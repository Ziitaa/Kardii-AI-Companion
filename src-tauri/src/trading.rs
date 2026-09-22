use crate::decision::{evaluate_with_fallback, DecisionAttempt, DecisionInput, DecisionProvider, JevDecisionProvider, RuleBaselineProvider};
use chrono::Utc;
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Sha256;
use std::{path::Path, sync::{Arc, Mutex}, time::Duration};
use tokio::sync::RwLock;

const SPOT_BASES: &[&str] = &[
    "https://api.binance.com",
    "https://data-api.binance.vision",
    "https://api1.binance.com",
];

const MARKET_GATEWAY_BASE_ENV: &str = "KARDII_MARKET_GATEWAY_BASE";
const MARKET_GATEWAY_TOKEN_ENV: &str = "KARDII_MARKET_GATEWAY_TOKEN";
const MARKET_GATEWAY_TOKEN_HEADER: &str = "X-Kardii-Market-Token";
const MARKET_GATEWAY_BASE_ACCOUNT: &str = "market-gateway-base-v1";
const MARKET_GATEWAY_TOKEN_ACCOUNT: &str = "market-gateway-token-v1";

fn normalize_market_gateway_base(value: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(value.trim())
        .map_err(|_| "Market Data Gateway 地址格式不正确。".to_string())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Market Data Gateway 地址不能包含账号、密码、查询参数或 fragment。".to_string());
    }
    if !matches!(url.path(), "" | "/") {
        return Err("Market Data Gateway 地址必须使用站点根路径。".to_string());
    }
    let host = url.host_str().unwrap_or_default();
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("远程 Market Data Gateway 必须使用 HTTPS；只有 localhost 可以使用 HTTP。".to_string());
    }
    url.set_path("");
    let mut normalized = url.to_string();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_market_gateway_keyring() -> Result<Option<(String, String)>, String> {
    let base_entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, MARKET_GATEWAY_BASE_ACCOUNT)
        .map_err(|error| format!("无法打开 Market Data Gateway 凭据库：{error}"))?;
    let token_entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, MARKET_GATEWAY_TOKEN_ACCOUNT)
        .map_err(|error| format!("无法打开 Market Data Gateway 凭据库：{error}"))?;
    let base = match base_entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("无法读取 Market Data Gateway 地址：{error}")),
    };
    let token = match token_entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("无法读取 Market Data Gateway Token：{error}")),
    };
    Ok(Some((normalize_market_gateway_base(&base)?, token)))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_market_gateway_keyring() -> Result<Option<(String, String)>, String> {
    Ok(None)
}

fn validate_market_gateway_token(value: &str) -> Result<String, String> {
    let token = value.trim();
    if token.len() < 32
        || token.len() > 256
        || !token.chars().all(|character| character.is_ascii_graphic())
    {
        return Err("Market Data Gateway Token 必须是 32–256 位可见 ASCII 字符。".to_string());
    }
    Ok(token.to_string())
}

fn configured_market_gateway() -> Result<Option<(String, String, &'static str)>, String> {
    let env_base = std::env::var(MARKET_GATEWAY_BASE_ENV).ok().unwrap_or_default();
    let env_token = std::env::var(MARKET_GATEWAY_TOKEN_ENV).ok().unwrap_or_default();
    if !env_base.trim().is_empty() || !env_token.trim().is_empty() {
        if env_base.trim().is_empty() || env_token.trim().is_empty() {
            return Err("Market Data Gateway 环境配置不完整，必须同时设置地址与 Token。".to_string());
        }
        return Ok(Some((
            normalize_market_gateway_base(&env_base)?,
            validate_market_gateway_token(&env_token)?,
            "environment",
        )));
    }
    Ok(load_market_gateway_keyring()?
        .map(|(base, token)| (base, token, "keyring")))
}

fn public_market_path_allowed(path_and_query: &str) -> bool {
    let path = path_and_query.split('?').next().unwrap_or(path_and_query);
    path == "/api/v3/ticker/24hr"
        || path == "/api/v3/ticker/price"
        || path == "/api/v3/klines"
        || path == "/api/v3/depth"
        || path == "/api/v3/exchangeInfo"
        || path == "/okx/api/v5/market/tickers"
        || path == "/okx/api/v5/market/ticker"
        || path == "/okx/api/v5/market/books"
        || path == "/okx/api/v5/market/candles"
        || path == "/okx/api/v5/public/instruments"
}

fn public_market_targets(path_and_query: &str) -> Result<Vec<(String, Option<String>)>, String> {
    if !path_and_query.starts_with('/') {
        return Err("公开市场数据路径无效。".to_string());
    }
    if let Some((base, token, _)) = configured_market_gateway()? {
        if !public_market_path_allowed(path_and_query) {
            return Err("Market Data Gateway 拒绝非公开行情路径。".to_string());
        }
        return Ok(vec![(format!("{base}{path_and_query}"), Some(token))]);
    }
    Ok(SPOT_BASES
        .iter()
        .map(|base| (format!("{base}{path_and_query}"), None))
        .collect())
}

fn with_market_gateway_auth(
    request: reqwest::RequestBuilder,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    match token {
        Some(value) => request.header(MARKET_GATEWAY_TOKEN_HEADER, value),
        None => request,
    }
}



#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketGatewayConnectionStatus {
    configured: bool,
    base_url: String,
    source: String,
    reachable: bool,
    okx_public_available: bool,
    okx_error: String,
    error: String,
}

#[derive(Debug, Clone, Default)]
struct MarketGatewayProbe {
    okx_public_available: bool,
    okx_error: String,
}

async fn probe_market_gateway(base_url: &str, token: &str) -> Result<MarketGatewayProbe, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("无法初始化 Market Data Gateway 检查：{error}"))?;
    let base = base_url.trim_end_matches('/');
    let response = client
        .get(format!("{base}/api/v3/ticker/price?symbol=BTCUSDT"))
        .header(MARKET_GATEWAY_TOKEN_HEADER, token)
        .header("Cache-Control", "no-store")
        .send()
        .await
        .map_err(|error| format!("无法连接 Market Data Gateway：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("Market Data Gateway 返回 HTTP {}", response.status()));
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Market Data Gateway 返回内容无法读取：{error}"))?;
    if payload.get("price").and_then(|value| value.as_str()).is_none() {
        return Err("Market Data Gateway 没有返回有效的 BTCUSDT 行情。".to_string());
    }

    let mut probe = MarketGatewayProbe::default();
    let okx_enabled = match client
        .get(format!("{base}/healthz"))
        .header("Cache-Control", "no-store")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|value| value.get("okxPublicEnabled").and_then(|item| item.as_bool()))
            .unwrap_or(false),
        _ => false,
    };
    if okx_enabled {
        match client
            .get(format!("{base}/okx/api/v5/market/ticker?instId=BTC-USDT"))
            .header(MARKET_GATEWAY_TOKEN_HEADER, token)
            .header("Cache-Control", "no-store")
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                match response.json::<serde_json::Value>().await {
                    Ok(value)
                        if value.get("code").and_then(|item| item.as_str()) == Some("0")
                            && value.get("data").and_then(|item| item.as_array()).is_some_and(|items| !items.is_empty()) =>
                    {
                        probe.okx_public_available = true;
                    }
                    Ok(value) => {
                        probe.okx_error = value
                            .get("msg")
                            .and_then(|item| item.as_str())
                            .filter(|message| !message.is_empty())
                            .unwrap_or("OKX public provider 返回内容无效。")
                            .to_string();
                    }
                    Err(error) => probe.okx_error = format!("OKX public provider 返回内容无法读取：{error}"),
                }
            }
            Ok(response) => probe.okx_error = format!("OKX public provider 返回 HTTP {}", response.status()),
            Err(error) => probe.okx_error = format!("无法连接 OKX public provider：{error}"),
        }
    }
    Ok(probe)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn save_market_gateway_keyring(base_url: &str, token: &str) -> Result<(), String> {
    keyring::Entry::new(TRADING_KEYRING_SERVICE, MARKET_GATEWAY_BASE_ACCOUNT)
        .map_err(|error| format!("无法打开 Market Data Gateway 凭据库：{error}"))?
        .set_password(base_url)
        .map_err(|error| format!("无法保存 Market Data Gateway 地址：{error}"))?;
    keyring::Entry::new(TRADING_KEYRING_SERVICE, MARKET_GATEWAY_TOKEN_ACCOUNT)
        .map_err(|error| format!("无法打开 Market Data Gateway 凭据库：{error}"))?
        .set_password(token)
        .map_err(|error| format!("无法保存 Market Data Gateway Token：{error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn save_market_gateway_keyring(_base_url: &str, _token: &str) -> Result<(), String> {
    Err("当前平台暂不支持安全保存 Market Data Gateway 配置。".to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn delete_market_gateway_keyring() -> Result<(), String> {
    for account in [MARKET_GATEWAY_BASE_ACCOUNT, MARKET_GATEWAY_TOKEN_ACCOUNT] {
        let entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, account)
            .map_err(|error| format!("无法打开 Market Data Gateway 凭据库：{error}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(format!("无法删除 Market Data Gateway 配置：{error}")),
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn delete_market_gateway_keyring() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn save_market_gateway_connection(
    base_url: String,
    token: String,
) -> Result<MarketGatewayConnectionStatus, String> {
    let base_url = normalize_market_gateway_base(&base_url)?;
    let token = validate_market_gateway_token(&token)?;
    let probe = probe_market_gateway(&base_url, &token).await?;
    save_market_gateway_keyring(&base_url, &token)?;
    Ok(MarketGatewayConnectionStatus {
        configured: true,
        base_url,
        source: "keyring".to_string(),
        reachable: true,
        okx_public_available: probe.okx_public_available,
        okx_error: probe.okx_error,
        error: String::new(),
    })
}

#[tauri::command]
pub async fn get_market_gateway_connection_status() -> Result<MarketGatewayConnectionStatus, String> {
    let Some((base_url, token, source)) = configured_market_gateway()? else {
        return Ok(MarketGatewayConnectionStatus {
            configured: false,
            base_url: String::new(),
            source: String::new(),
            reachable: false,
            okx_public_available: false,
            okx_error: String::new(),
            error: String::new(),
        });
    };
    match probe_market_gateway(&base_url, &token).await {
        Ok(probe) => Ok(MarketGatewayConnectionStatus {
            configured: true,
            base_url,
            source: source.to_string(),
            reachable: true,
            okx_public_available: probe.okx_public_available,
            okx_error: probe.okx_error,
            error: String::new(),
        }),
        Err(error) => Ok(MarketGatewayConnectionStatus {
            configured: true,
            base_url,
            source: source.to_string(),
            reachable: false,
            okx_public_available: false,
            okx_error: String::new(),
            error,
        }),
    }
}

#[tauri::command]
pub fn delete_market_gateway_connection() -> Result<(), String> {
    delete_market_gateway_keyring()
}

const BINANCE_PRIVATE_BASES: &[&str] = &[
    "https://api.binance.com",
    "https://api1.binance.com",
];
const TRADING_KEYRING_SERVICE: &str = "Kardii Trading Runtime";
const BINANCE_API_KEY_ACCOUNT: &str = "binance-readonly-api-key";
const BINANCE_API_SECRET_ACCOUNT: &str = "binance-readonly-api-secret";
const TYPESAFE_JEV_API_KEY_ACCOUNT: &str = "typesafe-jev-api-key-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JevProviderStatus {
    configured: bool,
    verified: bool,
    provider: String,
    model: String,
    mode: String,
    execution_linked: bool,
    error: String,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn save_jev_api_key_to_keyring(api_key: &str) -> Result<(), String> {
    keyring::Entry::new(TRADING_KEYRING_SERVICE, TYPESAFE_JEV_API_KEY_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .set_password(api_key)
        .map_err(|error| format!("无法保存 TypeSafe API Key：{error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn save_jev_api_key_to_keyring(_api_key: &str) -> Result<(), String> {
    Err("当前平台暂不支持系统凭据库。".to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_jev_api_key_from_keyring() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, TYPESAFE_JEV_API_KEY_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法读取 TypeSafe API Key：{error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_jev_api_key_from_keyring() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn delete_jev_api_key_from_keyring() -> Result<(), String> {
    let entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, TYPESAFE_JEV_API_KEY_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法删除 TypeSafe API Key：{error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn delete_jev_api_key_from_keyring() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn save_jev_provider_credentials(api_key: String) -> Result<JevProviderStatus, String> {
    let provider = JevDecisionProvider::new(api_key.clone())?;
    let model = provider.validate_access().await?;
    save_jev_api_key_to_keyring(api_key.trim())?;
    Ok(JevProviderStatus {
        configured: true,
        verified: true,
        provider: "typesafe-jev".to_string(),
        model,
        mode: "shadow-only".to_string(),
        execution_linked: false,
        error: String::new(),
    })
}

#[tauri::command]
pub fn get_jev_provider_status() -> Result<JevProviderStatus, String> {
    let configured = load_jev_api_key_from_keyring()?.is_some();
    Ok(JevProviderStatus {
        configured,
        verified: configured,
        provider: "typesafe-jev".to_string(),
        model: if configured { "jev-latest".to_string() } else { String::new() },
        mode: "shadow-only".to_string(),
        execution_linked: false,
        error: String::new(),
    })
}

#[tauri::command]
pub fn delete_jev_provider_credentials() -> Result<(), String> {
    delete_jev_api_key_from_keyring()
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BinanceApiRestrictions {
    #[serde(default)]
    ip_restrict: bool,
    #[serde(default)]
    enable_reading: bool,
    #[serde(default)]
    enable_withdrawals: bool,
    #[serde(default)]
    enable_internal_transfer: bool,
    #[serde(default)]
    permits_universal_transfer: bool,
    #[serde(default)]
    enable_margin: bool,
    #[serde(default)]
    enable_futures: bool,
    #[serde(default)]
    enable_vanilla_options: bool,
    #[serde(default)]
    enable_spot_and_margin_trading: bool,
    #[serde(default)]
    enable_portfolio_margin_trading: bool,
    #[serde(default)]
    enable_fix_api_trade: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceBalance {
    asset: String,
    free: String,
    locked: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinanceAccountInfo {
    #[serde(default)]
    can_trade: bool,
    #[serde(default)]
    can_withdraw: bool,
    #[serde(default)]
    can_deposit: bool,
    #[serde(default)]
    account_type: String,
    #[serde(default)]
    update_time: i64,
    #[serde(default)]
    balances: Vec<BinanceBalance>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceReadOnlyStatus {
    configured: bool,
    verified: bool,
    safe_read_only: bool,
    account_type: String,
    can_deposit: bool,
    nonzero_balances: Vec<BinanceBalance>,
    permissions: Option<BinanceApiRestrictions>,
    checked_at: String,
    error: String,
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sign_binance_query(secret: &str, query: &str) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| "Binance API Secret 无效。".to_string())?;
    mac.update(query.as_bytes());
    Ok(hex_lower(&mac.finalize().into_bytes()))
}

async fn binance_signed_json<T: DeserializeOwned>(
    api_key: &str,
    api_secret: &str,
    path: &str,
    extra_query: &str,
) -> Result<T, String> {
    let timestamp = Utc::now().timestamp_millis();
    let prefix = if extra_query.trim().is_empty() {
        String::new()
    } else {
        format!("{}&", extra_query.trim().trim_start_matches('?'))
    };
    let query = format!("{prefix}recvWindow=5000&timestamp={timestamp}");
    let signature = sign_binance_query(api_secret, &query)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("无法初始化 Binance 账户客户端：{error}"))?;
    let mut errors = Vec::new();

    for base in BINANCE_PRIVATE_BASES {
        let url = format!("{base}{path}?{query}&signature={signature}");
        match client
            .get(&url)
            .header("X-MBX-APIKEY", api_key)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                return response
                    .json::<T>()
                    .await
                    .map_err(|error| format!("Binance 账户数据解析失败：{error}"));
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                errors.push(format!("{base}: HTTP {status} {}", body.chars().take(220).collect::<String>()));
            }
            Err(error) => errors.push(format!("{base}: {error}")),
        }
    }
    Err(format!("Binance 账户读取失败：{}", errors.join("；")))
}

fn readonly_permissions_are_safe(value: &BinanceApiRestrictions) -> bool {
    value.enable_reading
        && !value.enable_withdrawals
        && !value.enable_internal_transfer
        && !value.permits_universal_transfer
        && !value.enable_spot_and_margin_trading
        && !value.enable_margin
        && !value.enable_futures
        && !value.enable_vanilla_options
        && !value.enable_portfolio_margin_trading
        && !value.enable_fix_api_trade
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn save_binance_credentials_to_keyring(api_key: &str, api_secret: &str) -> Result<(), String> {
    keyring::Entry::new(TRADING_KEYRING_SERVICE, BINANCE_API_KEY_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .set_password(api_key)
        .map_err(|error| format!("无法保存 Binance API Key：{error}"))?;
    keyring::Entry::new(TRADING_KEYRING_SERVICE, BINANCE_API_SECRET_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?
        .set_password(api_secret)
        .map_err(|error| format!("无法保存 Binance API Secret：{error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn save_binance_credentials_to_keyring(_api_key: &str, _api_secret: &str) -> Result<(), String> {
    Err("当前平台暂不支持系统凭据库。".to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_binance_credentials_from_keyring() -> Result<Option<(String, String)>, String> {
    let key_entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, BINANCE_API_KEY_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
    let secret_entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, BINANCE_API_SECRET_ACCOUNT)
        .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
    let api_key = match key_entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("无法读取 Binance API Key：{error}")),
    };
    let api_secret = match secret_entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("无法读取 Binance API Secret：{error}")),
    };
    Ok(Some((api_key, api_secret)))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_binance_credentials_from_keyring() -> Result<Option<(String, String)>, String> {
    Ok(None)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn delete_binance_credentials_from_keyring() -> Result<(), String> {
    for account in [BINANCE_API_KEY_ACCOUNT, BINANCE_API_SECRET_ACCOUNT] {
        let entry = keyring::Entry::new(TRADING_KEYRING_SERVICE, account)
            .map_err(|error| format!("无法打开系统凭据库：{error}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(format!("无法删除 Binance 只读凭据：{error}")),
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn delete_binance_credentials_from_keyring() -> Result<(), String> {
    Ok(())
}

async fn inspect_binance_readonly(
    api_key: &str,
    api_secret: &str,
) -> Result<BinanceReadOnlyStatus, String> {
    let permissions = binance_signed_json::<BinanceApiRestrictions>(
        api_key,
        api_secret,
        "/sapi/v1/account/apiRestrictions",
        "",
    )
    .await?;
    let safe = readonly_permissions_are_safe(&permissions);
    if !safe {
        return Ok(BinanceReadOnlyStatus {
            configured: true,
            verified: true,
            safe_read_only: false,
            account_type: String::new(),
            can_deposit: false,
            nonzero_balances: Vec::new(),
            permissions: Some(permissions),
            checked_at: Utc::now().to_rfc3339(),
            error: "这个 API Key 不是严格只读权限。Kardii 不会保存带交易、提现、保证金、期货、期权或组合保证金权限的 Key。".to_string(),
        });
    }

    let account = binance_signed_json::<BinanceAccountInfo>(
        api_key,
        api_secret,
        "/api/v3/account",
        "omitZeroBalances=true",
    )
    .await?;
    let balances = account
        .balances
        .into_iter()
        .filter(|item| parse_number(&item.free) != 0.0 || parse_number(&item.locked) != 0.0)
        .collect::<Vec<_>>();

    Ok(BinanceReadOnlyStatus {
        configured: true,
        verified: true,
        safe_read_only: true,
        account_type: account.account_type,
        can_deposit: account.can_deposit,
        nonzero_balances: balances,
        permissions: Some(permissions),
        checked_at: Utc::now().to_rfc3339(),
        error: String::new(),
    })
}

#[tauri::command]
pub async fn save_binance_readonly_credentials(
    api_key: String,
    api_secret: String,
) -> Result<BinanceReadOnlyStatus, String> {
    let api_key = api_key.trim();
    let api_secret = api_secret.trim();
    if api_key.len() < 16 || api_key.len() > 200 || api_secret.len() < 16 || api_secret.len() > 200 {
        return Err("Binance API Key / Secret 格式不完整。".to_string());
    }
    let status = inspect_binance_readonly(api_key, api_secret).await?;
    if !status.safe_read_only || !status.error.is_empty() {
        return Err(status.error);
    }
    save_binance_credentials_to_keyring(api_key, api_secret)?;
    Ok(status)
}

#[tauri::command]
pub async fn get_binance_readonly_status() -> Result<BinanceReadOnlyStatus, String> {
    let Some((api_key, api_secret)) = load_binance_credentials_from_keyring()? else {
        return Ok(BinanceReadOnlyStatus {
            configured: false,
            verified: false,
            safe_read_only: false,
            account_type: String::new(),
            can_deposit: false,
            nonzero_balances: Vec::new(),
            permissions: None,
            checked_at: Utc::now().to_rfc3339(),
            error: String::new(),
        });
    };
    inspect_binance_readonly(&api_key, &api_secret).await
}

#[tauri::command]
pub fn delete_binance_readonly_credentials() -> Result<(), String> {
    delete_binance_credentials_from_keyring()
}


#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BinanceDepositRecord {
    #[serde(default)]
    id: String,
    #[serde(default)]
    amount: String,
    #[serde(default)]
    coin: String,
    #[serde(default)]
    network: String,
    #[serde(default)]
    status: i64,
    #[serde(default)]
    tx_id: String,
    #[serde(default)]
    insert_time: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BinanceWithdrawRecord {
    #[serde(default)]
    id: String,
    #[serde(default)]
    amount: String,
    #[serde(default)]
    transaction_fee: String,
    #[serde(default)]
    coin: String,
    #[serde(default)]
    network: String,
    #[serde(default)]
    status: i64,
    #[serde(default)]
    tx_id: String,
    #[serde(default)]
    apply_time: String,
    #[serde(default)]
    withdraw_order_id: String,
}


#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BinanceTradeRecord {
    #[serde(default)]
    symbol: String,
    #[serde(default)]
    id: u64,
    #[serde(default)]
    order_id: i64,
    #[serde(default)]
    price: String,
    #[serde(default)]
    qty: String,
    #[serde(default)]
    quote_qty: String,
    #[serde(default)]
    commission: String,
    #[serde(default)]
    commission_asset: String,
    #[serde(default)]
    time: i64,
    #[serde(default)]
    is_buyer: bool,
    #[serde(default)]
    is_maker: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct BinancePriceTicker {
    price: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinanceTicker {
    symbol: String,
    last_price: String,
    price_change_percent: String,
    high_price: String,
    low_price: String,
    quote_volume: String,
    #[serde(default)]
    count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketTickerSummary {
    symbol: String,
    last_price: f64,
    change_percent_24h: f64,
    quote_volume_24h: f64,
    trade_count_24h: u64,
    intraday_range_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSnapshot {
    source: String,
    fetched_at: String,
    symbol_count: usize,
    top_by_volume: Vec<MarketTickerSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityCandidate {
    symbol: String,
    last_price: f64,
    change_percent_24h: f64,
    quote_volume_24h: f64,
    trade_count_24h: u64,
    intraday_range_percent: f64,
    attention_score: f64,
    signal: String,
    rationale: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityScan {
    source: String,
    fetched_at: String,
    methodology: String,
    candidates: Vec<OpportunityCandidate>,
}

#[derive(Debug, Clone, Deserialize)]
struct BinanceDepth {
    bids: Vec<[String; 2]>,
    asks: Vec<[String; 2]>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolResearch {
    symbol: String,
    fetched_at: String,
    sources: Vec<String>,
    last_price: f64,
    spread_bps: f64,
    bid_depth_notional: f64,
    ask_depth_notional: f64,
    order_book_imbalance: f64,
    return_1h_percent: f64,
    return_4h_percent: f64,
    realized_volatility_5m_percent: f64,
    volume_acceleration: f64,
    evidence: Vec<String>,
    limitations: Vec<String>,
}

async fn fetch_public_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    path_and_query: &str,
) -> Result<(String, T), String> {
    let mut errors = Vec::new();
    for (url, gateway_token) in public_market_targets(path_and_query)? {
        let request = with_market_gateway_auth(client.get(&url), gateway_token.as_deref());
        match request.send().await {
            Ok(response) if response.status().is_success() => {
                match response.json::<T>().await {
                    Ok(value) => return Ok((url, value)),
                    Err(error) => errors.push(format!("{url}: 数据解析失败 {error}")),
                }
            }
            Ok(response) => errors.push(format!("{url}: HTTP {}", response.status())),
            Err(error) => errors.push(format!("{url}: {error}")),
        }
    }
    Err(format!("公开市场数据暂不可用：{}", errors.join("；")))
}

fn percent_change(from: f64, to: f64) -> f64 {
    if from <= 0.0 { 0.0 } else { ((to - from) / from) * 100.0 }
}

fn stddev(values: &[f64]) -> f64 {
    if values.len() < 2 { return 0.0; }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / values.len() as f64;
    variance.sqrt()
}

fn depth_notional(levels: &[[String; 2]]) -> f64 {
    levels.iter().map(|level| parse_number(&level[0]) * parse_number(&level[1])).sum()
}

fn kline_number(row: &[serde_json::Value], index: usize) -> f64 {
    row.get(index)
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0)
}

fn kline_timestamp(row: &[serde_json::Value], index: usize) -> i64 {
    row.get(index)
        .and_then(|value| value.as_i64())
        .unwrap_or(0)
}

fn nearest_kline_close(rows: &[Vec<serde_json::Value>], target_ms: i64) -> f64 {
    rows.iter()
        .filter(|row| kline_timestamp(row, 0) > 0)
        .min_by_key(|row| (kline_timestamp(row, 0) - target_ms).abs())
        .map(|row| kline_number(row, 4))
        .unwrap_or(0.0)
}

async fn fetch_decision_horizon_prices(
    symbol: &str,
    decided_at_ms: i64,
) -> Result<(f64, f64, f64, f64), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("无法初始化 Decision Shadow 行情客户端：{error}"))?;

    let start_ms = decided_at_ms + 4 * 60_000;
    let end_ms = decided_at_ms + 242 * 60_000;
    let path = format!(
        "/api/v3/klines?symbol={symbol}&interval=1m&startTime={start_ms}&endTime={end_ms}&limit=300"
    );
    let (_source, rows) =
        fetch_public_json::<Vec<Vec<serde_json::Value>>>(&client, &path).await?;
    if rows.is_empty() {
        return Err(format!("{symbol} Decision Shadow 缺少后续 K 线。"));
    }

    let p5 = nearest_kline_close(&rows, decided_at_ms + 5 * 60_000);
    let p30 = nearest_kline_close(&rows, decided_at_ms + 30 * 60_000);
    let p60 = nearest_kline_close(&rows, decided_at_ms + 60 * 60_000);
    let p240 = nearest_kline_close(&rows, decided_at_ms + 240 * 60_000);
    if [p5, p30, p60, p240].iter().any(|price| *price <= 0.0) {
        return Err(format!("{symbol} Decision Shadow 后续价格样本不完整。"));
    }
    Ok((p5, p30, p60, p240))
}

fn shadow_return(entry: f64, future: f64) -> f64 {
    if entry > 0.0 {
        ((future - entry) / entry) * 100.0
    } else {
        0.0
    }
}

const DECISION_BENCHMARK_POLICY_VERSION: &str = "direction-1h-v1";
const DECISION_OUTCOME_HORIZON_MINUTES: i64 = 60;
const DECISION_BULLISH_THRESHOLD_PERCENT: f64 = 0.30;
const DECISION_BEARISH_THRESHOLD_PERCENT: f64 = -0.30;

fn classify_shadow_outcome(return_1h_percent: f64) -> &'static str {
    if return_1h_percent >= DECISION_BULLISH_THRESHOLD_PERCENT {
        "bullish"
    } else if return_1h_percent <= DECISION_BEARISH_THRESHOLD_PERCENT {
        "bearish"
    } else {
        "neutral"
    }
}


#[tauri::command]
pub async fn get_symbol_research(symbol: String) -> Result<SymbolResearch, String> {
    let symbol = symbol.trim().to_uppercase();
    if !tradable_usdt_symbol(&symbol) || symbol.len() > 24 {
        return Err("只支持有效的 USDT 现货交易对。".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("无法初始化市场研究客户端：{error}"))?;

    let depth_path = format!("/api/v3/depth?symbol={symbol}&limit=100");
    let klines_path = format!("/api/v3/klines?symbol={symbol}&interval=5m&limit=120");
    let ticker_path = format!("/api/v3/ticker/24hr?symbol={symbol}");

    let ((depth_source, depth), (klines_source, klines), (ticker_source, ticker)) =
        tokio::try_join!(
            fetch_public_json::<BinanceDepth>(&client, &depth_path),
            fetch_public_json::<Vec<Vec<serde_json::Value>>>(&client, &klines_path),
            fetch_public_json::<BinanceTicker>(&client, &ticker_path),
        )?;

    if klines.len() < 49 {
        return Err("K 线样本不足，暂不生成研究摘要。".to_string());
    }

    let best_bid = depth.bids.first().map(|x| parse_number(&x[0])).unwrap_or(0.0);
    let best_ask = depth.asks.first().map(|x| parse_number(&x[0])).unwrap_or(0.0);
    let mid = if best_bid > 0.0 && best_ask > 0.0 { (best_bid + best_ask) / 2.0 } else { 0.0 };
    let spread_bps = if mid > 0.0 { ((best_ask - best_bid) / mid) * 10_000.0 } else { 0.0 };

    let bid_depth = depth_notional(&depth.bids);
    let ask_depth = depth_notional(&depth.asks);
    let depth_total = bid_depth + ask_depth;
    let imbalance = if depth_total > 0.0 { (bid_depth - ask_depth) / depth_total } else { 0.0 };

    let closes: Vec<f64> = klines.iter().map(|row| kline_number(row, 4)).filter(|x| *x > 0.0).collect();
    let volumes: Vec<f64> = klines.iter().map(|row| kline_number(row, 5)).collect();
    let last_price = closes.last().copied().unwrap_or_else(|| parse_number(&ticker.last_price));

    let close_1h = closes.get(closes.len().saturating_sub(13)).copied().unwrap_or(last_price);
    let close_4h = closes.get(closes.len().saturating_sub(49)).copied().unwrap_or(last_price);
    let return_1h = percent_change(close_1h, last_price);
    let return_4h = percent_change(close_4h, last_price);

    let log_returns: Vec<f64> = closes.windows(2).filter_map(|pair| {
        if pair[0] > 0.0 && pair[1] > 0.0 { Some((pair[1] / pair[0]).ln() * 100.0) } else { None }
    }).collect();
    let realized_volatility = stddev(&log_returns);

    let recent_volume: f64 = volumes.iter().rev().take(12).sum();
    let previous_volume: f64 = volumes.iter().rev().skip(12).take(12).sum();
    let volume_acceleration = if previous_volume > 0.0 { recent_volume / previous_volume } else { 0.0 };

    let mut evidence = Vec::new();
    evidence.push(format!("盘口价差约 {:.2} bps。", spread_bps));
    evidence.push(format!("前 100 档买卖盘不平衡值 {:.3}（正值偏买盘，负值偏卖盘）。", imbalance));
    evidence.push(format!("近 1 小时价格变化 {:.2}%，近 4 小时 {:.2}%。", return_1h, return_4h));
    evidence.push(format!("5 分钟收益波动率约 {:.3}%，近 1 小时成交量相对前 1 小时为 {:.2}x。", realized_volatility, volume_acceleration));
    evidence.push(format!("24h 成交额约 {:.0} USDT，成交笔数 {}。", parse_number(&ticker.quote_volume), ticker.count));

    Ok(SymbolResearch {
        symbol,
        fetched_at: Utc::now().to_rfc3339(),
        sources: vec![ticker_source, depth_source, klines_source],
        last_price,
        spread_bps: (spread_bps * 100.0).round() / 100.0,
        bid_depth_notional: bid_depth,
        ask_depth_notional: ask_depth,
        order_book_imbalance: (imbalance * 1000.0).round() / 1000.0,
        return_1h_percent: (return_1h * 100.0).round() / 100.0,
        return_4h_percent: (return_4h * 100.0).round() / 100.0,
        realized_volatility_5m_percent: (realized_volatility * 1000.0).round() / 1000.0,
        volume_acceleration: (volume_acceleration * 100.0).round() / 100.0,
        evidence,
        limitations: vec![
            "这些是公开现货市场数据，不包含账户、持仓或任何私人数据。".to_string(),
            "盘口是抓取瞬间的快照，不能单独证明未来方向。".to_string(),
            "该研究层只生成可复核证据，不产生买卖指令。".to_string(),
        ],
    })
}

fn millis_timestamp_rfc3339(value: i64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(value)
        .map(|time| time.to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339())
}

fn binance_apply_time_rfc3339(value: &str) -> String {
    let clean = value.trim();
    if clean.is_empty() {
        return Utc::now().to_rfc3339();
    }
    chrono::NaiveDateTime::parse_from_str(clean, "%Y-%m-%d %H:%M:%S")
        .map(|time| time.and_utc().to_rfc3339())
        .unwrap_or_else(|_| clean.to_string())
}

fn parse_number(value: &str) -> f64 {
    value.parse::<f64>().unwrap_or(0.0)
}

fn tradable_usdt_symbol(symbol: &str) -> bool {
    if !symbol.ends_with("USDT") {
        return false;
    }
    const EXCLUDED_BASES: &[&str] = &[
        "USDC", "FDUSD", "TUSD", "USDP", "BUSD", "DAI", "EUR", "TRY", "BRL",
    ];
    let base = symbol.trim_end_matches("USDT");
    if EXCLUDED_BASES.contains(&base) {
        return false;
    }
    !["UP", "DOWN", "BULL", "BEAR"].iter().any(|suffix| base.ends_with(suffix))
}

fn summarize(ticker: &BinanceTicker) -> MarketTickerSummary {
    let last = parse_number(&ticker.last_price);
    let high = parse_number(&ticker.high_price);
    let low = parse_number(&ticker.low_price);
    let range = if low > 0.0 { ((high - low) / low) * 100.0 } else { 0.0 };
    MarketTickerSummary {
        symbol: ticker.symbol.clone(),
        last_price: last,
        change_percent_24h: parse_number(&ticker.price_change_percent),
        quote_volume_24h: parse_number(&ticker.quote_volume),
        trade_count_24h: ticker.count,
        intraday_range_percent: range.max(0.0),
    }
}

fn candidate_from(summary: &MarketTickerSummary) -> Option<OpportunityCandidate> {
    if !tradable_usdt_symbol(&summary.symbol) {
        return None;
    }
    if summary.quote_volume_24h < 3_000_000.0 || summary.trade_count_24h < 1_000 {
        return None;
    }

    let absolute_change = summary.change_percent_24h.abs();
    let unusually_liquid = summary.quote_volume_24h >= 100_000_000.0;
    let unusually_volatile = summary.intraday_range_percent >= 5.0;
    if absolute_change < 2.5 && !unusually_liquid && !unusually_volatile {
        return None;
    }

    let liquidity_component =
        ((summary.quote_volume_24h.max(1.0).log10() - 6.0).max(0.0) * 12.0).min(30.0);
    let activity_component =
        ((summary.trade_count_24h.max(1) as f64).log10() * 3.0).min(15.0);
    let change_component = (absolute_change * 2.0).min(35.0);
    let range_component = (summary.intraday_range_percent * 1.5).min(20.0);
    let score = (liquidity_component + activity_component + change_component + range_component)
        .min(100.0);

    let (signal, rationale) = if absolute_change >= 8.0 && unusually_liquid {
        (
            "high-momentum".to_string(),
            "24h 价格变化显著且成交额高，适合进入研究队列；不代表买入或卖出信号。".to_string(),
        )
    } else if unusually_volatile && unusually_liquid {
        (
            "high-volatility".to_string(),
            "日内振幅与成交活跃度同时偏高，值得检查新闻、资金与盘口来源。".to_string(),
        )
    } else if unusually_liquid {
        (
            "liquidity-leader".to_string(),
            "成交额处于高水平，适合作为市场状态与后续策略研究样本。".to_string(),
        )
    } else {
        (
            "activity-spike".to_string(),
            "价格或振幅达到研究阈值，进入候选池等待更多证据。".to_string(),
        )
    };

    Some(OpportunityCandidate {
        symbol: summary.symbol.clone(),
        last_price: summary.last_price,
        change_percent_24h: summary.change_percent_24h,
        quote_volume_24h: summary.quote_volume_24h,
        trade_count_24h: summary.trade_count_24h,
        intraday_range_percent: summary.intraday_range_percent,
        attention_score: (score * 10.0).round() / 10.0,
        signal,
        rationale,
    })
}

async fn fetch_spot_tickers() -> Result<(String, Vec<MarketTickerSummary>), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("无法初始化市场数据客户端：{error}"))?;
    let (source, tickers) =
        fetch_public_json::<Vec<BinanceTicker>>(&client, "/api/v3/ticker/24hr").await?;
    if tickers.is_empty() {
        return Err("市场数据暂不可用：返回空数据".to_string());
    }
    Ok((source, tickers.iter().map(summarize).collect()))
}

#[tauri::command]
pub async fn get_market_snapshot(limit: Option<usize>) -> Result<MarketSnapshot, String> {
    let limit = limit.unwrap_or(12).clamp(1, 50);
    let (source, tickers) = fetch_spot_tickers().await?;
    let mut summaries: Vec<_> = tickers
        .into_iter()
        .filter(|ticker| tradable_usdt_symbol(&ticker.symbol))
        .collect();
    summaries.sort_by(|a, b| {
        b.quote_volume_24h
            .partial_cmp(&a.quote_volume_24h)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let symbol_count = summaries.len();
    summaries.truncate(limit);

    Ok(MarketSnapshot {
        source,
        fetched_at: Utc::now().to_rfc3339(),
        symbol_count,
        top_by_volume: summaries,
    })
}

#[tauri::command]
pub async fn scan_market_opportunities(limit: Option<usize>) -> Result<OpportunityScan, String> {
    let limit = limit.unwrap_or(12).clamp(1, 50);
    let (source, tickers) = fetch_spot_tickers().await?;
    let mut candidates: Vec<_> = tickers.iter().filter_map(candidate_from).collect();
    candidates.sort_by(|a, b| {
        b.attention_score
            .partial_cmp(&a.attention_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(limit);

    Ok(OpportunityScan {
        source,
        fetched_at: Utc::now().to_rfc3339(),
        methodology: "公开现货 24h 数据的确定性筛选：流动性、成交笔数、价格变化与日内振幅。候选仅进入研究队列，不构成交易指令。".to_string(),
        candidates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(symbol: &str, change: f64, volume: f64, count: u64) -> MarketTickerSummary {
        MarketTickerSummary {
            symbol: symbol.into(),
            last_price: 1.25,
            change_percent_24h: change,
            quote_volume_24h: volume,
            trade_count_24h: count,
            intraday_range_percent: ((1.40 - 1.10) / 1.10) * 100.0,
        }
    }

    #[test]
    fn market_gateway_only_allows_public_market_paths() {
        assert!(public_market_path_allowed("/api/v3/ticker/24hr"));
        assert!(public_market_path_allowed("/api/v3/ticker/24hr?symbol=BTCUSDT"));
        assert!(public_market_path_allowed("/api/v3/klines?symbol=BTCUSDT&interval=1m"));
        assert!(public_market_path_allowed("/okx/api/v5/market/tickers?instType=SPOT"));
        assert!(public_market_path_allowed("/okx/api/v5/market/books?instId=BTC-USDT&sz=100"));
        assert!(!public_market_path_allowed("/api/v3/account"));
        assert!(!public_market_path_allowed("/sapi/v1/account/apiRestrictions"));
        assert!(!public_market_path_allowed("/okx/api/v5/account/balance"));
        assert!(!public_market_path_allowed("/okx/api/v5/trade/order"));
    }

    #[test]
    fn market_gateway_requires_https_except_loopback() {
        assert_eq!(
            normalize_market_gateway_base("https://market.example/").unwrap(),
            "https://market.example"
        );
        assert!(normalize_market_gateway_base("http://127.0.0.1:8787").is_ok());
        assert!(normalize_market_gateway_base("http://localhost:8787").is_ok());
        assert!(normalize_market_gateway_base("http://market.example").is_err());
        assert!(normalize_market_gateway_base("https://market.example/private").is_err());
        assert!(normalize_market_gateway_base("https://user@market.example").is_err());
    }

    #[test]
    fn market_gateway_token_is_strict() {
        assert!(validate_market_gateway_token("12345678901234567890123456789012").is_ok());
        assert!(validate_market_gateway_token("short").is_err());
        assert!(validate_market_gateway_token("bad token with spaces 12345678901234567890123456789012").is_err());
    }

    #[test]
    fn excludes_stable_and_leveraged_pairs() {
        assert!(!tradable_usdt_symbol("USDCUSDT"));
        assert!(!tradable_usdt_symbol("BTCUPUSDT"));
        assert!(tradable_usdt_symbol("BTCUSDT"));
    }

    #[test]
    fn binance_ticker_normalizes_into_provider_neutral_summary() {
        let ticker = BinanceTicker {
            symbol: "BTCUSDT".into(),
            last_price: "100".into(),
            price_change_percent: "5".into(),
            high_price: "110".into(),
            low_price: "90".into(),
            quote_volume: "250000000".into(),
            count: 50000,
        };
        let normalized = summarize(&ticker);
        assert_eq!(normalized.symbol, "BTCUSDT");
        assert_eq!(normalized.last_price, 100.0);
        assert_eq!(normalized.change_percent_24h, 5.0);
        assert_eq!(normalized.quote_volume_24h, 250000000.0);
        assert_eq!(normalized.trade_count_24h, 50000);
    }

    #[test]
    fn thin_markets_do_not_become_candidates() {
        assert!(candidate_from(&sample("ABCUSDT", 20.0, 100000.0, 50)).is_none());
    }

    #[test]
    fn active_liquid_markets_can_enter_research_queue() {
        let candidate = candidate_from(&sample("ABCUSDT", 9.0, 120000000.0, 25000)).unwrap();
        assert!(candidate.attention_score > 0.0);
        assert_eq!(candidate.signal, "high-momentum");
    }

    #[test]
    fn percentage_change_is_deterministic() {
        assert_eq!((percent_change(100.0, 105.0) * 100.0).round() / 100.0, 5.0);
    }

    #[test]
    fn order_book_notional_uses_price_times_quantity() {
        let levels = vec![
            ["100".to_string(), "2".to_string()],
            ["99".to_string(), "1".to_string()],
        ];
        assert_eq!(depth_notional(&levels), 299.0);
    }
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRiskPolicy {
    mode: String,
    real_execution_enabled: bool,
    withdrawal_enabled: bool,
    leverage_enabled: bool,
    max_order_notional_usdt: f64,
    max_daily_loss_usdt: f64,
    max_open_positions: u32,
    note: String,
}

fn default_risk_policy() -> RuntimeRiskPolicy {
    RuntimeRiskPolicy {
        mode: "research-only".to_string(),
        real_execution_enabled: false,
        withdrawal_enabled: false,
        leverage_enabled: false,
        max_order_notional_usdt: 0.0,
        max_daily_loss_usdt: 0.0,
        max_open_positions: 0,
        note: "当前只做公开市场研究；真实交易、提现和杠杆均未启用。".to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchHistoryItem {
    id: i64,
    scanned_at: String,
    symbol: String,
    attention_score: f64,
    signal: String,
    last_price: f64,
    spread_bps: f64,
    return_1h_percent: f64,
    return_4h_percent: f64,
    volume_acceleration: f64,
    evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyExperiment {
    symbol: String,
    status: String,
    created_at: String,
    updated_at: String,
    observation_count: u32,
    miss_count: u32,
    best_attention_score: f64,
    hypothesis: String,
    invalidation_rule: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketDomainStatus {
    id: String,
    label: String,
    status: String,
    market_data: bool,
    account_read: bool,
    execution: bool,
    note: String,
}

fn market_domains() -> Vec<MarketDomainStatus> {
    vec![
        MarketDomainStatus {
            id: "crypto".to_string(),
            label: "Crypto".to_string(),
            status: "active".to_string(),
            market_data: true,
            account_read: false,
            execution: false,
            note: "当前使用公开加密市场数据做研究；账户读取和真实执行尚未接入。".to_string(),
        },
        MarketDomainStatus {
            id: "us-equities".to_string(),
            label: "美股".to_string(),
            status: "planned".to_string(),
            market_data: false,
            account_read: false,
            execution: false,
            note: "后续通过独立券商/行情适配器接入，不复用加密交易所凭据。".to_string(),
        },
        MarketDomainStatus {
            id: "hk-equities".to_string(),
            label: "港股".to_string(),
            status: "planned".to_string(),
            market_data: false,
            account_read: false,
            execution: false,
            note: "后续通过独立券商/行情适配器接入，并使用单独风险规则。".to_string(),
        },
    ]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealLedgerStatus {
    event_count: i64,
    snapshot_count: i64,
    latest_event_at: String,
    latest_snapshot_at: String,
    reconciliation_status: String,
    reconciliation_detail: String,
    full_event_sync_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingRuntimeSnapshot {
    mode: String,
    refreshing: bool,
    started_at: String,
    last_scan_at: String,
    last_error: String,
    persistence_error: String,
    market_source: String,
    candidate_count: usize,
    candidates: Vec<OpportunityCandidate>,
    research: Vec<SymbolResearch>,
    recent_history: Vec<ResearchHistoryItem>,
    strategy_experiments: Vec<StrategyExperiment>,
    markets: Vec<MarketDomainStatus>,
    risk_policy: RuntimeRiskPolicy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowExperimentStatus {
    open_count: i64,
    closed_count: i64,
    positive_count: i64,
    negative_count: i64,
    average_return_percent: f64,
    latest_closed_at: String,
    horizon_minutes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionProviderBenchmark {
    provider: String,
    provider_version: String,
    prediction_count: i64,
    settled_count: i64,
    correct_direction_count: i64,
    direction_accuracy_percent: f64,
    enter_count: i64,
    settled_enter_count: i64,
    positive_enter_count: i64,
    enter_positive_rate_percent: f64,
    average_enter_return_1h_percent: f64,
    average_latency_ms: f64,
    estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionShadowStatus {
    mode: String,
    benchmark_policy_version: String,
    outcome_horizon_minutes: i64,
    bullish_threshold_percent: f64,
    bearish_threshold_percent: f64,
    sample_count: i64,
    prediction_count: i64,
    pending_outcomes: i64,
    settled_outcomes: i64,
    providers_seen: i64,
    effective_predictions: i64,
    average_latency_ms: f64,
    provider_benchmarks: Vec<DecisionProviderBenchmark>,
    latest_decision_at: String,
    latest_provider: String,
    latest_symbol: String,
    latest_direction: String,
    latest_action: String,
    external_provider_configured: bool,
    execution_linked: bool,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionGuardStatus {
    latched: bool,
    reason: String,
    source: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionReadiness {
    ready: bool,
    account_configured: bool,
    reconciliation_ready: bool,
    risk_limits_configured: bool,
    real_execution_enabled: bool,
    kill_switch_latched: bool,
    reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeRiskRequest {
    symbol: String,
    side: String,
    notional_usdt: f64,
    leverage: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskDecision {
    allowed: bool,
    reasons: Vec<String>,
    policy: RuntimeRiskPolicy,
}


#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeIntentRequest {
    symbol: String,
    side: String,
    notional_usdt: f64,
    #[serde(default)]
    rationale: String,
    #[serde(default)]
    source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeIntentRecord {
    id: String,
    symbol: String,
    side: String,
    notional_usdt: f64,
    rationale: String,
    source: String,
    status: String,
    real_execution_allowed: bool,
    risk_reasons: Vec<String>,
    created_at: String,
}

#[derive(Clone)]
pub struct TradingRuntimeState {
    inner: Arc<RwLock<TradingRuntimeSnapshot>>,
    database: Arc<Mutex<Option<Connection>>>,
}

impl Default for TradingRuntimeState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(TradingRuntimeSnapshot {
                mode: "research-only".to_string(),
                refreshing: false,
                started_at: Utc::now().to_rfc3339(),
                last_scan_at: String::new(),
                last_error: String::new(),
                persistence_error: String::new(),
                market_source: String::new(),
                candidate_count: 0,
                candidates: Vec::new(),
                research: Vec::new(),
                recent_history: Vec::new(),
                strategy_experiments: Vec::new(),
                markets: market_domains(),
                risk_policy: default_risk_policy(),
            })),
            database: Arc::new(Mutex::new(None)),
        }
    }
}

fn strategy_hypothesis(signal: &str) -> String {
    match signal {
        "high-momentum" => "观察高成交额与价格动量是否能在后续扫描持续，而不是一次性尖峰。".to_string(),
        "high-volatility" => "观察高波动是否伴随持续流动性与成交活跃，而不是短暂失真。".to_string(),
        "liquidity-leader" => "观察高流动性标的是否出现新的方向性结构与成交量加速。".to_string(),
        _ => "观察当前异常活动是否能在多次扫描中重复出现并得到更多证据支持。".to_string(),
    }
}

impl TradingRuntimeState {
    pub fn initialize_persistence(&self, app_data_dir: &Path) -> Result<(), String> {
        let path = app_data_dir.join("kardii-trading.sqlite3");
        let connection = Connection::open(path)
            .map_err(|error| format!("无法打开 Kardii 交易研究数据库：{error}"))?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS research_history (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               scanned_at TEXT NOT NULL,
               symbol TEXT NOT NULL,
               attention_score REAL NOT NULL,
               signal TEXT NOT NULL,
               last_price REAL NOT NULL,
               spread_bps REAL NOT NULL,
               return_1h_percent REAL NOT NULL,
               return_4h_percent REAL NOT NULL,
               volume_acceleration REAL NOT NULL,
               evidence_json TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS research_history_symbol_time
               ON research_history(symbol, id DESC);
             CREATE TABLE IF NOT EXISTS strategy_experiments (
               symbol TEXT PRIMARY KEY NOT NULL,
               status TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               observation_count INTEGER NOT NULL,
               miss_count INTEGER NOT NULL,
               best_attention_score REAL NOT NULL,
               hypothesis TEXT NOT NULL,
               invalidation_rule TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS risk_policy (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               mode TEXT NOT NULL,
               real_execution_enabled INTEGER NOT NULL,
               withdrawal_enabled INTEGER NOT NULL,
               leverage_enabled INTEGER NOT NULL,
               max_order_notional_usdt REAL NOT NULL,
               max_daily_loss_usdt REAL NOT NULL,
               max_open_positions INTEGER NOT NULL,
               note TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS real_ledger_events (
               event_key TEXT PRIMARY KEY NOT NULL,
               venue TEXT NOT NULL,
               event_type TEXT NOT NULL,
               asset TEXT NOT NULL,
               amount REAL NOT NULL,
               occurred_at TEXT NOT NULL,
               external_id TEXT NOT NULL,
               source TEXT NOT NULL,
               raw_json TEXT NOT NULL,
               created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS real_ledger_events_time
               ON real_ledger_events(occurred_at DESC);
             CREATE TABLE IF NOT EXISTS account_balance_snapshots (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               venue TEXT NOT NULL,
               captured_at TEXT NOT NULL,
               asset TEXT NOT NULL,
               free REAL NOT NULL,
               locked REAL NOT NULL,
               total REAL NOT NULL,
               source TEXT NOT NULL,
               UNIQUE(venue, captured_at, asset)
             );
             CREATE INDEX IF NOT EXISTS balance_snapshots_time
               ON account_balance_snapshots(venue, captured_at DESC);
             CREATE TABLE IF NOT EXISTS ledger_reconciliation (
               venue TEXT PRIMARY KEY NOT NULL,
               checked_at TEXT NOT NULL,
               status TEXT NOT NULL,
               detail TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS shadow_strategy_trials (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               symbol TEXT NOT NULL,
               signal TEXT NOT NULL,
               opened_at_ms INTEGER NOT NULL,
               entry_price REAL NOT NULL,
               horizon_minutes INTEGER NOT NULL,
               attention_score REAL NOT NULL,
               status TEXT NOT NULL,
               closed_at_ms INTEGER,
               exit_price REAL,
               return_percent REAL
             );
             CREATE INDEX IF NOT EXISTS shadow_strategy_trials_status
               ON shadow_strategy_trials(status, opened_at_ms);
             CREATE TABLE IF NOT EXISTS execution_guard (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               latched INTEGER NOT NULL,
               reason TEXT NOT NULL,
               source TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS trade_intents (
               id TEXT PRIMARY KEY NOT NULL,
               symbol TEXT NOT NULL,
               side TEXT NOT NULL,
               notional_usdt REAL NOT NULL,
               rationale TEXT NOT NULL,
               source TEXT NOT NULL,
               status TEXT NOT NULL,
               real_execution_allowed INTEGER NOT NULL,
               risk_reasons_json TEXT NOT NULL,
               created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS trade_intents_created
               ON trade_intents(created_at DESC);
             CREATE TABLE IF NOT EXISTS decision_shadow_samples (
               sample_id TEXT PRIMARY KEY NOT NULL,
               decided_at_ms INTEGER NOT NULL,
               decided_at TEXT NOT NULL,
               symbol TEXT NOT NULL,
               feature_json TEXT NOT NULL,
               price_at_decision REAL NOT NULL,
               rule_engine_result TEXT NOT NULL,
               price_5m REAL,
               price_30m REAL,
               price_1h REAL,
               price_4h REAL,
               return_5m REAL,
               return_30m REAL,
               return_1h REAL,
               return_4h REAL,
               actual_outcome TEXT,
               settled_at TEXT,
               status TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS decision_shadow_samples_status
               ON decision_shadow_samples(status, decided_at_ms);
             CREATE TABLE IF NOT EXISTS decision_shadow_predictions (
               prediction_id TEXT PRIMARY KEY NOT NULL,
               sample_id TEXT NOT NULL,
               provider_requested TEXT NOT NULL,
               provider TEXT NOT NULL,
               provider_version TEXT NOT NULL,
               fallback_used INTEGER NOT NULL,
               primary_error TEXT NOT NULL,
               direction TEXT NOT NULL,
               action TEXT NOT NULL,
               market_regime TEXT NOT NULL,
               risk_state TEXT NOT NULL,
               abnormal_state INTEGER NOT NULL,
               signal_priority TEXT NOT NULL,
               confidence REAL NOT NULL,
               confidence_kind TEXT NOT NULL,
               probabilities_json TEXT NOT NULL,
               latency_ms INTEGER NOT NULL,
               estimated_cost_usd REAL NOT NULL,
               created_at TEXT NOT NULL,
               FOREIGN KEY(sample_id) REFERENCES decision_shadow_samples(sample_id)
             );
             CREATE INDEX IF NOT EXISTS decision_shadow_predictions_sample
               ON decision_shadow_predictions(sample_id, provider);"
        ).map_err(|error| format!("无法初始化 Kardii 交易研究数据库：{error}"))?;

        let policy = default_risk_policy();
        connection.execute(
            "INSERT OR IGNORE INTO risk_policy(
               id, mode, real_execution_enabled, withdrawal_enabled, leverage_enabled,
               max_order_notional_usdt, max_daily_loss_usdt, max_open_positions, note
             ) VALUES(1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                policy.mode,
                policy.real_execution_enabled as i64,
                policy.withdrawal_enabled as i64,
                policy.leverage_enabled as i64,
                policy.max_order_notional_usdt,
                policy.max_daily_loss_usdt,
                policy.max_open_positions as i64,
                policy.note,
            ],
        ).map_err(|error| format!("无法初始化风险策略：{error}"))?;

        connection.execute(
            "INSERT OR IGNORE INTO execution_guard(id, latched, reason, source, updated_at) VALUES(1, 0, '', 'system', ?1)",
            [Utc::now().to_rfc3339()],
        ).map_err(|error| format!("无法初始化执行 Kill Switch：{error}"))?;

        let mut guard = self.database.lock()
            .map_err(|_| "Kardii 交易研究数据库暂时不可用。".to_string())?;
        *guard = Some(connection);
        Ok(())
    }

    fn with_database<T>(&self, action: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let guard = self.database.lock()
            .map_err(|_| "Kardii 交易研究数据库暂时不可用。".to_string())?;
        let connection = guard.as_ref()
            .ok_or_else(|| "Kardii 交易研究数据库尚未初始化。".to_string())?;
        action(connection)
    }

    fn with_database_mut<T>(&self, action: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.database.lock()
            .map_err(|_| "Kardii 交易研究数据库暂时不可用。".to_string())?;
        let connection = guard.as_mut()
            .ok_or_else(|| "Kardii 交易研究数据库尚未初始化。".to_string())?;
        action(connection)
    }

    fn load_execution_guard(&self) -> Result<ExecutionGuardStatus, String> {
        self.with_database(|connection| {
            connection.query_row(
                "SELECT latched, reason, source, updated_at FROM execution_guard WHERE id = 1",
                [],
                |row| Ok(ExecutionGuardStatus {
                    latched: row.get::<_, i64>(0)? != 0,
                    reason: row.get(1)?,
                    source: row.get(2)?,
                    updated_at: row.get(3)?,
                }),
            ).map_err(|error| format!("无法读取执行 Kill Switch：{error}"))
        })
    }

    fn latch_execution_guard(&self, reason: &str, source: &str) -> Result<ExecutionGuardStatus, String> {
        self.with_database(|connection| {
            connection.execute(
                "UPDATE execution_guard SET latched = 1, reason = ?1, source = ?2, updated_at = ?3 WHERE id = 1",
                params![reason, source, Utc::now().to_rfc3339()],
            ).map_err(|error| format!("无法触发执行 Kill Switch：{error}"))?;
            Ok(())
        })?;
        self.load_execution_guard()
    }

    pub fn reset_execution_guard(&self) -> Result<ExecutionGuardStatus, String> {
        let policy = self.load_risk_policy().unwrap_or_else(|_| default_risk_policy());
        if policy.real_execution_enabled {
            return Err("请先关闭真实交易总开关，再重置 Kill Switch。".to_string());
        }
        self.with_database(|connection| {
            connection.execute(
                "UPDATE execution_guard SET latched = 0, reason = '', source = 'manual-reset', updated_at = ?1 WHERE id = 1",
                [Utc::now().to_rfc3339()],
            ).map_err(|error| format!("无法重置执行 Kill Switch：{error}"))?;
            Ok(())
        })?;
        self.load_execution_guard()
    }

    fn load_real_ledger_status(&self) -> Result<RealLedgerStatus, String> {
        self.with_database(|connection| {
            let event_count: i64 = connection.query_row("SELECT COUNT(*) FROM real_ledger_events", [], |row| row.get(0))
                .map_err(|error| format!("无法统计真实账本：{error}"))?;
            let snapshot_count: i64 = connection.query_row("SELECT COUNT(*) FROM account_balance_snapshots", [], |row| row.get(0))
                .map_err(|error| format!("无法统计余额快照：{error}"))?;
            let latest_event_at: String = connection.query_row("SELECT COALESCE(MAX(occurred_at), '') FROM real_ledger_events", [], |row| row.get(0))
                .map_err(|error| format!("无法读取最新真实账本时间：{error}"))?;
            let latest_snapshot_at: String = connection.query_row("SELECT COALESCE(MAX(captured_at), '') FROM account_balance_snapshots", [], |row| row.get(0))
                .map_err(|error| format!("无法读取最新余额快照：{error}"))?;
            let reconciliation = connection.query_row(
                "SELECT status, detail FROM ledger_reconciliation WHERE venue = 'binance'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            ).optional().map_err(|error| format!("无法读取账本对账状态：{error}"))?;
            Ok(RealLedgerStatus {
                event_count,
                snapshot_count,
                latest_event_at,
                latest_snapshot_at,
                reconciliation_status: reconciliation.as_ref().map(|v| v.0.clone()).unwrap_or_else(|| "not-configured".to_string()),
                reconciliation_detail: reconciliation.map(|v| v.1).unwrap_or_else(|| "尚未连接真实账户；不会把模拟数据写入真实账本。".to_string()),
                full_event_sync_enabled: false,
            })
        })
    }

    fn persist_binance_balance_snapshot(&self, status: &BinanceReadOnlyStatus) -> Result<(), String> {
        self.with_database_mut(|connection| {
            let transaction = connection.transaction().map_err(|error| format!("无法开始保存真实余额快照：{error}"))?;
            for balance in &status.nonzero_balances {
                let free = parse_number(&balance.free);
                let locked = parse_number(&balance.locked);
                transaction.execute(
                    "INSERT OR IGNORE INTO account_balance_snapshots(venue, captured_at, asset, free, locked, total, source) VALUES('binance', ?1, ?2, ?3, ?4, ?5, 'binance-readonly-account')",
                    params![status.checked_at, balance.asset, free, locked, free + locked],
                ).map_err(|error| format!("无法保存 Binance 余额快照：{error}"))?;
            }
            transaction.execute(
                "INSERT INTO ledger_reconciliation(venue, checked_at, status, detail) VALUES('binance', ?1, 'partial', ?2) ON CONFLICT(venue) DO UPDATE SET checked_at = excluded.checked_at, status = excluded.status, detail = excluded.detail",
                params![status.checked_at, "余额快照已自动保存；充值、提现、成交、手续费与已实现盈亏事件连接器尚未启用，因此不会用余额差额猜测交易事件。"],
            ).map_err(|error| format!("无法保存账本对账状态：{error}"))?;
            transaction.execute(
                "DELETE FROM account_balance_snapshots WHERE id NOT IN (SELECT id FROM account_balance_snapshots ORDER BY id DESC LIMIT 50000)",
                [],
            ).map_err(|error| format!("无法整理余额快照：{error}"))?;
            transaction.commit().map_err(|error| format!("无法提交真实余额快照：{error}"))
        })
    }



    fn tracked_trade_symbols(&self) -> Result<Vec<String>, String> {
        self.with_database(|connection| {
            let mut symbols = Vec::<String>::new();

            let mut statement = connection
                .prepare(
                    "SELECT symbol
                     FROM strategy_experiments
                     WHERE symbol LIKE '%USDT'
                     ORDER BY CASE status WHEN 'observing' THEN 0 ELSE 1 END, updated_at DESC
                     LIMIT 8",
                )
                .map_err(|error| format!("无法读取策略交易对：{error}"))?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| format!("无法读取策略交易对：{error}"))?;
            for row in rows {
                let symbol = row.map_err(|error| format!("无法整理策略交易对：{error}"))?;
                if tradable_usdt_symbol(&symbol) && !symbols.contains(&symbol) {
                    symbols.push(symbol);
                }
            }

            if symbols.len() < 8 {
                let mut statement = connection
                    .prepare(
                        "SELECT asset
                         FROM account_balance_snapshots
                         WHERE venue = 'binance'
                         GROUP BY asset
                         ORDER BY MAX(id) DESC
                         LIMIT 12",
                    )
                    .map_err(|error| format!("无法读取 Binance 余额资产：{error}"))?;
                let rows = statement
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|error| format!("无法读取 Binance 余额资产：{error}"))?;
                for row in rows {
                    let asset = row
                        .map_err(|error| format!("无法整理 Binance 余额资产：{error}"))?
                        .trim()
                        .to_uppercase();
                    let symbol = format!("{asset}USDT");
                    if tradable_usdt_symbol(&symbol) && !symbols.contains(&symbol) {
                        symbols.push(symbol);
                        if symbols.len() >= 8 {
                            break;
                        }
                    }
                }
            }

            Ok(symbols)
        })
    }

    async fn sync_binance_trade_events(
        &self,
        api_key: &str,
        api_secret: &str,
    ) -> Result<usize, String> {
        let symbols = self.tracked_trade_symbols()?;
        if symbols.is_empty() {
            return Ok(0);
        }

        let mut total_inserted = 0usize;
        for symbol in symbols {
            let trades = binance_signed_json::<Vec<BinanceTradeRecord>>(
                api_key,
                api_secret,
                "/api/v3/myTrades",
                &format!("symbol={symbol}&limit=1000"),
            )
            .await?;

            total_inserted += self.with_database_mut(|connection| {
                let transaction = connection
                    .transaction()
                    .map_err(|error| format!("无法开始同步 {symbol} 成交：{error}"))?;
                let mut inserted = 0usize;
                let base_asset = symbol
                    .strip_suffix("USDT")
                    .unwrap_or("")
                    .to_string();
                if base_asset.is_empty() {
                    return Ok(0usize);
                }

                for trade in trades {
                    let external_id = format!("{}:{}", trade.symbol, trade.id);
                    let created_at = Utc::now().to_rfc3339();
                    let qty = parse_number(&trade.qty).abs();
                    let quote_qty = parse_number(&trade.quote_qty).abs();
                    let raw = serde_json::json!({
                        "symbol": trade.symbol,
                        "tradeId": trade.id,
                        "orderId": trade.order_id,
                        "price": trade.price,
                        "isBuyer": trade.is_buyer,
                        "isMaker": trade.is_maker
                    })
                    .to_string();

                    if qty > 0.0 {
                        let amount = if trade.is_buyer { qty } else { -qty };
                        inserted += transaction
                            .execute(
                                "INSERT OR IGNORE INTO real_ledger_events(
                                   event_key, venue, event_type, asset, amount, occurred_at,
                                   external_id, source, raw_json, created_at
                                 ) VALUES(?1, 'binance', 'trade_base', ?2, ?3, ?4, ?5, 'binance-my-trades', ?6, ?7)",
                                params![
                                    format!("binance:trade:{}:{}:base", trade.symbol, trade.id),
                                    base_asset,
                                    amount,
                                    millis_timestamp_rfc3339(trade.time),
                                    external_id,
                                    raw,
                                    created_at,
                                ],
                            )
                            .map_err(|error| format!("无法写入 {symbol} 基础资产成交：{error}"))?;
                    }

                    if quote_qty > 0.0 {
                        let amount = if trade.is_buyer { -quote_qty } else { quote_qty };
                        inserted += transaction
                            .execute(
                                "INSERT OR IGNORE INTO real_ledger_events(
                                   event_key, venue, event_type, asset, amount, occurred_at,
                                   external_id, source, raw_json, created_at
                                 ) VALUES(?1, 'binance', 'trade_quote', 'USDT', ?2, ?3, ?4, 'binance-my-trades', ?5, ?6)",
                                params![
                                    format!("binance:trade:{}:{}:quote", trade.symbol, trade.id),
                                    amount,
                                    millis_timestamp_rfc3339(trade.time),
                                    external_id,
                                    raw,
                                    created_at,
                                ],
                            )
                            .map_err(|error| format!("无法写入 {symbol} 计价资产成交：{error}"))?;
                    }

                    let commission = parse_number(&trade.commission).abs();
                    if commission > 0.0 && !trade.commission_asset.trim().is_empty() {
                        inserted += transaction
                            .execute(
                                "INSERT OR IGNORE INTO real_ledger_events(
                                   event_key, venue, event_type, asset, amount, occurred_at,
                                   external_id, source, raw_json, created_at
                                 ) VALUES(?1, 'binance', 'fee', ?2, ?3, ?4, ?5, 'binance-my-trades', ?6, ?7)",
                                params![
                                    format!("binance:trade:{}:{}:fee", trade.symbol, trade.id),
                                    trade.commission_asset.trim().to_uppercase(),
                                    -commission,
                                    millis_timestamp_rfc3339(trade.time),
                                    external_id,
                                    raw,
                                    created_at,
                                ],
                            )
                            .map_err(|error| format!("无法写入 {symbol} 成交手续费：{error}"))?;
                    }
                }

                transaction
                    .commit()
                    .map_err(|error| format!("无法提交 {symbol} 成交账本：{error}"))?;
                Ok(inserted)
            })?;
        }

        Ok(total_inserted)
    }

    async fn sync_binance_cash_events(
        &self,
        api_key: &str,
        api_secret: &str,
    ) -> Result<(usize, usize, usize), String> {
        let (deposits, withdrawals) = tokio::try_join!(
            binance_signed_json::<Vec<BinanceDepositRecord>>(
                api_key,
                api_secret,
                "/sapi/v1/capital/deposit/hisrec",
                "",
            ),
            binance_signed_json::<Vec<BinanceWithdrawRecord>>(
                api_key,
                api_secret,
                "/sapi/v1/capital/withdraw/history",
                "",
            ),
        )?;

        self.with_database_mut(|connection| {
            let transaction = connection
                .transaction()
                .map_err(|error| format!("无法开始同步 Binance 真实资金事件：{error}"))?;
            let created_at = Utc::now().to_rfc3339();
            let mut inserted_deposits = 0usize;
            let mut inserted_withdrawals = 0usize;
            let mut inserted_fees = 0usize;

            for item in deposits.iter().filter(|item| item.status == 1) {
                let external_id = if item.id.trim().is_empty() {
                    item.tx_id.trim().to_string()
                } else {
                    item.id.trim().to_string()
                };
                if external_id.is_empty() || item.coin.trim().is_empty() {
                    continue;
                }
                let raw = serde_json::json!({
                    "id": item.id,
                    "txId": item.tx_id,
                    "network": item.network,
                    "status": item.status
                }).to_string();
                let changed = transaction.execute(
                    "INSERT OR IGNORE INTO real_ledger_events(
                       event_key, venue, event_type, asset, amount, occurred_at,
                       external_id, source, raw_json, created_at
                     ) VALUES(?1, 'binance', 'deposit', ?2, ?3, ?4, ?5, 'binance-deposit-history', ?6, ?7)",
                    params![
                        format!("binance:deposit:{external_id}"),
                        item.coin.trim().to_uppercase(),
                        parse_number(&item.amount),
                        millis_timestamp_rfc3339(item.insert_time),
                        external_id,
                        raw,
                        created_at,
                    ],
                ).map_err(|error| format!("无法写入 Binance 充值事件：{error}"))?;
                inserted_deposits += changed;
            }

            for item in withdrawals.iter().filter(|item| item.status == 6) {
                let external_id = if item.id.trim().is_empty() {
                    item.tx_id.trim().to_string()
                } else {
                    item.id.trim().to_string()
                };
                if external_id.is_empty() || item.coin.trim().is_empty() {
                    continue;
                }
                let occurred_at = binance_apply_time_rfc3339(&item.apply_time);
                let raw = serde_json::json!({
                    "id": item.id,
                    "txId": item.tx_id,
                    "network": item.network,
                    "status": item.status,
                    "withdrawOrderId": item.withdraw_order_id
                }).to_string();

                let changed = transaction.execute(
                    "INSERT OR IGNORE INTO real_ledger_events(
                       event_key, venue, event_type, asset, amount, occurred_at,
                       external_id, source, raw_json, created_at
                     ) VALUES(?1, 'binance', 'withdrawal', ?2, ?3, ?4, ?5, 'binance-withdraw-history', ?6, ?7)",
                    params![
                        format!("binance:withdrawal:{external_id}"),
                        item.coin.trim().to_uppercase(),
                        -parse_number(&item.amount).abs(),
                        occurred_at,
                        external_id,
                        raw,
                        created_at,
                    ],
                ).map_err(|error| format!("无法写入 Binance 提现事件：{error}"))?;
                inserted_withdrawals += changed;

                let fee = parse_number(&item.transaction_fee).abs();
                if fee > 0.0 {
                    let changed = transaction.execute(
                        "INSERT OR IGNORE INTO real_ledger_events(
                           event_key, venue, event_type, asset, amount, occurred_at,
                           external_id, source, raw_json, created_at
                         ) VALUES(?1, 'binance', 'fee', ?2, ?3, ?4, ?5, 'binance-withdraw-history', ?6, ?7)",
                        params![
                            format!("binance:withdrawal-fee:{external_id}"),
                            item.coin.trim().to_uppercase(),
                            -fee,
                            binance_apply_time_rfc3339(&item.apply_time),
                            external_id,
                            raw,
                            created_at,
                        ],
                    ).map_err(|error| format!("无法写入 Binance 提现手续费：{error}"))?;
                    inserted_fees += changed;
                }
            }

            transaction.execute(
                "UPDATE ledger_reconciliation
                 SET checked_at = ?1, status = 'partial', detail = ?2
                 WHERE venue = 'binance'",
                params![
                    Utc::now().to_rfc3339(),
                    "已同步真实余额快照、成功充值、已完成提现和提现手续费；现货成交与成交手续费仍待按交易对增量同步。"
                ],
            ).map_err(|error| format!("无法更新 Binance 对账阶段：{error}"))?;

            transaction.commit()
                .map_err(|error| format!("无法提交 Binance 真实资金事件：{error}"))?;
            Ok((inserted_deposits, inserted_withdrawals, inserted_fees))
        })
    }

    pub async fn sync_binance_readonly_snapshot(&self) -> Result<RealLedgerStatus, String> {
        let Some((api_key, api_secret)) = load_binance_credentials_from_keyring()? else {
            return self.load_real_ledger_status();
        };
        let status = inspect_binance_readonly(&api_key, &api_secret).await?;
        if !status.safe_read_only || !status.error.is_empty() {
            let reason = if status.error.is_empty() { "Binance API Key 不满足只读安全要求。".to_string() } else { status.error };
            let _ = self.latch_execution_guard(&reason, "binance-api-permission");
            return Err(reason);
        }
        self.persist_binance_balance_snapshot(&status)?;
        let _ = self.sync_binance_cash_events(&api_key, &api_secret).await?;
        let _ = self.sync_binance_trade_events(&api_key, &api_secret).await?;
        self.with_database(|connection| {
            connection.execute(
                "UPDATE ledger_reconciliation
                 SET checked_at = ?1, status = 'partial', detail = ?2
                 WHERE venue = 'binance'",
                params![
                    Utc::now().to_rfc3339(),
                    "已同步余额快照、充值、提现、提现手续费，以及当前追踪 USDT 交易对最近成交与成交手续费；仍未宣称覆盖全部历史交易对。"
                ],
            ).map_err(|error| format!("无法更新 Binance 成交对账状态：{error}"))?;
            Ok(())
        })?;
        self.load_real_ledger_status()
    }

    fn load_risk_policy(&self) -> Result<RuntimeRiskPolicy, String> {
        self.with_database(|connection| {
            connection.query_row(
                "SELECT mode, real_execution_enabled, withdrawal_enabled, leverage_enabled,
                        max_order_notional_usdt, max_daily_loss_usdt, max_open_positions, note
                 FROM risk_policy WHERE id = 1",
                [],
                |row| Ok(RuntimeRiskPolicy {
                    mode: row.get(0)?,
                    real_execution_enabled: row.get::<_, i64>(1)? != 0,
                    withdrawal_enabled: row.get::<_, i64>(2)? != 0,
                    leverage_enabled: row.get::<_, i64>(3)? != 0,
                    max_order_notional_usdt: row.get(4)?,
                    max_daily_loss_usdt: row.get(5)?,
                    max_open_positions: row.get::<_, i64>(6)?.max(0) as u32,
                    note: row.get(7)?,
                }),
            ).optional()
             .map_err(|error| format!("无法读取风险策略：{error}"))
             .map(|value| value.unwrap_or_else(default_risk_policy))
        })
    }

    fn load_recent_history(&self, limit: usize) -> Result<Vec<ResearchHistoryItem>, String> {
        self.with_database(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, scanned_at, symbol, attention_score, signal, last_price, spread_bps,
                        return_1h_percent, return_4h_percent, volume_acceleration, evidence_json
                 FROM research_history ORDER BY id DESC LIMIT ?1"
            ).map_err(|error| format!("无法读取研究历史：{error}"))?;
            let rows = statement.query_map([limit.clamp(1, 100) as i64], |row| {
                let evidence_json: String = row.get(10)?;
                Ok(ResearchHistoryItem {
                    id: row.get(0)?,
                    scanned_at: row.get(1)?,
                    symbol: row.get(2)?,
                    attention_score: row.get(3)?,
                    signal: row.get(4)?,
                    last_price: row.get(5)?,
                    spread_bps: row.get(6)?,
                    return_1h_percent: row.get(7)?,
                    return_4h_percent: row.get(8)?,
                    volume_acceleration: row.get(9)?,
                    evidence: serde_json::from_str(&evidence_json).unwrap_or_default(),
                })
            }).map_err(|error| format!("无法读取研究历史：{error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("无法整理研究历史：{error}"))
        })
    }

    fn load_strategy_experiments(&self) -> Result<Vec<StrategyExperiment>, String> {
        self.with_database(|connection| {
            let mut statement = connection.prepare(
                "SELECT symbol, status, created_at, updated_at, observation_count, miss_count,
                        best_attention_score, hypothesis, invalidation_rule
                 FROM strategy_experiments
                 ORDER BY CASE status WHEN 'observing' THEN 0 ELSE 1 END, updated_at DESC
                 LIMIT 50"
            ).map_err(|error| format!("无法读取策略实验：{error}"))?;
            let rows = statement.query_map([], |row| Ok(StrategyExperiment {
                symbol: row.get(0)?,
                status: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                observation_count: row.get::<_, i64>(4)?.max(0) as u32,
                miss_count: row.get::<_, i64>(5)?.max(0) as u32,
                best_attention_score: row.get(6)?,
                hypothesis: row.get(7)?,
                invalidation_rule: row.get(8)?,
            })).map_err(|error| format!("无法读取策略实验：{error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("无法整理策略实验：{error}"))
        })
    }

    fn create_shadow_trials(&self, scan: &OpportunityScan) -> Result<(), String> {
        self.with_database_mut(|connection| {
            let transaction = connection.transaction()
                .map_err(|error| format!("无法开始 Shadow 策略实验：{error}"))?;
            let now_ms = Utc::now().timestamp_millis();
            for candidate in scan.candidates.iter().take(3) {
                let exists: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM shadow_strategy_trials WHERE symbol = ?1 AND status = 'open'",
                    [&candidate.symbol],
                    |row| row.get(0),
                ).map_err(|error| format!("无法检查 Shadow 实验：{error}"))?;
                if exists > 0 { continue; }
                transaction.execute(
                    "INSERT INTO shadow_strategy_trials(
                       symbol, signal, opened_at_ms, entry_price, horizon_minutes, attention_score, status
                     ) VALUES(?1, ?2, ?3, ?4, 60, ?5, 'open')",
                    params![
                        candidate.symbol,
                        candidate.signal,
                        now_ms,
                        candidate.last_price,
                        candidate.attention_score,
                    ],
                ).map_err(|error| format!("无法建立 Shadow 实验：{error}"))?;
            }
            transaction.commit()
                .map_err(|error| format!("无法提交 Shadow 实验：{error}"))
        })
    }

    fn due_shadow_trials(&self) -> Result<Vec<(i64, String, f64, i64)>, String> {
        let now_ms = Utc::now().timestamp_millis();
        self.with_database(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, symbol, entry_price, horizon_minutes
                 FROM shadow_strategy_trials
                 WHERE status = 'open'
                   AND opened_at_ms + horizon_minutes * 60000 <= ?1
                 ORDER BY opened_at_ms ASC
                 LIMIT 12"
            ).map_err(|error| format!("无法读取待结算 Shadow 实验：{error}"))?;
            let rows = statement.query_map([now_ms], |row| Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, i64>(3)?,
            ))).map_err(|error| format!("无法读取待结算 Shadow 实验：{error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("无法整理待结算 Shadow 实验：{error}"))
        })
    }

    fn close_shadow_trial(&self, id: i64, entry_price: f64, exit_price: f64) -> Result<(), String> {
        let return_percent = if entry_price > 0.0 {
            ((exit_price - entry_price) / entry_price) * 100.0
        } else { 0.0 };
        self.with_database(|connection| {
            connection.execute(
                "UPDATE shadow_strategy_trials
                 SET status = 'closed', closed_at_ms = ?1, exit_price = ?2, return_percent = ?3
                 WHERE id = ?4 AND status = 'open'",
                params![Utc::now().timestamp_millis(), exit_price, return_percent, id],
            ).map_err(|error| format!("无法结算 Shadow 实验：{error}"))?;
            Ok(())
        })
    }

    async fn update_shadow_trials(&self, scan: &OpportunityScan) -> Result<(), String> {
        self.create_shadow_trials(scan)?;
        let due = self.due_shadow_trials()?;
        if due.is_empty() { return Ok(()); }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| format!("无法初始化 Shadow 行情客户端：{error}"))?;
        for (id, symbol, entry_price, _horizon) in due {
            let path = format!("/api/v3/ticker/price?symbol={symbol}");
            if let Ok((_source, ticker)) = fetch_public_json::<BinancePriceTicker>(&client, &path).await {
                let exit_price = parse_number(&ticker.price);
                if exit_price > 0.0 {
                    let _ = self.close_shadow_trial(id, entry_price, exit_price);
                }
            }
        }
        Ok(())
    }

    pub fn shadow_experiment_status(&self) -> Result<ShadowExperimentStatus, String> {
        self.with_database(|connection| {
            let open_count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM shadow_strategy_trials WHERE status = 'open'",
                [], |row| row.get(0)
            ).map_err(|error| format!("无法统计 Shadow 实验：{error}"))?;
            let (closed_count, positive_count, negative_count, average_return, latest_closed_ms): (i64, i64, i64, f64, i64) = connection.query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN return_percent > 0 THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN return_percent < 0 THEN 1 ELSE 0 END), 0),
                        COALESCE(AVG(return_percent), 0),
                        COALESCE(MAX(closed_at_ms), 0)
                 FROM shadow_strategy_trials WHERE status = 'closed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).map_err(|error| format!("无法统计 Shadow 实验结果：{error}"))?;
            let latest_closed_at = chrono::DateTime::<Utc>::from_timestamp_millis(latest_closed_ms)
                .map(|value| value.to_rfc3339())
                .unwrap_or_default();
            Ok(ShadowExperimentStatus {
                open_count,
                closed_count,
                positive_count,
                negative_count,
                average_return_percent: (average_return * 1000.0).round() / 1000.0,
                latest_closed_at,
                horizon_minutes: 60,
            })
        })
    }


    fn record_decision_shadow(
        &self,
        input: &DecisionInput,
        attempt: &DecisionAttempt,
    ) -> Result<(), String> {
        let sample_bucket_ms = (input.timestamp_ms / (5 * 60_000)) * (5 * 60_000);
        let sample_id = format!("{}:{}", sample_bucket_ms, input.symbol);
        let prediction_id = format!(
            "{}:{}:{}",
            sample_id,
            attempt.output.provider,
            attempt.output.provider_version
        );
        let feature_json = serde_json::to_string(input)
            .map_err(|error| format!("无法序列化 Decision Shadow 输入：{error}"))?;
        let probabilities_json = attempt.output.probabilities.to_string();
        let created_at = Utc::now().to_rfc3339();

        self.with_database_mut(|connection| {
            let transaction = connection
                .transaction()
                .map_err(|error| format!("无法开始 Decision Shadow 记录：{error}"))?;

            transaction.execute(
                "INSERT OR IGNORE INTO decision_shadow_samples(
                   sample_id, decided_at_ms, decided_at, symbol, feature_json,
                   price_at_decision, rule_engine_result, status
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'shadow-only-no-execution-link', 'pending')",
                params![
                    sample_id,
                    input.timestamp_ms,
                    input.timestamp,
                    input.symbol,
                    feature_json,
                    input.price,
                ],
            ).map_err(|error| format!("无法保存 Decision Shadow 样本：{error}"))?;

            transaction.execute(
                "INSERT OR IGNORE INTO decision_shadow_predictions(
                   prediction_id, sample_id, provider_requested, provider, provider_version,
                   fallback_used, primary_error, direction, action, market_regime, risk_state,
                   abnormal_state, signal_priority, confidence, confidence_kind,
                   probabilities_json, latency_ms, estimated_cost_usd, created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    prediction_id,
                    sample_id,
                    attempt.provider_requested,
                    attempt.output.provider,
                    attempt.output.provider_version,
                    attempt.fallback_used as i64,
                    attempt.primary_error,
                    attempt.output.direction,
                    attempt.output.action,
                    attempt.output.market_regime,
                    attempt.output.risk_state,
                    attempt.output.abnormal_state as i64,
                    attempt.output.signal_priority,
                    attempt.output.confidence,
                    attempt.output.confidence_kind,
                    probabilities_json,
                    attempt.latency_ms as i64,
                    attempt.output.estimated_cost_usd,
                    created_at,
                ],
            ).map_err(|error| format!("无法保存 Decision Shadow 判断：{error}"))?;

            transaction.commit()
                .map_err(|error| format!("无法提交 Decision Shadow：{error}"))
        })
    }

    fn due_decision_shadow_samples(
        &self,
        limit: usize,
    ) -> Result<Vec<(String, String, i64, f64)>, String> {
        let due_before = Utc::now().timestamp_millis() - 240 * 60_000;
        self.with_database(|connection| {
            let mut statement = connection.prepare(
                "SELECT sample_id, symbol, decided_at_ms, price_at_decision
                 FROM decision_shadow_samples
                 WHERE status = 'pending' AND decided_at_ms <= ?1
                 ORDER BY decided_at_ms ASC
                 LIMIT ?2"
            ).map_err(|error| format!("无法读取待结算 Decision Shadow：{error}"))?;
            let rows = statement.query_map(
                params![due_before, limit.clamp(1, 24) as i64],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, f64>(3)?,
                )),
            ).map_err(|error| format!("无法读取待结算 Decision Shadow：{error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("无法整理待结算 Decision Shadow：{error}"))
        })
    }

    async fn settle_decision_shadow_outcomes(&self) -> Result<(), String> {
        let due = self.due_decision_shadow_samples(8)?;
        if due.is_empty() {
            return Ok(());
        }
        let mut errors = Vec::new();

        for (sample_id, symbol, decided_at_ms, entry_price) in due {
            match fetch_decision_horizon_prices(&symbol, decided_at_ms).await {
                Ok((price_5m, price_30m, price_1h, price_4h)) => {
                    let return_5m = shadow_return(entry_price, price_5m);
                    let return_30m = shadow_return(entry_price, price_30m);
                    let return_1h = shadow_return(entry_price, price_1h);
                    let return_4h = shadow_return(entry_price, price_4h);
                    let actual_outcome = classify_shadow_outcome(return_1h);
                    let update = self.with_database(|connection| {
                        connection.execute(
                            "UPDATE decision_shadow_samples
                             SET price_5m = ?1, price_30m = ?2, price_1h = ?3, price_4h = ?4,
                                 return_5m = ?5, return_30m = ?6, return_1h = ?7, return_4h = ?8,
                                 actual_outcome = ?9, settled_at = ?10, status = 'settled'
                             WHERE sample_id = ?11 AND status = 'pending'",
                            params![
                                price_5m,
                                price_30m,
                                price_1h,
                                price_4h,
                                return_5m,
                                return_30m,
                                return_1h,
                                return_4h,
                                actual_outcome,
                                Utc::now().to_rfc3339(),
                                sample_id,
                            ],
                        ).map_err(|error| format!("无法结算 Decision Shadow：{error}"))?;
                        Ok(())
                    });
                    if let Err(error) = update {
                        errors.push(error);
                    }
                }
                Err(error) => errors.push(error),
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("；"))
        }
    }

    async fn update_decision_shadow(
        &self,
        scan: &OpportunityScan,
        research: &[SymbolResearch],
    ) -> Result<(), String> {
        let baseline = RuleBaselineProvider;
        let jev = load_jev_api_key_from_keyring()?
            .and_then(|key| JevDecisionProvider::new(key).ok());
        let decided_at_ms = Utc::now().timestamp_millis();

        for item in research.iter().take(3) {
            let Some(candidate) = scan.candidates.iter().find(|value| value.symbol == item.symbol) else {
                continue;
            };
            let input = DecisionInput {
                timestamp: scan.fetched_at.clone(),
                timestamp_ms: decided_at_ms,
                symbol: item.symbol.clone(),
                price: item.last_price,
                candidate_signal: candidate.signal.clone(),
                attention_score: candidate.attention_score,
                change_percent_24h: candidate.change_percent_24h,
                quote_volume_24h: candidate.quote_volume_24h,
                trade_count_24h: candidate.trade_count_24h,
                intraday_range_percent: candidate.intraday_range_percent,
                spread_bps: item.spread_bps,
                order_book_imbalance: item.order_book_imbalance,
                return_1h_percent: item.return_1h_percent,
                return_4h_percent: item.return_4h_percent,
                realized_volatility_5m_percent: item.realized_volatility_5m_percent,
                volume_acceleration: item.volume_acceleration,
            };

            // Always record the deterministic baseline on the same sample first.
            let baseline_attempt = evaluate_with_fallback(None, &baseline, &input).await?;
            self.record_decision_shadow(&input, &baseline_attempt)?;

            // Jev is a second comparison arm only. Failure never blocks the research loop,
            // never substitutes a hidden trade decision, and never links to execution.
            if let Some(provider) = jev.as_ref() {
                let started = std::time::Instant::now();
                if let Ok(output) = provider.decide(&input).await {
                    let attempt = DecisionAttempt {
                        provider_requested: provider.id().to_string(),
                        provider_used: provider.id().to_string(),
                        fallback_used: false,
                        primary_error: String::new(),
                        latency_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                        output,
                    };
                    self.record_decision_shadow(&input, &attempt)?;
                }
            }
        }

        self.settle_decision_shadow_outcomes().await
    }

    pub fn decision_shadow_status(&self) -> Result<DecisionShadowStatus, String> {
        self.with_database(|connection| {
            let (sample_count, pending, settled): (i64, i64, i64) = connection.query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END), 0)
                 FROM decision_shadow_samples",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).map_err(|error| format!("无法统计 Decision Shadow 样本：{error}"))?;

            let (prediction_count, providers_seen, average_latency_ms, effective_predictions): (i64, i64, f64, i64) =
                connection.query_row(
                    "SELECT COUNT(*),
                            COUNT(DISTINCT p.provider),
                            COALESCE(AVG(p.latency_ms), 0),
                            COALESCE(SUM(CASE WHEN s.status = 'settled' AND p.direction = s.actual_outcome THEN 1 ELSE 0 END), 0)
                     FROM decision_shadow_predictions p
                     JOIN decision_shadow_samples s ON s.sample_id = p.sample_id",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                ).map_err(|error| format!("无法统计 Decision Shadow 判断：{error}"))?;

            let mut provider_benchmarks = Vec::new();
            let mut benchmark_statement = connection.prepare(
                "SELECT p.provider,
                        p.provider_version,
                        COUNT(*),
                        COALESCE(SUM(CASE WHEN s.status = 'settled' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN s.status = 'settled' AND p.direction = s.actual_outcome THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN p.action = 'enter' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN p.action = 'enter' AND s.status = 'settled' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN p.action = 'enter' AND s.status = 'settled' AND s.return_1h > 0 THEN 1 ELSE 0 END), 0),
                        COALESCE(AVG(CASE WHEN p.action = 'enter' AND s.status = 'settled' THEN s.return_1h END), 0),
                        COALESCE(AVG(p.latency_ms), 0),
                        COALESCE(SUM(p.estimated_cost_usd), 0)
                 FROM decision_shadow_predictions p
                 JOIN decision_shadow_samples s ON s.sample_id = p.sample_id
                 GROUP BY p.provider, p.provider_version
                 ORDER BY p.provider ASC, p.provider_version ASC"
            ).map_err(|error| format!("无法准备 Decision Provider benchmark：{error}"))?;
            let benchmark_rows = benchmark_statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, f64>(8)?,
                    row.get::<_, f64>(9)?,
                    row.get::<_, f64>(10)?,
                ))
            }).map_err(|error| format!("无法统计 Decision Provider benchmark：{error}"))?;
            for row in benchmark_rows {
                let (
                    provider,
                    provider_version,
                    provider_prediction_count,
                    provider_settled_count,
                    correct_direction_count,
                    enter_count,
                    settled_enter_count,
                    positive_enter_count,
                    average_enter_return_1h_percent,
                    provider_average_latency_ms,
                    estimated_cost_usd,
                ) = row.map_err(|error| format!("无法读取 Decision Provider benchmark：{error}"))?;
                let direction_accuracy_percent = if provider_settled_count > 0 {
                    correct_direction_count as f64 / provider_settled_count as f64 * 100.0
                } else {
                    0.0
                };
                let enter_positive_rate_percent = if settled_enter_count > 0 {
                    positive_enter_count as f64 / settled_enter_count as f64 * 100.0
                } else {
                    0.0
                };
                provider_benchmarks.push(DecisionProviderBenchmark {
                    provider,
                    provider_version,
                    prediction_count: provider_prediction_count,
                    settled_count: provider_settled_count,
                    correct_direction_count,
                    direction_accuracy_percent: (direction_accuracy_percent * 100.0).round() / 100.0,
                    enter_count,
                    settled_enter_count,
                    positive_enter_count,
                    enter_positive_rate_percent: (enter_positive_rate_percent * 100.0).round() / 100.0,
                    average_enter_return_1h_percent: (average_enter_return_1h_percent * 1000.0).round() / 1000.0,
                    average_latency_ms: (provider_average_latency_ms * 100.0).round() / 100.0,
                    estimated_cost_usd: (estimated_cost_usd * 1_000_000.0).round() / 1_000_000.0,
                });
            }

            let latest = connection.query_row(
                "SELECT p.created_at, p.provider, s.symbol, p.direction, p.action
                 FROM decision_shadow_predictions p
                 JOIN decision_shadow_samples s ON s.sample_id = p.sample_id
                 ORDER BY p.created_at DESC LIMIT 1",
                [],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                )),
            ).optional().map_err(|error| format!("无法读取最近 Decision Shadow：{error}"))?;

            let (latest_decision_at, latest_provider, latest_symbol, latest_direction, latest_action) =
                latest.unwrap_or_default();

            Ok(DecisionShadowStatus {
                mode: "shadow-only".to_string(),
                benchmark_policy_version: DECISION_BENCHMARK_POLICY_VERSION.to_string(),
                outcome_horizon_minutes: DECISION_OUTCOME_HORIZON_MINUTES,
                bullish_threshold_percent: DECISION_BULLISH_THRESHOLD_PERCENT,
                bearish_threshold_percent: DECISION_BEARISH_THRESHOLD_PERCENT,
                sample_count,
                prediction_count,
                pending_outcomes: pending,
                settled_outcomes: settled,
                providers_seen,
                effective_predictions,
                average_latency_ms: (average_latency_ms * 100.0).round() / 100.0,
                provider_benchmarks,
                latest_decision_at,
                latest_provider,
                latest_symbol,
                latest_direction,
                latest_action,
                external_provider_configured: load_jev_api_key_from_keyring().ok().flatten().is_some(),
                execution_linked: false,
            })
        })
    }

    fn persist_refresh(&self, scan: &OpportunityScan, research: &[SymbolResearch]) -> Result<(), String> {
        self.with_database_mut(|connection| {
            let transaction = connection.transaction()
                .map_err(|error| format!("无法开始保存交易研究：{error}"))?;

            transaction.execute(
                "UPDATE strategy_experiments SET miss_count = miss_count + 1 WHERE status = 'observing'",
                []
            ).map_err(|error| format!("无法更新策略实验状态：{error}"))?;

            for item in research {
                let Some(candidate) = scan.candidates.iter().find(|value| value.symbol == item.symbol) else {
                    continue;
                };
                let evidence_json = serde_json::to_string(&item.evidence)
                    .map_err(|error| format!("无法序列化研究证据：{error}"))?;
                transaction.execute(
                    "INSERT INTO research_history(
                       scanned_at, symbol, attention_score, signal, last_price, spread_bps,
                       return_1h_percent, return_4h_percent, volume_acceleration, evidence_json
                     ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        scan.fetched_at, item.symbol, candidate.attention_score, candidate.signal,
                        item.last_price, item.spread_bps, item.return_1h_percent,
                        item.return_4h_percent, item.volume_acceleration, evidence_json,
                    ],
                ).map_err(|error| format!("无法保存研究历史：{error}"))?;

                transaction.execute(
                    "INSERT INTO strategy_experiments(
                       symbol, status, created_at, updated_at, observation_count, miss_count,
                       best_attention_score, hypothesis, invalidation_rule
                     ) VALUES(?1, 'observing', ?2, ?2, 1, 0, ?3, ?4, ?5)
                     ON CONFLICT(symbol) DO UPDATE SET
                       status = 'observing',
                       updated_at = excluded.updated_at,
                       observation_count = strategy_experiments.observation_count + 1,
                       miss_count = 0,
                       best_attention_score = MAX(strategy_experiments.best_attention_score, excluded.best_attention_score),
                       hypothesis = excluded.hypothesis",
                    params![
                        item.symbol, scan.fetched_at, candidate.attention_score,
                        strategy_hypothesis(&candidate.signal),
                        "若连续 3 次扫描不再进入优先研究集合，则本轮实验转为 cooldown；重新出现时可恢复观察。",
                    ],
                ).map_err(|error| format!("无法保存策略实验：{error}"))?;
            }

            transaction.execute(
                "UPDATE strategy_experiments
                 SET status = 'cooldown', updated_at = ?1
                 WHERE status = 'observing' AND miss_count >= 3",
                [&scan.fetched_at],
            ).map_err(|error| format!("无法收敛策略实验：{error}"))?;

            transaction.execute(
                "DELETE FROM research_history WHERE id NOT IN (
                   SELECT id FROM research_history ORDER BY id DESC LIMIT 20000
                 )",
                [],
            ).map_err(|error| format!("无法整理研究历史：{error}"))?;

            transaction.commit()
                .map_err(|error| format!("无法提交交易研究记录：{error}"))
        })
    }

    pub async fn snapshot(&self) -> TradingRuntimeSnapshot {
        let mut snapshot = self.inner.read().await.clone();
        match self.load_recent_history(20) {
            Ok(value) => snapshot.recent_history = value,
            Err(error) => snapshot.persistence_error = error,
        }
        match self.load_strategy_experiments() {
            Ok(value) => snapshot.strategy_experiments = value,
            Err(error) => snapshot.persistence_error = error,
        }
        match self.load_risk_policy() {
            Ok(value) => snapshot.risk_policy = value,
            Err(error) => snapshot.persistence_error = error,
        }
        snapshot
    }

    pub async fn refresh(&self) -> Result<TradingRuntimeSnapshot, String> {
        {
            let mut inner = self.inner.write().await;
            if inner.refreshing {
                drop(inner);
                return Ok(self.snapshot().await);
            }
            inner.refreshing = true;
            inner.last_error.clear();
            inner.persistence_error.clear();
        }

        match scan_market_opportunities(Some(12)).await {
            Ok(scan) => {
                let mut research = Vec::new();
                for candidate in scan.candidates.iter().take(3) {
                    if let Ok(item) = get_symbol_research(candidate.symbol.clone()).await {
                        research.push(item);
                    }
                }
                let persistence_error = self.persist_refresh(&scan, &research).err().unwrap_or_default();
                let shadow_error = self.update_shadow_trials(&scan).await.err().unwrap_or_default();
                let decision_shadow_error = self.update_decision_shadow(&scan, &research).await.err().unwrap_or_default();
                {
                    let mut inner = self.inner.write().await;
                    inner.refreshing = false;
                    inner.last_scan_at = scan.fetched_at.clone();
                    inner.market_source = scan.source.clone();
                    inner.candidate_count = scan.candidates.len();
                    inner.candidates = scan.candidates;
                    inner.research = research;
                    inner.last_error.clear();
                    inner.persistence_error = [persistence_error, shadow_error, decision_shadow_error].into_iter().filter(|value| !value.is_empty()).collect::<Vec<_>>().join("；");
                }
                Ok(self.snapshot().await)
            }
            Err(error) => {
                let mut inner = self.inner.write().await;
                inner.refreshing = false;
                inner.last_error = error.clone();
                drop(inner);
                Err(error)
            }
        }
    }


    pub fn create_trade_intent_record(
        &self,
        request: TradeIntentRequest,
    ) -> Result<TradeIntentRecord, String> {
        let symbol = request.symbol.trim().to_uppercase();
        let side = request.side.trim().to_lowercase();
        if !tradable_usdt_symbol(&symbol) {
            return Err("Trade Intent 只接受有效的 USDT 现货交易对。".to_string());
        }
        if !matches!(side.as_str(), "buy" | "sell") {
            return Err("Trade Intent 的方向必须是 buy 或 sell。".to_string());
        }
        if !request.notional_usdt.is_finite() || request.notional_usdt <= 0.0 {
            return Err("Trade Intent 的名义金额必须大于 0。".to_string());
        }

        let risk = self.evaluate_risk(&TradeRiskRequest {
            symbol: symbol.clone(),
            side: side.clone(),
            notional_usdt: request.notional_usdt,
            leverage: 1.0,
        })?;
        let now = Utc::now();
        let record = TradeIntentRecord {
            id: format!(
                "intent-{}-{}-{}",
                now.timestamp_micros(),
                symbol,
                side
            ),
            symbol,
            side,
            notional_usdt: request.notional_usdt,
            rationale: request.rationale.trim().chars().take(1000).collect(),
            source: request.source.trim().chars().take(120).collect(),
            status: if risk.allowed {
                "risk-approved-not-executed".to_string()
            } else {
                "dry-run-only".to_string()
            },
            real_execution_allowed: risk.allowed,
            risk_reasons: risk.reasons.clone(),
            created_at: now.to_rfc3339(),
        };

        self.with_database(|connection| {
            connection.execute(
                "INSERT INTO trade_intents(
                   id, symbol, side, notional_usdt, rationale, source, status,
                   real_execution_allowed, risk_reasons_json, created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    record.id,
                    record.symbol,
                    record.side,
                    record.notional_usdt,
                    record.rationale,
                    record.source,
                    record.status,
                    record.real_execution_allowed as i64,
                    serde_json::to_string(&record.risk_reasons)
                        .map_err(|error| format!("无法序列化 Trade Intent 风险原因：{error}"))?,
                    record.created_at,
                ],
            ).map_err(|error| format!("无法保存 Trade Intent：{error}"))?;
            Ok(())
        })?;

        Ok(record)
    }

    pub fn recent_trade_intents(&self, limit: usize) -> Result<Vec<TradeIntentRecord>, String> {
        self.with_database(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, symbol, side, notional_usdt, rationale, source, status,
                        real_execution_allowed, risk_reasons_json, created_at
                 FROM trade_intents
                 ORDER BY created_at DESC
                 LIMIT ?1"
            ).map_err(|error| format!("无法读取 Trade Intent：{error}"))?;
            let rows = statement.query_map([limit.clamp(1, 50) as i64], |row| {
                let risk_json: String = row.get(8)?;
                Ok(TradeIntentRecord {
                    id: row.get(0)?,
                    symbol: row.get(1)?,
                    side: row.get(2)?,
                    notional_usdt: row.get(3)?,
                    rationale: row.get(4)?,
                    source: row.get(5)?,
                    status: row.get(6)?,
                    real_execution_allowed: row.get::<_, i64>(7)? != 0,
                    risk_reasons: serde_json::from_str(&risk_json).unwrap_or_default(),
                    created_at: row.get(9)?,
                })
            }).map_err(|error| format!("无法读取 Trade Intent：{error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("无法整理 Trade Intent：{error}"))
        })
    }

    fn apply_realized_loss_guards(&self, policy: &RuntimeRiskPolicy) -> Result<(), String> {
        if !policy.real_execution_enabled { return Ok(()); }
        let (daily_realized, consecutive_losses): (f64, usize) = self.with_database(|connection| {
            let day_prefix = Utc::now().format("%Y-%m-%d").to_string();
            let daily_realized: f64 = connection.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM real_ledger_events
                 WHERE event_type = 'realized_pnl' AND created_at LIKE ?1",
                [format!("{day_prefix}%")],
                |row| row.get(0),
            ).map_err(|error| format!("无法统计当日已实现损益：{error}"))?;

            let mut statement = connection.prepare(
                "SELECT amount FROM real_ledger_events
                 WHERE event_type = 'realized_pnl'
                 ORDER BY created_at DESC LIMIT 20"
            ).map_err(|error| format!("无法读取最近已实现损益：{error}"))?;
            let rows = statement.query_map([], |row| row.get::<_, f64>(0))
                .map_err(|error| format!("无法读取最近已实现损益：{error}"))?;
            let mut consecutive_losses = 0usize;
            for row in rows {
                let amount = row.map_err(|error| format!("无法整理最近已实现损益：{error}"))?;
                if amount < 0.0 { consecutive_losses += 1; } else { break; }
            }
            Ok((daily_realized, consecutive_losses))
        })?;

        if policy.max_daily_loss_usdt > 0.0 && daily_realized <= -policy.max_daily_loss_usdt {
            let reason = format!("当日已实现亏损 {:.2} USDT 已达到最大亏损上限 {:.2} USDT。", daily_realized.abs(), policy.max_daily_loss_usdt);
            let _ = self.latch_execution_guard(&reason, "daily-loss-limit");
        } else if consecutive_losses >= 3 {
            let reason = format!("真实账本出现连续 {consecutive_losses} 笔已实现亏损，已自动停机。");
            let _ = self.latch_execution_guard(&reason, "consecutive-realized-losses");
        }
        Ok(())
    }

    pub fn execution_readiness(&self) -> Result<ExecutionReadiness, String> {
        let policy = self.load_risk_policy().unwrap_or_else(|_| default_risk_policy());
        let account_configured = load_binance_credentials_from_keyring()?.is_some();
        let reconciliation_status = self.with_database(|connection| {
            connection
                .query_row(
                    "SELECT status FROM ledger_reconciliation WHERE venue = 'binance'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("无法读取真实账本对账状态：{error}"))
        })?;
        let reconciliation_ready = matches!(reconciliation_status.as_deref(), Some("complete") | Some("ok"));
        let risk_limits_configured = policy.max_order_notional_usdt > 0.0
            && policy.max_daily_loss_usdt > 0.0
            && policy.max_open_positions > 0;
        let guard = self.load_execution_guard().unwrap_or(ExecutionGuardStatus { latched: true, reason: "无法读取执行 Kill Switch 状态。".to_string(), source: "system".to_string(), updated_at: Utc::now().to_rfc3339() });
        let mut reasons = Vec::new();
        if guard.latched { reasons.push(format!("Kill Switch 已触发：{}", guard.reason)); }
        if !account_configured { reasons.push("尚未配置 Binance 只读账户。".to_string()); }
        if !reconciliation_ready { reasons.push("真实账本与账户对账尚未完整。".to_string()); }
        if !risk_limits_configured { reasons.push("单笔上限、每日最大亏损或最大同时持仓尚未全部配置。".to_string()); }
        if !policy.real_execution_enabled { reasons.push("真实交易总开关仍关闭。".to_string()); }
        Ok(ExecutionReadiness {
            ready: reasons.is_empty(),
            account_configured,
            reconciliation_ready,
            risk_limits_configured,
            real_execution_enabled: policy.real_execution_enabled,
            kill_switch_latched: guard.latched,
            reasons,
        })
    }

    pub fn evaluate_risk(&self, request: &TradeRiskRequest) -> Result<RiskDecision, String> {
        let policy = self.load_risk_policy().unwrap_or_else(|_| default_risk_policy());
        let _ = self.apply_realized_loss_guards(&policy);
        let mut reasons = Vec::new();
        let guard = self.load_execution_guard().unwrap_or(ExecutionGuardStatus { latched: true, reason: "无法读取执行 Kill Switch 状态。".to_string(), source: "system".to_string(), updated_at: Utc::now().to_rfc3339() });
        if guard.latched { reasons.push(format!("Kill Switch 已触发：{}", guard.reason)); }
        let symbol = request.symbol.trim().to_uppercase();
        let side = request.side.trim().to_lowercase();

        if !tradable_usdt_symbol(&symbol) {
            reasons.push("交易对不是允许的 USDT 现货格式。".to_string());
        }
        if !matches!(side.as_str(), "buy" | "sell") {
            reasons.push("交易方向必须是 buy 或 sell。".to_string());
        }
        if !request.notional_usdt.is_finite() || request.notional_usdt <= 0.0 {
            reasons.push("订单名义金额必须大于 0。".to_string());
        }
        if !policy.real_execution_enabled {
            reasons.push("真实交易总开关未启用。".to_string());
        }
        if request.leverage > 1.0 && !policy.leverage_enabled {
            reasons.push("杠杆未启用。".to_string());
        }
        if policy.real_execution_enabled {
            let reconciliation_ready = self.with_database(|connection| {
                let status = connection
                    .query_row(
                        "SELECT status FROM ledger_reconciliation WHERE venue = 'binance'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|error| format!("无法读取真实账本对账状态：{error}"))?;
                Ok(matches!(status.as_deref(), Some("complete") | Some("ok")))
            }).unwrap_or(false);
            if !reconciliation_ready {
                reasons.push("真实账本与账户对账尚未达到完整状态，执行层保持锁定。".to_string());
            }
            if policy.max_order_notional_usdt <= 0.0 {
                reasons.push("单笔订单上限尚未配置。".to_string());
            } else if request.notional_usdt > policy.max_order_notional_usdt {
                reasons.push(format!("订单金额超过 {:.2} USDT 的确定性上限。", policy.max_order_notional_usdt));
            }
            if policy.max_daily_loss_usdt <= 0.0 {
                reasons.push("每日最大亏损阈值尚未配置。".to_string());
            }
            if policy.max_open_positions == 0 {
                reasons.push("最大同时持仓数尚未配置。".to_string());
            }
        }

        Ok(RiskDecision { allowed: reasons.is_empty(), reasons, policy })
    }
}

#[tauri::command]
pub fn get_shadow_experiment_status(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<ShadowExperimentStatus, String> {
    state.shadow_experiment_status()
}

#[tauri::command]
pub fn get_decision_shadow_status(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<DecisionShadowStatus, String> {
    state.decision_shadow_status()
}


#[tauri::command]
pub fn get_execution_guard_status(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<ExecutionGuardStatus, String> {
    state.load_execution_guard()
}

#[tauri::command]
pub fn reset_execution_kill_switch(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<ExecutionGuardStatus, String> {
    state.reset_execution_guard()
}

#[tauri::command]
pub fn get_execution_readiness(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<ExecutionReadiness, String> {
    state.execution_readiness()
}

#[tauri::command]
pub fn get_real_ledger_status(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<RealLedgerStatus, String> {
    state.load_real_ledger_status()
}

#[tauri::command]
pub async fn sync_binance_readonly_ledger(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<RealLedgerStatus, String> {
    state.sync_binance_readonly_snapshot().await
}

#[tauri::command]
pub async fn get_trading_runtime_status(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<TradingRuntimeSnapshot, String> {
    Ok(state.snapshot().await)
}

#[tauri::command]
pub async fn refresh_trading_runtime(
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<TradingRuntimeSnapshot, String> {
    state.refresh().await
}


#[tauri::command]
pub fn create_trade_intent(
    request: TradeIntentRequest,
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<TradeIntentRecord, String> {
    state.create_trade_intent_record(request)
}

#[tauri::command]
pub fn list_trade_intents(
    limit: Option<usize>,
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<Vec<TradeIntentRecord>, String> {
    state.recent_trade_intents(limit.unwrap_or(10))
}

#[tauri::command]
pub fn evaluate_trade_risk(
    request: TradeRiskRequest,
    state: tauri::State<'_, TradingRuntimeState>,
) -> Result<RiskDecision, String> {
    state.evaluate_risk(&request)
}

#[cfg(test)]
mod runtime_tests {
    use super::*;

    #[test]
    fn decision_benchmark_policy_v1_is_frozen() {
        assert_eq!(DECISION_BENCHMARK_POLICY_VERSION, "direction-1h-v1");
        assert_eq!(DECISION_OUTCOME_HORIZON_MINUTES, 60);
        assert_eq!(classify_shadow_outcome(0.30), "bullish");
        assert_eq!(classify_shadow_outcome(0.299), "neutral");
        assert_eq!(classify_shadow_outcome(-0.30), "bearish");
        assert_eq!(classify_shadow_outcome(-0.299), "neutral");
    }

    #[test]
    fn default_policy_blocks_real_execution() {
        let policy = default_risk_policy();
        assert!(!policy.real_execution_enabled);
        assert!(!policy.withdrawal_enabled);
        assert!(!policy.leverage_enabled);
    }

    #[test]
    fn strategy_hypothesis_depends_on_signal() {
        assert!(strategy_hypothesis("high-momentum").contains("价格动量"));
        assert!(strategy_hypothesis("high-volatility").contains("高波动"));
    }
}
