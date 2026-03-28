use actix_cors::Cors;
use actix_web::rt::time::sleep;
use actix_web::{http::header, web, App, HttpRequest, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

mod auth;

const DEFAULT_PROMPT_NAME: &str = "Limitless 1.5";

#[derive(Clone)]
pub struct AppState {
    pub bot_api_url: String,
    pub bot_internal_api_key: String,
    pub client: reqwest::Client,
    pub prompt_store: PromptStore,
    pub account_store: AccountStore,
    pub admin_sessions: Arc<Mutex<HashMap<String, AdminSession>>>,
    pub admin_username: String,
    pub admin_password: String,
    pub admin_terminal_password: String,
}

#[derive(Clone)]
pub struct PromptStore {
    pub primary_path: PathBuf,
    pub fallback_path: PathBuf,
}

#[derive(Clone)]
pub struct AccountStore {
    pub primary_base_dir: PathBuf,
    pub fallback_base_dir: PathBuf,
}

#[derive(Clone)]
pub struct AdminSession {
    pub username: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptConfig {
    pub name: String,
    pub prompt: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountChat {
    pub id: String,
    pub title: String,
    pub messages: Vec<AccountMessage>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSettings {
    pub gemini_api_key: String,
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub chats: Vec<AccountChat>,
    pub settings: AccountSettings,
    pub current_chat_id: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateRequest {
    pub token: String,
    pub device_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResponse {
    pub valid: bool,
    pub username: Option<String>,
    pub token: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminLoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminLoginResponse {
    pub success: bool,
    pub token: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPromptUpdateRequest {
    pub name: String,
    pub prompt: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUsersQuery {
    pub search: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserActionRequest {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserRecord {
    pub token: String,
    pub chat_id: i64,
    pub username: String,
    pub created_at: Option<String>,
    pub activated_device_id: Option<String>,
    pub activated_at: Option<String>,
    pub subscription_plan: Option<String>,
    pub subscription_status: Option<String>,
    pub subscription_expires_at: Option<String>,
    pub revoked_at: Option<String>,
    pub last_seen_at: Option<String>,
    pub is_banned: bool,
    pub is_bound: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUsersSummary {
    pub total_users: i64,
    pub active_users: i64,
    pub banned_users: i64,
    pub bound_devices: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUsersResponse {
    pub success: bool,
    #[serde(default)]
    pub users: Vec<AdminUserRecord>,
    pub summary: Option<AdminUsersSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserActionResponse {
    pub success: bool,
    pub user: Option<AdminUserRecord>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BasicSuccessResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

impl PromptStore {
    pub fn new(file_path: PathBuf) -> Self {
        let fallback_path = resolve_runtime_path("prompt-config.json");
        Self {
            primary_path: file_path,
            fallback_path,
        }
    }

    pub fn load(&self) -> Option<PromptConfig> {
        for candidate in [&self.primary_path, &self.fallback_path] {
            if let Ok(content) = fs::read_to_string(candidate) {
                if let Ok(config) = serde_json::from_str::<PromptConfig>(&content) {
                    return Some(config);
                }
            }
        }

        None
    }

    pub fn save(&self, config: &PromptConfig) -> Result<(), String> {
        let payload = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;

        match write_file_with_parent_creation(&self.primary_path, &payload) {
            Ok(_) => Ok(()),
            Err(primary_error) => {
                write_file_with_parent_creation(&self.fallback_path, &payload)
                    .map_err(|fallback_error| format!("{primary_error}; fallback failed: {fallback_error}"))
            }
        }
    }
}

impl AccountStore {
    pub fn new(base_dir: PathBuf) -> Self {
        let fallback_base_dir = resolve_runtime_path("account-store");
        Self {
            primary_base_dir: base_dir,
            fallback_base_dir,
        }
    }

    fn token_file_path(base_dir: &PathBuf, token: &str) -> PathBuf {
        let safe_token: String = token
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                    ch
                } else {
                    '_'
                }
            })
            .collect();

        base_dir.join(format!("{safe_token}.json"))
    }

    pub fn load(&self, token: &str) -> Option<AccountSnapshot> {
        for candidate in [
            Self::token_file_path(&self.primary_base_dir, token),
            Self::token_file_path(&self.fallback_base_dir, token),
        ] {
            if let Ok(content) = fs::read_to_string(candidate) {
                if let Ok(snapshot) = serde_json::from_str::<AccountSnapshot>(&content) {
                    return Some(snapshot);
                }
            }
        }

        None
    }

    pub fn save(&self, token: &str, snapshot: &AccountSnapshot) -> Result<(), String> {
        let payload = serde_json::to_string_pretty(snapshot).map_err(|err| err.to_string())?;
        let primary_path = Self::token_file_path(&self.primary_base_dir, token);
        let fallback_path = Self::token_file_path(&self.fallback_base_dir, token);

        match write_file_with_parent_creation(&primary_path, &payload) {
            Ok(_) => Ok(()),
            Err(primary_error) => {
                write_file_with_parent_creation(&fallback_path, &payload)
                    .map_err(|fallback_error| format!("{primary_error}; fallback failed: {fallback_error}"))
            }
        }
    }
}

fn resolve_runtime_path(name: &str) -> PathBuf {
    std::env::temp_dir().join("limitless-runtime").join(name)
}

fn write_file_with_parent_creation(path: &PathBuf, payload: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    fs::write(path, payload).map_err(|err| err.to_string())
}

fn fallback_prompt_config() -> PromptConfig {
    PromptConfig {
        name: DEFAULT_PROMPT_NAME.to_string(),
        prompt: String::new(),
        updated_at: None,
    }
}

fn default_account_snapshot() -> AccountSnapshot {
    AccountSnapshot {
        chats: vec![],
        settings: AccountSettings {
            gemini_api_key: String::new(),
            theme: "dark".to_string(),
        },
        current_chat_id: None,
        updated_at: None,
    }
}

fn normalize_service_url(value: String) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    }
}

fn normalize_prompt_config(config: Option<PromptConfig>) -> PromptConfig {
    let mut normalized = config.unwrap_or_else(fallback_prompt_config);
    if normalized.name.trim().is_empty() {
        normalized.name = DEFAULT_PROMPT_NAME.to_string();
    }
    normalized
}

fn extract_bearer_token(request: &HttpRequest) -> Option<String> {
    request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn extract_device_id(request: &HttpRequest) -> Option<String> {
    request
        .headers()
        .get("X-Limitless-Device-Id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn ensure_admin(request: &HttpRequest, data: &web::Data<AppState>) -> Result<(), HttpResponse> {
    let token = match extract_bearer_token(request) {
        Some(token) => token,
        None => {
            return Err(HttpResponse::Unauthorized().json(AdminLoginResponse {
                success: false,
                token: None,
                error: Some("ADMIN_AUTH_REQUIRED".to_string()),
            }))
        }
    };

    let sessions = match data.admin_sessions.lock() {
        Ok(sessions) => sessions,
        Err(_) => {
            return Err(HttpResponse::InternalServerError().json(AdminLoginResponse {
                success: false,
                token: None,
                error: Some("ADMIN_SESSION_LOCK_FAILED".to_string()),
            }))
        }
    };

    if sessions.contains_key(&token) {
        Ok(())
    } else {
        Err(HttpResponse::Unauthorized().json(AdminLoginResponse {
            success: false,
            token: None,
            error: Some("ADMIN_AUTH_INVALID".to_string()),
        }))
    }
}

async fn validate_account_access(
    request: &HttpRequest,
    data: &web::Data<AppState>,
) -> Result<ValidateResponse, HttpResponse> {
    let token = match extract_bearer_token(request) {
        Some(token) => token,
        None => {
            return Err(HttpResponse::Unauthorized().json(ValidateResponse {
                valid: false,
                username: None,
                token: None,
                error: Some("TOKEN_REQUIRED".to_string()),
            }))
        }
    };

    let device_id = match extract_device_id(request) {
        Some(device_id) => device_id,
        None => {
            return Err(HttpResponse::BadRequest().json(ValidateResponse {
                valid: false,
                username: None,
                token: None,
                error: Some("DEVICE_ID_REQUIRED".to_string()),
            }))
        }
    };

    if !auth::validate_token_format(&token) {
        return Err(HttpResponse::Unauthorized().json(ValidateResponse {
            valid: false,
            username: None,
            token: None,
            error: Some("INVALID_TOKEN_FORMAT".to_string()),
        }));
    }

    match data
        .client
        .post(format!("{}/api/validate", data.bot_api_url))
        .json(&ValidateRequest {
            token,
            device_id,
        })
        .send()
        .await
    {
        Ok(resp) => match resp.json::<ValidateResponse>().await {
            Ok(result) if result.valid => Ok(result),
            Ok(result) => Err(HttpResponse::Unauthorized().json(result)),
            Err(_) => Err(HttpResponse::BadGateway().json(ValidateResponse {
                valid: false,
                username: None,
                token: None,
                error: Some("VALIDATION_PARSE_FAILED".to_string()),
            })),
        },
        Err(_) => Err(HttpResponse::BadGateway().json(ValidateResponse {
            valid: false,
            username: None,
            token: None,
            error: Some("VALIDATION_UNAVAILABLE".to_string()),
        })),
    }
}

fn build_bot_admin_request(
    data: &web::Data<AppState>,
    method: reqwest::Method,
    path: &str,
) -> reqwest::RequestBuilder {
    data.client
        .request(method, format!("{}/{}", data.bot_api_url, path.trim_start_matches('/')))
        .header("X-Limitless-Bridge-Key", data.bot_internal_api_key.clone())
}

fn bridge_error_from_status(status: reqwest::StatusCode, parse_fallback: &str, unavailable_key: &str) -> String {
    match status.as_u16() {
        401 => "ADMIN_BRIDGE_UNAUTHORIZED".to_string(),
        404 => "ADMIN_USERS_ROUTE_MISSING".to_string(),
        502 | 503 | 504 => unavailable_key.to_string(),
        _ => parse_fallback.to_string(),
    }
}

async fn send_admin_bridge_get_users(
    data: &web::Data<AppState>,
    limit: usize,
    search: String,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut last_response: Option<reqwest::Response> = None;

    for attempt in 0..3 {
        let response = build_bot_admin_request(data, reqwest::Method::GET, "/api/admin/users")
            .query(&[
                ("limit", limit.to_string()),
                ("search", search.clone()),
            ])
            .send()
            .await?;

        if matches!(response.status().as_u16(), 502 | 503 | 504) && attempt < 2 {
            last_response = Some(response);
            sleep(Duration::from_millis(900)).await;
            continue;
        }

        return Ok(response);
    }

    Ok(last_response.expect("admin bridge retries should store last response"))
}

async fn send_admin_bridge_user_action(
    data: &web::Data<AppState>,
    path: &str,
    body: &AdminUserActionRequest,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut last_response: Option<reqwest::Response> = None;

    for attempt in 0..3 {
        let response = build_bot_admin_request(data, reqwest::Method::POST, path)
            .json(body)
            .send()
            .await?;

        if matches!(response.status().as_u16(), 502 | 503 | 504) && attempt < 2 {
            last_response = Some(response);
            sleep(Duration::from_millis(900)).await;
            continue;
        }

        return Ok(response);
    }

    Ok(last_response.expect("admin bridge retries should store last response"))
}

async fn health_check() -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok".to_string(),
        version: "1.1.0".to_string(),
    })
}

async fn validate_token(body: web::Json<ValidateRequest>, data: web::Data<AppState>) -> HttpResponse {
    let token = body.token.trim();
    let device_id = body.device_id.trim();

    if device_id.is_empty() {
        return HttpResponse::Ok().json(ValidateResponse {
            valid: false,
            username: None,
            token: None,
            error: Some("DEVICE_ID_REQUIRED".to_string()),
        });
    }

    if !auth::validate_token_format(token) {
        return HttpResponse::Ok().json(ValidateResponse {
            valid: false,
            username: None,
            token: None,
            error: Some("INVALID_TOKEN_FORMAT".to_string()),
        });
    }

    match data
        .client
        .post(format!("{}/api/validate", data.bot_api_url))
        .json(&ValidateRequest {
            token: token.to_string(),
            device_id: device_id.to_string(),
        })
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(result) = resp.json::<ValidateResponse>().await {
                return HttpResponse::Ok().json(result);
            }
        }
        Err(_) => {}
    }

    HttpResponse::Ok().json(ValidateResponse {
        valid: false,
        username: None,
        token: None,
        error: Some("VALIDATION_UNAVAILABLE".to_string()),
    })
}

async fn get_public_prompt(data: web::Data<AppState>) -> HttpResponse {
    let prompt_config = normalize_prompt_config(data.prompt_store.load());
    HttpResponse::Ok().json(prompt_config)
}

async fn get_account_snapshot(request: HttpRequest, data: web::Data<AppState>) -> HttpResponse {
    let validation = match validate_account_access(&request, &data).await {
        Ok(validation) => validation,
        Err(response) => return response,
    };

    let token = validation
        .token
        .or_else(|| extract_bearer_token(&request))
        .unwrap_or_default();

    let snapshot = data
        .account_store
        .load(&token)
        .unwrap_or_else(default_account_snapshot);

    HttpResponse::Ok().json(snapshot)
}

async fn save_account_snapshot(
    request: HttpRequest,
    body: web::Json<AccountSnapshot>,
    data: web::Data<AppState>,
) -> HttpResponse {
    let validation = match validate_account_access(&request, &data).await {
        Ok(validation) => validation,
        Err(response) => return response,
    };

    let token = validation
        .token
        .or_else(|| extract_bearer_token(&request))
        .unwrap_or_default();

    let mut snapshot = body.into_inner();
    if snapshot.settings.theme.trim().is_empty() {
        snapshot.settings.theme = "dark".to_string();
    }
    snapshot.updated_at = Some(chrono::Utc::now().to_rfc3339());

    match data.account_store.save(&token, &snapshot) {
        Ok(_) => HttpResponse::Ok().json(snapshot),
        Err(error) => HttpResponse::InternalServerError().json(AdminLoginResponse {
            success: false,
            token: None,
            error: Some(format!("ACCOUNT_SAVE_FAILED: {error}")),
        }),
    }
}

async fn admin_login(body: web::Json<AdminLoginRequest>, data: web::Data<AppState>) -> HttpResponse {
    let username = body.username.trim();
    let password = body.password.trim();
    let console_login = password == data.admin_terminal_password;
    let default_login = username == data.admin_username && password == data.admin_password;

    if !console_login && !default_login {
        return HttpResponse::Unauthorized().json(AdminLoginResponse {
            success: false,
            token: None,
            error: Some("INVALID_CREDENTIALS".to_string()),
        });
    }

    let token = Uuid::new_v4().to_string();
    let session = AdminSession {
        username: data.admin_username.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    match data.admin_sessions.lock() {
        Ok(mut sessions) => {
            sessions.insert(token.clone(), session);
        }
        Err(_) => {
            return HttpResponse::InternalServerError().json(AdminLoginResponse {
                success: false,
                token: None,
                error: Some("ADMIN_SESSION_LOCK_FAILED".to_string()),
            })
        }
    }

    HttpResponse::Ok().json(AdminLoginResponse {
        success: true,
        token: Some(token),
        error: None,
    })
}

async fn admin_get_prompt(request: HttpRequest, data: web::Data<AppState>) -> HttpResponse {
    if let Err(response) = ensure_admin(&request, &data) {
        return response;
    }

    let prompt_config = normalize_prompt_config(data.prompt_store.load());
    HttpResponse::Ok().json(prompt_config)
}

async fn admin_update_prompt(
    request: HttpRequest,
    body: web::Json<AdminPromptUpdateRequest>,
    data: web::Data<AppState>,
) -> HttpResponse {
    if let Err(response) = ensure_admin(&request, &data) {
        return response;
    }

    let name = body.name.trim();
    let prompt = body.prompt.trim();

    if name.is_empty() {
        return HttpResponse::BadRequest().json(AdminLoginResponse {
            success: false,
            token: None,
            error: Some("PROMPT_NAME_REQUIRED".to_string()),
        });
    }

    if prompt.is_empty() {
        return HttpResponse::BadRequest().json(AdminLoginResponse {
            success: false,
            token: None,
            error: Some("PROMPT_TEXT_REQUIRED".to_string()),
        });
    }

    let prompt_config = PromptConfig {
        name: name.to_string(),
        prompt: prompt.to_string(),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    match data.prompt_store.save(&prompt_config) {
        Ok(_) => HttpResponse::Ok().json(prompt_config),
        Err(error) => HttpResponse::InternalServerError().json(AdminLoginResponse {
            success: false,
            token: None,
            error: Some(format!("PROMPT_SAVE_FAILED: {error}")),
        }),
    }
}

async fn admin_list_users(
    request: HttpRequest,
    query: web::Query<AdminUsersQuery>,
    data: web::Data<AppState>,
) -> HttpResponse {
    if let Err(response) = ensure_admin(&request, &data) {
        return response;
    }

    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    let search = query.search.clone().unwrap_or_default();

    let response = send_admin_bridge_get_users(&data, limit, search).await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();

            match serde_json::from_str::<AdminUsersResponse>(&body) {
                Ok(payload) if status.is_success() => HttpResponse::Ok().json(payload),
                Ok(payload) => HttpResponse::BadGateway().json(payload),
                Err(_) => {
                    let bridge_error = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|value| value.get("error").and_then(|error| error.as_str()).map(str::to_owned))
                        .unwrap_or_else(|| bridge_error_from_status(status, "ADMIN_USERS_PARSE_FAILED", "ADMIN_USERS_UNAVAILABLE"));

                    HttpResponse::BadGateway().json(AdminUsersResponse {
                        success: false,
                        users: vec![],
                        summary: None,
                        error: Some(bridge_error),
                    })
                }
            }
        }
        Err(_) => HttpResponse::BadGateway().json(AdminUsersResponse {
            success: false,
            users: vec![],
            summary: None,
            error: Some("ADMIN_USERS_UNAVAILABLE".to_string()),
        }),
    }
}

async fn admin_ban_user(
    request: HttpRequest,
    body: web::Json<AdminUserActionRequest>,
    data: web::Data<AppState>,
) -> HttpResponse {
    if let Err(response) = ensure_admin(&request, &data) {
        return response;
    }

    let response = send_admin_bridge_user_action(&data, "/api/admin/users/ban", &body.0).await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();

            match serde_json::from_str::<AdminUserActionResponse>(&body) {
                Ok(payload) if status.is_success() => HttpResponse::Ok().json(payload),
                Ok(payload) => HttpResponse::BadGateway().json(payload),
                Err(_) => {
                    let bridge_error = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|value| value.get("error").and_then(|error| error.as_str()).map(str::to_owned))
                        .unwrap_or_else(|| bridge_error_from_status(status, "ADMIN_USER_ACTION_PARSE_FAILED", "ADMIN_USER_ACTION_UNAVAILABLE"));

                    HttpResponse::BadGateway().json(AdminUserActionResponse {
                        success: false,
                        user: None,
                        error: Some(bridge_error),
                    })
                }
            }
        }
        Err(_) => HttpResponse::BadGateway().json(AdminUserActionResponse {
            success: false,
            user: None,
            error: Some("ADMIN_USER_ACTION_UNAVAILABLE".to_string()),
        }),
    }
}

async fn admin_unban_user(
    request: HttpRequest,
    body: web::Json<AdminUserActionRequest>,
    data: web::Data<AppState>,
) -> HttpResponse {
    if let Err(response) = ensure_admin(&request, &data) {
        return response;
    }

    let response = send_admin_bridge_user_action(&data, "/api/admin/users/unban", &body.0).await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();

            match serde_json::from_str::<AdminUserActionResponse>(&body) {
                Ok(payload) if status.is_success() => HttpResponse::Ok().json(payload),
                Ok(payload) => HttpResponse::BadGateway().json(payload),
                Err(_) => {
                    let bridge_error = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|value| value.get("error").and_then(|error| error.as_str()).map(str::to_owned))
                        .unwrap_or_else(|| bridge_error_from_status(status, "ADMIN_USER_ACTION_PARSE_FAILED", "ADMIN_USER_ACTION_UNAVAILABLE"));

                    HttpResponse::BadGateway().json(AdminUserActionResponse {
                        success: false,
                        user: None,
                        error: Some(bridge_error),
                    })
                }
            }
        }
        Err(_) => HttpResponse::BadGateway().json(AdminUserActionResponse {
            success: false,
            user: None,
            error: Some("ADMIN_USER_ACTION_UNAVAILABLE".to_string()),
        }),
    }
}

async fn admin_logout(request: HttpRequest, data: web::Data<AppState>) -> HttpResponse {
    if let Some(token) = extract_bearer_token(&request) {
        if let Ok(mut sessions) = data.admin_sessions.lock() {
            sessions.remove(&token);
        }
    }

    HttpResponse::Ok().json(BasicSuccessResponse { success: true })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv::dotenv().ok();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()
        .unwrap_or(8080);
    let bot_api_url = normalize_service_url(
        std::env::var("BOT_API_URL").unwrap_or_else(|_| "http://localhost:3001".to_string()),
    );
    let bot_internal_api_key =
        std::env::var("BOT_INTERNAL_API_KEY").unwrap_or_else(|_| "limitless-bridge-key".to_string());
    let admin_username = std::env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_string());
    let admin_password = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "limitless-admin-2026".to_string());
    let admin_terminal_password =
        std::env::var("ADMIN_TERMINAL_PASSWORD").unwrap_or_else(|_| "L1M1tLecc".to_string());
    let prompt_config_path =
        std::env::var("PROMPT_CONFIG_PATH").unwrap_or_else(|_| "./data/prompt-config.json".to_string());
    let account_store_path = std::env::var("ACCOUNT_STORE_PATH").unwrap_or_else(|_| {
        let mut derived = PathBuf::from(&prompt_config_path);
        derived.set_file_name("account-store");
        derived.to_string_lossy().to_string()
    });

    let state = web::Data::new(AppState {
        bot_api_url,
        bot_internal_api_key,
        client: reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .build()
            .expect("Failed to build HTTP client"),
        prompt_store: PromptStore::new(PathBuf::from(prompt_config_path)),
        account_store: AccountStore::new(PathBuf::from(account_store_path)),
        admin_sessions: Arc::new(Mutex::new(HashMap::new())),
        admin_username,
        admin_password,
        admin_terminal_password,
    });

    println!("Limitless Backend started on port {}", port);

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(state.clone())
            .route("/api/health", web::get().to(health_check))
            .route("/api/validate", web::post().to(validate_token))
            .route("/api/prompt", web::get().to(get_public_prompt))
            .route("/api/account", web::get().to(get_account_snapshot))
            .route("/api/account", web::put().to(save_account_snapshot))
            .route("/api/admin/login", web::post().to(admin_login))
            .route("/api/admin/logout", web::post().to(admin_logout))
            .route("/api/admin/prompt", web::get().to(admin_get_prompt))
            .route("/api/admin/prompt", web::put().to(admin_update_prompt))
            .route("/api/admin/users", web::get().to(admin_list_users))
            .route("/api/admin/users/ban", web::post().to(admin_ban_user))
            .route("/api/admin/users/unban", web::post().to(admin_unban_user))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
