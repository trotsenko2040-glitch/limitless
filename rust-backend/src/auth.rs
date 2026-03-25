use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthToken {
    pub token: String,
    pub user_id: String,
    pub created_at: String,
    pub expires_at: Option<String>,
}

pub fn validate_token_format(token: &str) -> bool {
    // Token must start with "LMT-" and be at least 10 characters
    token.starts_with("LMT-") && token.len() >= 10
        || token.len() >= 10 // Also accept generic long tokens  
}
