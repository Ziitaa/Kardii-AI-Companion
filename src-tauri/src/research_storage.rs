//! Independent SQLite store for general external research.
//! This initialization never deletes or rewrites the legacy trading database.
use rusqlite::{Connection, params};
use std::path::Path;
use std::collections::HashSet;
use sha2::{Digest, Sha256};
use crate::research_types::ExternalResearchItem;

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
    db.execute("ATTACH DATABASE ?1 AS legacy", params![legacy.to_string_lossy().to_string()])
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

pub(crate) fn external_research_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExternalResearchItem> {
    let assets_json: String = row.get(13)?;
    let indicators_json: String = row.get(14)?;
    let tools_json: String = row.get(15)?;
    let claims_json: String = row.get(16)?;
    let evidence_links_json: String = row.get(17)?;
    Ok(ExternalResearchItem {
        id: row.get(0)?,
        source_id: row.get(1)?,
        author: row.get(2)?,
        source_type: row.get(3)?,
        source_tier: row.get(4)?,
        canonical_url: row.get(5)?,
        title: row.get(6)?,
        summary: row.get(7)?,
        published_at: row.get(8)?,
        retrieved_at: row.get(9)?,
        raw_content: row.get(10)?,
        content_hash: row.get(11)?,
        duplicate_of: row.get(12)?,
        topic: row.get(18)?,
        assets: serde_json::from_str(&assets_json).unwrap_or_default(),
        mentioned_indicators: serde_json::from_str(&indicators_json).unwrap_or_default(),
        mentioned_tools: serde_json::from_str(&tools_json).unwrap_or_default(),
        extracted_claims: serde_json::from_str(&claims_json).unwrap_or_else(|_| serde_json::json!([])),
        evidence_links: serde_json::from_str(&evidence_links_json).unwrap_or_default(),
        possible_commercial_relationship: row.get(19)?,
        verification_status: row.get(20)?,
        linked_experiment_id: row.get(21)?,
        hypothesis: row.get(22)?,
        research_result: row.get(23)?,
        disposition: row.get(24)?,
        rejection_reason: row.get(25)?,
        ingestion_provider: row.get(26)?,
        created_at: row.get(27)?,
        updated_at: row.get(28)?,
    })
}

pub(crate) fn external_research_by_id(
    connection: &Connection,
    id: i64,
) -> Result<ExternalResearchItem, String> {
    connection
        .query_row(
            "SELECT
               id, source_id, author, source_type, source_tier, canonical_url, title,
               summary, published_at, retrieved_at, raw_content, content_hash, duplicate_of,
               assets_json, indicators_json, tools_json, claims_json, evidence_links_json,
               topic, possible_commercial_relationship, verification_status,
               linked_experiment_id, hypothesis, research_result, disposition,
               rejection_reason, ingestion_provider, created_at, updated_at
             FROM external_research_items WHERE id = ?1",
            [id],
            external_research_from_row,
        )
        .map_err(|error| format!("无法读取 External Research item：{error}"))
}


pub(crate) fn canonical_external_url(raw: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(raw.trim())
        .map_err(|_| "External Research URL 格式不正确。".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("External Research 只接受公开 http/https URL，且不能包含用户名或密码。".to_string());
    }
    url.set_fragment(None);
    if url.path() != "/" && url.path().ends_with('/') {
        let trimmed_path = url.path().trim_end_matches('/').to_string();
        url.set_path(&trimmed_path);
    }

    let mut pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| {
            let lower = key.to_ascii_lowercase();
            !lower.starts_with("utm_")
                && !matches!(lower.as_str(), "gclid" | "fbclid" | "ref" | "ref_src")
        })
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    pairs.sort();
    url.set_query(None);
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs.iter().map(|(key, value)| (key, value)));
    }
    Ok(url.to_string())
}

pub(crate) fn normalized_external_content(value: &str) -> String {
    let mut output = String::new();
    let mut previous_space = true;
    for character in value.chars() {
        if character.is_alphanumeric() {
            for lower in character.to_lowercase() {
                output.push(lower);
            }
            previous_space = false;
        } else if !previous_space {
            output.push(' ');
            previous_space = true;
        }
    }
    output.trim().to_string()
}

pub(crate) fn external_sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub(crate) fn clean_external_list(values: Vec<String>, max_items: usize, max_chars: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().chars().take(max_chars).collect::<String>())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.to_ascii_lowercase()))
        .take(max_items)
        .collect()
}

pub(crate) fn valid_verification_status(value: &str) -> bool {
    matches!(
        value,
        "NEW" | "TRIAGED" | "VERIFYING" | "SUPPORTED" | "REJECTED" | "UNRESOLVED"
    )
}

