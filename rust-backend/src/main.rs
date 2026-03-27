use actix_cors::Cors;
use actix_web::{http::header, web, App, HttpRequest, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

mod auth;

const DEFAULT_PROMPT_NAME: &str = "Limitless 1.5";

#[derive(Clone)]
pub struct AppState {
    pub bot_api_url: String,
    pub client: reqwest::Client,
    pub prompt_store: PromptStore,
    pub admin_sessions: Arc<Mutex<HashMap<String, AdminSession>>>,
    pub admin_username: String,
    pub admin_password: String,
}

#[derive(Clone)]
pub struct PromptStore {
    pub file_path: PathBuf,
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
        Self { file_path }
    }

    pub fn load(&self) -> Option<PromptConfig> {
        let content = fs::read_to_string(&self.file_path).ok()?;
        serde_json::from_str::<PromptConfig>(&content).ok()
    }

    pub fn save(&self, config: &PromptConfig) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let payload = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
        fs::write(&self.file_path, payload).map_err(|err| err.to_string())
    }
}

fn fallback_prompt_config() -> PromptConfig {
    PromptConfig {
        name: DEFAULT_PROMPT_NAME.to_string(),
        prompt: String::new(),
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

async fn admin_login(body: web::Json<AdminLoginRequest>, data: web::Data<AppState>) -> HttpResponse {
    let username = body.username.trim();
    let password = body.password.trim();

    if username != data.admin_username || password != data.admin_password {
        return HttpResponse::Unauthorized().json(AdminLoginResponse {
            success: false,
            token: None,
            error: Some("INVALID_CREDENTIALS".to_string()),
        });
    }

    let token = Uuid::new_v4().to_string();
    let session = AdminSession {
        username: username.to_string(),
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
    let admin_username = std::env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_string());
    let admin_password = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "limitless-admin-2026".to_string());
    let prompt_config_path =
        std::env::var("PROMPT_CONFIG_PATH").unwrap_or_else(|_| "./data/prompt-config.json".to_string());

    let state = web::Data::new(AppState {
        bot_api_url,
        client: reqwest::Client::new(),
        prompt_store: PromptStore::new(PathBuf::from(prompt_config_path)),
        admin_sessions: Arc::new(Mutex::new(HashMap::new())),
        admin_username,
        admin_password,
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
            .route("/api/admin/login", web::post().to(admin_login))
            .route("/api/admin/logout", web::post().to(admin_logout))
            .route("/api/admin/prompt", web::get().to(admin_get_prompt))
            .route("/api/admin/prompt", web::put().to(admin_update_prompt))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
