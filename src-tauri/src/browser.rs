use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{path::BaseDirectory, Manager};

const BRIDGE_PORT: u16 = 43_198;
const MAX_REQUEST_BYTES: usize = 1_200_000;
const MAX_PAGE_CHARS: usize = 120_000;
const MAX_PAIRING_FAILURES: u8 = 5;
const PAIRING_LOCK_SECONDS: u64 = 60;
const KEYRING_SERVICE: &str = "Kardii AI Companion";
const KEYRING_ACCOUNT: &str = "browser-bridge-token-v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserCaptureInput {
    title: String,
    url: String,
    #[serde(default)]
    selected_text: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    language: String,
    #[serde(default)]
    captured_at: String,
    #[serde(default)]
    targets: Vec<BrowserInteractiveElement>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInteractiveElement {
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub input_type: String,
    #[serde(default)]
    pub href: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapture {
    pub id: String,
    pub title: String,
    pub url: String,
    pub selected_text: String,
    pub content: String,
    pub description: String,
    pub language: String,
    pub captured_at: String,
    pub received_at: u64,
    pub source: String,
    pub targets: Vec<BrowserInteractiveElement>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserActionRequest {
    pub capture_id: String,
    pub action_type: String,
    #[serde(default)]
    pub target_id: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub amount: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPendingAction {
    pub id: String,
    pub capture_id: String,
    pub page_title: String,
    pub page_url: String,
    pub action_type: String,
    pub target_id: String,
    pub target_label: String,
    pub value: String,
    pub url: String,
    pub direction: String,
    pub amount: i32,
    pub created_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserActionResult {
    pub action_id: String,
    pub success: bool,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBridgeStatus {
    pub running: bool,
    pub port: u16,
    pub pairing_code: String,
    pub paired: bool,
    pub pairing_locked_until: Option<u64>,
    pub last_seen_at: Option<u64>,
    pub capture_count: u64,
    pub latest_capture_id: String,
    pub latest_title: String,
    pub latest_url: String,
    pub latest_captured_at: String,
    pub latest_content_chars: usize,
    pub pending_action: bool,
}

struct BrowserBridgeRuntime {
    running: bool,
    pairing_code: String,
    token: String,
    paired: bool,
    pairing_failures: u8,
    pairing_locked_until: Option<u64>,
    last_seen_at: Option<u64>,
    capture_count: u64,
    latest_capture: Option<BrowserCapture>,
    pending_action: Option<BrowserPendingAction>,
    action_result: Option<BrowserActionResult>,
    stop: Option<Arc<AtomicBool>>,
    thread: Option<JoinHandle<()>>,
}

impl BrowserBridgeRuntime {
    fn new() -> Self {
        Self {
            running: false,
            pairing_code: pairing_code(),
            token: load_or_create_token(),
            paired: false,
            pairing_failures: 0,
            pairing_locked_until: None,
            last_seen_at: None,
            capture_count: 0,
            latest_capture: None,
            pending_action: None,
            action_result: None,
            stop: None,
            thread: None,
        }
    }

    fn status(&self) -> BrowserBridgeStatus {
        let latest = self.latest_capture.as_ref();
        BrowserBridgeStatus {
            running: self.running,
            port: BRIDGE_PORT,
            pairing_code: self.pairing_code.clone(),
            paired: self.paired,
            pairing_locked_until: self.pairing_locked_until,
            last_seen_at: self.last_seen_at,
            capture_count: self.capture_count,
            latest_capture_id: latest.map(|item| item.id.clone()).unwrap_or_default(),
            latest_title: latest.map(|item| item.title.clone()).unwrap_or_default(),
            latest_url: latest.map(|item| item.url.clone()).unwrap_or_default(),
            latest_captured_at: latest.map(|item| item.captured_at.clone()).unwrap_or_default(),
            latest_content_chars: latest
                .map(|item| item.selected_text.chars().count().max(item.content.chars().count()))
                .unwrap_or(0),
            pending_action: self.pending_action.is_some(),
        }
    }
}

fn bridge_state() -> &'static Arc<Mutex<BrowserBridgeRuntime>> {
    static STATE: OnceLock<Arc<Mutex<BrowserBridgeRuntime>>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(Mutex::new(BrowserBridgeRuntime::new())))
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn pairing_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000_u32))
}

fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn load_or_create_token() -> String {
    let generated = random_token();
    let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) else {
        return generated;
    };
    if let Ok(saved) = entry.get_password() {
        if saved.len() >= 32 {
            return saved;
        }
    }
    let _ = entry.set_password(&generated);
    generated
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn load_or_create_token() -> String {
    random_token()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn save_token(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("无法打开系统安全凭据库：{error}"))?
        .set_password(token)
        .map_err(|error| format!("无法保存浏览器连接凭据：{error}"))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn save_token(_token: &str) -> Result<(), String> {
    Ok(())
}

fn clean_text(value: &str, max_chars: usize) -> String {
    value
        .replace('\0', "")
        .trim()
        .chars()
        .take(max_chars)
        .collect()
}

fn safe_web_url(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(clean_text(url.as_str(), 2_000))
}

fn clean_browser_target(value: BrowserInteractiveElement) -> Option<BrowserInteractiveElement> {
    let id = clean_text(&value.id, 40);
    let role = clean_text(&value.role, 20).to_ascii_lowercase();
    if id.is_empty()
        || !id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
        || !matches!(role.as_str(), "link" | "button" | "input" | "textarea" | "select" | "checkbox" | "radio")
    {
        return None;
    }
    Some(BrowserInteractiveElement {
        id,
        role,
        label: clean_text(&value.label, 300),
        input_type: clean_text(&value.input_type, 30).to_ascii_lowercase(),
        href: if value.href.trim().is_empty() { String::new() } else { safe_web_url(&value.href)? },
        disabled: value.disabled,
    })
}

fn contains_blocked_commerce_term(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let contains_blocked_word = lower
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|word| matches!(word, "pay" | "buy" | "refund"));
    contains_blocked_word || [
        "purchase", "payment", "checkout", "place order", "place_order", "buy now",
        "submit order", "submit_order", "add to cart", "add-to-cart", "transfer funds",
        "wire transfer", "withdraw", "charge card", "支付", "购买", "付款", "结账",
        "下单", "提交订单", "加入购物车", "转账", "汇款", "提现",
    ].iter().any(|term| lower.contains(term))
}

fn contains_blocked_account_action(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    ["sign in", "signin", "log in", "login", "sign up", "register", "登录", "登入", "注册"]
        .iter()
        .any(|term| lower.contains(term))
}

fn contains_sensitive_input_term(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "password", "passcode", "one-time", "otp", "verification code", "cvv", "cvc",
        "credit card", "card number", "security code", "api key", "token", "密码", "验证码",
        "信用卡", "银行卡", "安全码", "密钥",
    ].iter().any(|term| lower.contains(term))
}

fn dangerous_download_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [".exe", ".msi", ".dmg", ".pkg", ".sh", ".bat", ".cmd", ".ps1", ".scr", ".com", ".jar"]
        .iter()
        .any(|extension| lower.split(|character| character == '?' || character == '#').next().unwrap_or(&lower).ends_with(extension))
}

fn header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .map_err(|error| error.to_string())?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8_192];
    let end = loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("浏览器请求提前结束。".into());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("浏览器发送的页面资料过大。".into());
        }
        if let Some(end) = header_end(&buffer) {
            break end;
        }
        if buffer.len() > 32_768 {
            return Err("浏览器请求头过大。".into());
        }
    };
    let header_text = String::from_utf8_lossy(&buffer[..end]);
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().ok_or_else(|| "浏览器请求格式无效。".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().split('?').next().unwrap_or_default().to_string();
    if method.is_empty() || path.is_empty() {
        return Err("浏览器请求格式无效。".into());
    }
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_REQUEST_BYTES {
        return Err("浏览器发送的页面资料过大。".into());
    }
    while buffer.len() < end + content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("浏览器请求正文不完整。".into());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("浏览器发送的页面资料过大。".into());
        }
    }
    Ok(HttpRequest {
        method,
        path,
        headers,
        body: buffer[end..end + content_length].to_vec(),
    })
}

fn extension_origin(headers: &HashMap<String, String>) -> Option<String> {
    let origin = headers.get("origin")?;
    let extension_id = origin.strip_prefix("chrome-extension://")?;
    if extension_id.len() == 32
        && extension_id
            .bytes()
            .all(|character| (b'a'..=b'p').contains(&character))
    {
        Some(origin.clone())
    } else {
        None
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    body: serde_json::Value,
    origin: Option<&str>,
) {
    let payload = body.to_string();
    let cors = origin
        .map(|value| format!("Access-Control-Allow-Origin: {value}\r\nVary: Origin\r\n"))
        .unwrap_or_default();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n{cors}Access-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n{payload}",
        payload.as_bytes().len(),
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn valid_token(request: &HttpRequest, token: &str) -> bool {
    request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|value| value.as_bytes() == token.as_bytes())
        .unwrap_or(false)
}

fn handle_request(mut stream: TcpStream, state: Arc<Mutex<BrowserBridgeRuntime>>) {
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            write_response(&mut stream, "400 Bad Request", json!({ "error": error }), None);
            return;
        }
    };
    let origin = extension_origin(&request.headers);
    if request.method == "OPTIONS" {
        if origin.is_some() {
            write_response(&mut stream, "204 No Content", json!({}), origin.as_deref());
        } else {
            write_response(&mut stream, "403 Forbidden", json!({ "error": "不允许的浏览器来源。" }), None);
        }
        return;
    }

    if request.path == "/health" && request.method == "GET" {
        let mut runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let authorized = valid_token(&request, &runtime.token);
        if authorized {
            runtime.paired = true;
            runtime.last_seen_at = Some(now_epoch());
        }
        write_response(
            &mut stream,
            "200 OK",
            json!({ "app": "Kardii", "bridgeVersion": 2, "paired": authorized }),
            origin.as_deref(),
        );
        return;
    }

    let Some(origin_value) = origin.as_deref() else {
        write_response(&mut stream, "403 Forbidden", json!({ "error": "只有 Kardii 浏览器扩展可以连接。" }), None);
        return;
    };

    if request.path == "/pair" && request.method == "POST" {
        let value: serde_json::Value = match serde_json::from_slice(&request.body) {
            Ok(value) => value,
            Err(_) => {
                write_response(&mut stream, "400 Bad Request", json!({ "error": "配对请求格式无效。" }), Some(origin_value));
                return;
            }
        };
        let code = value.get("code").and_then(|value| value.as_str()).unwrap_or_default();
        let mut runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = now_epoch();
        if runtime.paired {
            write_response(&mut stream, "409 Conflict", json!({ "error": "浏览器扩展已经配对。需要更换扩展时，请先在 Kardii 中撤销旧连接。" }), Some(origin_value));
            return;
        }
        if runtime.pairing_locked_until.is_some_and(|locked_until| locked_until > now) {
            write_response(&mut stream, "429 Too Many Requests", json!({ "error": "配对尝试过多，请等待一分钟后使用 Kardii 显示的新配对码。" }), Some(origin_value));
            return;
        }
        runtime.pairing_locked_until = None;
        if code != runtime.pairing_code {
            runtime.pairing_failures = runtime.pairing_failures.saturating_add(1);
            if runtime.pairing_failures >= MAX_PAIRING_FAILURES {
                runtime.pairing_failures = 0;
                runtime.pairing_locked_until = Some(now.saturating_add(PAIRING_LOCK_SECONDS));
                runtime.pairing_code = pairing_code();
            }
            write_response(&mut stream, "401 Unauthorized", json!({ "error": "配对码不正确，请回到 Kardii 查看最新配对码。" }), Some(origin_value));
            return;
        }
        runtime.paired = true;
        runtime.pairing_failures = 0;
        runtime.pairing_locked_until = None;
        runtime.pairing_code.clear();
        runtime.last_seen_at = Some(now);
        write_response(
            &mut stream,
            "200 OK",
            json!({ "token": runtime.token, "port": BRIDGE_PORT }),
            Some(origin_value),
        );
        return;
    }

    if request.path == "/action" && request.method == "GET" {
        let mut runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !valid_token(&request, &runtime.token) {
            write_response(&mut stream, "401 Unauthorized", json!({ "error": "浏览器连接已失效，请重新配对。" }), Some(origin_value));
            return;
        }
        runtime.paired = true;
        runtime.last_seen_at = Some(now_epoch());
        write_response(
            &mut stream,
            "200 OK",
            json!({ "action": runtime.pending_action.clone() }),
            Some(origin_value),
        );
        return;
    }

    if request.path == "/action-result" && request.method == "POST" {
        let mut runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !valid_token(&request, &runtime.token) {
            write_response(&mut stream, "401 Unauthorized", json!({ "error": "浏览器连接已失效，请重新配对。" }), Some(origin_value));
            return;
        }
        let mut result: BrowserActionResult = match serde_json::from_slice(&request.body) {
            Ok(result) => result,
            Err(_) => {
                write_response(&mut stream, "400 Bad Request", json!({ "error": "浏览器操作结果格式无效。" }), Some(origin_value));
                return;
            }
        };
        let matches_pending = runtime.pending_action.as_ref()
            .is_some_and(|action| action.id == result.action_id);
        if !matches_pending {
            write_response(&mut stream, "409 Conflict", json!({ "error": "这一步操作已经失效或不属于当前任务。" }), Some(origin_value));
            return;
        }
        let original_capture_id = runtime.pending_action.as_ref()
            .map(|action| action.capture_id.clone())
            .unwrap_or_default();
        result.message = clean_text(&result.message, 1_000);
        runtime.pending_action = None;
        if result.success
            && runtime.latest_capture.as_ref().is_some_and(|capture| capture.id == original_capture_id)
        {
            runtime.latest_capture = None;
        }
        runtime.action_result = Some(result);
        runtime.last_seen_at = Some(now_epoch());
        write_response(&mut stream, "200 OK", json!({ "accepted": true }), Some(origin_value));
        return;
    }

    if request.path == "/capture" && request.method == "POST" {
        let mut runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !valid_token(&request, &runtime.token) {
            write_response(&mut stream, "401 Unauthorized", json!({ "error": "浏览器连接已失效，请重新配对。" }), Some(origin_value));
            return;
        }
        let payload: BrowserCaptureInput = match serde_json::from_slice(&request.body) {
            Ok(payload) => payload,
            Err(_) => {
                write_response(&mut stream, "400 Bad Request", json!({ "error": "网页资料格式无效。" }), Some(origin_value));
                return;
            }
        };
        let url = match reqwest::Url::parse(payload.url.trim()) {
            Ok(url)
                if matches!(url.scheme(), "http" | "https")
                    && url.username().is_empty()
                    && url.password().is_none() => url,
            _ => {
                write_response(&mut stream, "400 Bad Request", json!({ "error": "只接受 http 或 https 网页。" }), Some(origin_value));
                return;
            }
        };
        let received_at = now_epoch();
        let targets = payload.targets
            .into_iter()
            .take(120)
            .filter_map(clean_browser_target)
            .collect();
        let capture = BrowserCapture {
            id: format!("browser-{received_at}-{:08x}", rand::thread_rng().gen::<u32>()),
            title: clean_text(&payload.title, 300),
            url: clean_text(url.as_str(), 2_000),
            selected_text: clean_text(&payload.selected_text, 30_000),
            content: clean_text(&payload.content, MAX_PAGE_CHARS),
            description: clean_text(&payload.description, 1_000),
            language: clean_text(&payload.language, 40),
            captured_at: clean_text(&payload.captured_at, 80),
            received_at,
            source: "kardii-browser-extension".into(),
            targets,
        };
        if capture.title.is_empty() || (capture.selected_text.is_empty() && capture.content.is_empty()) {
            write_response(&mut stream, "400 Bad Request", json!({ "error": "当前页面没有提取到可读文字。" }), Some(origin_value));
            return;
        }
        let capture_id = capture.id.clone();
        runtime.paired = true;
        runtime.last_seen_at = Some(received_at);
        runtime.capture_count = runtime.capture_count.saturating_add(1);
        runtime.latest_capture = Some(capture);
        write_response(&mut stream, "200 OK", json!({ "accepted": true, "captureId": capture_id }), Some(origin_value));
        return;
    }

    write_response(&mut stream, "404 Not Found", json!({ "error": "未知的浏览器连接请求。" }), Some(origin_value));
}

#[tauri::command]
pub fn start_browser_bridge() -> Result<BrowserBridgeStatus, String> {
    let state = Arc::clone(bridge_state());
    {
        let runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if runtime.running {
            return Ok(runtime.status());
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", BRIDGE_PORT))
        .map_err(|error| format!("无法启动浏览器连接端口 {BRIDGE_PORT}：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法配置浏览器连接：{error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let state_for_thread = Arc::clone(&state);
    let handle = thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => handle_request(stream, Arc::clone(&state_for_thread)),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(80));
                }
                Err(_) => thread::sleep(Duration::from_millis(120)),
            }
        }
    });
    let mut runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    runtime.running = true;
    runtime.paired = false;
    runtime.pairing_failures = 0;
    runtime.pairing_locked_until = None;
    runtime.pairing_code = pairing_code();
    runtime.pending_action = None;
    runtime.action_result = None;
    runtime.stop = Some(stop);
    runtime.thread = Some(handle);
    Ok(runtime.status())
}

#[tauri::command]
pub fn stop_browser_bridge() -> BrowserBridgeStatus {
    let state = Arc::clone(bridge_state());
    let handle = {
        let mut runtime = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(stop) = runtime.stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        runtime.running = false;
        runtime.paired = false;
        runtime.pending_action = None;
        runtime.action_result = None;
        runtime.thread.take()
    };
    if let Some(handle) = handle {
        let _ = handle.join();
    }
    bridge_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .status()
}

#[tauri::command]
pub fn browser_bridge_status() -> BrowserBridgeStatus {
    bridge_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .status()
}

#[tauri::command]
pub fn regenerate_browser_pairing() -> Result<BrowserBridgeStatus, String> {
    let token = random_token();
    save_token(&token)?;
    let mut runtime = bridge_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    runtime.token = token;
    runtime.pairing_code = pairing_code();
    runtime.paired = false;
    runtime.pairing_failures = 0;
    runtime.pairing_locked_until = None;
    runtime.last_seen_at = None;
    runtime.pending_action = None;
    runtime.action_result = None;
    Ok(runtime.status())
}

#[tauri::command]
pub fn get_browser_capture() -> Option<BrowserCapture> {
    bridge_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .latest_capture
        .clone()
}

fn validate_browser_action(
    request: BrowserActionRequest,
    capture: &BrowserCapture,
) -> Result<BrowserPendingAction, String> {
    if request.capture_id.trim() != capture.id {
        return Err("网页快照已经变化。请从目标标签页重新发送，再重试这一步。".into());
    }
    let action_type = request.action_type.trim().to_ascii_lowercase();
    if !matches!(action_type.as_str(), "click" | "fill" | "select" | "scroll" | "navigate" | "download") {
        return Err("浏览器操作类型不受支持。".into());
    }
    let target_id = clean_text(&request.target_id, 40);
    let target = (!target_id.is_empty())
        .then(|| capture.targets.iter().find(|item| item.id == target_id))
        .flatten();
    let target_label = target.map(|item| item.label.clone()).unwrap_or_default();
    let target_href = target.map(|item| item.href.as_str()).unwrap_or_default();
    if contains_blocked_commerce_term(&format!(
        "{} {} {} {}",
        target_label, target_href, request.url, request.value
    )) {
        return Err("Kardii 禁止执行付款、购买、下单或资金转移操作。".into());
    }
    if contains_blocked_account_action(&capture.url) {
        return Err("当前页面属于登录、注册或账户验证流程，Kardii 不会在这里执行网页操作。".into());
    }
    match action_type.as_str() {
        "click" => {
            let target = target.ok_or_else(|| "点击操作缺少有效的页面目标。".to_string())?;
            if target.disabled || !matches!(target.role.as_str(), "link" | "button" | "checkbox" | "radio") {
                return Err("这个页面目标不能安全点击。".into());
            }
            if contains_blocked_account_action(&format!("{} {}", target.label, target.href)) {
                return Err("Kardii 不会执行登录、注册或账户验证步骤。".into());
            }
        }
        "fill" => {
            let target = target.ok_or_else(|| "填写操作缺少有效的输入目标。".to_string())?;
            if target.disabled || !matches!(target.role.as_str(), "input" | "textarea") {
                return Err("这个页面目标不是可填写的普通输入框。".into());
            }
            if contains_sensitive_input_term(&format!("{} {}", target.label, target.input_type))
                || matches!(target.input_type.as_str(), "password" | "hidden" | "file")
            {
                return Err("Kardii 不会填写密码、验证码、支付卡、Token 或文件输入框。".into());
            }
            if request.value.is_empty() || request.value.chars().count() > 2_000 {
                return Err("要填写的内容为空或超过 2,000 字。".into());
            }
        }
        "select" => {
            let target = target.ok_or_else(|| "选择操作缺少有效的下拉框目标。".to_string())?;
            if target.disabled || target.role != "select" || request.value.chars().count() > 300 {
                return Err("这个页面目标不是可安全操作的下拉框。".into());
            }
        }
        "download" => {
            let target = target.ok_or_else(|| "下载操作缺少有效的链接目标。".to_string())?;
            if target.disabled || target.role != "link" || target.href.is_empty() || dangerous_download_url(&target.href) {
                return Err("这个下载链接不可用，或文件类型可能直接执行，Kardii 已拒绝。".into());
            }
        }
        "navigate" => {
            let url = safe_web_url(&request.url).ok_or_else(|| "导航地址必须是安全的 http 或 https 网址。".to_string())?;
            if contains_blocked_commerce_term(&url) {
                return Err("Kardii 不会导航到付款、购买或资金转移步骤。".into());
            }
            if contains_blocked_account_action(&url) {
                return Err("Kardii 不会导航到登录、注册或账户验证步骤。".into());
            }
        }
        "scroll" => {
            if !matches!(request.direction.as_str(), "up" | "down") {
                return Err("滚动方向只能是 up 或 down。".into());
            }
        }
        _ => unreachable!(),
    }
    Ok(BrowserPendingAction {
        id: format!("action-{}-{:08x}", now_epoch(), rand::thread_rng().gen::<u32>()),
        capture_id: capture.id.clone(),
        page_title: capture.title.clone(),
        page_url: capture.url.clone(),
        action_type,
        target_id,
        target_label,
        value: clean_text(&request.value, 2_000),
        url: if request.url.trim().is_empty() { String::new() } else { safe_web_url(&request.url).unwrap_or_default() },
        direction: clean_text(&request.direction, 10).to_ascii_lowercase(),
        amount: request.amount.clamp(200, 2_000),
        created_at: now_epoch(),
    })
}

#[tauri::command]
pub async fn execute_browser_action(request: BrowserActionRequest) -> Result<BrowserActionResult, String> {
    let action_id = {
        let mut runtime = bridge_state().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !runtime.running || !runtime.paired {
            return Err("浏览器扩展尚未连接。请先在工作台“外部连接”中完成配对。".into());
        }
        if runtime.pending_action.is_some() {
            return Err("浏览器中还有一步待处理操作，请先在扩展中执行或拒绝。".into());
        }
        let capture = runtime.latest_capture.as_ref()
            .ok_or_else(|| "还没有网页快照，请先从目标标签页发送当前网页。".to_string())?;
        let action = validate_browser_action(request, capture)?;
        let action_id = action.id.clone();
        runtime.action_result = None;
        runtime.pending_action = Some(action);
        action_id
    };
    for _ in 0..600 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let result = {
            let mut runtime = bridge_state().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime.action_result.as_ref().is_some_and(|result| result.action_id == action_id) {
                runtime.action_result.take()
            } else {
                None
            }
        };
        if let Some(result) = result {
            if result.success {
                return Ok(result);
            }
            return Err(if result.message.is_empty() { "用户在浏览器扩展中拒绝了这一步。".into() } else { result.message });
        }
    }
    let mut runtime = bridge_state().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if runtime.pending_action.as_ref().is_some_and(|action| action.id == action_id) {
        runtime.pending_action = None;
    }
    Err("等待浏览器扩展执行超时。请重新发送网页后再试。".into())
}

#[tauri::command]
pub fn clear_browser_capture() -> BrowserBridgeStatus {
    let mut runtime = bridge_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    runtime.latest_capture = None;
    runtime.pending_action = None;
    runtime.action_result = None;
    runtime.status()
}

#[tauri::command]
pub fn open_browser_extension_folder(app: tauri::AppHandle) -> Result<String, String> {
    let bundled_path = app
        .path()
        .resolve("browser-extension", BaseDirectory::Resource)
        .map_err(|error| format!("无法找到浏览器扩展目录：{error}"))?;
    let source_path = if bundled_path.is_dir() {
        bundled_path
    } else {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("browser-extension")
    };
    if !source_path.is_dir() {
        return Err("浏览器扩展尚未打包到当前安装中，请安装最新 Kardii 测试版。".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法打开 Kardii 数据目录：{error}"))?
        .join("browser-extension");
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("无法准备浏览器扩展目录：{error}"))?;
    for file_name in ["manifest.json", "popup.html", "popup.css", "popup.js", "README.md"] {
        let source = source_path.join(file_name);
        let metadata = std::fs::symlink_metadata(&source)
            .map_err(|error| format!("浏览器扩展资源 {file_name} 不完整：{error}"))?;
        if !metadata.file_type().is_file() {
            return Err(format!("浏览器扩展资源 {file_name} 不是安全的普通文件。"));
        }
        std::fs::copy(&source, path.join(file_name))
            .map_err(|error| format!("无法更新浏览器扩展文件 {file_name}：{error}"))?;
    }
    open::that(&path).map_err(|error| format!("无法打开浏览器扩展目录：{error}"))?;
    Ok(path.to_string_lossy().to_string())
}
