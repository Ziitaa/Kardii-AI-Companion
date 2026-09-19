
use rand::RngCore;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOnlyViewerStatus {
    pub running: bool,
    pub port: u16,
    pub bind_address: String,
    pub local_url: String,
    pub remote_enabled: bool,
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
        ReadOnlyViewerStatus {
            running: self.running,
            port: VIEWER_PORT,
            bind_address: "127.0.0.1".to_string(),
            local_url: format!("http://127.0.0.1:{VIEWER_PORT}/"),
            remote_enabled: false,
        }
    }
}

fn state() -> &'static Arc<Mutex<ViewerRuntime>> {
    static STATE: OnceLock<Arc<Mutex<ViewerRuntime>>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(Mutex::new(ViewerRuntime::new())))
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
        write_json(&mut stream, "200 OK", serde_json::json!({
            "app": "Kardii",
            "service": "readonly-viewer",
            "remoteEnabled": false
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

    let risk_gate = connection.query_row(
        "SELECT real_execution_enabled, max_order_notional_usdt, max_daily_loss_usdt, max_open_positions FROM risk_policy WHERE id = 1",
        [],
        |row| Ok((
            row.get::<_, i64>(0)? != 0,
            row.get::<_, f64>(1)?,
            row.get::<_, f64>(2)?,
            row.get::<_, i64>(3)?,
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

    let mut recent = Vec::new();
    if let Ok(mut statement) = connection.prepare(
        "SELECT symbol, attention_score, scanned_at
         FROM research_history
         ORDER BY id DESC LIMIT 5"
    ) {
        if let Ok(rows) = statement.query_map([], |row| {
            Ok(serde_json::json!({
                "symbol": row.get::<_, String>(0)?,
                "attentionScore": row.get::<_, f64>(1)?,
                "scannedAt": row.get::<_, String>(2)?
            }))
        }) {
            for row in rows.flatten() {
                recent.push(row);
            }
        }
    }

    Ok(serde_json::json!({
        "researchCount": research_count,
        "observingExperimentCount": observing_count,
        "realLedgerEventCount": ledger_count,
        "balanceSnapshotCount": snapshot_count,
        "reconciliation": reconciliation.map(|value| serde_json::json!({
            "status": value.0,
            "detail": value.1,
            "checkedAt": value.2
        })),
        "recentResearch": recent,
        "executionGate": risk_gate.map(|value| serde_json::json!({
            "realExecutionEnabled": value.0,
            "riskLimitsConfigured": value.1 > 0.0 && value.2 > 0.0 && value.3 > 0,
            "maxOrderNotionalUsdt": value.1,
            "maxDailyLossUsdt": value.2,
            "maxOpenPositions": value.3
        })),
        "killSwitch": kill_switch.map(|value| serde_json::json!({
            "latched": value.0,
            "reason": value.1,
            "source": value.2,
            "updatedAt": value.3
        })),
        "remoteEnabled": false
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
