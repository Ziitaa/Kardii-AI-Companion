use reqwest::{header, Client, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

const MCP_PROTOCOL_VERSION: &str = "2025-11-25";
const MAX_MCP_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const KEYRING_SERVICE: &str = "Kardii AI Companion";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRequest {
    server_id: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallRequest {
    server_id: String,
    url: String,
    tool_name: String,
    #[serde(default)]
    arguments: Value,
    #[serde(default)]
    allow_write: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub read_only_hint: bool,
    pub destructive_hint: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionResult {
    pub protocol_version: String,
    pub server_name: String,
    pub server_version: String,
    pub tools: Vec<McpToolInfo>,
    pub tested_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallResult {
    pub tool_name: String,
    pub content: String,
    pub structured_content: Option<Value>,
    pub is_error: bool,
    pub duration_ms: u128,
}

fn mcp_tool_risk(tool: &McpToolInfo) -> &'static str {
    let text = format!("{} {}", tool.name, tool.description).to_ascii_lowercase();
    let contains_blocked_word = text
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|word| matches!(word, "pay" | "buy"));
    if contains_blocked_word || [
        "purchase", "payment", "checkout", "place order", "place_order", "submit order",
        "submit_order", "buy now", "transfer funds", "transfer money", "wire transfer",
        "withdraw", "charge", "payout", "refund", "支付", "购买", "付款", "结账",
        "下单", "提交订单", "转账", "汇款", "提现", "退款",
    ].iter().any(|term| text.contains(term)) {
        "blocked"
    } else if tool.destructive_hint || [
        "delete", "remove", "erase", "destroy", "drop", "truncate", "revoke", "删除",
        "撤销", "销毁", "清空",
    ].iter().any(|term| text.contains(term)) {
        "destructive"
    } else if tool.read_only_hint {
        "read"
    } else {
        "write"
    }
}

fn mcp_arguments_contain_secret(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            let lower = key.to_ascii_lowercase().replace('-', "_").replace(' ', "_");
            ["password", "passcode", "secret", "token", "api_key", "apikey", "otp", "cvv", "cvc", "card_number"]
                .iter()
                .any(|blocked| lower.contains(blocked))
                || mcp_arguments_contain_secret(value)
        }),
        Value::Array(items) => items.iter().any(mcp_arguments_contain_secret),
        _ => false,
    }
}

struct McpSession {
    client: Client,
    url: Url,
    token: Option<String>,
    session_id: Option<String>,
    protocol_version: String,
    server_name: String,
    server_version: String,
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn clean_server_id(value: &str) -> Result<String, String> {
    let clean = value.trim();
    if clean.is_empty()
        || clean.len() > 48
        || !clean.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("MCP 连接 ID 无效。".into());
    }
    Ok(clean.to_string())
}

fn mcp_account(server_id: &str) -> Result<String, String> {
    Ok(format!("mcp-token-v1-{}", clean_server_id(server_id)?))
}

fn validate_mcp_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "MCP 地址格式无效。".to_string())?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("MCP 地址不能包含账号、密码或片段。".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let is_loopback = matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && is_loopback) {
        return Err("远程 MCP 必须使用 HTTPS；HTTP 只允许 127.0.0.1、localhost 或 ::1。".into());
    }
    if host.is_empty() {
        return Err("MCP 地址缺少主机名。".into());
    }
    Ok(url)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn save_secret(account: &str, token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("无法打开系统安全凭据库：{error}"))?
        .set_password(token)
        .map_err(|error| format!("无法保存 MCP 凭据：{error}"))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn load_secret(account: &str) -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, account).ok()?.get_password().ok()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn delete_secret(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("无法打开系统安全凭据库：{error}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法删除 MCP 凭据：{error}")),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn dev_secrets() -> &'static Mutex<HashMap<String, String>> {
    static SECRETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    SECRETS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn save_secret(account: &str, token: &str) -> Result<(), String> {
    dev_secrets().lock().map_err(|_| "无法锁定 MCP 开发凭据。".to_string())?.insert(account.into(), token.into());
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn load_secret(account: &str) -> Option<String> {
    dev_secrets().lock().ok()?.get(account).cloned()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn delete_secret(account: &str) -> Result<(), String> {
    dev_secrets().lock().map_err(|_| "无法锁定 MCP 开发凭据。".to_string())?.remove(account);
    Ok(())
}

fn mcp_client(url: &Url) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none());
    if matches!(url.host_str().unwrap_or_default(), "127.0.0.1" | "localhost" | "::1") {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|error| format!("无法创建 MCP 连接：{error}"))
}

fn rpc_request(session: &McpSession, value: &Value) -> reqwest::RequestBuilder {
    let mut request = session.client
        .post(session.url.clone())
        .header(header::ACCEPT, "application/json, text/event-stream")
        .header(header::CONTENT_TYPE, "application/json")
        .header("MCP-Protocol-Version", &session.protocol_version)
        .json(value);
    if let Some(token) = session.token.as_deref() {
        request = request.bearer_auth(token);
    }
    if let Some(session_id) = session.session_id.as_deref() {
        request = request.header("Mcp-Session-Id", session_id);
    }
    request
}

async fn response_body(mut response: Response) -> Result<(Option<String>, String), String> {
    let status = response.status();
    let session_id = response.headers().get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    if response.content_length().is_some_and(|length| length > MAX_MCP_RESPONSE_BYTES as u64) {
        return Err("MCP 响应超过 2 MB 安全上限。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("读取 MCP 响应失败：{error}"))? {
        if bytes.len().saturating_add(chunk.len()) > MAX_MCP_RESPONSE_BYTES {
            return Err("MCP 响应超过 2 MB 安全上限。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        return Err(format!("MCP 返回 HTTP {}：{}", status.as_u16(), body.chars().take(600).collect::<String>()));
    }
    Ok((session_id, body))
}

fn rpc_value(body: &str) -> Result<Value, String> {
    let clean = body.trim();
    let value = if clean.starts_with('{') {
        serde_json::from_str(clean).ok()
    } else {
        let values: Vec<Value> = clean.lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim)
            .filter(|line| !line.is_empty() && *line != "[DONE]")
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
        values.into_iter().rev().find(|value| value.get("id").is_some() || value.get("error").is_some())
    }.ok_or_else(|| "MCP 返回了无法识别的 JSON-RPC 或 SSE 响应。".to_string())?;
    if let Some(error) = value.get("error") {
        let message = error.get("message").and_then(Value::as_str).unwrap_or("未知 MCP 错误");
        return Err(format!("MCP 工具服务器拒绝请求：{message}"));
    }
    Ok(value)
}

async fn initialize_mcp(request: &McpServerRequest) -> Result<McpSession, String> {
    let account = mcp_account(&request.server_id)?;
    let url = validate_mcp_url(&request.url)?;
    let mut session = McpSession {
        client: mcp_client(&url)?,
        url,
        token: load_secret(&account).filter(|value| !value.trim().is_empty()),
        session_id: None,
        protocol_version: MCP_PROTOCOL_VERSION.into(),
        server_name: "MCP Server".into(),
        server_version: "未知".into(),
    };
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "Kardii", "version": env!("CARGO_PKG_VERSION") }
        }
    });
    let response = rpc_request(&session, &initialize).send().await
        .map_err(|error| format!("连接 MCP 服务器失败：{error}"))?;
    let (session_id, body) = response_body(response).await?;
    session.session_id = session_id;
    let value = rpc_value(&body)?;
    let result = value.get("result").cloned().unwrap_or(Value::Null);
    session.protocol_version = result.get("protocolVersion").and_then(Value::as_str).unwrap_or(MCP_PROTOCOL_VERSION).to_string();
    if !matches!(session.protocol_version.as_str(), "2025-11-25" | "2025-06-18" | "2025-03-26") {
        return Err(format!("MCP 服务器选择了 Kardii 尚未支持的协议版本：{}", session.protocol_version));
    }
    if result.pointer("/capabilities/tools").is_none() {
        return Err("这个 MCP 服务器没有声明 tools 能力。".into());
    }
    session.server_name = result.pointer("/serverInfo/name").and_then(Value::as_str).unwrap_or("MCP Server").chars().take(200).collect();
    session.server_version = result.pointer("/serverInfo/version").and_then(Value::as_str).unwrap_or("未知").chars().take(100).collect();
    let notification = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let response = rpc_request(&session, &notification).send().await
        .map_err(|error| format!("MCP 初始化确认失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("MCP 初始化确认返回 HTTP {}。", response.status().as_u16()));
    }
    Ok(session)
}

async fn close_mcp_session(session: &McpSession) {
    let Some(session_id) = session.session_id.as_deref() else { return; };
    let mut request = session.client
        .delete(session.url.clone())
        .header("MCP-Protocol-Version", &session.protocol_version)
        .header("Mcp-Session-Id", session_id);
    if let Some(token) = session.token.as_deref() {
        request = request.bearer_auth(token);
    }
    let _ = request.send().await;
}

async fn list_tools(session: &McpSession) -> Result<Vec<McpToolInfo>, String> {
    let request = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} });
    let response = rpc_request(session, &request).send().await
        .map_err(|error| format!("读取 MCP 工具清单失败：{error}"))?;
    let (_, body) = response_body(response).await?;
    let value = rpc_value(&body)?;
    let tools = value.pointer("/result/tools").and_then(Value::as_array)
        .ok_or_else(|| "MCP 服务器没有返回 tools/list 清单。".to_string())?;
    Ok(tools.iter().take(200).filter_map(|tool| {
        let name: String = tool.get("name")?.as_str()?.trim().chars().take(200).collect();
        if name.is_empty() { return None; }
        Some(McpToolInfo {
            name,
            description: tool.get("description").and_then(Value::as_str).unwrap_or("").chars().take(2_000).collect(),
            input_schema: tool.get("inputSchema").cloned().unwrap_or_else(|| json!({ "type": "object" })),
            read_only_hint: tool.pointer("/annotations/readOnlyHint").and_then(Value::as_bool).unwrap_or(false),
            destructive_hint: tool.pointer("/annotations/destructiveHint").and_then(Value::as_bool).unwrap_or(false),
        })
    }).collect())
}

#[tauri::command]
pub fn save_mcp_token(server_id: String, token: String) -> Result<(), String> {
    let clean: String = token.trim().chars().take(8_192).collect();
    if clean.is_empty() {
        return delete_secret(&mcp_account(&server_id)?);
    }
    save_secret(&mcp_account(&server_id)?, &clean)
}

#[tauri::command]
pub fn has_mcp_token(server_id: String) -> Result<bool, String> {
    Ok(load_secret(&mcp_account(&server_id)?).is_some())
}

#[tauri::command]
pub fn delete_mcp_token(server_id: String) -> Result<(), String> {
    delete_secret(&mcp_account(&server_id)?)
}

#[tauri::command]
pub async fn test_mcp_connection(request: McpServerRequest) -> Result<McpConnectionResult, String> {
    let session = initialize_mcp(&request).await?;
    let result = list_tools(&session).await.map(|tools| McpConnectionResult {
        protocol_version: session.protocol_version.clone(),
        server_name: session.server_name.clone(),
        server_version: session.server_version.clone(),
        tools,
        tested_at: now_epoch(),
    });
    close_mcp_session(&session).await;
    result
}

#[tauri::command]
pub async fn call_mcp_tool(request: McpCallRequest) -> Result<McpCallResult, String> {
    if !request.arguments.is_object() {
        return Err("MCP 工具参数必须是 JSON 对象。".into());
    }
    if serde_json::to_vec(&request.arguments).map_err(|_| "MCP 工具参数无法编码。".to_string())?.len() > 100_000 {
        return Err("MCP 工具参数超过 100 KB 安全上限。".into());
    }
    let tool_name: String = request.tool_name.trim().chars().take(200).collect();
    if tool_name.is_empty() {
        return Err("请选择要调用的 MCP 工具。".into());
    }
    let started = Instant::now();
    let server = McpServerRequest { server_id: request.server_id, url: request.url };
    let session = initialize_mcp(&server).await?;
    let tools = match list_tools(&session).await {
        Ok(tools) => tools,
        Err(error) => {
            close_mcp_session(&session).await;
            return Err(error);
        }
    };
    let Some(tool) = tools.iter().find(|tool| tool.name == tool_name) else {
        close_mcp_session(&session).await;
        return Err("所选工具不在服务器刚刚返回的工具清单中，已拒绝调用。".into());
    };
    let risk = mcp_tool_risk(tool);
    if risk == "blocked" {
        close_mcp_session(&session).await;
        return Err("Kardii 禁止调用付款、购买、下单或资金转移类 MCP 工具。".into());
    }
    if risk != "read" && !request.allow_write {
        close_mcp_session(&session).await;
        return Err("这个 MCP 工具未证明只读，需要用户对本次写入或删除操作单独确认。".into());
    }
    if mcp_arguments_contain_secret(&request.arguments) {
        close_mcp_session(&session).await;
        return Err("MCP 参数包含密码、Token、验证码或支付卡等敏感字段，Kardii 已拒绝发送。".into());
    }
    let call = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": { "name": tool_name, "arguments": request.arguments }
    });
    let response = match rpc_request(&session, &call).send().await {
        Ok(response) => response,
        Err(error) => {
            close_mcp_session(&session).await;
            return Err(format!("调用 MCP 工具失败：{error}"));
        }
    };
    let (_, body) = match response_body(response).await {
        Ok(body) => body,
        Err(error) => {
            close_mcp_session(&session).await;
            return Err(error);
        }
    };
    let value = match rpc_value(&body) {
        Ok(value) => value,
        Err(error) => {
            close_mcp_session(&session).await;
            return Err(error);
        }
    };
    let result = value.get("result").cloned().unwrap_or(Value::Null);
    let is_error = result.get("isError").and_then(Value::as_bool).unwrap_or(false);
    let content = result.get("content").and_then(Value::as_array).map(|items| {
        items.iter().filter_map(|item| {
            item.get("text").and_then(Value::as_str).map(ToOwned::to_owned)
                .or_else(|| serde_json::to_string_pretty(item).ok())
        }).collect::<Vec<_>>().join("\n\n")
    }).unwrap_or_else(|| serde_json::to_string_pretty(&result).unwrap_or_else(|_| "MCP 工具已返回结果。".into()));
    let call_result = McpCallResult {
        tool_name,
        content: content.chars().take(100_000).collect(),
        structured_content: result.get("structuredContent").cloned(),
        is_error,
        duration_ms: started.elapsed().as_millis(),
    };
    close_mcp_session(&session).await;
    Ok(call_result)
}
