use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::time::Duration;

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
}
