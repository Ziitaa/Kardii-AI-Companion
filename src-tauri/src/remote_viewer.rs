use reqwest::Url;
use serde::Serialize;
use std::time::Duration;

const KEYRING_SERVICE: &str = "Kardii Trading Runtime";
const REMOTE_URL_ACCOUNT: &str = "remote-readonly-viewer-url-v1";
const REMOTE_TOKEN_ACCOUNT: &str = "remote-readonly-viewer-token-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteViewerConnectionStatus {
    configured: bool,
    base_url: String,
    reachable: bool,
    error: String,
    snapshot: Option<serde_json::Value>,
}

fn normalize_remote_base(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value.trim())
        .map_err(|_| "远程只读地址格式不正确。".to_string())?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() {
        return Err("远程只读地址不能包含账号、密码或查询参数。".to_string());
    }
    let host = url.host_str().unwrap_or_default();
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("远程连接必须使用 HTTPS；只有本机 localhost 可以使用 HTTP。".to_string());
    }
    url.set_fragment(None);
    let mut normalized = url.to_string();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

fn parse_pairing_link(value: &str) -> Result<(String, String), String> {
    let url = Url::parse(value.trim())
        .map_err(|_| "配对链接格式不正确。".to_string())?;
    let token = url.fragment().unwrap_or_default().trim().to_string();
    if token.len() < 32 || token.len() > 256 {
        return Err("配对链接缺少有效的只读访问凭据。".to_string());
    }
    let base = normalize_remote_base(value)?;
    Ok((base, token))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn save_connection(base_url: &str, token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, REMOTE_URL_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .set_password(base_url)
        .map_err(|error| format!("无法保存远程只读地址：{error}"))?;
    keyring::Entry::new(KEYRING_SERVICE, REMOTE_TOKEN_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .set_password(token)
        .map_err(|error| format!("无法保存远程只读凭据：{error}"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_connection() -> Result<Option<(String, String)>, String> {
    let url_entry = keyring::Entry::new(KEYRING_SERVICE, REMOTE_URL_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
    let token_entry = keyring::Entry::new(KEYRING_SERVICE, REMOTE_TOKEN_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
    let base_url = match url_entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("无法读取远程只读地址：{error}")),
    };
    let token = match token_entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("无法读取远程只读凭据：{error}")),
    };
    Ok(Some((base_url, token)))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn delete_connection() -> Result<(), String> {
    for account in [REMOTE_URL_ACCOUNT, REMOTE_TOKEN_ACCOUNT] {
        let entry = keyring::Entry::new(KEYRING_SERVICE, account)
            .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(format!("无法删除远程只读连接：{error}")),
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn save_connection(_base_url: &str, _token: &str) -> Result<(), String> {
    Err("当前平台暂不支持安全凭据库。".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_connection() -> Result<Option<(String, String)>, String> {
    Ok(None)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn delete_connection() -> Result<(), String> {
    Ok(())
}

async fn fetch_snapshot(base_url: &str, token: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}/status", base_url.trim_end_matches('/'));
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("无法初始化远程只读客户端：{error}"))?
        .get(url)
        .bearer_auth(token)
        .header("Cache-Control", "no-store")
        .send()
        .await
        .map_err(|error| format!("无法连接远程 Kardii：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("远程 Kardii 返回 HTTP {}", response.status()));
    }
    response.json::<serde_json::Value>().await
        .map_err(|error| format!("远程 Kardii 状态解析失败：{error}"))
}

#[tauri::command]
pub async fn save_remote_viewer_connection(
    pairing_link: String,
) -> Result<RemoteViewerConnectionStatus, String> {
    let (base_url, token) = parse_pairing_link(&pairing_link)?;
    let snapshot = fetch_snapshot(&base_url, &token).await?;
    save_connection(&base_url, &token)?;
    Ok(RemoteViewerConnectionStatus {
        configured: true,
        base_url,
        reachable: true,
        error: String::new(),
        snapshot: Some(snapshot),
    })
}

#[tauri::command]
pub async fn get_remote_viewer_connection_status() -> Result<RemoteViewerConnectionStatus, String> {
    let Some((base_url, token)) = load_connection()? else {
        return Ok(RemoteViewerConnectionStatus {
            configured: false,
            base_url: String::new(),
            reachable: false,
            error: String::new(),
            snapshot: None,
        });
    };
    match fetch_snapshot(&base_url, &token).await {
        Ok(snapshot) => Ok(RemoteViewerConnectionStatus {
            configured: true,
            base_url,
            reachable: true,
            error: String::new(),
            snapshot: Some(snapshot),
        }),
        Err(error) => Ok(RemoteViewerConnectionStatus {
            configured: true,
            base_url,
            reachable: false,
            error,
            snapshot: None,
        }),
    }
}

#[tauri::command]
pub fn delete_remote_viewer_connection() -> Result<(), String> {
    delete_connection()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_requires_https_except_loopback() {
        assert!(normalize_remote_base("https://kardii.example/status").is_ok());
        assert!(normalize_remote_base("http://127.0.0.1:43199").is_ok());
        assert!(normalize_remote_base("http://example.com").is_err());
    }

    #[test]
    fn pairing_link_requires_fragment_token() {
        assert!(parse_pairing_link("https://kardii.example/#12345678901234567890123456789012").is_ok());
        assert!(parse_pairing_link("https://kardii.example/").is_err());
    }
}
