use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const TYPESAFE_JEV_ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
const TYPESAFE_JEV_MODEL: &str = "jev-latest";
const TYPESAFE_JEV_INPUT_COST_PER_MILLION_TOKENS_USD: f64 = 0.042;

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

#[derive(Debug, Clone)]
pub struct JevDecisionProvider {
    api_key: String,
}

impl JevDecisionProvider {
    pub fn new(api_key: String) -> Result<Self, String> {
        let key = api_key.trim();
        if key.len() < 12 || key.chars().any(char::is_whitespace) {
            return Err("TypeSafe API Key 看起来不完整。".to_string());
        }
        Ok(Self {
            api_key: key.to_string(),
        })
    }
}

fn jev_state(input: &DecisionInput) -> Value {
    json!({
        "market": "crypto-spot",
        "symbol": input.symbol,
        "timestamp": input.timestamp,
        "price": input.price,
        "candidateSignal": input.candidate_signal,
        "attentionScore": input.attention_score,
        "changePercent24h": input.change_percent_24h,
        "quoteVolume24h": input.quote_volume_24h,
        "tradeCount24h": input.trade_count_24h,
        "intradayRangePercent": input.intraday_range_percent,
        "spreadBps": input.spread_bps,
        "orderBookImbalance": input.order_book_imbalance,
        "return1hPercent": input.return_1h_percent,
        "return4hPercent": input.return_4h_percent,
        "realizedVolatility5mPercent": input.realized_volatility_5m_percent,
        "volumeAcceleration": input.volume_acceleration,
        "positionContextAvailable": false,
        "executionEnabled": false
    })
}

fn jev_questions() -> Value {
    json!({
        "direction": {
            "type": "choice",
            "instructions": "For the next approximately one hour, which directional state is best supported by the supplied spot-market evidence?",
            "criteria": {
                "bullish": "Evidence supports upward direction over the next approximately one hour.",
                "neutral": "Evidence is mixed, range-bound, or insufficient for a directional conclusion.",
                "bearish": "Evidence supports downward direction over the next approximately one hour."
            }
        },
        "action": {
            "type": "choice",
            "instructions": "For a shadow-only spot-entry candidate with no existing position context, what should the research layer do?",
            "criteria": {
                "enter": "Evidence supports a new spot entry candidate strongly enough for shadow benchmarking; this does not authorize execution.",
                "wait": "Evidence is insufficient, ambiguous, abnormal, or risky enough that the research layer should wait."
            }
        },
        "market_regime": {
            "type": "choice",
            "instructions": "Which market regime best describes the supplied evidence?",
            "criteria": {
                "trending": "Directional movement is persistent across horizons with supportive activity.",
                "range-mixed": "Direction is mixed or range-bound without an unusually severe liquidity or volatility condition.",
                "high-volatility": "Short-horizon volatility or intraday range is unusually high.",
                "low-liquidity": "Liquidity or spread quality is poor enough to dominate the state."
            }
        },
        "risk_state": {
            "type": "choice",
            "instructions": "How severe is the market-state risk for evaluating a new spot-entry candidate?",
            "criteria": {
                "normal": "Liquidity, spread, volatility, and imbalance are broadly ordinary.",
                "elevated": "One or more risk indicators are meaningfully elevated and require caution.",
                "extreme": "Market-state risk is severe enough that a new entry candidate should not proceed."
            }
        },
        "abnormal_state": {
            "type": "noul",
            "instructions": "Does the supplied market evidence show an abnormal microstructure, volatility, liquidity, or activity condition?"
        },
        "signal_priority": {
            "type": "choice",
            "instructions": "How important is this sample for the research queue?",
            "criteria": {
                "low": "Ordinary sample with limited research value.",
                "medium": "Meaningful sample worth keeping in the research queue.",
                "high": "Unusually informative or urgent sample for research and monitoring."
            }
        }
    })
}

fn choice_answer<'a>(answers: &'a Value, key: &str) -> Result<&'a Value, String> {
    let answer = answers
        .get(key)
        .ok_or_else(|| format!("Jev 缺少 {key} 判断。"))?;
    if answer.get("type").and_then(Value::as_str) != Some("choice") {
        return Err(format!("Jev {key} 返回类型不正确。"));
    }
    Ok(answer)
}

fn choice_value(answers: &Value, key: &str, allowed: &[&str]) -> Result<(String, f64, Value), String> {
    let answer = choice_answer(answers, key)?;
    let choice = answer
        .get("choice")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Jev {key} 没有返回 choice。"))?;
    if !allowed.contains(&choice) {
        return Err(format!("Jev {key} 返回了未允许的选项。"));
    }
    let confidence = answer
        .get("confidence")
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("Jev {key} 没有返回 confidence。"))?
        .clamp(0.0, 1.0);
    let probabilities = answer
        .get("probabilities")
        .cloned()
        .unwrap_or_else(|| json!({}));
    Ok((choice.to_string(), confidence, probabilities))
}

fn parse_jev_output(payload: &Value) -> Result<DecisionOutput, String> {
    let answers = payload
        .get("answers")
        .ok_or_else(|| "Jev 没有返回 answers。".to_string())?;
    let (direction, direction_confidence, direction_probabilities) =
        choice_value(answers, "direction", &["bullish", "neutral", "bearish"])?;
    let (action, action_confidence, action_probabilities) =
        choice_value(answers, "action", &["enter", "wait"])?;
    let (market_regime, regime_confidence, regime_probabilities) =
        choice_value(answers, "market_regime", &["trending", "range-mixed", "high-volatility", "low-liquidity"])?;
    let (risk_state, risk_confidence, risk_probabilities) =
        choice_value(answers, "risk_state", &["normal", "elevated", "extreme"])?;
    let (signal_priority, priority_confidence, priority_probabilities) =
        choice_value(answers, "signal_priority", &["low", "medium", "high"])?;

    let abnormal_state_probability = answers
        .get("abnormal_state")
        .and_then(|answer| answer.get("noul"))
        .and_then(Value::as_f64)
        .ok_or_else(|| "Jev abnormal_state 没有返回 noul。".to_string())?
        .clamp(0.0, 1.0);
    let abnormal_state = abnormal_state_probability >= 0.5;

    let model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(TYPESAFE_JEV_MODEL)
        .to_string();
    let input_tokens = payload
        .pointer("/usage/input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let estimated_cost_usd =
        input_tokens as f64 / 1_000_000.0 * TYPESAFE_JEV_INPUT_COST_PER_MILLION_TOKENS_USD;

    Ok(DecisionOutput {
        provider: "typesafe-jev".to_string(),
        provider_version: model,
        direction,
        action,
        market_regime,
        risk_state,
        abnormal_state,
        signal_priority,
        confidence: direction_confidence,
        confidence_kind: "typesafe-calibrated-choice-direction".to_string(),
        probabilities: json!({
            "direction": direction_probabilities,
            "action": action_probabilities,
            "marketRegime": regime_probabilities,
            "riskState": risk_probabilities,
            "abnormalState": {
                "true": abnormal_state_probability,
                "false": 1.0 - abnormal_state_probability
            },
            "signalPriority": priority_probabilities,
            "confidenceByQuestion": {
                "direction": direction_confidence,
                "action": action_confidence,
                "marketRegime": regime_confidence,
                "riskState": risk_confidence,
                "signalPriority": priority_confidence
            }
        }),
        estimated_cost_usd,
    })
}

impl DecisionProvider for JevDecisionProvider {
    fn id(&self) -> &'static str {
        "typesafe-jev"
    }

    fn version(&self) -> &'static str {
        TYPESAFE_JEV_MODEL
    }

    fn decide<'a>(
        &'a self,
        input: &'a DecisionInput,
    ) -> BoxFuture<'a, Result<DecisionOutput, String>> {
        Box::pin(async move {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(4))
                .build()
                .map_err(|error| format!("无法初始化 Jev 客户端：{error}"))?;
            let response = client
                .post(TYPESAFE_JEV_ENDPOINT)
                .bearer_auth(&self.api_key)
                .json(&json!({
                    "state": jev_state(input),
                    "model": TYPESAFE_JEV_MODEL,
                    "questions": jev_questions()
                }))
                .send()
                .await
                .map_err(|error| {
                    if error.is_timeout() {
                        "Jev 请求超时。".to_string()
                    } else {
                        format!("无法连接 Jev：{error}")
                    }
                })?;
            let status = response.status();
            let payload: Value = response
                .json()
                .await
                .map_err(|error| format!("Jev 返回内容无法读取：{error}"))?;
            if !status.is_success() {
                let detail = payload
                    .get("detail")
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("message").and_then(Value::as_str))
                    .unwrap_or("请求失败");
                return Err(format!("Jev 返回 HTTP {status}：{detail}"));
            }
            parse_jev_output(&payload)
        })
    }
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

    #[test]
    fn jev_request_is_shadow_only_and_typed() {
        let state = jev_state(&sample());
        assert_eq!(state["executionEnabled"], false);
        assert_eq!(state["positionContextAvailable"], false);
        let questions = jev_questions();
        assert_eq!(questions["direction"]["type"], "choice");
        assert_eq!(questions["abnormal_state"]["type"], "noul");
        assert_eq!(questions["action"]["criteria"].as_object().map(|x| x.len()), Some(2));
    }

    #[test]
    fn parses_jev_decision_without_free_text() {
        let payload = json!({
            "model": "jev-1.13.0",
            "answers": {
                "direction": {
                    "type": "choice",
                    "choice": "bullish",
                    "confidence": 0.82,
                    "probabilities": {"bullish": 0.88, "neutral": 0.10, "bearish": 0.02}
                },
                "action": {
                    "type": "choice",
                    "choice": "wait",
                    "confidence": 0.70,
                    "probabilities": {"enter": 0.20, "wait": 0.80}
                },
                "market_regime": {
                    "type": "choice",
                    "choice": "trending",
                    "confidence": 0.75,
                    "probabilities": {"trending": 0.80, "range-mixed": 0.10, "high-volatility": 0.08, "low-liquidity": 0.02}
                },
                "risk_state": {
                    "type": "choice",
                    "choice": "normal",
                    "confidence": 0.90,
                    "probabilities": {"normal": 0.95, "elevated": 0.04, "extreme": 0.01}
                },
                "abnormal_state": {"type": "noul", "noul": 0.15},
                "signal_priority": {
                    "type": "choice",
                    "choice": "high",
                    "confidence": 0.68,
                    "probabilities": {"low": 0.05, "medium": 0.20, "high": 0.75}
                }
            },
            "usage": {"input_tokens": 1000, "output_tokens": 100}
        });
        let output = parse_jev_output(&payload).unwrap();
        assert_eq!(output.provider, "typesafe-jev");
        assert_eq!(output.provider_version, "jev-1.13.0");
        assert_eq!(output.direction, "bullish");
        assert_eq!(output.action, "wait");
        assert!(!output.abnormal_state);
        assert!((output.estimated_cost_usd - 0.000042).abs() < 0.000000001);
    }

    #[test]
    fn rejects_unexpected_jev_choices() {
        let payload = json!({
            "model": "jev-1.13.0",
            "answers": {
                "direction": {"type": "choice", "choice": "moon", "confidence": 1.0, "probabilities": {"moon": 1.0}},
                "action": {"type": "choice", "choice": "wait", "confidence": 1.0, "probabilities": {"wait": 1.0}},
                "market_regime": {"type": "choice", "choice": "trending", "confidence": 1.0, "probabilities": {"trending": 1.0}},
                "risk_state": {"type": "choice", "choice": "normal", "confidence": 1.0, "probabilities": {"normal": 1.0}},
                "abnormal_state": {"type": "noul", "noul": 0.0},
                "signal_priority": {"type": "choice", "choice": "low", "confidence": 1.0, "probabilities": {"low": 1.0}}
            }
        });
        assert!(parse_jev_output(&payload).is_err());
    }
}
