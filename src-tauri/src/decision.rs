use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionInput {
    pub timestamp: String,
    pub timestamp_ms: i64,
    pub symbol: String,
    pub price: f64,
    pub candidate_signal: String,
    pub attention_score: f64,
    pub change_percent_24h: f64,
    pub quote_volume_24h: f64,
    pub trade_count_24h: u64,
    pub intraday_range_percent: f64,
    pub spread_bps: f64,
    pub order_book_imbalance: f64,
    pub return_1h_percent: f64,
    pub return_4h_percent: f64,
    pub realized_volatility_5m_percent: f64,
    pub volume_acceleration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionOutput {
    pub provider: String,
    pub provider_version: String,
    pub direction: String,
    pub action: String,
    pub market_regime: String,
    pub risk_state: String,
    pub abnormal_state: bool,
    pub signal_priority: String,
    pub confidence: f64,
    pub confidence_kind: String,
    pub probabilities: Value,
    pub estimated_cost_usd: f64,
}

pub trait DecisionProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> &'static str;
    fn decide<'a>(
        &'a self,
        input: &'a DecisionInput,
    ) -> BoxFuture<'a, Result<DecisionOutput, String>>;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionAttempt {
    pub provider_requested: String,
    pub provider_used: String,
    pub fallback_used: bool,
    pub primary_error: String,
    pub latency_ms: u64,
    pub output: DecisionOutput,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct RuleBaselineProvider;

impl DecisionProvider for RuleBaselineProvider {
    fn id(&self) -> &'static str {
        "rule-baseline"
    }

    fn version(&self) -> &'static str {
        "0.1"
    }

    fn decide<'a>(
        &'a self,
        input: &'a DecisionInput,
    ) -> BoxFuture<'a, Result<DecisionOutput, String>> {
        Box::pin(async move { Ok(rule_baseline_decision(input)) })
    }
}

pub async fn evaluate_with_fallback(
    primary: Option<&dyn DecisionProvider>,
    fallback: &dyn DecisionProvider,
    input: &DecisionInput,
) -> Result<DecisionAttempt, String> {
    let requested = primary.map(|provider| provider.id()).unwrap_or_else(|| fallback.id());
    let started = Instant::now();

    if let Some(provider) = primary {
        match provider.decide(input).await {
            Ok(output) => {
                return Ok(DecisionAttempt {
                    provider_requested: requested.to_string(),
                    provider_used: provider.id().to_string(),
                    fallback_used: false,
                    primary_error: String::new(),
                    latency_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                    output,
                });
            }
            Err(primary_error) => {
                let output = fallback
                    .decide(input)
                    .await
                    .map_err(|fallback_error| {
                        format!(
                            "primary provider failed: {primary_error}; fallback failed: {fallback_error}"
                        )
                    })?;
                return Ok(DecisionAttempt {
                    provider_requested: requested.to_string(),
                    provider_used: fallback.id().to_string(),
                    fallback_used: true,
                    primary_error,
                    latency_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                    output,
                });
            }
        }
    }

    let output = fallback.decide(input).await?;
    Ok(DecisionAttempt {
        provider_requested: fallback.id().to_string(),
        provider_used: fallback.id().to_string(),
        fallback_used: false,
        primary_error: String::new(),
        latency_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        output,
    })
}

fn bounded_probability(value: f64) -> f64 {
    value.clamp(0.02, 0.96)
}

fn direction_distribution(direction: &str, confidence: f64) -> Value {
    let confidence = bounded_probability(confidence);
    let remainder = 1.0 - confidence;
    match direction {
        "bullish" => json!({
            "bullish": confidence,
            "neutral": remainder * 0.65,
            "bearish": remainder * 0.35
        }),
        "bearish" => json!({
            "bullish": remainder * 0.35,
            "neutral": remainder * 0.65,
            "bearish": confidence
        }),
        _ => json!({
            "bullish": remainder * 0.5,
            "neutral": confidence,
            "bearish": remainder * 0.5
        }),
    }
}

fn rule_baseline_decision(input: &DecisionInput) -> DecisionOutput {
    let directional_score =
        input.return_1h_percent * 0.45
        + input.return_4h_percent * 0.25
        + input.order_book_imbalance * 1.2
        + (input.volume_acceleration - 1.0).clamp(-1.0, 2.0) * 0.15;

    let direction = if directional_score >= 0.45 {
        "bullish"
    } else if directional_score <= -0.45 {
        "bearish"
    } else {
        "neutral"
    };

    let market_regime = if input.spread_bps >= 25.0 || input.quote_volume_24h < 8_000_000.0 {
        "low-liquidity"
    } else if input.realized_volatility_5m_percent >= 0.8 || input.intraday_range_percent >= 8.0 {
        "high-volatility"
    } else if input.return_1h_percent.abs() >= 0.8
        && input.return_4h_percent.abs() >= 1.2
        && input.return_1h_percent.signum() == input.return_4h_percent.signum()
    {
        "trending"
    } else {
        "range-mixed"
    };

    let abnormal_state =
        input.spread_bps >= 30.0
        || input.realized_volatility_5m_percent >= 1.2
        || input.volume_acceleration >= 3.0
        || input.order_book_imbalance.abs() >= 0.75;

    let risk_state = if input.spread_bps >= 40.0
        || input.realized_volatility_5m_percent >= 1.5
        || input.order_book_imbalance.abs() >= 0.9
    {
        "extreme"
    } else if abnormal_state
        || input.spread_bps >= 15.0
        || input.realized_volatility_5m_percent >= 0.8
        || input.intraday_range_percent >= 10.0
    {
        "elevated"
    } else {
        "normal"
    };

    let signal_priority = if abnormal_state || input.attention_score >= 80.0 {
        "high"
    } else if input.attention_score >= 60.0 {
        "medium"
    } else {
        "low"
    };

    // The baseline deliberately emits ENTER only for strong bullish spot setups.
    // REDUCE / EXIT require position context that Kardii does not yet have in this layer.
    let action = if risk_state != "extreme"
        && !abnormal_state
        && direction == "bullish"
        && input.attention_score >= 65.0
        && input.volume_acceleration >= 1.05
    {
        "enter"
    } else {
        "wait"
    };

    let evidence_strength = (directional_score.abs() / 3.0).min(0.28)
        + ((input.attention_score - 50.0).max(0.0) / 250.0).min(0.12);
    let confidence = if direction == "neutral" {
        (0.58 + (0.45 - directional_score.abs()).max(0.0) * 0.20).clamp(0.52, 0.78)
    } else {
        (0.55 + evidence_strength).clamp(0.55, 0.90)
    };

    DecisionOutput {
        provider: "rule-baseline".to_string(),
        provider_version: "0.1".to_string(),
        direction: direction.to_string(),
        action: action.to_string(),
        market_regime: market_regime.to_string(),
        risk_state: risk_state.to_string(),
        abnormal_state,
        signal_priority: signal_priority.to_string(),
        confidence,
        confidence_kind: "heuristic-not-calibrated".to_string(),
        probabilities: json!({
            "direction": direction_distribution(direction, confidence),
            "action": {
                "enter": if action == "enter" { confidence } else { 1.0 - confidence },
                "wait": if action == "wait" { confidence } else { 1.0 - confidence },
                "reduce": 0.0,
                "exit": 0.0
            }
        }),
        estimated_cost_usd: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> DecisionInput {
        DecisionInput {
            timestamp: "2026-09-21T00:00:00Z".to_string(),
            timestamp_ms: 1_758_412_800_000,
            symbol: "BTCUSDT".to_string(),
            price: 100_000.0,
            candidate_signal: "high-momentum".to_string(),
            attention_score: 82.0,
            change_percent_24h: 6.0,
            quote_volume_24h: 2_000_000_000.0,
            trade_count_24h: 500_000,
            intraday_range_percent: 5.0,
            spread_bps: 1.5,
            order_book_imbalance: 0.22,
            return_1h_percent: 1.2,
            return_4h_percent: 2.1,
            realized_volatility_5m_percent: 0.35,
            volume_acceleration: 1.4,
        }
    }

    #[test]
    fn baseline_is_observation_only_shape() {
        let output = rule_baseline_decision(&sample());
        assert_eq!(output.provider, "rule-baseline");
        assert!(matches!(output.direction.as_str(), "bullish" | "neutral" | "bearish"));
        assert!(matches!(output.action.as_str(), "enter" | "wait" | "reduce" | "exit"));
        assert!(output.confidence >= 0.0 && output.confidence <= 1.0);
        assert_eq!(output.estimated_cost_usd, 0.0);
    }

    #[test]
    fn extreme_market_never_enters_in_baseline() {
        let mut input = sample();
        input.spread_bps = 55.0;
        input.realized_volatility_5m_percent = 2.0;
        let output = rule_baseline_decision(&input);
        assert_eq!(output.risk_state, "extreme");
        assert_eq!(output.action, "wait");
    }
}
