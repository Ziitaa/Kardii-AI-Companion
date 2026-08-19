use rusqlite::{params, Connection, OptionalExtension, Transaction, MAIN_DB};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const STORAGE_SCHEMA_VERSION: i64 = 1;
const MAX_STORAGE_ENTRIES: usize = 256;
const MAX_STORAGE_KEY_BYTES: usize = 160;
const MAX_STORAGE_VALUE_BYTES: usize = 64 * 1024 * 1024;
const MAX_REVISIONS_PER_KEY: i64 = 10;
const MAX_TOTAL_REVISIONS: i64 = 1_000;
const MAX_SNAPSHOTS: usize = 5;
const AUTO_SNAPSHOT_INTERVAL_MS: i64 = 24 * 60 * 60 * 1_000;

const EPHEMERAL_KEYS: &[&str] = &[
    "kardii-workbench-open-target-v1",
    "kardii-agent-open-target-v1",
    "kardii-chat-open-target-v1",
    "kardii-browser-context-v1",
    "kardii-browser-agent-request-v1",
    "kardii-browser-capture-seen-v1",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub id: String,
    pub kind: String,
    pub created_at: i64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub ready: bool,
    pub schema_version: i64,
    pub item_count: i64,
    pub value_bytes: i64,
    pub database_bytes: u64,
    pub revision_count: i64,
    pub migrated_from_webview: bool,
    pub migrated_item_count: i64,
    pub integrity: String,
    pub last_write_at: i64,
    pub snapshot_count: usize,
    pub latest_snapshot_id: String,
    pub latest_snapshot_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageBootstrap {
    pub entries: Vec<StorageEntry>,
    pub status: StorageStatus,
}

pub struct StorageState {
    connection: Mutex<Connection>,
    database_path: PathBuf,
    snapshot_dir: PathBuf,
}

impl StorageState {
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(app_data_dir)
            .map_err(|error| format!("无法创建 Kardii 数据目录：{error}"))?;
        let snapshot_dir = app_data_dir.join("state-snapshots");
        fs::create_dir_all(&snapshot_dir)
            .map_err(|error| format!("无法创建 Kardii 恢复点目录：{error}"))?;
        let database_path = app_data_dir.join("kardii-state.sqlite3");
        let connection = Connection::open(&database_path)
            .map_err(|error| format!("无法打开 Kardii SQLite 数据库：{error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("无法设置 SQLite 等待时间：{error}"))?;
        initialize_schema(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            database_path,
            snapshot_dir,
        })
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS app_meta (
               key TEXT PRIMARY KEY NOT NULL,
               value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS app_state (
               key TEXT PRIMARY KEY NOT NULL,
               value TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS state_revisions (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               key TEXT NOT NULL,
               value TEXT,
               operation TEXT NOT NULL CHECK(operation IN ('set', 'remove', 'clear')),
               created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS state_revisions_key_created
               ON state_revisions(key, created_at DESC);",
        )
        .map_err(|error| format!("无法初始化 Kardii SQLite 数据库：{error}"))?;
    connection
        .pragma_update(None, "user_version", STORAGE_SCHEMA_VERSION)
        .map_err(|error| format!("无法写入 SQLite 结构版本：{error}"))?;
    connection
        .execute(
            "INSERT INTO app_meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [STORAGE_SCHEMA_VERSION.to_string()],
        )
        .map_err(|error| format!("无法记录 SQLite 结构版本：{error}"))?;
    Ok(())
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > MAX_STORAGE_KEY_BYTES
        || !key.starts_with("kardii-")
        || EPHEMERAL_KEYS.contains(&key)
    {
        return Err("这个本机状态键不允许写入 SQLite。".into());
    }
    let lower = key.to_ascii_lowercase();
    if ["password", "api-key", "apikey", "credential", "bearer-token", "oauth-token"]
        .iter()
        .any(|word| lower.contains(word))
    {
        return Err("密码、API Key 和登录凭据不能写入 SQLite。".into());
    }
    Ok(())
}

fn validate_entry(entry: &StorageEntry) -> Result<(), String> {
    validate_key(&entry.key)?;
    if entry.value.len() > MAX_STORAGE_VALUE_BYTES {
        return Err(format!("“{}”超过本机数据库单项大小限制。", entry.key));
    }
    Ok(())
}

fn meta_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |row| row.get(0))
        .optional()
        .map_err(|error| format!("无法读取 SQLite 元数据：{error}"))
}

fn set_meta(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO app_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|error| format!("无法写入 SQLite 元数据：{error}"))?;
    Ok(())
}

fn load_entries(connection: &Connection) -> Result<Vec<StorageEntry>, String> {
    let mut statement = connection
        .prepare("SELECT key, value FROM app_state ORDER BY key")
        .map_err(|error| format!("无法准备读取本机数据：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(StorageEntry {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|error| format!("无法读取本机数据：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法整理本机数据：{error}"))
}

fn record_revision(
    transaction: &Transaction<'_>,
    key: &str,
    value: Option<&str>,
    operation: &str,
    created_at: i64,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO state_revisions(key, value, operation, created_at)
             VALUES(?1, ?2, ?3, ?4)",
            params![key, value, operation, created_at],
        )
        .map_err(|error| format!("无法建立本机数据修订记录：{error}"))?;
    transaction
        .execute(
            "DELETE FROM state_revisions
             WHERE key = ?1 AND id NOT IN (
               SELECT id FROM state_revisions WHERE key = ?1
               ORDER BY id DESC LIMIT ?2
             )",
            params![key, MAX_REVISIONS_PER_KEY],
        )
        .map_err(|error| format!("无法整理本机数据修订记录：{error}"))?;
    transaction
        .execute(
            "DELETE FROM state_revisions WHERE id NOT IN (
               SELECT id FROM state_revisions ORDER BY id DESC LIMIT ?1
             )",
            [MAX_TOTAL_REVISIONS],
        )
        .map_err(|error| format!("无法限制本机数据修订数量：{error}"))?;
    Ok(())
}

fn snapshot_timestamp(file_name: &str) -> i64 {
    file_name
        .strip_suffix(".sqlite3")
        .and_then(|value| value.rsplit('-').next())
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}

fn snapshot_kind(file_name: &str) -> String {
    file_name
        .strip_prefix("kardii-")
        .and_then(|value| value.rsplit_once('-').map(|parts| parts.0))
        .unwrap_or("manual")
        .to_string()
}

fn list_snapshots(snapshot_dir: &Path) -> Result<Vec<StorageSnapshot>, String> {
    let mut snapshots = Vec::new();
    for item in fs::read_dir(snapshot_dir)
        .map_err(|error| format!("无法读取 Kardii 恢复点：{error}"))?
    {
        let item = item.map_err(|error| format!("无法读取 Kardii 恢复点：{error}"))?;
        let file_name = item.file_name().to_string_lossy().to_string();
        if !file_name.starts_with("kardii-") || !file_name.ends_with(".sqlite3") {
            continue;
        }
        let metadata = item
            .metadata()
            .map_err(|error| format!("无法读取恢复点大小：{error}"))?;
        snapshots.push(StorageSnapshot {
            id: file_name.clone(),
            kind: snapshot_kind(&file_name),
            created_at: snapshot_timestamp(&file_name),
            size_bytes: metadata.len(),
        });
    }
    snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(snapshots)
}

fn prune_snapshots(snapshot_dir: &Path) -> Result<(), String> {
    for snapshot in list_snapshots(snapshot_dir)?.into_iter().skip(MAX_SNAPSHOTS) {
        fs::remove_file(snapshot_dir.join(snapshot.id))
            .map_err(|error| format!("无法整理旧恢复点：{error}"))?;
    }
    Ok(())
}

fn create_snapshot_locked(
    connection: &Connection,
    snapshot_dir: &Path,
    kind: &str,
    prune: bool,
) -> Result<StorageSnapshot, String> {
    let created_at = now_millis();
    let id = format!("kardii-{kind}-{created_at}.sqlite3");
    let path = snapshot_dir.join(&id);
    connection
        .backup(MAIN_DB, &path, None)
        .map_err(|error| format!("无法建立 SQLite 恢复点：{error}"))?;
    if prune {
        prune_snapshots(snapshot_dir)?;
    }
    let size_bytes = fs::metadata(&path).map(|value| value.len()).unwrap_or_default();
    Ok(StorageSnapshot {
        id,
        kind: kind.to_string(),
        created_at,
        size_bytes,
    })
}

fn maybe_create_automatic_snapshot(
    connection: &Connection,
    snapshot_dir: &Path,
) -> Result<(), String> {
    let item_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM app_state", [], |row| row.get(0))
        .map_err(|error| format!("无法统计本机数据：{error}"))?;
    if item_count == 0 {
        return Ok(());
    }
    let now = now_millis();
    let last = meta_value(connection, "last_auto_snapshot_at")?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_default();
    if now.saturating_sub(last) < AUTO_SNAPSHOT_INTERVAL_MS {
        return Ok(());
    }
    let snapshot = create_snapshot_locked(connection, snapshot_dir, "auto", true)?;
    set_meta(connection, "last_auto_snapshot_at", &snapshot.created_at.to_string())?;
    Ok(())
}

fn database_size(path: &Path) -> u64 {
    let mut size = fs::metadata(path).map(|value| value.len()).unwrap_or_default();
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", path.display()));
        size = size.saturating_add(fs::metadata(sidecar).map(|value| value.len()).unwrap_or_default());
    }
    size
}

fn status_locked(
    connection: &Connection,
    database_path: &Path,
    snapshot_dir: &Path,
) -> Result<StorageStatus, String> {
    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| format!("无法检查 SQLite 完整性：{error}"))?;
    let (item_count, value_bytes, last_write_at): (i64, i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(length(value)), 0), COALESCE(MAX(updated_at), 0)
             FROM app_state",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("无法统计 SQLite 数据：{error}"))?;
    let revision_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM state_revisions", [], |row| row.get(0))
        .map_err(|error| format!("无法统计 SQLite 修订记录：{error}"))?;
    let migrated_item_count = meta_value(connection, "migrated_item_count")?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_default();
    let snapshots = list_snapshots(snapshot_dir)?;
    let latest = snapshots.first();
    Ok(StorageStatus {
        ready: integrity.eq_ignore_ascii_case("ok"),
        schema_version: STORAGE_SCHEMA_VERSION,
        item_count,
        value_bytes,
        database_bytes: database_size(database_path),
        revision_count,
        migrated_from_webview: meta_value(connection, "webview_migration_completed")?.is_some(),
        migrated_item_count,
        integrity,
        last_write_at,
        snapshot_count: snapshots.len(),
        latest_snapshot_id: latest.map(|value| value.id.clone()).unwrap_or_default(),
        latest_snapshot_at: latest.map(|value| value.created_at).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn storage_bootstrap(
    legacy_entries: Vec<StorageEntry>,
    state: tauri::State<'_, StorageState>,
) -> Result<StorageBootstrap, String> {
    if legacy_entries.len() > MAX_STORAGE_ENTRIES {
        return Err("WebView 本机数据项目过多，已停止自动迁移以保护原数据。".into());
    }
    for entry in &legacy_entries {
        validate_entry(entry)?;
    }

    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "Kardii SQLite 数据库暂时不可用。".to_string())?;
    let migration_completed = meta_value(&connection, "webview_migration_completed")?.is_some();
    if !migration_completed {
        let existing_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM app_state", [], |row| row.get(0))
            .map_err(|error| format!("无法检查 SQLite 迁移状态：{error}"))?;
        let mut imported = 0_i64;
        if existing_count == 0 && !legacy_entries.is_empty() {
            let migrated_at = now_millis();
            let transaction = connection
                .transaction()
                .map_err(|error| format!("无法开始 SQLite 数据迁移：{error}"))?;
            for entry in &legacy_entries {
                transaction
                    .execute(
                        "INSERT INTO app_state(key, value, updated_at) VALUES(?1, ?2, ?3)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                        params![entry.key, entry.value, migrated_at],
                    )
                    .map_err(|error| format!("无法迁移“{}”：{error}", entry.key))?;
                imported += 1;
            }
            transaction
                .commit()
                .map_err(|error| format!("无法完成 SQLite 数据迁移：{error}"))?;
        }
        set_meta(&connection, "webview_migration_completed", &now_millis().to_string())?;
        set_meta(&connection, "migrated_item_count", &imported.to_string())?;
        if imported > 0 {
            let snapshot = create_snapshot_locked(&connection, &state.snapshot_dir, "migration", true)?;
            set_meta(
                &connection,
                "last_auto_snapshot_at",
                &snapshot.created_at.to_string(),
            )?;
        }
    }

    maybe_create_automatic_snapshot(&connection, &state.snapshot_dir)?;
    let entries = load_entries(&connection)?;
    let status = status_locked(&connection, &state.database_path, &state.snapshot_dir)?;
    Ok(StorageBootstrap { entries, status })
}

#[tauri::command]
pub fn storage_set(
    key: String,
    value: String,
    state: tauri::State<'_, StorageState>,
) -> Result<(), String> {
    let entry = StorageEntry { key, value };
    validate_entry(&entry)?;
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "Kardii SQLite 数据库暂时不可用。".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始写入 SQLite：{error}"))?;
    let previous: Option<String> = transaction
        .query_row(
            "SELECT value FROM app_state WHERE key = ?1",
            [&entry.key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("无法读取 SQLite 旧值：{error}"))?;
    if previous.as_deref() != Some(entry.value.as_str()) {
        let updated_at = now_millis();
        if let Some(previous) = previous.as_deref() {
            record_revision(&transaction, &entry.key, Some(previous), "set", updated_at)?;
        }
        transaction
            .execute(
                "INSERT INTO app_state(key, value, updated_at) VALUES(?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![entry.key, entry.value, updated_at],
            )
            .map_err(|error| format!("无法写入 SQLite：{error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交 SQLite 写入：{error}"))
}

#[tauri::command]
pub fn storage_remove(
    key: String,
    state: tauri::State<'_, StorageState>,
) -> Result<(), String> {
    validate_key(&key)?;
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "Kardii SQLite 数据库暂时不可用。".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始删除 SQLite 数据：{error}"))?;
    let previous: Option<String> = transaction
        .query_row("SELECT value FROM app_state WHERE key = ?1", [&key], |row| row.get(0))
        .optional()
        .map_err(|error| format!("无法读取待删除的 SQLite 数据：{error}"))?;
    if let Some(previous) = previous.as_deref() {
        record_revision(&transaction, &key, Some(previous), "remove", now_millis())?;
        transaction
            .execute("DELETE FROM app_state WHERE key = ?1", [&key])
            .map_err(|error| format!("无法删除 SQLite 数据：{error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交 SQLite 删除：{error}"))
}

#[tauri::command]
pub fn storage_clear(state: tauri::State<'_, StorageState>) -> Result<(), String> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "Kardii SQLite 数据库暂时不可用。".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始清空 SQLite 数据：{error}"))?;
    let entries = {
        let mut statement = transaction
            .prepare("SELECT key, value FROM app_state")
            .map_err(|error| format!("无法读取待清空的 SQLite 数据：{error}"))?;
        let rows = statement
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|error| format!("无法读取待清空的 SQLite 数据：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法整理待清空的 SQLite 数据：{error}"))?
    };
    let timestamp = now_millis();
    for (key, value) in entries {
        record_revision(&transaction, &key, Some(&value), "clear", timestamp)?;
    }
    transaction
        .execute("DELETE FROM app_state", [])
        .map_err(|error| format!("无法清空 SQLite 数据：{error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交 SQLite 清空：{error}"))
}

#[tauri::command]
pub fn storage_status(state: tauri::State<'_, StorageState>) -> Result<StorageStatus, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Kardii SQLite 数据库暂时不可用。".to_string())?;
    status_locked(&connection, &state.database_path, &state.snapshot_dir)
}

#[tauri::command]
pub fn storage_create_snapshot(
    state: tauri::State<'_, StorageState>,
) -> Result<StorageStatus, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Kardii SQLite 数据库暂时不可用。".to_string())?;
    create_snapshot_locked(&connection, &state.snapshot_dir, "manual", true)?;
    status_locked(&connection, &state.database_path, &state.snapshot_dir)
}

fn valid_snapshot_id(value: &str) -> bool {
    value.starts_with("kardii-")
        && value.ends_with(".sqlite3")
        && !value.contains('/')
        && !value.contains('\\')
        && value.len() <= 100
}

#[tauri::command]
pub fn storage_restore_snapshot(
    snapshot_id: String,
    state: tauri::State<'_, StorageState>,
) -> Result<StorageBootstrap, String> {
    if !valid_snapshot_id(&snapshot_id) {
        return Err("恢复点名称无效。".into());
    }
    let source = state.snapshot_dir.join(&snapshot_id);
    if !source.is_file() {
        return Err("没有找到这个本机恢复点。".into());
    }
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "Kardii SQLite 数据库暂时不可用。".to_string())?;
    let safety = create_snapshot_locked(&connection, &state.snapshot_dir, "pre-restore", false)?;
    if let Err(error) = connection.restore(
        MAIN_DB,
        &source,
        None::<fn(rusqlite::backup::Progress)>,
    ) {
        let _ = connection.restore(
            MAIN_DB,
            state.snapshot_dir.join(&safety.id),
            None::<fn(rusqlite::backup::Progress)>,
        );
        let _ = prune_snapshots(&state.snapshot_dir);
        return Err(format!("恢复 SQLite 数据失败，已保留恢复前数据：{error}"));
    }
    initialize_schema(&connection)?;
    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| format!("恢复后无法检查 SQLite 数据：{error}"))?;
    if !integrity.eq_ignore_ascii_case("ok") {
        let _ = connection.restore(
            MAIN_DB,
            state.snapshot_dir.join(&safety.id),
            None::<fn(rusqlite::backup::Progress)>,
        );
        let _ = prune_snapshots(&state.snapshot_dir);
        return Err("恢复点完整性检查失败，已退回恢复前状态。".into());
    }
    set_meta(&connection, "last_restore_at", &now_millis().to_string())?;
    prune_snapshots(&state.snapshot_dir)?;
    let entries = load_entries(&connection)?;
    let status = status_locked(&connection, &state.database_path, &state.snapshot_dir)?;
    Ok(StorageBootstrap { entries, status })
}
