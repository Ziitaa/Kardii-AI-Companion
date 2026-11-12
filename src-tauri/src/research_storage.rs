//! Independent SQLite store for general external research.
//! This initialization never deletes or rewrites the legacy trading database.
use rusqlite::{Connection, params};
use std::path::Path;

pub fn initialize_research_storage(app_data_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| format!("无法创建研究数据目录：{e}"))?;
    let destination = app_data_dir.join("kardii-research.sqlite3");
    let mut db = Connection::open(&destination).map_err(|e| format!("无法打开独立研究数据库：{e}"))?;
    db.execute_batch(r#"
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS external_research_items (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               source_id TEXT NOT NULL,
               author TEXT NOT NULL,
               source_type TEXT NOT NULL,
               source_tier TEXT NOT NULL,
               canonical_url TEXT NOT NULL UNIQUE,
               title TEXT NOT NULL,
               summary TEXT NOT NULL,
               published_at TEXT NOT NULL,
               retrieved_at TEXT NOT NULL,
               raw_content TEXT NOT NULL,
               content_hash TEXT NOT NULL,
               normalized_hash TEXT NOT NULL,
               duplicate_of INTEGER,
               assets_json TEXT NOT NULL,
               indicators_json TEXT NOT NULL,
               tools_json TEXT NOT NULL,
               claims_json TEXT NOT NULL,
               evidence_links_json TEXT NOT NULL,
               topic TEXT NOT NULL,
               possible_commercial_relationship TEXT NOT NULL,
               verification_status TEXT NOT NULL,
               linked_experiment_id TEXT NOT NULL,
               hypothesis TEXT NOT NULL,
               research_result TEXT NOT NULL,
               disposition TEXT NOT NULL,
               rejection_reason TEXT NOT NULL,
               ingestion_provider TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               FOREIGN KEY(duplicate_of) REFERENCES external_research_items(id)
             );
             CREATE INDEX IF NOT EXISTS external_research_status_time
               ON external_research_items(verification_status, retrieved_at DESC);
             CREATE INDEX IF NOT EXISTS external_research_source_topic
               ON external_research_items(source_id, topic, retrieved_at DESC);
             CREATE INDEX IF NOT EXISTS external_research_content_hash
               ON external_research_items(content_hash);
             CREATE INDEX IF NOT EXISTS external_research_normalized_hash
               ON external_research_items(normalized_hash);
             
        CREATE TABLE IF NOT EXISTS research_verification_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          research_item_id INTEGER NOT NULL,
          verification_status TEXT NOT NULL,
          research_result TEXT NOT NULL,
          rejection_reason TEXT NOT NULL,
          linked_experiment_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(research_item_id) REFERENCES external_research_items(id) ON DELETE CASCADE
        );
    "#).map_err(|e| format!("无法初始化独立研究数据表：{e}"))?;
    let legacy = app_data_dir.join("kardii-trading.sqlite3");
    if !legacy.is_file() { return Ok(()); }
    // ATTACH is read-only: preserve the source database and all original IDs.
    let uri = format!("file:{}?mode=ro", legacy.to_string_lossy());
    db.execute("ATTACH DATABASE ?1 AS legacy", params![uri])
        .map_err(|e| format!("无法读取旧研究数据库：{e}"))?;
    let result = (|| -> Result<(), String> {
        let exists: i64 = db.query_row(
            "SELECT COUNT(*) FROM legacy.sqlite_master WHERE type='table' AND name='external_research_items'",
            [], |row| row.get(0)
        ).map_err(|e| e.to_string())?;
        if exists == 0 { return Ok(()); }
        let tx = db.transaction().map_err(|e| e.to_string())?;
        // Copy only missing IDs; repeated startup is idempotent. Never overwrite
        // newer research stored in the independent database.
        tx.execute_batch(r#"
            INSERT OR IGNORE INTO external_research_items
            SELECT * FROM legacy.external_research_items;
        "#).map_err(|e| format!("无法迁移研究记录：{e}"))?;
        let has_events: i64 = tx.query_row(
            "SELECT COUNT(*) FROM legacy.sqlite_master WHERE type='table' AND name='research_verification_events'",
            [], |row| row.get(0)
        ).map_err(|e| e.to_string())?;
        if has_events != 0 {
            tx.execute_batch("INSERT OR IGNORE INTO research_verification_events SELECT * FROM legacy.research_verification_events;")
                .map_err(|e| format!("无法迁移研究验证记录：{e}"))?;
        }
        tx.commit().map_err(|e| format!("无法提交研究数据迁移：{e}"))
    })();
    let _ = db.execute_batch("DETACH DATABASE legacy;");
    result
}
