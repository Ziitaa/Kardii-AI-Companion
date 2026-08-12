use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, Instant},
};

const KEYRING_SERVICE: &str = "Kardii AI Companion";
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES: &[&str] = &[
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
];
const MICROSOFT_SCOPES: &[&str] = &[
    "openid",
    "profile",
    "email",
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Calendars.Read",
    "Files.Read.All",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthStartRequest {
    provider: String,
    account_id: String,
    client_id: String,
    #[serde(default)]
    client_secret: String,
    #[serde(default)]
    tenant: String,
    #[serde(default)]
    include_share_point: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthConnectionResult {
    provider: String,
    account_id: String,
    display_name: String,
    email: String,
    scopes: Vec<String>,
    connected_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudSyncRequest {
    provider: String,
    account_id: String,
    max_items: usize,
    #[serde(default)]
    include_share_point: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudItem {
    provider: String,
    service: String,
    id: String,
    title: String,
    subtitle: String,
    web_url: String,
    modified_at: String,
    mime_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudServiceStatus {
    service: String,
    label: String,
    success: bool,
    item_count: usize,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudSyncResult {
    items: Vec<CloudItem>,
    services: Vec<CloudServiceStatus>,
    synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredOAuthToken {
    provider: String,
    account_id: String,
    client_id: String,
    client_secret: String,
    tenant: String,
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    scopes: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default = "default_token_lifetime")]
    expires_in: i64,
    #[serde(default)]
    scope: String,
}

fn default_token_lifetime() -> i64 {
    3_600
}

fn validate_account_id(value: &str) -> Result<String, String> {
    let clean = value.trim();
    if clean.is_empty()
        || clean.len() > 48
        || !clean
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("连接标识无效。".into());
    }
    Ok(clean.to_string())
}

fn validate_client_id(value: &str) -> Result<String, String> {
    let clean = value.trim();
    if clean.is_empty() || clean.len() > 500 || clean.chars().any(char::is_whitespace) {
        return Err("OAuth Client ID 无效。".into());
    }
    Ok(clean.to_string())
}

fn validate_tenant(value: &str) -> Result<String, String> {
    let clean = if value.trim().is_empty() { "common" } else { value.trim() };
    if clean.len() > 100
        || !clean
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Microsoft 登录范围无效。".into());
    }
    Ok(clean.to_string())
}

fn oauth_credential_account(kind: &str, account_id: &str) -> Result<String, String> {
    Ok(format!("oauth-{kind}-{}", validate_account_id(account_id)?))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn oauth_entry(kind: &str, account_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &oauth_credential_account(kind, account_id)?)
        .map_err(|error| format!("无法打开系统安全凭据库：{error}"))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn save_token(token: &StoredOAuthToken) -> Result<(), String> {
    if token.refresh_token.is_empty() {
        return Err("服务商没有返回离线刷新授权。请撤销 Kardii 授权后重新登录。".into());
    }
    let mut metadata = token.clone();
    let refresh_token = std::mem::take(&mut metadata.refresh_token);
    let client_secret = std::mem::take(&mut metadata.client_secret);
    metadata.access_token.clear();
    metadata.expires_at = 0;
    let serialized = serde_json::to_string(&metadata)
        .map_err(|error| format!("无法保存 OAuth 授权：{error}"))?;
    oauth_entry("meta", &token.account_id)?
        .set_password(&serialized)
        .map_err(|error| format!("无法把 OAuth 元数据保存到系统凭据库：{error}"))?;
    oauth_entry("refresh", &token.account_id)?
        .set_password(&refresh_token)
        .map_err(|error| format!("无法把 OAuth 刷新授权保存到系统凭据库：{error}"))?;
    let secret_entry = oauth_entry("client-secret", &token.account_id)?;
    if client_secret.is_empty() {
        match secret_entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(format!("无法清理旧 OAuth client secret：{error}")),
        }
    } else {
        secret_entry
            .set_password(&client_secret)
            .map_err(|error| format!("无法把 OAuth client secret 保存到系统凭据库：{error}"))?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn save_token(_token: &StoredOAuthToken) -> Result<(), String> {
    Err("OAuth 连接仅支持 Windows 和 macOS。".into())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn load_token(account_id: &str) -> Result<StoredOAuthToken, String> {
    let serialized = oauth_entry("meta", account_id)?
        .get_password()
        .map_err(|_| "OAuth 授权不存在或已失效，请重新登录。".to_string())?;
    let mut token: StoredOAuthToken = serde_json::from_str(&serialized)
        .map_err(|_| "OAuth 授权记录损坏，请断开后重新登录。".to_string())?;
    token.refresh_token = oauth_entry("refresh", account_id)?
        .get_password()
        .map_err(|_| "OAuth 刷新授权不存在，请重新登录。".to_string())?;
    token.client_secret = oauth_entry("client-secret", account_id)?
        .get_password()
        .unwrap_or_default();
    Ok(token)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn load_token(_account_id: &str) -> Result<StoredOAuthToken, String> {
    Err("OAuth 连接仅支持 Windows 和 macOS。".into())
}

fn random_base64(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn trim_text(value: impl AsRef<str>, limit: usize) -> String {
    value.as_ref().chars().take(limit).collect()
}

fn error_from_body(status: reqwest::StatusCode, body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("error_description"))
                .or_else(|| value.get("error"))
                .and_then(Value::as_str)
        })
        .unwrap_or(body);
    format!("服务返回 {}：{}", status.as_u16(), trim_text(message, 500))
}

fn write_browser_page(stream: &mut TcpStream, success: bool, message: &str) {
    let title = if success { "Kardii 已完成连接" } else { "Kardii 连接未完成" };
    let color = if success { "#477b63" } else { "#a5475e" };
    let safe_message = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let body = format!(
        "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>{title}</title><body style=\"font-family:system-ui;padding:48px;color:#26364a\"><h2 style=\"color:{color}\">{title}</h2><p>{safe_message}</p><p>现在可以关闭这个页面并返回 Kardii。</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn wait_for_callback(listener: TcpListener, expected_state: String) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法启动 OAuth 本机回调：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut request_bytes = Vec::with_capacity(2_048);
                loop {
                    let mut chunk = [0_u8; 2_048];
                    let count = stream
                        .read(&mut chunk)
                        .map_err(|error| format!("无法读取 OAuth 回调：{error}"))?;
                    if count == 0 {
                        break;
                    }
                    request_bytes.extend_from_slice(&chunk[..count]);
                    if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                    if request_bytes.len() >= 16_384 {
                        return Err("OAuth 回调请求过大，已拒绝。".into());
                    }
                }
                let request = String::from_utf8_lossy(&request_bytes);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("");
                if !(target == "/" || target.starts_with("/?")) {
                    write_browser_page(&mut stream, false, "这不是 Kardii 正在等待的授权回调。");
                    continue;
                }
                let callback = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
                    .map_err(|_| "OAuth 回调地址无效。".to_string())?;
                let params: std::collections::HashMap<String, String> =
                    callback.query_pairs().into_owned().collect();
                if params.get("state") != Some(&expected_state) {
                    write_browser_page(&mut stream, false, "授权状态校验失败，未保存任何令牌。");
                    // Ignore unrelated loopback traffic and keep waiting for the
                    // callback carrying the unguessable state generated above.
                    continue;
                }
                if let Some(error) = params.get("error") {
                    let description = params
                        .get("error_description")
                        .cloned()
                        .unwrap_or_else(|| error.clone());
                    write_browser_page(&mut stream, false, &description);
                    return Err(format!("OAuth 登录未完成：{}", trim_text(description, 500)));
                }
                let code = params.get("code").cloned().unwrap_or_default();
                if code.is_empty() {
                    write_browser_page(&mut stream, false, "服务商没有返回授权码。");
                    return Err("OAuth 服务商没有返回授权码。".into());
                }
                write_browser_page(&mut stream, true, "授权码已安全交给本机 Kardii。令牌不会显示在这个页面中。");
                return Ok(code);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(error) => return Err(format!("OAuth 本机回调失败：{error}")),
        }
    }
    Err("等待浏览器登录超时。没有保存任何授权，请重新尝试。".into())
}

fn authorization_url(
    request: &OAuthStartRequest,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Result<(String, Vec<String>, String), String> {
    let client_id = validate_client_id(&request.client_id)?;
    let (mut url, scopes, tenant) = if request.provider == "google" {
        (
            reqwest::Url::parse(GOOGLE_AUTH_URL).map_err(|_| "Google OAuth 地址无效。")?,
            GOOGLE_SCOPES.iter().map(|scope| (*scope).to_string()).collect::<Vec<_>>(),
            String::new(),
        )
    } else if request.provider == "microsoft" {
        let tenant = validate_tenant(&request.tenant)?;
        let mut scopes = MICROSOFT_SCOPES
            .iter()
            .map(|scope| (*scope).to_string())
            .collect::<Vec<_>>();
        if request.include_share_point {
            scopes.push("Sites.Read.All".into());
        }
        (
            reqwest::Url::parse(&format!(
                "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
            ))
            .map_err(|_| "Microsoft OAuth 地址无效。")?,
            scopes,
            tenant,
        )
    } else {
        return Err("不支持这个 OAuth 服务商。".into());
    };
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", &scopes.join(" "))
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256");
        if request.provider == "google" {
            query
                .append_pair("access_type", "offline")
                .append_pair("prompt", "consent")
                .append_pair("include_granted_scopes", "true");
        } else {
            query.append_pair("response_mode", "query");
        }
    }
    Ok((url.to_string(), scopes, tenant))
}

async fn exchange_code(
    request: &OAuthStartRequest,
    code: String,
    redirect_uri: &str,
    verifier: &str,
    scopes: &[String],
    tenant: &str,
) -> Result<StoredOAuthToken, String> {
    let endpoint = if request.provider == "google" {
        GOOGLE_TOKEN_URL.to_string()
    } else {
        format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token")
    };
    let mut form = vec![
        ("client_id", request.client_id.trim().to_string()),
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", redirect_uri.to_string()),
        ("code_verifier", verifier.to_string()),
    ];
    if request.provider == "google" && !request.client_secret.trim().is_empty() {
        form.push(("client_secret", request.client_secret.trim().to_string()));
    }
    if request.provider == "microsoft" {
        form.push(("scope", scopes.join(" ")));
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法初始化 OAuth 网络连接：{error}"))?
        .post(endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("无法交换 OAuth 授权码：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取 OAuth 令牌响应：{error}"))?;
    if !status.is_success() {
        return Err(error_from_body(status, &body));
    }
    let token: OAuthTokenResponse = serde_json::from_str(&body)
        .map_err(|_| "OAuth 服务返回了无法识别的令牌响应。".to_string())?;
    let granted_scopes = if token.scope.trim().is_empty() {
        scopes.to_vec()
    } else {
        token.scope.split_whitespace().map(str::to_string).collect()
    };
    Ok(StoredOAuthToken {
        provider: request.provider.clone(),
        account_id: validate_account_id(&request.account_id)?,
        client_id: validate_client_id(&request.client_id)?,
        client_secret: if request.provider == "google" {
            request.client_secret.trim().to_string()
        } else {
            String::new()
        },
        tenant: tenant.to_string(),
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: Utc::now().timestamp() + token.expires_in.max(60) - 30,
        scopes: granted_scopes,
    })
}

async fn authorized_json(client: &reqwest::Client, token: &str, url: reqwest::Url) -> Result<Value, String> {
    let response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("无法读取云端服务：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取云端响应：{error}"))?;
    if !status.is_success() {
        return Err(error_from_body(status, &body));
    }
    serde_json::from_str(&body).map_err(|_| "云端服务返回了无法识别的数据。".into())
}

async fn account_profile(token: &StoredOAuthToken) -> Result<(String, String), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法初始化云端连接：{error}"))?;
    if token.provider == "google" {
        let url = reqwest::Url::parse("https://openidconnect.googleapis.com/v1/userinfo")
            .map_err(|_| "Google 账号地址无效。")?;
        let profile = authorized_json(&client, &token.access_token, url).await?;
        let email = profile.get("email").and_then(Value::as_str).unwrap_or("");
        let name = profile.get("name").and_then(Value::as_str).unwrap_or(email);
        Ok((name.to_string(), email.to_string()))
    } else {
        let url = reqwest::Url::parse(
            "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
        )
        .map_err(|_| "Microsoft 账号地址无效。")?;
        let profile = authorized_json(&client, &token.access_token, url).await?;
        let display_name = profile.get("displayName").and_then(Value::as_str).unwrap_or("");
        let email = profile
            .get("mail")
            .and_then(Value::as_str)
            .or_else(|| profile.get("userPrincipalName").and_then(Value::as_str))
            .unwrap_or("");
        Ok((display_name.to_string(), email.to_string()))
    }
}

#[tauri::command]
pub(crate) async fn start_oauth_connection(
    request: OAuthStartRequest,
) -> Result<OAuthConnectionResult, String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return Err("OAuth 连接仅支持 Windows 和 macOS。".into());

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        validate_account_id(&request.account_id)?;
        validate_client_id(&request.client_id)?;
        if request.client_secret.len() > 500 {
            return Err("Google OAuth client secret 过长。".into());
        }
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("无法启动 OAuth 本机回调端口：{error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("无法读取 OAuth 回调端口：{error}"))?
            .port();
        let redirect_host = if request.provider == "microsoft" { "localhost" } else { "127.0.0.1" };
        let redirect_uri = format!("http://{redirect_host}:{port}");
        let verifier = random_base64(64);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_base64(32);
        let (auth_url, scopes, tenant) =
            authorization_url(&request, &redirect_uri, &state, &challenge)?;
        open::that(&auth_url).map_err(|error| format!("无法打开系统浏览器：{error}"))?;
        let code = tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, state))
            .await
            .map_err(|error| format!("OAuth 回调任务异常结束：{error}"))??;
        let token = exchange_code(
            &request,
            code,
            &redirect_uri,
            &verifier,
            &scopes,
            &tenant,
        )
        .await?;
        let (display_name, email) = account_profile(&token).await?;
        save_token(&token)?;
        Ok(OAuthConnectionResult {
            provider: request.provider,
            account_id: token.account_id,
            display_name,
            email,
            scopes: token.scopes,
            connected_at: utc_now(),
        })
    }
}

#[tauri::command]
pub(crate) fn oauth_connection_status(account_id: String) -> bool {
    validate_account_id(&account_id).is_ok() && load_token(&account_id).is_ok()
}

#[tauri::command]
pub(crate) fn disconnect_oauth_connection(account_id: String) -> Result<(), String> {
    validate_account_id(&account_id)?;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        for kind in ["meta", "refresh", "client-secret"] {
            match oauth_entry(kind, &account_id)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(error) => return Err(format!("删除 OAuth 授权失败：{error}")),
            }
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("OAuth 连接仅支持 Windows 和 macOS。".into())
}

async fn refresh_token_if_needed(mut token: StoredOAuthToken) -> Result<StoredOAuthToken, String> {
    if token.expires_at > Utc::now().timestamp() + 60 {
        return Ok(token);
    }
    if token.refresh_token.is_empty() {
        return Err("OAuth 授权已过期且没有刷新令牌，请重新登录。".into());
    }
    let endpoint = if token.provider == "google" {
        GOOGLE_TOKEN_URL.to_string()
    } else {
        format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            validate_tenant(&token.tenant)?
        )
    };
    let mut form = vec![
        ("client_id", token.client_id.clone()),
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", token.refresh_token.clone()),
    ];
    if token.provider == "google" && !token.client_secret.is_empty() {
        form.push(("client_secret", token.client_secret.clone()));
    }
    if token.provider == "microsoft" {
        form.push(("scope", token.scopes.join(" ")));
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法初始化 OAuth 刷新连接：{error}"))?
        .post(endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("无法刷新 OAuth 授权：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取 OAuth 刷新响应：{error}"))?;
    if !status.is_success() {
        return Err(format!("OAuth 授权刷新失败。{}", error_from_body(status, &body)));
    }
    let refreshed: OAuthTokenResponse = serde_json::from_str(&body)
        .map_err(|_| "OAuth 服务返回了无法识别的刷新响应。".to_string())?;
    token.access_token = refreshed.access_token;
    if !refreshed.refresh_token.is_empty() {
        token.refresh_token = refreshed.refresh_token;
    }
    if !refreshed.scope.trim().is_empty() {
        token.scopes = refreshed.scope.split_whitespace().map(str::to_string).collect();
    }
    token.expires_at = Utc::now().timestamp() + refreshed.expires_in.max(60) - 30;
    save_token(&token)?;
    Ok(token)
}

fn value_string(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(|text| trim_text(text, 1_000))
        .unwrap_or_default()
}

fn google_internal_date(value: &Value) -> String {
    value
        .get("internalDate")
        .and_then(Value::as_str)
        .and_then(|text| text.parse::<i64>().ok())
        .and_then(DateTime::<Utc>::from_timestamp_millis)
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Secs, true))
        .unwrap_or_default()
}

fn google_header(value: &Value, name: &str) -> String {
    value
        .pointer("/payload/headers")
        .and_then(Value::as_array)
        .and_then(|headers| {
            headers.iter().find(|header| {
                header
                    .get("name")
                    .and_then(Value::as_str)
                    .map(|value| value.eq_ignore_ascii_case(name))
                    .unwrap_or(false)
            })
        })
        .and_then(|header| header.get("value"))
        .and_then(Value::as_str)
        .map(|text| trim_text(text, 500))
        .unwrap_or_default()
}

async fn google_mail(client: &reqwest::Client, token: &str, max_items: usize) -> Result<Vec<CloudItem>, String> {
    let mut list_url = reqwest::Url::parse("https://gmail.googleapis.com/gmail/v1/users/me/messages")
        .map_err(|_| "Gmail 地址无效。")?;
    list_url
        .query_pairs_mut()
        .append_pair("maxResults", &max_items.to_string())
        .append_pair("q", "newer_than:30d");
    let list = authorized_json(client, token, list_url).await?;
    let mut items = Vec::new();
    for message in list.get("messages").and_then(Value::as_array).into_iter().flatten() {
        let Some(id) = message.get("id").and_then(Value::as_str) else { continue };
        let mut detail_url = reqwest::Url::parse(&format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
        ))
        .map_err(|_| "Gmail 邮件地址无效。")?;
        detail_url
            .query_pairs_mut()
            .append_pair("format", "metadata")
            .append_pair("metadataHeaders", "Subject")
            .append_pair("metadataHeaders", "From")
            .append_pair("metadataHeaders", "Date");
        let detail = authorized_json(client, token, detail_url).await?;
        items.push(CloudItem {
            provider: "google".into(),
            service: "mail".into(),
            id: id.to_string(),
            title: {
                let subject = google_header(&detail, "Subject");
                if subject.is_empty() { "（无主题）".into() } else { subject }
            },
            subtitle: trim_text(
                format!("{} · {}", google_header(&detail, "From"), value_string(&detail, "/snippet")),
                1_000,
            ),
            web_url: format!("https://mail.google.com/mail/u/0/#inbox/{id}"),
            modified_at: google_internal_date(&detail),
            mime_type: "message/rfc822".into(),
        });
    }
    Ok(items)
}

async fn google_calendar(client: &reqwest::Client, token: &str, max_items: usize) -> Result<Vec<CloudItem>, String> {
    let mut url = reqwest::Url::parse("https://www.googleapis.com/calendar/v3/calendars/primary/events")
        .map_err(|_| "Google Calendar 地址无效。")?;
    url.query_pairs_mut()
        .append_pair("singleEvents", "true")
        .append_pair("orderBy", "startTime")
        .append_pair("timeMin", &utc_now())
        .append_pair("maxResults", &max_items.to_string());
    let response = authorized_json(client, token, url).await?;
    Ok(response
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            let start = value_string(item, "/start/dateTime");
            let start = if start.is_empty() { value_string(item, "/start/date") } else { start };
            Some(CloudItem {
                provider: "google".into(),
                service: "calendar".into(),
                id,
                title: {
                    let title = value_string(item, "/summary");
                    if title.is_empty() { "（无标题日程）".into() } else { title }
                },
                subtitle: value_string(item, "/location"),
                web_url: value_string(item, "/htmlLink"),
                modified_at: start,
                mime_type: "text/calendar".into(),
            })
        })
        .collect())
}

async fn google_drive(client: &reqwest::Client, token: &str, max_items: usize) -> Result<Vec<CloudItem>, String> {
    let mut url = reqwest::Url::parse("https://www.googleapis.com/drive/v3/files")
        .map_err(|_| "Google Drive 地址无效。")?;
    url.query_pairs_mut()
        .append_pair("pageSize", &max_items.to_string())
        .append_pair("orderBy", "modifiedTime desc")
        .append_pair("q", "trashed = false")
        .append_pair("fields", "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))");
    let response = authorized_json(client, token, url).await?;
    Ok(response
        .get("files")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            let mime = value_string(item, "/mimeType");
            let owner = item
                .get("owners")
                .and_then(Value::as_array)
                .and_then(|owners| owners.first())
                .map(|owner| value_string(owner, "/displayName"))
                .unwrap_or_default();
            Some(CloudItem {
                provider: "google".into(),
                service: if mime == "application/vnd.google-apps.spreadsheet" { "sheets".into() } else { "drive".into() },
                id,
                title: value_string(item, "/name"),
                subtitle: owner,
                web_url: value_string(item, "/webViewLink"),
                modified_at: value_string(item, "/modifiedTime"),
                mime_type: mime,
            })
        })
        .collect())
}

async fn microsoft_mail(client: &reqwest::Client, token: &str, max_items: usize) -> Result<Vec<CloudItem>, String> {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/v1.0/me/messages")
        .map_err(|_| "Outlook 地址无效。")?;
    url.query_pairs_mut()
        .append_pair("$top", &max_items.to_string())
        .append_pair("$select", "id,subject,from,receivedDateTime,bodyPreview,webLink")
        .append_pair("$orderby", "receivedDateTime desc");
    let response = authorized_json(client, token, url).await?;
    Ok(response
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            Some(CloudItem {
                provider: "microsoft".into(),
                service: "mail".into(),
                id,
                title: {
                    let subject = value_string(item, "/subject");
                    if subject.is_empty() { "（无主题）".into() } else { subject }
                },
                subtitle: trim_text(
                    format!("{} · {}", value_string(item, "/from/emailAddress/address"), value_string(item, "/bodyPreview")),
                    1_000,
                ),
                web_url: value_string(item, "/webLink"),
                modified_at: value_string(item, "/receivedDateTime"),
                mime_type: "message/rfc822".into(),
            })
        })
        .collect())
}

async fn microsoft_calendar(client: &reqwest::Client, token: &str, max_items: usize) -> Result<Vec<CloudItem>, String> {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/v1.0/me/calendarView")
        .map_err(|_| "Microsoft Calendar 地址无效。")?;
    url.query_pairs_mut()
        .append_pair("startDateTime", &utc_now())
        .append_pair(
            "endDateTime",
            &(Utc::now() + ChronoDuration::days(90)).to_rfc3339_opts(SecondsFormat::Secs, true),
        )
        .append_pair("$top", &max_items.to_string())
        .append_pair("$select", "id,subject,start,location,webLink")
        .append_pair("$orderby", "start/dateTime");
    let response = authorized_json(client, token, url).await?;
    Ok(response
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            Some(CloudItem {
                provider: "microsoft".into(),
                service: "calendar".into(),
                id,
                title: {
                    let title = value_string(item, "/subject");
                    if title.is_empty() { "（无标题日程）".into() } else { title }
                },
                subtitle: value_string(item, "/location/displayName"),
                web_url: value_string(item, "/webLink"),
                modified_at: value_string(item, "/start/dateTime"),
                mime_type: "text/calendar".into(),
            })
        })
        .collect())
}

fn microsoft_drive_item(item: &Value) -> Option<CloudItem> {
    let id = item.get("id")?.as_str()?.to_string();
    let name = value_string(item, "/name");
    let mime = {
        let value = value_string(item, "/file/mimeType");
        if value.is_empty() && item.get("folder").is_some() {
            "application/vnd.microsoft.folder".into()
        } else {
            value
        }
    };
    let lower_name = name.to_ascii_lowercase();
    let is_sheet = [".xlsx", ".xls", ".xlsm", ".xlsb"]
        .iter()
        .any(|extension| lower_name.ends_with(extension));
    Some(CloudItem {
        provider: "microsoft".into(),
        service: if is_sheet { "sheets".into() } else { "drive".into() },
        id,
        title: if name.is_empty() { "（未命名项目）".into() } else { name },
        subtitle: value_string(item, "/lastModifiedBy/user/displayName"),
        web_url: value_string(item, "/webUrl"),
        modified_at: value_string(item, "/lastModifiedDateTime"),
        mime_type: mime,
    })
}

fn microsoft_drive_children_url(item_id: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/v1.0/me/drive/items/")
        .map_err(|_| "OneDrive 地址无效。")?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "OneDrive 文件夹地址无效。".to_string())?;
        segments.pop_if_empty().push(item_id).push("children");
    }
    Ok(url)
}

async fn microsoft_drive(client: &reqwest::Client, token: &str, max_items: usize) -> Result<Vec<CloudItem>, String> {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/v1.0/me/drive/root/children")
        .map_err(|_| "OneDrive 地址无效。")?;
    url.query_pairs_mut()
        .append_pair("$top", &max_items.saturating_mul(2).clamp(1, 40).to_string())
        .append_pair("$select", "id,name,lastModifiedDateTime,webUrl,file,folder,lastModifiedBy")
        .append_pair("$orderby", "lastModifiedDateTime desc");
    let response = authorized_json(client, token, url).await?;
    let folder_ids = response
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("folder").is_some())
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
        .take(3)
        .collect::<Vec<_>>();
    let mut items = response
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(microsoft_drive_item)
        .collect::<Vec<_>>();

    // Graph's `drive/recent` endpoint is deprecated. Read the root plus the
    // three most recently modified top-level folders for a useful, bounded overview.
    for folder_id in folder_ids {
        let mut child_url = microsoft_drive_children_url(&folder_id)?;
        child_url
            .query_pairs_mut()
            .append_pair("$top", &max_items.to_string())
            .append_pair("$select", "id,name,lastModifiedDateTime,webUrl,file,folder,lastModifiedBy")
            .append_pair("$orderby", "lastModifiedDateTime desc");
        if let Ok(children) = authorized_json(client, token, child_url).await {
            items.extend(
                children
                    .get("value")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(microsoft_drive_item),
            );
        }
    }

    items.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.id.clone()));
    items.truncate(max_items);
    Ok(items)
}

async fn microsoft_sharepoint(client: &reqwest::Client, token: &str, max_items: usize) -> Result<Vec<CloudItem>, String> {
    let mut url = reqwest::Url::parse("https://graph.microsoft.com/v1.0/sites")
        .map_err(|_| "SharePoint 地址无效。")?;
    url.query_pairs_mut()
        .append_pair("search", "*")
        .append_pair("$top", &max_items.to_string())
        .append_pair("$select", "id,displayName,description,webUrl,lastModifiedDateTime");
    let response = authorized_json(client, token, url).await?;
    Ok(response
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            Some(CloudItem {
                provider: "microsoft".into(),
                service: "sharepoint".into(),
                id,
                title: value_string(item, "/displayName"),
                subtitle: value_string(item, "/description"),
                web_url: value_string(item, "/webUrl"),
                modified_at: value_string(item, "/lastModifiedDateTime"),
                mime_type: "application/vnd.microsoft.sharepoint.site".into(),
            })
        })
        .collect())
}

fn append_service(
    all_items: &mut Vec<CloudItem>,
    services: &mut Vec<CloudServiceStatus>,
    service: &str,
    label: &str,
    result: Result<Vec<CloudItem>, String>,
) {
    match result {
        Ok(items) => {
            let item_count = items.len();
            all_items.extend(items);
            services.push(CloudServiceStatus {
                service: service.into(),
                label: label.into(),
                success: true,
                item_count,
                error: String::new(),
            });
        }
        Err(error) => services.push(CloudServiceStatus {
            service: service.into(),
            label: label.into(),
            success: false,
            item_count: 0,
            error: trim_text(error, 500),
        }),
    }
}

#[tauri::command]
pub(crate) async fn sync_cloud_overview(
    request: CloudSyncRequest,
) -> Result<CloudSyncResult, String> {
    validate_account_id(&request.account_id)?;
    if !matches!(request.provider.as_str(), "google" | "microsoft") {
        return Err("不支持这个云端服务商。".into());
    }
    let token = refresh_token_if_needed(load_token(&request.account_id)?).await?;
    if token.provider != request.provider {
        return Err("OAuth 授权与所选服务商不匹配，请重新连接。".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法初始化云端连接：{error}"))?;
    let max_items = request.max_items.clamp(1, 20);
    let mut items = Vec::new();
    let mut services = Vec::new();
    if token.provider == "google" {
        let mail = google_mail(&client, &token.access_token, max_items).await;
        append_service(&mut items, &mut services, "mail", "Gmail", mail);
        let calendar = google_calendar(&client, &token.access_token, max_items).await;
        append_service(&mut items, &mut services, "calendar", "Google Calendar", calendar);
        let drive = google_drive(&client, &token.access_token, max_items).await;
        append_service(&mut items, &mut services, "drive", "Google Drive / Sheets", drive);
    } else {
        let mail = microsoft_mail(&client, &token.access_token, max_items).await;
        append_service(&mut items, &mut services, "mail", "Outlook", mail);
        let calendar = microsoft_calendar(&client, &token.access_token, max_items).await;
        append_service(&mut items, &mut services, "calendar", "Microsoft Calendar", calendar);
        let drive = microsoft_drive(&client, &token.access_token, max_items).await;
        append_service(&mut items, &mut services, "drive", "OneDrive / Excel", drive);
        if request.include_share_point {
            let sharepoint = microsoft_sharepoint(&client, &token.access_token, max_items).await;
            append_service(&mut items, &mut services, "sharepoint", "SharePoint", sharepoint);
        }
    }
    items.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    Ok(CloudSyncResult {
        items,
        services,
        synced_at: utc_now(),
    })
}
