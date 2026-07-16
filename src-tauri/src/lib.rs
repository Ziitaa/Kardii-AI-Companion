use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashSet,
    sync::Mutex,
    time::Duration,
};
use futures_util::StreamExt;
use tauri::ipc::Channel;

const KEYRING_SERVICE: &str = "Kardii AI Companion";
const KEYRING_ACCOUNT: &str = "deepseek-api-key";
const DEEPSEEK_URL: &str = "https://api.deepseek.com/chat/completions";

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetProfile {
    user_name: String,
    personality: String,
    custom_instructions: String,
    memories: Vec<String>,
}

impl PetProfile {
    fn system_prompt(&self) -> String {
        let personality = match self.personality.as_str() {
            "lively" => "活泼开朗、充满好奇心，语气轻快但不过度吵闹",
            "calm" => "安静温和、善于陪伴和倾听，语气平静柔和",
            "professional" => "简洁可靠、条理清楚，同时保留友善的小狗伙伴感觉",
            _ => "温柔可爱、聪明亲切，像贴心的小狗伙伴",
        };
        let user_name: String = self.user_name.trim().chars().take(30).collect();
        let custom: String = self.custom_instructions.trim().chars().take(300).collect();
        let memories: Vec<String> = self.memories
            .iter()
            .filter_map(|memory| {
                let clean: String = memory.trim().chars().take(160).collect();
                (!clean.is_empty()).then_some(clean)
            })
            .take(20)
            .collect();

        let mut prompt = format!(
            "你是桌宠 Kardii，一只温暖、聪明、可爱的小狗伙伴。你的性格是：{personality}。优先使用用户的语言回答，回答自然、实用，不要假装已经执行你无法执行的操作。"
        );
        if !user_name.is_empty() {
            prompt.push_str(&format!(" 用户希望你称呼其为“{user_name}”。"));
        }
        if !custom.is_empty() {
            prompt.push_str(&format!(" 用户对相处方式的补充要求：{custom}"));
        }
        if !memories.is_empty() {
            prompt.push_str(" 以下是用户明确要求 Kardii 记住的信息。只在相关时自然使用，不要每次回答都复述：");
            for (index, memory) in memories.iter().enumerate() {
                prompt.push_str(&format!("\n{}. {}", index + 1, memory));
            }
        }
        prompt
    }
}

#[derive(Debug, Serialize)]
struct AiReply {
    text: String,
    model: String,
}

#[derive(Debug, Clone, Serialize)]
struct StreamEvent {
    event: String,
    data: Option<String>,
}

#[derive(Default)]
struct StreamState {
    cancelled: Mutex<HashSet<String>>,
}

impl StreamState {
    fn reset(&self, request_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(request_id);
        }
    }

    fn cancel(&self, request_id: String) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.insert(request_id);
        }
    }

    fn is_cancelled(&self, request_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|cancelled| cancelled.contains(request_id))
            .unwrap_or(false)
    }
}

fn friendly_api_error(status: reqwest::StatusCode, payload: &serde_json::Value) -> String {
    match status.as_u16() {
        401 | 403 => "DeepSeek API Key 无效或没有权限，请在设置中重新填写。".into(),
        402 => "DeepSeek 账户余额不足，请充值后再试。".into(),
        429 => "DeepSeek 当前请求较多，请稍等一会儿再试。".into(),
        500..=599 => "DeepSeek 服务暂时不可用，请稍后重试。".into(),
        _ => payload["error"]["message"]
            .as_str()
            .map(|message| format!("DeepSeek 请求失败：{message}"))
            .unwrap_or_else(|| format!("DeepSeek 请求失败（{status}）")),
    }
}

fn extract_sse_event(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let (index, delimiter_len) = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4))
        .or_else(|| {
            buffer
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| (index, 2))
        })?;
    let event = buffer[..index].to_vec();
    buffer.drain(..index + delimiter_len);
    Some(event)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("无法打开系统安全凭据库：{error}"))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_deepseek_key() -> Result<String, String> {
    Err("当前测试版仅支持在 Windows 和 macOS 保存 API Key".into())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn get_deepseek_key() -> Result<String, String> {
    credential_entry()?
        .get_password()
        .map_err(|_| "尚未设置 DeepSeek API Key".into())
}

#[tauri::command]
fn save_deepseek_key(api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if key.len() < 12 {
        return Err("API Key 看起来不完整，请重新复制".into());
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return credential_entry()?
            .set_password(key)
            .map_err(|error| format!("保存 API Key 失败：{error}"));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("当前测试版仅支持 Windows 和 macOS".into())
}

#[tauri::command]
fn has_deepseek_key() -> bool {
    get_deepseek_key().map(|key| !key.is_empty()).unwrap_or(false)
}

#[tauri::command]
fn delete_deepseek_key() -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return credential_entry()?
            .delete_credential()
            .map_err(|error| format!("删除 API Key 失败：{error}"));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("当前测试版仅支持 Windows 和 macOS".into())
}

async fn request_deepseek(messages: Vec<ChatMessage>, max_tokens: u32) -> Result<AiReply, String> {
    let api_key = get_deepseek_key()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("无法创建网络请求：{error}"))?;

    let mut api_messages = vec![ChatMessage {
        role: "system".into(),
        content: "你是桌宠 Kardii，一只温暖、聪明、可爱的小狗伙伴。优先使用用户的语言回答，语气自然亲切。回答简洁实用，不要假装已经执行你无法执行的操作。".into(),
    }];
    api_messages.extend(messages.into_iter().take(16));

    let response = client
        .post(DEEPSEEK_URL)
        .bearer_auth(api_key)
        .json(&json!({
            "model": "deepseek-v4-flash",
            "messages": api_messages,
            "thinking": { "type": "disabled" },
            "max_tokens": max_tokens,
            "stream": false
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "连接 DeepSeek 超时，请检查网络后重试。".to_string()
            } else {
                "无法连接 DeepSeek，请检查网络连接。".to_string()
            }
        })?;

    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("DeepSeek 返回了无法读取的数据：{error}"))?;

    if !status.is_success() {
        return Err(friendly_api_error(status, &payload));
    }

    let text = payload["choices"][0]["message"]["content"]
        .as_str()
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "DeepSeek 没有返回文字".to_string())?;

    Ok(AiReply {
        text: text.trim().to_string(),
        model: "deepseek-v4-flash".into(),
    })
}

#[tauri::command]
async fn send_ai_message(messages: Vec<ChatMessage>) -> Result<AiReply, String> {
    request_deepseek(messages, 500).await
}

#[tauri::command]
fn stop_ai_message(request_id: String, state: tauri::State<'_, StreamState>) {
    state.cancel(request_id);
}

#[tauri::command]
async fn stream_ai_message(
    messages: Vec<ChatMessage>,
    profile: PetProfile,
    request_id: String,
    max_tokens: u32,
    on_event: Channel<StreamEvent>,
    state: tauri::State<'_, StreamState>,
) -> Result<(), String> {
    state.reset(&request_id);
    let api_key = get_deepseek_key()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "无法创建网络请求。".to_string())?;

    let mut api_messages = vec![ChatMessage {
        role: "system".into(),
        content: profile.system_prompt(),
    }];
    api_messages.extend(messages.into_iter().take(16));

    let response = client
        .post(DEEPSEEK_URL)
        .bearer_auth(api_key)
        .json(&json!({
            "model": "deepseek-v4-flash",
            "messages": api_messages,
            "thinking": { "type": "disabled" },
            "max_tokens": max_tokens.clamp(100, 1000),
            "stream": true
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "连接 DeepSeek 超时，请检查网络后重试。".to_string()
            } else {
                "无法连接 DeepSeek，请检查网络连接。".to_string()
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let payload: serde_json::Value = response.json().await.unwrap_or_default();
        return Err(friendly_api_error(status, &payload));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    while let Some(chunk) = stream.next().await {
        if state.is_cancelled(&request_id) {
            let _ = on_event.send(StreamEvent { event: "stopped".into(), data: None });
            state.reset(&request_id);
            return Ok(());
        }

        let chunk = chunk.map_err(|_| "接收回复时网络中断，请重试。".to_string())?;
        buffer.extend_from_slice(&chunk);

        while let Some(event_bytes) = extract_sse_event(&mut buffer) {
            let event_text = String::from_utf8(event_bytes)
                .map_err(|_| "DeepSeek 返回了无法读取的文字。".to_string())?;
            for line in event_text.lines() {
                let Some(data) = line.trim().strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    let _ = on_event.send(StreamEvent { event: "done".into(), data: None });
                    state.reset(&request_id);
                    return Ok(());
                }
                let Ok(payload) = serde_json::from_str::<serde_json::Value>(data) else { continue };
                if let Some(delta) = payload["choices"][0]["delta"]["content"].as_str() {
                    if !delta.is_empty() {
                        let _ = on_event.send(StreamEvent {
                            event: "delta".into(),
                            data: Some(delta.to_string()),
                        });
                    }
                }
            }
        }
    }

    let _ = on_event.send(StreamEvent { event: "done".into(), data: None });
    state.reset(&request_id);
    Ok(())
}

#[tauri::command]
async fn test_deepseek_connection() -> Result<(), String> {
    request_deepseek(
        vec![ChatMessage { role: "user".into(), content: "只回复 OK".into() }],
        8,
    )
    .await
    .map(|_| ())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StreamState::default())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示 Kardii", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 Kardii", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("Kardii app icon").clone())
                .tooltip("Kardii AI Companion")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            quit_app,
            save_deepseek_key,
            has_deepseek_key,
            delete_deepseek_key,
            send_ai_message,
            stream_ai_message,
            stop_ai_message,
            test_deepseek_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kardii AI Companion");
}
