//! Transitional research service boundary.
//! Research commands use this service rather than referencing TradingRuntimeState.
//! The legacy SQLite persistence is delegated temporarily; migration is pending.
use crate::research_types::{ExternalResearchAnalysisUpdate, ExternalResearchItem, ExternalResearchUpsert};
use crate::trading::TradingRuntimeState;

#[derive(Clone)]
pub struct ResearchState {
    legacy: TradingRuntimeState,
}

impl ResearchState {
    pub fn new(legacy: TradingRuntimeState) -> Self { Self { legacy } }

    pub fn upsert_external_research_item(&self, item: ExternalResearchUpsert) -> Result<ExternalResearchItem, String> {
        self.legacy.upsert_external_research_item(item)
    }

    pub fn load_external_research_item(&self, id: i64) -> Result<ExternalResearchItem, String> {
        self.legacy.load_external_research_item(id)
    }

    pub fn apply_external_research_analysis(&self, id: i64, update: ExternalResearchAnalysisUpdate) -> Result<ExternalResearchItem, String> {
        self.legacy.apply_external_research_analysis(id, update)
    }
}
