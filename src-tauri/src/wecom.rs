use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    path::PathBuf,
    process::Stdio,
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::{process::Child, sync::{mpsc, watch, Mutex as AsyncMutex}};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const WECOM_CLI_VERSION: &str = "1.1.0";
const WECOM_WS_URL: &str = "wss://openws.work.weixin.qq.com";
const KEYRING_SERVICE: &str = "Kardii AI Companion";
const WECOM_BOT_SECRET_ACCOUNT: &str = "wecom-api-bot-secret-v1";
const MAX_CLI_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_DOCUMENT_CONTENT_CHARS: usize = 120_000;
const MAX_WECOM_REPLY_BYTES: usize = 20_000;

#[derive(Debug)]
struct AuthSession {
    child: Child,
    directory: PathBuf,
}

#[derive(Clone)]
struct BotRuntime {
    cancel: watch::Sender<bool>,
    outbound: mpsc::Sender<OutboundReply>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomBotStatus {
    running: bool,
    connected: bool,
    state: String,
    bot_id: String,
    last_error: String,
    last_message_at: u64,
    received_count: u64,
}

#[derive(Clone)]
pub struct WecomState {
    auth_session: Arc<AsyncMutex<Option<AuthSession>>>,
    bot_runtime: Arc<AsyncMutex<Option<BotRuntime>>>,
    bot_status: Arc<Mutex<WecomBotStatus>>,
    seen_messages: Arc<Mutex<VecDeque<String>>>,
    pending_replies: Arc<Mutex<HashMap<String, (String, u64)>>>,
    bot_generation: Arc<AtomicU64>,
}

impl Default for WecomState {
    fn default() -> Self {
        Self {
            auth_session: Arc::new(AsyncMutex::new(None)),
            bot_runtime: Arc::new(AsyncMutex::new(None)),
            bot_status: Arc::new(Mutex::new(WecomBotStatus {
                state: "stopped".into(),
                ..WecomBotStatus::default()
            })),
            seen_messages: Arc::new(Mutex::new(VecDeque::new())),
            pending_replies: Arc::new(Mutex::new(HashMap::new())),
            bot_generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomComponentStatus {
    installed: bool,
    version: String,
    binary_path: String,
    expected_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomAuthorizationStatus {
    component: WecomComponentStatus,
    authorized: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomAuthStart {
    qr_data_url: String,
    expires_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomDocumentSummary {
    pub doc_id: String,
    pub name: String,
    pub doc_type: String,
    pub url: String,
    pub modified_at: String,
    pub highlights: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomDocumentReadRequest {
    pub doc_id: String,
    pub doc_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomDocumentPage {
    pub page_id: String,
    pub title: String,
    pub parent_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomDocumentContent {
    pub doc_id: String,
    pub name: String,
    pub doc_type: String,
    pub url: String,
    pub version: i64,
    pub content: String,
    pub pages: Vec<WecomDocumentPage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomDocumentWriteRequest {
    pub action: String,
    #[serde(default)]
    pub doc_id: String,
    #[serde(default)]
    pub doc_type: String,
    #[serde(default)]
    pub page_id: String,
    #[serde(default)]
    pub title: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomDocumentWriteResult {
    pub action: String,
    pub doc_id: String,
    pub url: String,
    pub status: String,
    pub previous_version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WecomIncomingMessage {
    message_id: String,
    request_id: String,
    conversation_key: String,
    from_user_id: String,
    chat_type: String,
    text: String,
}

#[derive(Debug)]
struct OutboundReply {
    request_id: String,
    stream_id: String,
    content: String,
    finish: bool,
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn clean_identifier(value: &str, label: &str, max_len: usize) -> Result<String, String> {
    let clean = value.trim();
    if clean.is_empty()
        || clean.len() > max_len
        || clean.chars().any(char::is_control)
        || !clean
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(format!("{label} 格式无效。"));
    }
    Ok(clean.to_string())
}

fn clean_text(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let clean = value.trim();
    if clean.is_empty() {
        return Err(format!("{label}不能为空。"));
    }
    if clean.chars().count() > max_chars || clean.chars().any(|character| character == '\0') {
        return Err(format!("{label}过长或包含无效字符。"));
    }
    Ok(clean.to_string())
}

fn validate_document_content(value: &str) -> Result<String, String> {
    let content = clean_text(value, "文档内容", MAX_DOCUMENT_CONTENT_CHARS)?;
    let lower = content.to_ascii_lowercase();
    if ["<script", "javascript:", "onerror=", "onload="].iter().any(|term| lower.contains(term)) {
        return Err("文档内容包含脚本或事件处理代码，已拒绝写入企业微信。".into());
    }
    Ok(content)
}

fn truncate_output(value: &str, max_chars: usize) -> String {
    let mut result: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        result.push_str("…");
    }
    result
}

fn bundled_binary_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("wecom-cli-windows-x86_64.exe"),
        ("macos", "aarch64") => Some("wecom-cli-macos-aarch64"),
        ("macos", "x86_64") => Some("wecom-cli-macos-x86_64"),
        ("linux", "aarch64") => Some("wecom-cli-linux-aarch64"),
        ("linux", "x86_64") => Some("wecom-cli-linux-x86_64"),
        _ => None,
    }
}

fn locate_wecom_cli(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("KARDII_WECOM_CLI") {
        let candidate = PathBuf::from(override_path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if let Some(name) = bundled_binary_name() {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let candidate = resource_dir.join("wecom-cli").join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("wecom-cli")
            .join(name);
        if development.is_file() {
            return Ok(development);
        }
    }

    #[cfg(debug_assertions)]
    {
        return Ok(PathBuf::from(if cfg!(target_os = "windows") {
            "wecom-cli.exe"
        } else {
            "wecom-cli"
        }));
    }
    #[cfg(not(debug_assertions))]
    Err("安装包中缺少企业微信官方组件，请重新安装 Kardii。".into())
}

fn wecom_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法打开 Kardii 数据目录：{error}"))?
        .join("wecom-cli");
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建企业微信连接目录：{error}"))?;
    Ok(root)
}

fn configure_cli_command(command: &mut tokio::process::Command, app: &tauri::AppHandle) -> Result<(), String> {
    let root = wecom_root(app)?;
    let temporary = root.join("tmp");
    std::fs::create_dir_all(&temporary)
        .map_err(|error| format!("无法创建企业微信临时目录：{error}"))?;
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("WECOM_CLI_") {
            command.env_remove(key);
        }
    }
    command
        .env("WECOM_CLI_CONFIG_DIR", &root)
        .env("WECOM_CLI_TMP_DIR", &temporary)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.as_std_mut().creation_flags(0x08000000);
    Ok(())
}

async fn run_cli(
    app: &tauri::AppHandle,
    args: Vec<OsString>,
    timeout: Duration,
) -> Result<String, String> {
    let binary = locate_wecom_cli(app)?;
    let mut command = tokio::process::Command::new(&binary);
    configure_cli_command(&mut command, app)?;
    command.args(args);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| "企业微信组件响应超时，请稍后重试。".to_string())?
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "未找到企业微信官方组件。请重新运行 Kardii 安装包或执行 npm run prepare:wecom。".to_string()
            } else {
                format!("无法启动企业微信官方组件：{error}")
            }
        })?;
    if output.stdout.len() > MAX_CLI_OUTPUT_BYTES || output.stderr.len() > MAX_CLI_OUTPUT_BYTES {
        return Err("企业微信组件返回的数据异常过大，已停止读取。".into());
    }
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            format!("企业微信组件执行失败（退出码 {:?}）。", output.status.code())
        } else {
            format!("企业微信组件执行失败：{}", truncate_output(&detail, 1_200))
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn cli_json(
    app: &tauri::AppHandle,
    command: &[&str],
    payload: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let json_payload = serde_json::to_string(&payload)
        .map_err(|_| "无法编码企业微信请求。".to_string())?;
    let mut args: Vec<OsString> = command.iter().map(OsString::from).collect();
    args.push("--json".into());
    args.push(json_payload.into());
    let output = run_cli(app, args, timeout).await?;
    serde_json::from_str(&output)
        .map_err(|_| format!("企业微信组件返回了无法读取的数据：{}", truncate_output(&output, 600)))
}

fn parse_component_version(output: &str) -> String {
    output
        .split_whitespace()
        .find(|part| part.chars().next().is_some_and(|character| character.is_ascii_digit()))
        .unwrap_or_default()
        .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '.')
        .to_string()
}

#[tauri::command]
pub async fn wecom_component_status(app: tauri::AppHandle) -> WecomComponentStatus {
    let binary = locate_wecom_cli(&app).unwrap_or_default();
    match run_cli(&app, vec!["--version".into()], Duration::from_secs(8)).await {
        Ok(output) => {
            let version = parse_component_version(&output);
            WecomComponentStatus {
                installed: version == WECOM_CLI_VERSION,
                version,
                binary_path: binary.to_string_lossy().to_string(),
                expected_version: WECOM_CLI_VERSION.into(),
            }
        }
        Err(_) => WecomComponentStatus {
            installed: false,
            version: String::new(),
            binary_path: binary.to_string_lossy().to_string(),
            expected_version: WECOM_CLI_VERSION.into(),
        },
    }
}

#[tauri::command]
pub async fn wecom_authorization_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, WecomState>,
) -> Result<WecomAuthorizationStatus, String> {
    {
        let mut guard = state.auth_session.lock().await;
        let finished = guard
            .as_mut()
            .and_then(|session| session.child.try_wait().ok().flatten())
            .is_some();
        if finished {
            if let Some(session) = guard.take() {
                let _ = std::fs::remove_file(session.directory.join("qr.png"));
            }
        }
    }
    let component = wecom_component_status(app.clone()).await;
    let authorized = if component.installed {
        run_cli(
            &app,
            vec!["auth".into(), "show".into(), "--status".into()],
            Duration::from_secs(8),
        )
        .await
        .is_ok_and(|output| output.lines().any(|line| line.trim() == "authorized"))
    } else {
        false
    };
    Ok(WecomAuthorizationStatus { component, authorized })
}

#[tauri::command]
pub async fn start_wecom_qr_authorization(
    app: tauri::AppHandle,
    state: tauri::State<'_, WecomState>,
) -> Result<WecomAuthStart, String> {
    let binary = locate_wecom_cli(&app)?;
    if !wecom_component_status(app.clone()).await.installed {
        return Err("企业微信官方组件尚未准备好，请重新安装 Kardii。".into());
    }

    let mut session_guard = state.auth_session.lock().await;
    if let Some(mut previous) = session_guard.take() {
        let _ = previous.child.kill().await;
        let _ = std::fs::remove_file(previous.directory.join("qr.png"));
    }
    let directory = wecom_root(&app)?.join("qr-authorization");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建二维码目录：{error}"))?;
    let qr_path = directory.join("qr.png");
    let _ = std::fs::remove_file(&qr_path);

    let mut command = tokio::process::Command::new(binary);
    configure_cli_command(&mut command, &app)?;
    command
        .current_dir(&directory)
        .args(["auth", "init", "--noninteractive", "--no-browser", "--output-qrcode", "qr.png"]);
    let child = command
        .spawn()
        .map_err(|error| format!("无法启动企业微信扫码授权：{error}"))?;
    *session_guard = Some(AuthSession {
        child,
        directory: directory.clone(),
    });
    drop(session_guard);

    for _ in 0..120 {
        if let Ok(bytes) = std::fs::read(&qr_path) {
            if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() < 2 * 1024 * 1024 {
                return Ok(WecomAuthStart {
                    qr_data_url: format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
                    expires_at: now_epoch() + 300,
                });
            }
        }
        {
            let mut guard = state.auth_session.lock().await;
            if let Some(session) = guard.as_mut() {
                if let Ok(Some(status)) = session.child.try_wait() {
                    *guard = None;
                    return Err(format!("企业微信扫码授权未能启动（退出码 {:?}）。", status.code()));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    cancel_wecom_qr_authorization(state).await?;
    Err("企业微信二维码生成超时，请重试。".into())
}

#[tauri::command]
pub async fn cancel_wecom_qr_authorization(
    state: tauri::State<'_, WecomState>,
) -> Result<(), String> {
    let mut guard = state.auth_session.lock().await;
    if let Some(mut session) = guard.take() {
        let _ = session.child.kill().await;
        let _ = std::fs::remove_file(session.directory.join("qr.png"));
    }
    Ok(())
}

#[tauri::command]
pub async fn disconnect_wecom_documents(
    app: tauri::AppHandle,
    state: tauri::State<'_, WecomState>,
) -> Result<(), String> {
    cancel_wecom_qr_authorization(state).await?;
    let root = wecom_root(&app)?;
    for name in ["credentials.enc", ".encryption_key", "bot.enc", "token.enc"] {
        match std::fs::remove_file(root.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法删除企业微信授权凭据：{error}")),
        }
    }
    let cache = root.join("cache");
    if cache.is_dir() {
        std::fs::remove_dir_all(cache)
            .map_err(|error| format!("无法清除企业微信授权缓存：{error}"))?;
    }
    Ok(())
}

fn search_keywords(query: &str) -> Vec<String> {
    let mut values = Vec::new();
    let full = query.trim();
    if !full.is_empty() {
        values.push(full.to_string());
    }
    for token in full.split(|character: char| {
        character.is_whitespace()
            || matches!(character, ',' | '，' | '。' | '、' | '/' | '\\' | ':' | '：' | ';' | '；')
    }) {
        let clean = token.trim();
        if clean.chars().count() >= 2 && !values.iter().any(|value| value == clean) {
            values.push(clean.to_string());
        }
        if values.len() >= 6 {
            break;
        }
    }
    values
}

#[tauri::command]
pub async fn search_wecom_documents(
    app: tauri::AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WecomDocumentSummary>, String> {
    let clean = clean_text(&query, "搜索词", 200)?;
    let payload = cli_json(
        &app,
        &["doc", "search"],
        json!({
            "keywords": search_keywords(&clean),
            "search_scope": "title_content",
            "sort_by": "best_match",
            "limit": limit.unwrap_or(10).clamp(1, 20),
        }),
        Duration::from_secs(30),
    )
    .await?;
    let docs = payload
        .get("docs")
        .and_then(Value::as_array)
        .ok_or_else(|| "企业微信文档搜索结果缺少文档列表。".to_string())?;
    Ok(docs
        .iter()
        .filter_map(|item| {
            let doc_id = item.get("docid")?.as_str()?.trim().to_string();
            if doc_id.is_empty() {
                return None;
            }
            let highlights = ["title_highlight", "text_highlight"]
                .iter()
                .flat_map(|key| item.get(key).and_then(Value::as_array).into_iter().flatten())
                .filter_map(Value::as_str)
                .map(|value| truncate_output(value, 300))
                .take(4)
                .collect();
            Some(WecomDocumentSummary {
                doc_id,
                name: item.get("doc_name").and_then(Value::as_str).unwrap_or("未命名文档").to_string(),
                doc_type: item.get("doc_type").and_then(Value::as_str).unwrap_or("unknown").to_string(),
                url: item.get("url").and_then(Value::as_str).unwrap_or_default().to_string(),
                modified_at: item.get("modify_time").and_then(Value::as_str).unwrap_or_default().to_string(),
                highlights,
            })
        })
        .collect())
}

fn read_cli_generated_file(app: &tauri::AppHandle, value: &str) -> Result<String, String> {
    let path = PathBuf::from(value);
    let canonical = path
        .canonicalize()
        .map_err(|_| "企业微信组件返回的临时内容文件不存在。".to_string())?;
    let temporary = wecom_root(app)?
        .join("tmp")
        .canonicalize()
        .map_err(|_| "企业微信临时目录不存在。".to_string())?;
    if !canonical.starts_with(&temporary) {
        return Err("企业微信组件返回了临时目录之外的文件，已拒绝读取。".into());
    }
    let metadata = std::fs::metadata(&canonical)
        .map_err(|_| "无法读取企业微信文档临时文件。".to_string())?;
    if metadata.len() > 2 * 1024 * 1024 {
        return Err("企业微信文档内容超过 2 MB，请缩小读取范围。".into());
    }
    std::fs::read_to_string(canonical)
        .map_err(|_| "企业微信文档内容不是可读取的 UTF-8 文本。".to_string())
}

fn value_text_or_file(app: &tauri::AppHandle, value: &Value) -> Result<String, String> {
    for key in ["content", "content_file_inner"] {
        if let Some(content) = value.get(key).and_then(Value::as_str).filter(|content| !content.is_empty()) {
            return Ok(content.to_string());
        }
    }
    if let Some(path) = value.get("file_path").and_then(Value::as_str) {
        return read_cli_generated_file(app, path);
    }
    Ok(String::new())
}

pub async fn read_document(
    app: &tauri::AppHandle,
    request: &WecomDocumentReadRequest,
) -> Result<WecomDocumentContent, String> {
    let doc_id = clean_identifier(&request.doc_id, "企业微信文档 ID", 256)?;
    let doc_type = request.doc_type.trim().to_ascii_lowercase();
    match doc_type.as_str() {
        "doc" => {
            let payload = cli_json(
                app,
                &["doc", "contents", "get"],
                json!({ "docid": doc_id, "content_type": "markdown" }),
                Duration::from_secs(40),
            )
            .await?;
            Ok(WecomDocumentContent {
                doc_id: request.doc_id.trim().to_string(),
                name: payload.get("name").and_then(Value::as_str).unwrap_or("在线文档").to_string(),
                doc_type,
                url: payload.get("url").and_then(Value::as_str).unwrap_or_default().to_string(),
                version: payload.get("version").and_then(Value::as_i64).unwrap_or_default(),
                content: truncate_output(&value_text_or_file(app, &payload)?, 200_000),
                pages: Vec::new(),
            })
        }
        "smartpage" => {
            let structure = cli_json(
                app,
                &["smartpage", "pages", "get"],
                json!({ "docid": doc_id }),
                Duration::from_secs(40),
            )
            .await?;
            let title = structure.get("doc_title").and_then(Value::as_str).unwrap_or("智能文档").to_string();
            let page_values = structure.get("pages").and_then(Value::as_array).cloned().unwrap_or_default();
            let mut pages = Vec::new();
            let mut combined = String::new();
            for page in page_values.into_iter().take(20) {
                let Some(page_id) = page.get("page_id").and_then(Value::as_str).filter(|value| !value.is_empty()) else { continue };
                let detail = cli_json(
                    app,
                    &["smartpage", "pages", "get"],
                    json!({ "docid": request.doc_id.trim(), "page_id": page_id, "content_type": "markdown" }),
                    Duration::from_secs(40),
                )
                .await?;
                let detail_page = detail.get("pages").and_then(Value::as_array).and_then(|items| items.first()).unwrap_or(&page);
                let content = truncate_output(&value_text_or_file(app, detail_page)?, 80_000);
                let page_title = page.get("page_title").and_then(Value::as_str).unwrap_or("未命名页面").to_string();
                if combined.chars().count() < 200_000 {
                    combined.push_str(&format!("\n\n# {page_title}\n\n{content}"));
                }
                pages.push(WecomDocumentPage {
                    page_id: page_id.to_string(),
                    title: page_title,
                    parent_id: page.get("parent_id").and_then(Value::as_str).unwrap_or_default().to_string(),
                    content,
                });
            }
            Ok(WecomDocumentContent {
                doc_id: request.doc_id.trim().to_string(),
                name: title,
                doc_type,
                url: format!("https://doc.weixin.qq.com/smartpage/{}", request.doc_id.trim()),
                version: 0,
                content: truncate_output(combined.trim(), 200_000),
                pages,
            })
        }
        _ => Err("Kardii 当前可读取并修改企微在线文档（doc）和智能文档（smartpage）；其他类型可从搜索结果打开查看。".into()),
    }
}

#[tauri::command]
pub async fn read_wecom_document(
    app: tauri::AppHandle,
    request: WecomDocumentReadRequest,
) -> Result<WecomDocumentContent, String> {
    read_document(&app, &request).await
}

struct TemporaryDocumentFile(PathBuf);

impl TemporaryDocumentFile {
    fn create(app: &tauri::AppHandle, content: &str) -> Result<Self, String> {
        let directory = wecom_root(app)?.join("requests");
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("无法创建企微文档请求目录：{error}"))?;
        let path = directory.join(format!(
            "document-{}-{}-{}.md",
            std::process::id(),
            now_epoch(),
            rand::random::<u64>()
        ));
        std::fs::write(&path, content)
            .map_err(|error| format!("无法准备企微文档内容：{error}"))?;
        Ok(Self(path))
    }
}

impl Drop for TemporaryDocumentFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[tauri::command]
pub async fn write_wecom_document(
    app: tauri::AppHandle,
    request: WecomDocumentWriteRequest,
) -> Result<WecomDocumentWriteResult, String> {
    let action = request.action.trim().to_ascii_lowercase();
    if !matches!(action.as_str(), "create" | "append" | "overwrite") {
        return Err("不支持这个企业微信文档写入动作。".into());
    }
    let content = validate_document_content(&request.content)?;
    if action == "create" {
        let title = clean_text(&request.title, "文档标题", 120)?;
        let file = TemporaryDocumentFile::create(&app, &content)?;
        let payload = cli_json(
            &app,
            &["smartpage", "import"],
            json!({ "name": title, "file_path": file.0.to_string_lossy().to_string() }),
            Duration::from_secs(90),
        )
        .await?;
        return Ok(WecomDocumentWriteResult {
            action,
            doc_id: payload.get("docid").and_then(Value::as_str).unwrap_or_default().to_string(),
            url: payload.get("url").and_then(Value::as_str).unwrap_or_default().to_string(),
            status: payload.get("status").or_else(|| payload.get("task_status")).and_then(Value::as_str).unwrap_or("success").to_string(),
            previous_version: 0,
        });
    }

    let doc_id = clean_identifier(&request.doc_id, "企业微信文档 ID", 256)?;
    let doc_type = request.doc_type.trim().to_ascii_lowercase();
    let latest = read_document(
        &app,
        &WecomDocumentReadRequest {
            doc_id: doc_id.clone(),
            doc_type: doc_type.clone(),
        },
    )
    .await?;
    let payload = match doc_type.as_str() {
        "doc" if action == "append" => {
            cli_json(
                &app,
                &["doc", "contents", "append"],
                json!({ "docid": doc_id, "content": content }),
                Duration::from_secs(60),
            )
            .await?
        }
        "doc" => {
            cli_json(
                &app,
                &["doc", "contents", "overwrite"],
                json!({ "docid": doc_id, "content_type": "text", "content": content }),
                Duration::from_secs(60),
            )
            .await?
        }
        "smartpage" => {
            if doc_id.starts_with("b1_") {
                return Err("这是发布态智能文档，只能读取。请在企业微信中打开编辑态链接后再修改。".into());
            }
            let page_id = if request.page_id.trim().is_empty() {
                if latest.pages.len() == 1 {
                    latest.pages[0].page_id.clone()
                } else {
                    return Err("智能文档包含多个页面，请先读取文档并明确选择要修改的页面。".into());
                }
            } else {
                let clean = clean_identifier(&request.page_id, "智能文档页面 ID", 256)?;
                if !latest.pages.iter().any(|page| page.page_id == clean) {
                    return Err("页面 ID 不在刚刚读取的最新文档结构中，已拒绝写入。".into());
                }
                clean
            };
            let file = TemporaryDocumentFile::create(&app, &content)?;
            cli_json(
                &app,
                &["smartpage", "pages", if action == "append" { "append" } else { "overwrite" }],
                json!({
                    "docid": doc_id,
                    "page_id": page_id,
                    "content_type": "markdown",
                    "file_path": file.0.to_string_lossy().to_string(),
                }),
                Duration::from_secs(60),
            )
            .await?
        }
        _ => return Err("Kardii 当前只修改企微在线文档（doc）和编辑态智能文档（smartpage）。".into()),
    };
    Ok(WecomDocumentWriteResult {
        action,
        doc_id: request.doc_id.trim().to_string(),
        url: if latest.url.is_empty() {
            payload.get("url").or_else(|| payload.get("page_url")).and_then(Value::as_str).unwrap_or_default().to_string()
        } else {
            latest.url
        },
        status: payload.get("status").and_then(Value::as_str).unwrap_or("success").to_string(),
        previous_version: latest.version,
    })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn save_bot_secret(secret: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, WECOM_BOT_SECRET_ACCOUNT)
        .map_err(|error| format!("无法打开系统安全凭据库：{error}"))?
        .set_password(secret)
        .map_err(|error| format!("无法保存企业微信机器人 Secret：{error}"))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn load_bot_secret() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, WECOM_BOT_SECRET_ACCOUNT)
        .ok()?
        .get_password()
        .ok()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn delete_bot_secret() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, WECOM_BOT_SECRET_ACCOUNT)
        .map_err(|error| format!("无法打开系统安全凭据库：{error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法删除企业微信机器人 Secret：{error}")),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn development_bot_secret() -> &'static Mutex<Option<String>> {
    static SECRET: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SECRET.get_or_init(|| Mutex::new(None))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn save_bot_secret(secret: &str) -> Result<(), String> {
    *development_bot_secret()
        .lock()
        .map_err(|_| "无法锁定企业微信开发凭据。".to_string())? = Some(secret.to_string());
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn load_bot_secret() -> Option<String> {
    development_bot_secret().lock().ok()?.clone()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn delete_bot_secret() -> Result<(), String> {
    *development_bot_secret()
        .lock()
        .map_err(|_| "无法锁定企业微信开发凭据。".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn save_wecom_bot_secret(secret: String) -> Result<(), String> {
    let clean = clean_text(&secret, "企业微信机器人 Secret", 1_024)?;
    save_bot_secret(&clean)
}

#[tauri::command]
pub fn has_wecom_bot_secret() -> bool {
    load_bot_secret().is_some_and(|secret| !secret.trim().is_empty())
}

#[tauri::command]
pub async fn delete_wecom_bot_secret(
    app: tauri::AppHandle,
    state: tauri::State<'_, WecomState>,
) -> Result<(), String> {
    stop_bot_runtime(state.inner()).await;
    delete_bot_secret()?;
    set_bot_status(state.inner(), &app, |status| {
        status.running = false;
        status.connected = false;
        status.state = "stopped".into();
        status.last_error.clear();
    });
    Ok(())
}

fn set_bot_status(
    state: &WecomState,
    app: &tauri::AppHandle,
    update: impl FnOnce(&mut WecomBotStatus),
) {
    let status = {
        let mut guard = state.bot_status.lock().unwrap_or_else(|error| error.into_inner());
        update(&mut guard);
        guard.clone()
    };
    let _ = app.emit("kardii-wecom-status", status);
}

fn set_bot_loop_status(
    state: &WecomState,
    app: &tauri::AppHandle,
    generation: u64,
    update: impl FnOnce(&mut WecomBotStatus),
) {
    if state.bot_generation.load(Ordering::SeqCst) == generation {
        set_bot_status(state, app, update);
    }
}

fn current_bot_status(state: &WecomState) -> WecomBotStatus {
    state
        .bot_status
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

fn bot_request_id(prefix: &str) -> String {
    format!("{prefix}_{}_{}", now_epoch(), rand::random::<u64>())
}

fn truncate_utf8_bytes(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let suffix = "\n\n…（回复已按企业微信长度限制截取）";
    let mut end = max_bytes.saturating_sub(suffix.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &value[..end], suffix)
}

fn mark_message_pending(state: &WecomState, message_id: &str, request_id: &str, generation: u64) -> bool {
    if state.bot_generation.load(Ordering::SeqCst) != generation {
        return false;
    }
    let mut seen = state.seen_messages.lock().unwrap_or_else(|error| error.into_inner());
    if seen.iter().any(|existing| existing == message_id) {
        return false;
    }
    seen.push_back(message_id.to_string());
    if seen.len() > 300 {
        if let Some(oldest) = seen.pop_front() {
            state
                .pending_replies
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(&oldest);
        }
    }
    state
        .pending_replies
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(message_id.to_string(), (request_id.to_string(), generation));
    true
}

fn response_frame(reply: &OutboundReply) -> Value {
    json!({
        "cmd": "aibot_respond_msg",
        "headers": { "req_id": reply.request_id },
        "body": {
            "msgtype": "stream",
            "stream": {
                "id": reply.stream_id,
                "finish": reply.finish,
                "content": reply.content,
            }
        }
    })
}

fn incoming_text(body: &Value) -> Option<String> {
    match body.get("msgtype").and_then(Value::as_str) {
        Some("text") => body.pointer("/text/content").and_then(Value::as_str).map(str::to_string),
        Some("voice") => body.pointer("/voice/content").and_then(Value::as_str).map(str::to_string),
        _ => None,
    }
}

fn incoming_payload(frame: &Value, expected_bot_id: &str) -> Option<WecomIncomingMessage> {
    let body = frame.get("body")?;
    let request_id = frame.pointer("/headers/req_id")?.as_str()?.trim();
    let text = incoming_text(body)?.trim().to_string();
    if request_id.is_empty() || text.is_empty() {
        return None;
    }
    let incoming_bot_id = body.get("aibotid").and_then(Value::as_str)?.trim();
    if incoming_bot_id != expected_bot_id {
        return None;
    }
    let from_user_id = body.pointer("/from/userid").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let chat_type = body.get("chattype").and_then(Value::as_str).unwrap_or("single").to_string();
    let chat_id = body.get("chatid").and_then(Value::as_str).unwrap_or_default().trim();
    let message_id = body.get("msgid").and_then(Value::as_str).filter(|value| !value.trim().is_empty()).unwrap_or(request_id).to_string();
    if chat_id.is_empty() && from_user_id.is_empty() {
        return None;
    }
    let conversation_key = if !chat_id.is_empty() {
        format!("bot:{incoming_bot_id}:chat:{chat_id}")
    } else {
        format!("bot:{incoming_bot_id}:single:{from_user_id}")
    };
    Some(WecomIncomingMessage {
        message_id,
        request_id: request_id.to_string(),
        conversation_key,
        from_user_id,
        chat_type,
        text: truncate_output(&text, 4_000),
    })
}

async fn wait_before_reconnect(cancel: &mut watch::Receiver<bool>, seconds: u64) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs(seconds)) => true,
        _ = cancel.changed() => false,
    }
}

async fn run_bot_loop(
    app: tauri::AppHandle,
    state: WecomState,
    bot_id: String,
    secret: String,
    mut outbound: mpsc::Receiver<OutboundReply>,
    mut cancel: watch::Receiver<bool>,
    generation: u64,
) {
    let mut reconnect_attempt = 0_u32;
    loop {
        if *cancel.borrow() || state.bot_generation.load(Ordering::SeqCst) != generation {
            break;
        }
        set_bot_loop_status(&state, &app, generation, |status| {
            status.running = true;
            status.connected = false;
            status.state = if reconnect_attempt == 0 { "connecting" } else { "reconnecting" }.into();
            status.bot_id = bot_id.clone();
        });

        let connection = connect_async(WECOM_WS_URL).await;
        let (socket, _) = match connection {
            Ok(value) => value,
            Err(error) => {
                set_bot_loop_status(&state, &app, generation, |status| status.last_error = format!("无法连接企业微信：{error}"));
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                let delay = 2_u64.saturating_pow(reconnect_attempt.min(4)).min(30);
                if !wait_before_reconnect(&mut cancel, delay).await { break; }
                continue;
            }
        };
        let (mut writer, mut reader) = socket.split();
        let auth_request_id = bot_request_id("aibot_subscribe");
        let auth = json!({
            "cmd": "aibot_subscribe",
            "headers": { "req_id": auth_request_id },
            "body": { "bot_id": bot_id.clone(), "secret": secret.clone() },
        });
        if writer.send(Message::Text(auth.to_string().into())).await.is_err() {
            reconnect_attempt = reconnect_attempt.saturating_add(1);
            if !wait_before_reconnect(&mut cancel, 2).await { break; }
            continue;
        }

        let mut authenticated = false;
        let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let authentication_deadline = tokio::time::sleep(Duration::from_secs(20));
        tokio::pin!(authentication_deadline);
        let mut should_reconnect = true;

        loop {
            tokio::select! {
                _ = cancel.changed() => {
                    should_reconnect = false;
                    let _ = writer.close().await;
                    break;
                }
                _ = &mut authentication_deadline, if !authenticated => {
                    set_bot_loop_status(&state, &app, generation, |status| status.last_error = "企业微信机器人认证超时。".into());
                    break;
                }
                _ = heartbeat.tick(), if authenticated => {
                    let heartbeat_frame = json!({
                        "cmd": "ping",
                        "headers": { "req_id": bot_request_id("ping") },
                    });
                    if writer.send(Message::Text(heartbeat_frame.to_string().into())).await.is_err() {
                        break;
                    }
                }
                reply = outbound.recv(), if authenticated => {
                    let Some(reply) = reply else {
                        should_reconnect = false;
                        break;
                    };
                    if writer.send(Message::Text(response_frame(&reply).to_string().into())).await.is_err() {
                        break;
                    }
                }
                message = reader.next() => {
                    let Some(message) = message else { break };
                    let message = match message {
                        Ok(Message::Text(text)) => text.to_string(),
                        Ok(Message::Binary(bytes)) => String::from_utf8(bytes.to_vec()).unwrap_or_default(),
                        Ok(Message::Close(_)) | Err(_) => break,
                        _ => continue,
                    };
                    let Ok(frame) = serde_json::from_str::<Value>(&message) else { continue };
                    let request_id = frame.pointer("/headers/req_id").and_then(Value::as_str).unwrap_or_default();
                    if request_id == auth_request_id {
                        if frame.get("errcode").and_then(Value::as_i64).unwrap_or(-1) != 0 {
                            let detail = frame.get("errmsg").and_then(Value::as_str).unwrap_or("Bot ID 或 Secret 无效");
                            set_bot_loop_status(&state, &app, generation, |status| {
                                status.state = "error".into();
                                status.last_error = format!("企业微信机器人认证失败：{detail}");
                            });
                            should_reconnect = false;
                            break;
                        }
                        authenticated = true;
                        reconnect_attempt = 0;
                        set_bot_loop_status(&state, &app, generation, |status| {
                            status.connected = true;
                            status.state = "connected".into();
                            status.last_error.clear();
                        });
                        continue;
                    }
                    if frame.get("cmd").and_then(Value::as_str) == Some("aibot_event_callback")
                        && frame.pointer("/body/event/eventtype").and_then(Value::as_str) == Some("disconnected_event")
                    {
                        set_bot_loop_status(&state, &app, generation, |status| {
                            status.connected = false;
                            status.state = "disconnected".into();
                            status.last_error = "另一个客户端连接了同一企业微信机器人，本连接已停止。".into();
                        });
                        should_reconnect = false;
                        break;
                    }
                    if frame.get("cmd").and_then(Value::as_str) != Some("aibot_msg_callback") {
                        continue;
                    }
                    if state.bot_generation.load(Ordering::SeqCst) != generation {
                        should_reconnect = false;
                        break;
                    }
                    if let Some(payload) = incoming_payload(&frame, &bot_id) {
                        if !mark_message_pending(&state, &payload.message_id, &payload.request_id, generation) {
                            continue;
                        }
                        set_bot_loop_status(&state, &app, generation, |status| {
                            status.last_message_at = now_epoch();
                            status.received_count = status.received_count.saturating_add(1);
                        });
                        if app.emit_to("main", "kardii-wecom-message", payload).is_err() {
                            set_bot_loop_status(&state, &app, generation, |status| status.last_error = "Kardii 主窗口没有接收企微消息，请保持应用运行。".into());
                        }
                    } else {
                        let message_id = frame.pointer("/body/msgid").and_then(Value::as_str).unwrap_or(request_id);
                        if mark_message_pending(&state, message_id, request_id, generation) {
                            state.pending_replies.lock().unwrap_or_else(|error| error.into_inner()).remove(message_id);
                            let reply = OutboundReply {
                                request_id: request_id.to_string(),
                                stream_id: bot_request_id("kardii"),
                                content: "Kardii 目前支持企业微信中的文字消息和已经转写成文字的语音消息。图片或文件请在桌面 Kardii 中上传。".into(),
                                finish: true,
                            };
                            let _ = writer.send(Message::Text(response_frame(&reply).to_string().into())).await;
                        }
                    }
                }
            }
        }

        set_bot_loop_status(&state, &app, generation, |status| status.connected = false);
        if !should_reconnect || *cancel.borrow() {
            break;
        }
        reconnect_attempt = reconnect_attempt.saturating_add(1);
        let delay = 2_u64.saturating_pow(reconnect_attempt.min(4)).min(30);
        if !wait_before_reconnect(&mut cancel, delay).await {
            break;
        }
    }
    set_bot_loop_status(&state, &app, generation, |status| {
        status.running = false;
        status.connected = false;
        if status.state != "error" && status.state != "disconnected" {
            status.state = "stopped".into();
        }
    });
}

async fn stop_bot_runtime(state: &WecomState) {
    state.bot_generation.fetch_add(1, Ordering::SeqCst);
    let runtime = state.bot_runtime.lock().await.take();
    if let Some(runtime) = runtime {
        let _ = runtime.cancel.send(true);
    }
    state
        .pending_replies
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
    state
        .seen_messages
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

#[tauri::command]
pub async fn start_wecom_bot(
    app: tauri::AppHandle,
    state: tauri::State<'_, WecomState>,
    bot_id: String,
) -> Result<WecomBotStatus, String> {
    let bot_id = clean_identifier(&bot_id, "企业微信 Bot ID", 256)?;
    let secret = load_bot_secret().filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "请先保存企业微信机器人的 Secret。".to_string())?;
    stop_bot_runtime(state.inner()).await;
    let generation = state.bot_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let (cancel_sender, cancel_receiver) = watch::channel(false);
    let (outbound_sender, outbound_receiver) = mpsc::channel(100);
    *state.bot_runtime.lock().await = Some(BotRuntime {
        cancel: cancel_sender,
        outbound: outbound_sender,
    });
    set_bot_status(state.inner(), &app, |status| {
        let last_message_at = status.last_message_at;
        let received_count = status.received_count;
        *status = WecomBotStatus {
            running: true,
            connected: false,
            state: "connecting".into(),
            bot_id: bot_id.clone(),
            last_error: String::new(),
            last_message_at,
            received_count,
        };
    });
    let owned_state = state.inner().clone();
    tauri::async_runtime::spawn(run_bot_loop(
        app,
        owned_state,
        bot_id,
        secret,
        outbound_receiver,
        cancel_receiver,
        generation,
    ));
    Ok(current_bot_status(state.inner()))
}

#[tauri::command]
pub async fn stop_wecom_bot(
    app: tauri::AppHandle,
    state: tauri::State<'_, WecomState>,
) -> Result<WecomBotStatus, String> {
    stop_bot_runtime(state.inner()).await;
    set_bot_status(state.inner(), &app, |status| {
        status.running = false;
        status.connected = false;
        status.state = "stopped".into();
        status.last_error.clear();
    });
    Ok(current_bot_status(state.inner()))
}

#[tauri::command]
pub fn wecom_bot_status(state: tauri::State<'_, WecomState>) -> WecomBotStatus {
    current_bot_status(state.inner())
}

#[tauri::command]
pub async fn reply_wecom_message(
    state: tauri::State<'_, WecomState>,
    message_id: String,
    request_id: String,
    content: String,
    stream_id: Option<String>,
    finish: Option<bool>,
) -> Result<String, String> {
    let message_id = clean_identifier(&message_id, "企业微信消息 ID", 256)?;
    let request_id = clean_identifier(&request_id, "企业微信请求 ID", 256)?;
    let (expected_request_id, expected_generation) = state
        .pending_replies
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&message_id)
        .cloned()
        .ok_or_else(|| "这条企业微信消息已经回复或已过期。".to_string())?;
    if expected_request_id != request_id
        || expected_generation != state.bot_generation.load(Ordering::SeqCst)
    {
        return Err("企业微信消息与回复请求不匹配，已拒绝发送。".into());
    }
    let content = clean_text(&content, "企业微信回复", MAX_WECOM_REPLY_BYTES)?;
    let stream_id = match stream_id {
        Some(value) => clean_identifier(&value, "企业微信流式回复 ID", 256)?,
        None => bot_request_id("kardii"),
    };
    let finish = finish.unwrap_or(true);
    let sender = state
        .bot_runtime
        .lock()
        .await
        .as_ref()
        .map(|runtime| runtime.outbound.clone())
        .ok_or_else(|| "企业微信机器人没有运行。".to_string())?;
    sender
        .send(OutboundReply {
            request_id,
            stream_id: stream_id.clone(),
            content: truncate_utf8_bytes(&content, MAX_WECOM_REPLY_BYTES),
            finish,
        })
        .await
        .map_err(|_| "企业微信机器人连接已经断开。".to_string())?;
    if finish {
        state
            .pending_replies
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&message_id);
    }
    Ok(stream_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_script_content() {
        assert!(validate_document_content("<script>alert(1)</script>").is_err());
        assert!(validate_document_content("正常的 Markdown 内容").is_ok());
    }

    #[test]
    fn reply_truncation_preserves_utf8() {
        let text = "好".repeat(10_000);
        let truncated = truncate_utf8_bytes(&text, 20_000);
        assert!(truncated.is_char_boundary(truncated.len()));
        assert!(truncated.len() <= 20_000);
    }

    #[test]
    fn response_frame_preserves_stream_id_and_finish_state() {
        let frame = response_frame(&OutboundReply {
            request_id: "request_1".into(),
            stream_id: "stream_1".into(),
            content: "正在生成".into(),
            finish: false,
        });
        assert_eq!(frame.pointer("/headers/req_id").and_then(Value::as_str), Some("request_1"));
        assert_eq!(frame.pointer("/body/stream/id").and_then(Value::as_str), Some("stream_1"));
        assert_eq!(frame.pointer("/body/stream/finish").and_then(Value::as_bool), Some(false));
    }

    #[test]
    fn search_terms_are_bounded() {
        let terms = search_keywords("项目 周报，市场 风险 下一步 负责人 日期");
        assert!(!terms.is_empty());
        assert!(terms.len() <= 6);
    }

    #[test]
    fn incoming_messages_are_scoped_to_the_authenticated_bot() {
        let frame = json!({
            "headers": { "req_id": "request_1" },
            "body": {
                "msgid": "message_1",
                "aibotid": "bot_1",
                "chattype": "group",
                "chatid": "chat_1",
                "from": { "userid": "user_1" },
                "msgtype": "text",
                "text": { "content": "你好" }
            }
        });
        assert!(incoming_payload(&frame, "another_bot").is_none());
        let payload = incoming_payload(&frame, "bot_1").expect("matching bot message");
        assert_eq!(payload.conversation_key, "bot:bot_1:chat:chat_1");
    }
}
