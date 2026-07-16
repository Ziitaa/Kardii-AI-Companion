use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

const KEYRING_SERVICE: &str = "Kardii AI Companion";
const KEYRING_ACCOUNT: &str = "deepseek-api-key";
const DEEPSEEK_URL: &str = "https://api.deepseek.com/chat/completions";

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct AiReply {
    text: String,
    model: String,
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
        .map_err(|error| format!("无法连接 DeepSeek：{error}"))?;

    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("DeepSeek 返回了无法读取的数据：{error}"))?;

    if !status.is_success() {
        let message = payload["error"]["message"]
            .as_str()
            .unwrap_or("请检查 API Key、余额和网络连接");
        return Err(format!("DeepSeek 请求失败（{status}）：{message}"));
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
            test_deepseek_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kardii AI Companion");
}
