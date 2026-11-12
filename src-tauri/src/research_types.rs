//! Shared, domain-neutral external research data contracts.
//! Persistence migration out of the legacy trading runtime is pending.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalResearchItem {
    pub id: i64,
    pub source_id: String,
    pub author: String,
    pub source_type: String,
    pub source_tier: String,
    pub canonical_url: String,
    pub title: String,
    pub summary: String,
    pub published_at: String,
    pub retrieved_at: String,
    pub raw_content: String,
    pub content_hash: String,
    pub duplicate_of: Option<i64>,
    pub topic: String,
    pub assets: Vec<String>,
    pub mentioned_indicators: Vec<String>,
    pub mentioned_tools: Vec<String>,
    pub extracted_claims: serde_json::Value,
    pub evidence_links: Vec<String>,
    pub possible_commercial_relationship: String,
    pub verification_status: String,
    pub linked_experiment_id: String,
    pub hypothesis: String,
    pub research_result: String,
    pub disposition: String,
    pub rejection_reason: String,
    pub ingestion_provider: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ExternalResearchUpsert {
    pub source_id: String,
    pub author: String,
    pub source_type: String,
    pub canonical_url: String,
    pub title: String,
    pub published_at: String,
    pub raw_content: String,
    pub ingestion_provider: String,
}

#[derive(Debug, Clone)]
pub struct ExternalResearchAnalysisUpdate {
    pub summary: String,
    pub topic: String,
    pub source_tier: String,
    pub assets: Vec<String>,
    pub mentioned_indicators: Vec<String>,
    pub mentioned_tools: Vec<String>,
    pub extracted_claims: serde_json::Value,
    pub evidence_links: Vec<String>,
    pub possible_commercial_relationship: String,
    pub hypothesis: String,
}

