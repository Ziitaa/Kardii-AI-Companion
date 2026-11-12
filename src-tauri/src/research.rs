//! Transitional research service boundary.
//! Research commands use this service rather than referencing TradingRuntimeState.
//! The legacy SQLite persistence is delegated temporarily; migration is pending.
use crate::research_types::{ExternalResearchAnalysisUpdate, ExternalResearchItem, ExternalResearchUpsert};
use crate::trading::TradingRuntimeState;
use crate::research_storage::external_research_from_row;
use rusqlite::{Connection, params};
use std::path::PathBuf;

#[derive(Clone)]
pub struct ResearchState {
    legacy: TradingRuntimeState,
    database_path: PathBuf,
}

impl ResearchState {
    pub fn new(legacy: TradingRuntimeState, database_path: PathBuf) -> Self { Self { legacy, database_path } }

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
