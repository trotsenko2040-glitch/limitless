use actix_cors::Cors;
use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::collections::HashMap;

mod auth;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub tokens: HashMap<String, TokenInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfo {
    pub username: String,
    pub created_at: String,
    pub valid: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateRequest {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateResponse {
    pub valid: bool,
    pub username: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

async fn health_check() -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok".to_string(),
        version: "1.0.0".to_string(),
    })
}

async fn validate_token(
    body: web::Json<ValidateRequest>,
    data: web::Data<Mutex<AppState>>,
) -> HttpResponse {
    let state = data.lock().unwrap();
    
    // Check local store
    if let Some(info) = state.tokens.get(&body.token) {
        if info.valid {
            return HttpResponse::Ok().json(ValidateResponse {
                valid: true,
                username: Some(info.username.clone()),
            });
        }
    }

    // Try validating against telegram bot API
    let bot_api_url = std::env::var("BOT_API_URL")
        .unwrap_or_else(|_| "http://localhost:3001".to_string());
    
    let client = reqwest::Client::new();
    match client
        .get(format!("{}/validate/{}", bot_api_url, &body.token))
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(result) = resp.json::<ValidateResponse>().await {
                if result.valid {
                    // Cache the validated token
                    drop(state);
                    let mut state = data.lock().unwrap();
                    state.tokens.insert(body.token.clone(), TokenInfo {
                        username: result.username.clone().unwrap_or_default(),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        valid: true,
                    });
                }
                return HttpResponse::Ok().json(result);
            }
        }
        Err(_) => {}
    }

    // If token is long enough, accept it (fallback for when bot is offline)
    if body.token.len() >= 10 {
        return HttpResponse::Ok().json(ValidateResponse {
            valid: true,
            username: Some("User".to_string()),
        });
    }

    HttpResponse::Ok().json(ValidateResponse {
        valid: false,
        username: None,
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv::dotenv().ok();
    
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()
        .unwrap_or(8080);

    let state = web::Data::new(Mutex::new(AppState {
        tokens: HashMap::new(),
    }));

    println!("🚀 Limitless Backend запущен на порту {}", port);

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
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
