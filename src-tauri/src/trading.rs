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

const SPOT_24H_ENDPOINTS: &[&str] = &[
    "https://api.binance.com/api/v3/ticker/24hr",
    "https://data-api.binance.vision/api/v3/ticker/24hr",
    "https://api1.binance.com/api/v3/ticker/24hr",
];


const BINANCE_PRIVATE_BASES: &[&str] = &[
    "https://api.binance.com",
    "https://api1.binance.com",
];
const TRADING_KEYRING_SERVICE: &str = "Kardii Trading Runtime";
const BINANCE_API_KEY_ACCOUNT: &str = "binance-readonly-api-key";
const BINANCE_API_SECRET_ACCOUNT: &str = "binance-readonly-api-secret";

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
        safe_read_only: !account.can_trade && !account.can_withdraw,
        account_type: account.account_type,
        can_deposit: account.can_deposit,
        nonzero_balances: balances,
        permissions: Some(permissions),
        checked_at: Utc::now().to_rfc3339(),
        error: if account.can_trade || account.can_withdraw {
            "账户返回的权限状态仍包含交易或提现能力，因此 Kardii 将其视为不安全。".to_string()
        } else {
            String::new()
        },
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
    for base in SPOT_BASES {
        let url = format!("{base}{path_and_query}");
        match client.get(&url).send().await {
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

fn candidate_from(ticker: &BinanceTicker) -> Option<OpportunityCandidate> {
    if !tradable_usdt_symbol(&ticker.symbol) {
        return None;
    }
    let summary = summarize(ticker);
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
        symbol: summary.symbol,
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

async fn fetch_spot_tickers() -> Result<(String, Vec<BinanceTicker>), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("无法初始化市场数据客户端：{error}"))?;

    let mut errors = Vec::new();
    for endpoint in SPOT_24H_ENDPOINTS {
        match client.get(*endpoint).send().await {
            Ok(response) if response.status().is_success() => {
                match response.json::<Vec<BinanceTicker>>().await {
                    Ok(tickers) if !tickers.is_empty() => {
                        return Ok((endpoint.to_string(), tickers));
                    }
                    Ok(_) => errors.push(format!("{endpoint}: 返回空数据")),
                    Err(error) => errors.push(format!("{endpoint}: 数据解析失败 {error}")),
                }
            }
            Ok(response) => errors.push(format!("{endpoint}: HTTP {}", response.status())),
            Err(error) => errors.push(format!("{endpoint}: {error}")),
        }
    }

    Err(format!("市场数据暂不可用：{}", errors.join("；")))
}

#[tauri::command]
pub async fn get_market_snapshot(limit: Option<usize>) -> Result<MarketSnapshot, String> {
    let limit = limit.unwrap_or(12).clamp(1, 50);
    let (source, tickers) = fetch_spot_tickers().await?;
    let mut summaries: Vec<_> = tickers
        .iter()
        .filter(|ticker| tradable_usdt_symbol(&ticker.symbol))
        .map(summarize)
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

    fn sample(symbol: &str, change: &str, volume: &str, count: u64) -> BinanceTicker {
        BinanceTicker {
            symbol: symbol.into(),
            last_price: "1.25".into(),
            price_change_percent: change.into(),
            high_price: "1.40".into(),
            low_price: "1.10".into(),
            quote_volume: volume.into(),
            count,
        }
    }

    #[test]
    fn excludes_stable_and_leveraged_pairs() {
        assert!(!tradable_usdt_symbol("USDCUSDT"));
        assert!(!tradable_usdt_symbol("BTCUPUSDT"));
        assert!(tradable_usdt_symbol("BTCUSDT"));
    }

    #[test]
    fn thin_markets_do_not_become_candidates() {
        assert!(candidate_from(&sample("ABCUSDT", "20", "100000", 50)).is_none());
    }

    #[test]
    fn active_liquid_markets_can_enter_research_queue() {
        let candidate = candidate_from(&sample("ABCUSDT", "9", "120000000", 25000)).unwrap();
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
             );"
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
                {
                    let mut inner = self.inner.write().await;
                    inner.refreshing = false;
                    inner.last_scan_at = scan.fetched_at.clone();
                    inner.market_source = scan.source.clone();
                    inner.candidate_count = scan.candidates.len();
                    inner.candidates = scan.candidates;
                    inner.research = research;
                    inner.last_error.clear();
                    inner.persistence_error = persistence_error;
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

    pub fn evaluate_risk(&self, request: &TradeRiskRequest) -> Result<RiskDecision, String> {
        let policy = self.load_risk_policy().unwrap_or_else(|_| default_risk_policy());
        let mut reasons = Vec::new();
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
