
use rand::RngCore;
use reqwest::Url;
use rusqlite::Connection;
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::Duration,
};

const VIEWER_PORT: u16 = 43_199;
const KEYRING_SERVICE: &str = "Kardii Trading Runtime";
const KEYRING_ACCOUNT: &str = "readonly-viewer-token-v1";
const REMOTE_PUBLIC_BASE_ENV: &str = "KARDII_REMOTE_VIEWER_PUBLIC_BASE";
const REMOTE_PUBLIC_BASE_ACCOUNT: &str = "readonly-viewer-public-base-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOnlyViewerStatus {
    pub running: bool,
    pub port: u16,
    pub bind_address: String,
    pub local_url: String,
    pub public_url: String,
    pub remote_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOnlyTransportStatus {
    configured: bool,
    public_url: String,
    reachable: bool,
    error: String,
}

struct ViewerRuntime {
    running: bool,
    token: String,
    db_path: Option<PathBuf>,
    stop: Option<Arc<AtomicBool>>,
}

impl ViewerRuntime {
    fn new() -> Self {
        Self {
            running: false,
            token: load_or_create_token(),
            db_path: None,
            stop: None,
        }
    }

    fn status(&self) -> ReadOnlyViewerStatus {
        let public_url = configured_remote_public_base().unwrap_or_default();
        ReadOnlyViewerStatus {
            running: self.running,
            port: VIEWER_PORT,
            bind_address: "127.0.0.1".to_string(),
            local_url: format!("http://127.0.0.1:{VIEWER_PORT}/"),
            remote_enabled: !public_url.is_empty(),
            public_url,
        }
    }
}

fn state() -> &'static Arc<Mutex<ViewerRuntime>> {
    static STATE: OnceLock<Arc<Mutex<ViewerRuntime>>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(Mutex::new(ViewerRuntime::new())))
}

fn normalize_remote_public_base(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value.trim())
        .map_err(|_| "远程 Kardii HTTPS 地址格式不正确。".to_string())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("远程 Kardii 地址不能包含账号、密码、查询参数或 fragment。".to_string());
    }
    if !matches!(url.path(), "" | "/") {
        return Err("远程 Kardii 地址必须使用站点根路径。".to_string());
    }
    let host = url.host_str().unwrap_or_default();
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("远程 Kardii 必须使用 HTTPS；只有本机 localhost 可以使用 HTTP。".to_string());
    }
    url.set_path("");
    let mut normalized = url.to_string();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_remote_public_base_keyring() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, REMOTE_PUBLIC_BASE_ACCOUNT).ok()?;
    let value = entry.get_password().ok()?;
    normalize_remote_public_base(&value).ok()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_remote_public_base_keyring() -> Option<String> {
    None
}

fn configured_remote_public_base() -> Option<String> {
    std::env::var(REMOTE_PUBLIC_BASE_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .and_then(|value| normalize_remote_public_base(&value).ok())
        .or_else(load_remote_public_base_keyring)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn save_remote_public_base_keyring(value: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, REMOTE_PUBLIC_BASE_ACCOUNT)
        .map_err(|error| format!("无法打开远程 HTTPS 配置：{error}"))?
        .set_password(value)
        .map_err(|error| format!("无法保存远程 HTTPS 地址：{error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn save_remote_public_base_keyring(_value: &str) -> Result<(), String> {
    Err("当前平台暂不支持安全保存远程 HTTPS 地址。".to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn delete_remote_public_base_keyring() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, REMOTE_PUBLIC_BASE_ACCOUNT)
        .map_err(|error| format!("无法打开远程 HTTPS 配置：{error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法删除远程 HTTPS 地址：{error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn delete_remote_public_base_keyring() -> Result<(), String> {
    Ok(())
}


fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_or_create_token() -> String {
    let generated = random_token();
    let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) else {
        return generated;
    };
    if let Ok(saved) = entry.get_password() {
        if saved.len() >= 32 {
            return saved;
        }
    }
    let _ = entry.set_password(&generated);
    generated
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_or_create_token() -> String {
    random_token()
}

pub fn initialize_readonly_viewer(app_data_dir: &Path) -> Result<ReadOnlyViewerStatus, String> {
    let runtime = Arc::clone(state());
    {
        let mut guard = runtime.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.db_path = Some(app_data_dir.join("kardii-trading.sqlite3"));
        if guard.running {
            return Ok(guard.status());
        }
    }

    let listener = TcpListener::bind(("127.0.0.1", VIEWER_PORT))
        .map_err(|error| format!("无法启动只读状态端口 {VIEWER_PORT}：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法配置只读状态端口：{error}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let runtime_for_thread = Arc::clone(&runtime);
    thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => handle_request(stream, Arc::clone(&runtime_for_thread)),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(80));
                }
                Err(_) => thread::sleep(Duration::from_millis(120)),
            }
        }
    });

    let mut guard = runtime.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.running = true;
    guard.stop = Some(stop);
    Ok(guard.status())
}

#[tauri::command]
pub fn readonly_viewer_status() -> ReadOnlyViewerStatus {
    state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .status()
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|error| error.to_string())?;
    let mut data = Vec::new();
    let mut chunk = [0u8; 1024];
    while data.len() < 16_384 {
        let count = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..count]);
        if data.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8(data).map_err(|_| "HTTP 请求不是 UTF-8。".to_string())?;
    let mut lines = text.split("\r\n");
    let first = lines.next().ok_or_else(|| "HTTP 请求为空。".to_string())?;
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    Ok(Request { method, path, headers })
}

fn authorized(request: &Request, token: &str) -> bool {
    request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|value| value == token)
        .unwrap_or(false)
}

fn handle_request(mut stream: TcpStream, runtime: Arc<Mutex<ViewerRuntime>>) {
    let request = match read_request(&mut stream) {
        Ok(value) => value,
        Err(error) => {
            write_json(&mut stream, "400 Bad Request", serde_json::json!({"error": error}));
            return;
        }
    };

    if request.method != "GET" {
        write_json(&mut stream, "405 Method Not Allowed", serde_json::json!({"error": "read-only"}));
        return;
    }

    if request.path == "/health" {
        let remote_enabled = runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .status()
            .remote_enabled;
        write_json(&mut stream, "200 OK", serde_json::json!({
            "app": "Kardii",
            "service": "readonly-viewer",
            "remoteEnabled": remote_enabled
        }));
        return;
    }

    if request.path == "/" {
        write_html(&mut stream, viewer_html());
        return;
    }

    if request.path == "/status" {
        let (token, db_path) = {
            let guard = runtime.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            (guard.token.clone(), guard.db_path.clone())
        };
        if !authorized(&request, &token) {
            write_json(&mut stream, "401 Unauthorized", serde_json::json!({"error": "unauthorized"}));
            return;
        }
        let Some(path) = db_path else {
            write_json(&mut stream, "503 Service Unavailable", serde_json::json!({"error": "database unavailable"}));
            return;
        };
        match read_status(&path) {
            Ok(value) => write_json(&mut stream, "200 OK", value),
            Err(error) => write_json(&mut stream, "500 Internal Server Error", serde_json::json!({"error": error})),
        }
        return;
    }

    write_json(&mut stream, "404 Not Found", serde_json::json!({"error": "not found"}));
}

fn read_status(path: &Path) -> Result<serde_json::Value, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("无法读取 Kardii 状态数据库：{error}"))?;

    let research_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM research_history", [], |row| row.get(0))
        .unwrap_or(0);
    let observing_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM strategy_experiments WHERE status = 'observing'", [], |row| row.get(0))
        .unwrap_or(0);
    let ledger_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM real_ledger_events", [], |row| row.get(0))
        .unwrap_or(0);
    let snapshot_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM account_balance_snapshots", [], |row| row.get(0))
        .unwrap_or(0);
    let decision_sample_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM decision_shadow_samples", [], |row| row.get(0))
        .unwrap_or(0);
    let decision_prediction_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM decision_shadow_predictions", [], |row| row.get(0))
        .unwrap_or(0);
    let decision_settled_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM decision_shadow_samples WHERE status = 'settled'", [], |row| row.get(0))
        .unwrap_or(0);

    let shadow_open: i64 = connection
        .query_row("SELECT COUNT(*) FROM shadow_strategy_trials WHERE status = 'open'", [], |row| row.get(0))
        .unwrap_or(0);
    let (shadow_closed, shadow_positive, shadow_negative, shadow_avg): (i64, i64, i64, f64) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN return_percent > 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN return_percent < 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(AVG(return_percent), 0)
             FROM shadow_strategy_trials WHERE status = 'closed'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap_or((0, 0, 0, 0.0));

    let risk_gate = connection.query_row(
        "SELECT mode, real_execution_enabled, withdrawal_enabled, leverage_enabled,
                max_order_notional_usdt, max_daily_loss_usdt, max_open_positions, note
         FROM risk_policy WHERE id = 1",
        [],
        |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)? != 0,
            row.get::<_, i64>(2)? != 0,
            row.get::<_, i64>(3)? != 0,
            row.get::<_, f64>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, String>(7)?,
        )),
    ).ok();

    let kill_switch = connection.query_row(
        "SELECT latched, reason, source, updated_at FROM execution_guard WHERE id = 1",
        [],
        |row| Ok((
            row.get::<_, i64>(0)? != 0,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        )),
    ).ok();

    let reconciliation = connection
        .query_row(
            "SELECT status, detail, checked_at FROM ledger_reconciliation WHERE venue = 'binance'",
            [],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            )),
        )
        .ok();

    let mut recent_research = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT symbol, attention_score, signal, last_price, spread_bps,
                return_1h_percent, return_4h_percent, volume_acceleration, scanned_at
         FROM research_history
         ORDER BY id DESC LIMIT 30"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            Ok(serde_json::json!({
                "symbol": row.get::<_, String>(0)?,
                "attentionScore": row.get::<_, f64>(1)?,
                "signal": row.get::<_, String>(2)?,
                "lastPrice": row.get::<_, f64>(3)?,
                "spreadBps": row.get::<_, f64>(4)?,
                "return1hPercent": row.get::<_, f64>(5)?,
                "return4hPercent": row.get::<_, f64>(6)?,
                "volumeAcceleration": row.get::<_, f64>(7)?,
                "scannedAt": row.get::<_, String>(8)?
            }))
        }) {
            for row in rows.flatten() {
                recent_research.push(row);
            }
        }
    }

    let mut strategy_experiments = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT symbol, status, created_at, updated_at, observation_count, miss_count,
                best_attention_score, hypothesis, invalidation_rule
         FROM strategy_experiments
         ORDER BY updated_at DESC LIMIT 30"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            Ok(serde_json::json!({
                "symbol": row.get::<_, String>(0)?,
                "status": row.get::<_, String>(1)?,
                "createdAt": row.get::<_, String>(2)?,
                "updatedAt": row.get::<_, String>(3)?,
                "observationCount": row.get::<_, i64>(4)?,
                "missCount": row.get::<_, i64>(5)?,
                "bestAttentionScore": row.get::<_, f64>(6)?,
                "hypothesis": row.get::<_, String>(7)?,
                "invalidationRule": row.get::<_, String>(8)?
            }))
        }) {
            for row in rows.flatten() {
                strategy_experiments.push(row);
            }
        }
    }

    let mut ledger_events = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT venue, event_type, asset, amount, occurred_at, source
         FROM real_ledger_events
         ORDER BY occurred_at DESC LIMIT 60"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            Ok(serde_json::json!({
                "venue": row.get::<_, String>(0)?,
                "eventType": row.get::<_, String>(1)?,
                "asset": row.get::<_, String>(2)?,
                "amount": row.get::<_, f64>(3)?,
                "occurredAt": row.get::<_, String>(4)?,
                "source": row.get::<_, String>(5)?
            }))
        }) {
            for row in rows.flatten() {
                ledger_events.push(row);
            }
        }
    }

    let mut latest_balances = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT asset, free, locked, total, captured_at, source
         FROM account_balance_snapshots
         WHERE venue = 'binance'
           AND captured_at = (SELECT MAX(captured_at) FROM account_balance_snapshots WHERE venue = 'binance')
         ORDER BY total DESC, asset ASC"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            Ok(serde_json::json!({
                "asset": row.get::<_, String>(0)?,
                "free": row.get::<_, f64>(1)?,
                "locked": row.get::<_, f64>(2)?,
                "total": row.get::<_, f64>(3)?,
                "capturedAt": row.get::<_, String>(4)?,
                "source": row.get::<_, String>(5)?
            }))
        }) {
            for row in rows.flatten() {
                latest_balances.push(row);
            }
        }
    }

    let mut shadow_trials = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT symbol, signal, opened_at_ms, entry_price, horizon_minutes,
                attention_score, status, closed_at_ms, exit_price, return_percent
         FROM shadow_strategy_trials
         ORDER BY id DESC LIMIT 40"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            Ok(serde_json::json!({
                "symbol": row.get::<_, String>(0)?,
                "signal": row.get::<_, String>(1)?,
                "openedAtMs": row.get::<_, i64>(2)?,
                "entryPrice": row.get::<_, f64>(3)?,
                "horizonMinutes": row.get::<_, i64>(4)?,
                "attentionScore": row.get::<_, f64>(5)?,
                "status": row.get::<_, String>(6)?,
                "closedAtMs": row.get::<_, Option<i64>>(7)?,
                "exitPrice": row.get::<_, Option<f64>>(8)?,
                "returnPercent": row.get::<_, Option<f64>>(9)?
            }))
        }) {
            for row in rows.flatten() {
                shadow_trials.push(row);
            }
        }
    }

    let mut trade_intents = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT id, symbol, side, notional_usdt, rationale, source, status,
                real_execution_allowed, risk_reasons_json, created_at
         FROM trade_intents
         ORDER BY created_at DESC LIMIT 40"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            let risk_json: String = row.get(8)?;
            let risk_reasons = serde_json::from_str::<serde_json::Value>(&risk_json)
                .unwrap_or_else(|_| serde_json::json!([]));
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "symbol": row.get::<_, String>(1)?,
                "side": row.get::<_, String>(2)?,
                "notionalUsdt": row.get::<_, f64>(3)?,
                "rationale": row.get::<_, String>(4)?,
                "source": row.get::<_, String>(5)?,
                "status": row.get::<_, String>(6)?,
                "realExecutionAllowed": row.get::<_, i64>(7)? != 0,
                "riskReasons": risk_reasons,
                "createdAt": row.get::<_, String>(9)?
            }))
        }) {
            for row in rows.flatten() {
                trade_intents.push(row);
            }
        }
    }


    let mut decision_provider_benchmarks = Vec::new();
    if let Ok(mut statement) = connection.prepare(
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
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
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
        }) {
            for row in rows.flatten() {
                let direction_accuracy = if row.3 > 0 { row.4 as f64 / row.3 as f64 * 100.0 } else { 0.0 };
                let enter_positive_rate = if row.6 > 0 { row.7 as f64 / row.6 as f64 * 100.0 } else { 0.0 };
                decision_provider_benchmarks.push(serde_json::json!({
                    "provider": row.0,
                    "providerVersion": row.1,
                    "predictionCount": row.2,
                    "settledCount": row.3,
                    "correctDirectionCount": row.4,
                    "directionAccuracyPercent": (direction_accuracy * 100.0).round() / 100.0,
                    "enterCount": row.5,
                    "settledEnterCount": row.6,
                    "positiveEnterCount": row.7,
                    "enterPositiveRatePercent": (enter_positive_rate * 100.0).round() / 100.0,
                    "averageEnterReturn1hPercent": (row.8 * 1000.0).round() / 1000.0,
                    "averageLatencyMs": (row.9 * 100.0).round() / 100.0,
                    "estimatedCostUsd": (row.10 * 1_000_000.0).round() / 1_000_000.0
                }));
            }
        }
    }

    let mut decision_shadow_recent = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT p.provider, p.provider_version, s.symbol, p.direction, p.action,
                p.market_regime, p.risk_state, p.abnormal_state, p.signal_priority,
                p.confidence, p.confidence_kind, p.latency_ms, p.estimated_cost_usd,
                s.price_at_decision, s.price_5m, s.price_30m, s.price_1h, s.price_4h,
                s.return_5m, s.return_30m, s.return_1h, s.return_4h,
                s.actual_outcome, s.status, p.created_at, s.rule_engine_result
         FROM decision_shadow_predictions p
         JOIN decision_shadow_samples s ON s.sample_id = p.sample_id
         ORDER BY p.created_at DESC LIMIT 30"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            Ok(serde_json::json!({
                "provider": row.get::<_, String>(0)?,
                "providerVersion": row.get::<_, String>(1)?,
                "symbol": row.get::<_, String>(2)?,
                "direction": row.get::<_, String>(3)?,
                "action": row.get::<_, String>(4)?,
                "marketRegime": row.get::<_, String>(5)?,
                "riskState": row.get::<_, String>(6)?,
                "abnormalState": row.get::<_, i64>(7)? != 0,
                "signalPriority": row.get::<_, String>(8)?,
                "confidence": row.get::<_, f64>(9)?,
                "confidenceKind": row.get::<_, String>(10)?,
                "latencyMs": row.get::<_, i64>(11)?,
                "estimatedCostUsd": row.get::<_, f64>(12)?,
                "priceAtDecision": row.get::<_, f64>(13)?,
                "price5m": row.get::<_, Option<f64>>(14)?,
                "price30m": row.get::<_, Option<f64>>(15)?,
                "price1h": row.get::<_, Option<f64>>(16)?,
                "price4h": row.get::<_, Option<f64>>(17)?,
                "return5m": row.get::<_, Option<f64>>(18)?,
                "return30m": row.get::<_, Option<f64>>(19)?,
                "return1h": row.get::<_, Option<f64>>(20)?,
                "return4h": row.get::<_, Option<f64>>(21)?,
                "actualOutcome": row.get::<_, Option<String>>(22)?,
                "status": row.get::<_, String>(23)?,
                "createdAt": row.get::<_, String>(24)?,
                "ruleEngineResult": row.get::<_, String>(25)?
            }))
        }) {
            for row in rows.flatten() {
                decision_shadow_recent.push(row);
            }
        }
    }

    Ok(serde_json::json!({
        "viewMode": "full-status-mirror",
        "researchCount": research_count,
        "observingExperimentCount": observing_count,
        "realLedgerEventCount": ledger_count,
        "balanceSnapshotCount": snapshot_count,
        "decisionShadow": {
            "mode": "shadow-only",
            "sampleCount": decision_sample_count,
            "predictionCount": decision_prediction_count,
            "settledOutcomeCount": decision_settled_count,
            "externalProviderConfigured": false,
            "executionLinked": false,
            "providerBenchmarks": decision_provider_benchmarks,
            "recent": decision_shadow_recent
        },
        "shadowExperiments": {
            "open": shadow_open,
            "closed": shadow_closed,
            "positive": shadow_positive,
            "negative": shadow_negative,
            "averageReturnPercent": (shadow_avg * 1000.0).round() / 1000.0
        },
        "reconciliation": reconciliation.map(|value| serde_json::json!({
            "status": value.0,
            "detail": value.1,
            "checkedAt": value.2
        })),
        "executionGate": risk_gate.map(|value| serde_json::json!({
            "mode": value.0,
            "realExecutionEnabled": value.1,
            "withdrawalEnabled": value.2,
            "leverageEnabled": value.3,
            "riskLimitsConfigured": value.4 > 0.0 && value.5 > 0.0 && value.6 > 0,
            "maxOrderNotionalUsdt": value.4,
            "maxDailyLossUsdt": value.5,
            "maxOpenPositions": value.6,
            "note": value.7
        })),
        "killSwitch": kill_switch.map(|value| serde_json::json!({
            "latched": value.0,
            "reason": value.1,
            "source": value.2,
            "updatedAt": value.3
        })),
        "recentResearch": recent_research,
        "strategyExperiments": strategy_experiments,
        "ledgerEvents": ledger_events,
        "latestBalances": latest_balances,
        "shadowTrials": shadow_trials,
        "tradeIntents": trade_intents,
        "secretsIncluded": false,
        "remoteControlEnabled": false
    }))
}

fn write_json(stream: &mut TcpStream, status: &str, body: serde_json::Value) {
    let payload = body.to_string();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{payload}",
        payload.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn write_html(stream: &mut TcpStream, body: String) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn viewer_html() -> String {
    r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kardii Read Only</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:40px;max-width:760px;background:#f7f7f8;color:#171719}pre{white-space:pre-wrap;background:white;padding:18px;border-radius:16px;border:1px solid #ddd}small{color:#666}</style></head><body><h2>Kardii · Read Only</h2><small>本页面只读取运行状态，不提供下单、提现或修改账户的能力。</small><pre id="out">需要配对凭据。</pre><script>const token=location.hash.slice(1);if(token){location.hash="";const out=document.getElementById("out");async function load(){try{const r=await fetch("/status",{headers:{Authorization:"Bearer "+token},cache:"no-store"});out.textContent=JSON.stringify(await r.json(),null,2)}catch(e){out.textContent=String(e)}}load();setInterval(load,10000)}</script></body></html>"#.to_string()
}


async fn verify_remote_public_base(base_url: &str, token: &str) -> Result<(), String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("无法初始化远程 Kardii 检查：{error}"))?
        .get(format!("{}/status", base_url.trim_end_matches('/')))
        .bearer_auth(token)
        .header("Cache-Control", "no-store")
        .send()
        .await
        .map_err(|error| format!("无法连接远程 Kardii HTTPS 入口：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("远程 Kardii HTTPS 入口返回 HTTP {}", response.status()));
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("远程 Kardii 状态无法读取：{error}"))?;
    if payload.get("viewMode").and_then(|value| value.as_str()) != Some("full-status-mirror")
        || payload.get("secretsIncluded").and_then(|value| value.as_bool()) != Some(false)
        || payload.get("remoteControlEnabled").and_then(|value| value.as_bool()) != Some(false)
    {
        return Err("这个 HTTPS 地址没有返回安全的 Kardii 只读全状态镜像。".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn save_readonly_viewer_public_base(public_base: String) -> Result<ReadOnlyViewerStatus, String> {
    let normalized = normalize_remote_public_base(&public_base)?;
    let token = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .token
        .clone();
    verify_remote_public_base(&normalized, &token).await?;
    save_remote_public_base_keyring(&normalized)?;
    Ok(state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .status())
}

#[tauri::command]
pub async fn get_readonly_viewer_transport_status() -> Result<ReadOnlyTransportStatus, String> {
    let public_url = configured_remote_public_base().unwrap_or_default();
    if public_url.is_empty() {
        return Ok(ReadOnlyTransportStatus {
            configured: false,
            public_url,
            reachable: false,
            error: String::new(),
        });
    }
    let token = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .token
        .clone();
    match verify_remote_public_base(&public_url, &token).await {
        Ok(()) => Ok(ReadOnlyTransportStatus {
            configured: true,
            public_url,
            reachable: true,
            error: String::new(),
        }),
        Err(error) => Ok(ReadOnlyTransportStatus {
            configured: true,
            public_url,
            reachable: false,
            error,
        }),
    }
}

#[tauri::command]
pub fn delete_readonly_viewer_public_base() -> Result<ReadOnlyViewerStatus, String> {
    delete_remote_public_base_keyring()?;
    Ok(state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .status())
}

#[tauri::command]
pub fn readonly_viewer_pairing_link() -> Result<String, String> {
    let guard = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let status = guard.status();
    if !status.running {
        return Err("Kardii 只读状态服务尚未启动。".to_string());
    }
    let base = if status.remote_enabled {
        status.public_url.clone()
    } else {
        status.local_url.trim_end_matches('/').to_string()
    };
    Ok(format!("{base}/#{}", guard.token))
}

#[tauri::command]
pub fn open_readonly_viewer() -> Result<ReadOnlyViewerStatus, String> {
    let (status, token) = {
        let guard = state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        (guard.status(), guard.token.clone())
    };
    if !status.running {
        return Err("Kardii 只读状态服务尚未启动。".to_string());
    }
    let url = format!("{}#{}", status.local_url, token);
    open::that(&url).map_err(|error| format!("无法打开 Kardii 只读状态页：{error}"))?;
    Ok(status)
}

#[cfg(test)]
mod remote_public_base_tests {
    use super::*;

    #[test]
    fn remote_public_base_requires_https_except_loopback() {
        assert_eq!(
            normalize_remote_public_base("https://kardii.example/").unwrap(),
            "https://kardii.example"
        );
        assert!(normalize_remote_public_base("http://127.0.0.1:43199").is_ok());
        assert!(normalize_remote_public_base("http://kardii.example").is_err());
        assert!(normalize_remote_public_base("https://kardii.example/status").is_err());
        assert!(normalize_remote_public_base("https://user@kardii.example").is_err());
    }
}
