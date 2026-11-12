//! Transitional research service boundary.
//! Research commands use this service rather than referencing TradingRuntimeState.
//! The legacy SQLite persistence is delegated temporarily; migration is pending.
use crate::research_types::{ExternalResearchAnalysisUpdate, ExternalResearchItem, ExternalResearchUpsert};
use crate::trading::TradingRuntimeState;
use crate::research_storage::external_research_from_row;
use rusqlite::{Connection, params, OptionalExtension};
use chrono::Utc;
use crate::research_storage::{canonical_external_url, external_sha256, normalized_external_content, external_research_by_id, clean_external_list, valid_verification_status};
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

    pub fn apply_independent_research_analysis(
        &self,
        id: i64,
        update: ExternalResearchAnalysisUpdate,
    ) -> Result<ExternalResearchItem, String> {
        let topic = update.topic.trim().chars().take(120).collect::<String>();
        let source_tier = match update.source_tier.trim() {
            "primary-official" | "institutional-quant" | "market-intelligence"
            | "practitioner-social" | "unknown" => update.source_tier.trim().to_string(),
            _ => "unknown".to_string(),
        };
        let assets = clean_external_list(update.assets, 24, 40);
        let indicators = clean_external_list(update.mentioned_indicators, 24, 80);
        let tools = clean_external_list(update.mentioned_tools, 24, 120);
        let links = clean_external_list(update.evidence_links, 24, 2_000);
        let claims_json = serde_json::to_string(&update.extracted_claims)
            .map_err(|error| format!("无法序列化 External Research claims：{error}"))?;
        let now = Utc::now().to_rfc3339();

        self.with_independent_database(|connection| {
            connection.execute(
                "UPDATE external_research_items SET
                   summary = ?1,
                   topic = ?2,
                   source_tier = ?3,
                   assets_json = ?4,
                   indicators_json = ?5,
                   tools_json = ?6,
                   claims_json = ?7,
                   evidence_links_json = ?8,
                   possible_commercial_relationship = ?9,
                   hypothesis = CASE WHEN hypothesis = '' THEN ?10 ELSE hypothesis END,
                   verification_status = CASE WHEN verification_status = 'NEW' THEN 'TRIAGED' ELSE verification_status END,
                   updated_at = ?11
                 WHERE id = ?12",
                params![
                    update.summary.trim().chars().take(4_000).collect::<String>(),
                    if topic.is_empty() { "unclassified".to_string() } else { topic },
                    source_tier,
                    serde_json::to_string(&assets).unwrap_or_else(|_| "[]".to_string()),
                    serde_json::to_string(&indicators).unwrap_or_else(|_| "[]".to_string()),
                    serde_json::to_string(&tools).unwrap_or_else(|_| "[]".to_string()),
                    claims_json,
                    serde_json::to_string(&links).unwrap_or_else(|_| "[]".to_string()),
                    update.possible_commercial_relationship.trim().chars().take(500).collect::<String>(),
                    update.hypothesis.trim().chars().take(2_000).collect::<String>(),
                    now,
                    id,
                ],
            ).map_err(|error| format!("无法更新 External Research claims：{error}"))?;
            external_research_by_id(connection, id)
        })
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

    pub fn set_independent_research_verification(
        &self,
        id: i64,
        verification_status: String,
        research_result: String,
        rejection_reason: String,
    ) -> Result<ExternalResearchItem, String> {
        let status = verification_status.trim().to_uppercase();
        if !valid_verification_status(&status) {
            return Err("Verification status 必须是 NEW / TRIAGED / VERIFYING / SUPPORTED / REJECTED / UNRESOLVED。".to_string());
        }
        let disposition = if status == "REJECTED" { "rejected" } else { "unresolved" };
        let research_result = research_result.trim().chars().take(8_000).collect::<String>();
        let rejection_reason = rejection_reason.trim().chars().take(2_000).collect::<String>();
        let now = Utc::now().to_rfc3339();
        self.with_independent_database(|connection| {
            let transaction = connection.unchecked_transaction()
                .map_err(|error| format!("无法开始 External Research verification 记录：{error}"))?;
            transaction.execute(
                "UPDATE external_research_items SET
                   verification_status = ?1,
                   research_result = ?2,
                   rejection_reason = ?3,
                   disposition = CASE WHEN disposition = 'promoted' THEN disposition ELSE ?4 END,
                   updated_at = ?5
                 WHERE id = ?6",
                params![
                    status,
                    research_result,
                    rejection_reason,
                    disposition,
                    now,
                    id,
                ],
            ).map_err(|error| format!("无法更新 External Research verification：{error}"))?;
            let linked_experiment_id: String = transaction
                .query_row(
                    "SELECT linked_experiment_id FROM external_research_items WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("无法读取 External Research experiment linkage：{error}"))?;
            transaction.execute(
                "INSERT INTO research_verification_events(
                   research_item_id, verification_status, research_result,
                   rejection_reason, linked_experiment_id, created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    status,
                    research_result,
                    rejection_reason,
                    linked_experiment_id,
                    now,
                ],
            ).map_err(|error| format!("无法写入 External Research verification event：{error}"))?;
            transaction.commit()
                .map_err(|error| format!("无法提交 External Research verification 记录：{error}"))?;
            external_research_by_id(connection, id)
        })
    }


    pub fn promote_independent_research_hypothesis(
        &self,
        id: i64,
        hypothesis: String,
        linked_experiment_id: String,
    ) -> Result<ExternalResearchItem, String> {
        let hypothesis = hypothesis.trim().chars().take(2_000).collect::<String>();
        if hypothesis.len() < 8 {
            return Err("Hypothesis 太短，无法进入可重复验证流程。".to_string());
        }
        let linked_experiment_id = linked_experiment_id.trim().chars().take(120).collect::<String>();
        let now = Utc::now().to_rfc3339();
        self.with_independent_database(|connection| {
            let transaction = connection.unchecked_transaction()
                .map_err(|error| format!("无法开始 External Research experiment linkage：{error}"))?;
            transaction.execute(
                "UPDATE external_research_items SET
                   hypothesis = ?1,
                   linked_experiment_id = ?2,
                   disposition = 'promoted',
                   verification_status = CASE
                     WHEN ?2 <> '' AND verification_status IN ('NEW', 'TRIAGED') THEN 'VERIFYING'
                     WHEN verification_status = 'NEW' THEN 'TRIAGED'
                     ELSE verification_status
                   END,
                   updated_at = ?3
                 WHERE id = ?4",
                params![hypothesis, linked_experiment_id, now, id],
            ).map_err(|error| format!("无法创建 External Research hypothesis：{error}"))?;
            let verification_status: String = transaction
                .query_row(
                    "SELECT verification_status FROM external_research_items WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("无法读取 External Research verification status：{error}"))?;
            transaction.execute(
                "INSERT INTO research_verification_events(
                   research_item_id, verification_status, research_result,
                   rejection_reason, linked_experiment_id, created_at
                 ) VALUES(?1, ?2, '', '', ?3, ?4)",
                params![id, verification_status, linked_experiment_id, now],
            ).map_err(|error| format!("无法记录 External Research verification linkage event：{error}"))?;
            transaction.commit()
                .map_err(|error| format!("无法提交 External Research experiment linkage：{error}"))?;
            external_research_by_id(connection, id)
        })
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
