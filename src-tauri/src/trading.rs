use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
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


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRiskPolicy {
    mode: String,
    real_execution_enabled: bool,
    withdrawal_enabled: bool,
    leverage_enabled: bool,
    note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingRuntimeSnapshot {
    mode: String,
    refreshing: bool,
    started_at: String,
    last_scan_at: String,
    last_error: String,
    market_source: String,
    candidate_count: usize,
    candidates: Vec<OpportunityCandidate>,
    research: Vec<SymbolResearch>,
    risk_policy: RuntimeRiskPolicy,
}

#[derive(Clone)]
pub struct TradingRuntimeState {
    inner: Arc<RwLock<TradingRuntimeSnapshot>>,
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
                market_source: String::new(),
                candidate_count: 0,
                candidates: Vec::new(),
                research: Vec::new(),
                risk_policy: RuntimeRiskPolicy {
                    mode: "research-only".to_string(),
                    real_execution_enabled: false,
                    withdrawal_enabled: false,
                    leverage_enabled: false,
                    note: "当前只做公开市场研究；真实交易、提现和杠杆均未启用。".to_string(),
                },
            })),
        }
    }
}

impl TradingRuntimeState {
    pub async fn snapshot(&self) -> TradingRuntimeSnapshot {
        self.inner.read().await.clone()
    }

    pub async fn refresh(&self) -> Result<TradingRuntimeSnapshot, String> {
        {
            let mut inner = self.inner.write().await;
            if inner.refreshing {
                return Ok(inner.clone());
            }
            inner.refreshing = true;
            inner.last_error.clear();
        }

        let scan_result = scan_market_opportunities(Some(12)).await;
        let final_result = match scan_result {
            Ok(scan) => {
                let mut research = Vec::new();
                for candidate in scan.candidates.iter().take(3) {
                    if let Ok(item) = get_symbol_research(candidate.symbol.clone()).await {
                        research.push(item);
                    }
                }
                let mut inner = self.inner.write().await;
                inner.refreshing = false;
                inner.last_scan_at = scan.fetched_at.clone();
                inner.market_source = scan.source.clone();
                inner.candidate_count = scan.candidates.len();
                inner.candidates = scan.candidates;
                inner.research = research;
                inner.last_error.clear();
                Ok(inner.clone())
            }
            Err(error) => {
                let mut inner = self.inner.write().await;
                inner.refreshing = false;
                inner.last_error = error.clone();
                Err(error)
            }
        };
        final_result
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
