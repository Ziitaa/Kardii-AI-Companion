//! Transitional research service boundary.
//! Research commands use this service rather than referencing TradingRuntimeState.
//! The legacy SQLite persistence is delegated temporarily; migration is pending.
use crate::research_types::{ExternalResearchAnalysisUpdate, ExternalResearchItem, ExternalResearchUpsert};
use crate::trading::TradingRuntimeState;
use crate::research_storage::external_research_from_row;
use rusqlite::{Connection, params, OptionalExtension};
use chrono::Utc;
use crate::research_storage::{canonical_external_url, external_sha256, normalized_external_content, external_research_by_id};
use std::path::PathBuf;

#[derive(Clone)]
pub struct ResearchState {
    legacy: TradingRuntimeState,
    database_path: PathBuf,
}

impl ResearchState {
    pub fn new(legacy: TradingRuntimeState, database_path: PathBuf) -> Self { Self { legacy, database_path } }

    fn with_independent_database<T>(&self, action: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let db = Connection::open(&self.database_path)
            .map_err(|e| format!("无法打开独立研究数据库：{e}"))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
            .map_err(|e| format!("无法配置独立研究数据库：{e}"))?;
        action(&db)
    }

    pub fn upsert_independent_research_item(
        &self,
        input: ExternalResearchUpsert,
    ) -> Result<ExternalResearchItem, String> {
        let canonical_url = canonical_external_url(&input.canonical_url)?;
        let raw_content = input.raw_content.trim().chars().take(120_000).collect::<String>();
        if raw_content.chars().count() < 12 {
            return Err("External Research 内容太短，无法建立可验证研究记录。".to_string());
        }
        let content_hash = external_sha256(&raw_content);
        let normalized_hash = external_sha256(&normalized_external_content(&raw_content));
        let now = Utc::now().to_rfc3339();

        self.with_independent_database(|connection| {
            if let Some(existing_id) = connection
                .query_row(
                    "SELECT id FROM external_research_items WHERE canonical_url = ?1",
                    [&canonical_url],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| format!("无法检查 External Research URL 去重：{error}"))?
            {
                return external_research_by_id(connection, existing_id);
            }

            let duplicate_of = connection
                .query_row(
                    "SELECT id FROM external_research_items
                     WHERE content_hash = ?1 OR normalized_hash = ?2
                     ORDER BY id ASC LIMIT 1",
                    params![content_hash, normalized_hash],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| format!("无法检查 External Research 内容去重：{error}"))?;

            connection.execute(
                "INSERT INTO external_research_items(
                   source_id, author, source_type, source_tier, canonical_url, title, summary,
                   published_at, retrieved_at, raw_content, content_hash, normalized_hash,
                   duplicate_of, assets_json, indicators_json, tools_json, claims_json,
                   evidence_links_json, topic, possible_commercial_relationship,
                   verification_status, linked_experiment_id, hypothesis, research_result,
                   disposition, rejection_reason, ingestion_provider, created_at, updated_at
                 ) VALUES(
                   ?1, ?2, ?3, 'unknown', ?4, ?5, '', ?6, ?7, ?8, ?9, ?10, ?11,
                   '[]', '[]', '[]', '[]', '[]', 'unclassified', 'unknown',
                   'NEW', '', '', '', 'unresolved', '', ?12, ?7, ?7
                 )",
                params![
                    input.source_id.trim().chars().take(200).collect::<String>(),
                    input.author.trim().chars().take(200).collect::<String>(),
                    input.source_type.trim().chars().take(80).collect::<String>(),
                    canonical_url,
                    input.title.trim().chars().take(500).collect::<String>(),
                    input.published_at.trim().chars().take(120).collect::<String>(),
                    now,
                    raw_content,
                    content_hash,
                    normalized_hash,
                    duplicate_of,
                    input.ingestion_provider.trim().chars().take(80).collect::<String>(),
                ],
            ).map_err(|error| format!("无法保存 External Research item：{error}"))?;

            external_research_by_id(connection, connection.last_insert_rowid())
        })
    }

    pub fn upsert_external_research_item(&self, item: ExternalResearchUpsert) -> Result<ExternalResearchItem, String> {
        self.legacy.upsert_external_research_item(item)
    }

    pub fn load_independent_research_item(&self, id: i64) -> Result<ExternalResearchItem, String> {
        let db = Connection::open(&self.database_path).map_err(|e| format!("无法打开研究数据库：{e}"))?;
        crate::research_storage::external_research_by_id(&db, id)
    }

    // Keep command reads on the legacy store until writes are migrated too.
    // Mixing independent reads with legacy writes would hide new changes.
    pub fn load_external_research_item(&self, id: i64) -> Result<ExternalResearchItem, String> {
        self.legacy.load_external_research_item(id)
    }

    pub fn list_external_research_items(&self, limit: usize, verification_status: Option<String>) -> Result<Vec<ExternalResearchItem>, String> {
        self.legacy.list_external_research_items(limit, verification_status)
    }

    pub fn apply_external_research_analysis(&self, id: i64, update: ExternalResearchAnalysisUpdate) -> Result<ExternalResearchItem, String> {
        self.legacy.apply_external_research_analysis(id, update)
    }
    pub fn list_independent_research_items(&self, limit: usize, verification_status: Option<String>) -> Result<Vec<ExternalResearchItem>, String> {
        let db = Connection::open(&self.database_path).map_err(|e| format!("无法打开研究数据库：{e}"))?;
        let status = verification_status
            .map(|value| value.trim().to_uppercase())
            .filter(|value| matches!(value.as_str(), "NEW" | "TRIAGED" | "VERIFYING" | "SUPPORTED" | "REJECTED" | "UNRESOLVED"));
        let select = "SELECT id, source_id, author, source_type, source_tier, canonical_url, title,
            summary, published_at, retrieved_at, raw_content, content_hash, duplicate_of,
            assets_json, indicators_json, tools_json, claims_json, evidence_links_json,
            topic, possible_commercial_relationship, verification_status,
            linked_experiment_id, hypothesis, research_result, disposition,
            rejection_reason, ingestion_provider, created_at, updated_at
            FROM external_research_items";
        let sql = if status.is_some() {
            format!("{select} WHERE verification_status = ?1 ORDER BY retrieved_at DESC, id DESC LIMIT ?2")
        } else {
            format!("{select} ORDER BY retrieved_at DESC, id DESC LIMIT ?1")
        };
        let mut statement = db.prepare(&sql).map_err(|e| format!("无法准备研究记录查询：{e}"))?;
        let max_rows = limit.clamp(1, 100) as i64;
        let rows = if let Some(status) = status {
            statement.query_map(params![status, max_rows], external_research_from_row)
        } else {
            statement.query_map(params![max_rows], external_research_from_row)
        }.map_err(|e| format!("无法查询研究记录：{e}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("无法解析研究记录：{e}"))
    }

    pub fn set_external_research_verification(&self, id: i64, status: String, result: String, reason: String) -> Result<ExternalResearchItem, String> {
        self.legacy.set_external_research_verification(id, status, result, reason)
    }

    pub fn promote_external_research_hypothesis(&self, id: i64, hypothesis: String, linked_experiment_id: String) -> Result<ExternalResearchItem, String> {
        self.legacy.promote_external_research_hypothesis(id, hypothesis, linked_experiment_id)
    }

}

#[tauri::command]
pub fn list_external_research_items(
    state: tauri::State<'_, ResearchState>,
    limit: Option<usize>,
    verification_status: Option<String>,
) -> Result<Vec<ExternalResearchItem>, String> {
    state.list_external_research_items(limit.unwrap_or(50), verification_status)
}

#[tauri::command]
pub fn set_external_research_verification(
    state: tauri::State<'_, ResearchState>,
    item_id: i64,
    verification_status: String,
    research_result: String,
    rejection_reason: String,
) -> Result<ExternalResearchItem, String> {
    state.set_external_research_verification(item_id, verification_status, research_result, rejection_reason)
}

#[tauri::command]
pub fn promote_external_research_hypothesis(
    state: tauri::State<'_, ResearchState>,
    item_id: i64,
    hypothesis: String,
    linked_experiment_id: String,
) -> Result<ExternalResearchItem, String> {
    state.promote_external_research_hypothesis(item_id, hypothesis, linked_experiment_id)
}
