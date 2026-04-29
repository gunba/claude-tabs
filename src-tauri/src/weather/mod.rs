//! [WX-01] Weather scene driven by Cloudflare-derived country code.
//!
//! Anthropic and OpenAI both serve through Cloudflare, so their responses
//! carry a `cf-ipcountry` header naming the user's edge POP country. The
//! app registers [`observe_response_headers`] with the proxy, then we pick
//! coordinates for that country, fetch current conditions from Open-Meteo
//! every ~30 minutes, persist the latest
//! payload to `<appdata>/weather.json`, and emit a `weather-changed`
//! Tauri event the renderer subscribes to.
//!
//! No API key is required: Open-Meteo is open and free for non-commercial
//! use. A failed fetch retries after one minute; success holds for 30 min.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const WEATHER_CACHE_FILE: &str = "weather.json";
const POLL_INTERVAL: Duration = Duration::from_secs(30 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(60);
const MAX_RETRY_INTERVAL: Duration = Duration::from_secs(30 * 60);
const SUCCESS_JITTER_MAX: Duration = Duration::from_secs(60);
const RETRY_JITTER_MAX: Duration = Duration::from_secs(30);

static COUNTRY: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static CACHE: OnceLock<Mutex<Option<WeatherPayload>>> = OnceLock::new();
static COUNTRY_CAPITALS: OnceLock<Vec<CountryCapital>> = OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WeatherPayload {
    pub country: String,
    pub label: String,
    #[serde(rename = "weatherCode")]
    pub weather_code: i32,
    #[serde(rename = "tempC")]
    pub temp_c: f64,
    #[serde(rename = "windKph")]
    pub wind_kph: f64,
    #[serde(rename = "precipMm")]
    pub precip_mm: f64,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
}

#[derive(Debug, Deserialize)]
struct CountryCapital {
    code: String,
    label: String,
    lat: f64,
    lon: f64,
}

fn country_capitals() -> &'static [CountryCapital] {
    COUNTRY_CAPITALS.get_or_init(|| {
        serde_json::from_str(include_str!("country_capitals.json"))
            .expect("embedded country_capitals.json must be valid")
    })
}

/// (lat, lon, label) for country/territory capital coordinates. Unknown
/// codes return None so we do not show weather for the wrong city.
pub fn coords_for(cc: &str) -> Option<(f64, f64, &'static str)> {
    let upper = cc.trim().to_ascii_uppercase();
    let capital = country_capitals()
        .iter()
        .find(|capital| capital.code == upper)?;
    Some((capital.lat, capital.lon, capital.label.as_str()))
}

fn jitter(max: Duration) -> Duration {
    if max.as_secs() == 0 {
        return Duration::ZERO;
    }
    Duration::from_secs(rand::thread_rng().gen_range(0..=max.as_secs()))
}

fn retry_delay(retries: u32) -> Duration {
    let multiplier = 1u64 << retries.min(5);
    let secs = RETRY_INTERVAL
        .as_secs()
        .saturating_mul(multiplier)
        .min(MAX_RETRY_INTERVAL.as_secs());
    Duration::from_secs(secs) + jitter(RETRY_JITTER_MAX)
}

fn country_slot() -> &'static Mutex<Option<String>> {
    COUNTRY.get_or_init(|| Mutex::new(None))
}

fn cache_slot() -> &'static Mutex<Option<WeatherPayload>> {
    CACHE.get_or_init(|| Mutex::new(None))
}

/// Called fire-and-forget by the proxy on each upstream response. Two-letter
/// ISO codes only; `XX` (Cloudflare's "unknown") and other lengths are ignored.
pub fn set_country(cc: &str) {
    if cc.len() != 2 {
        return;
    }
    let upper = cc.to_uppercase();
    if upper == "XX" {
        return;
    }
    if let Ok(mut guard) = country_slot().lock() {
        if guard.as_deref() == Some(upper.as_str()) {
            return;
        }
        *guard = Some(upper);
    }
}

pub fn observe_response_headers(headers: &reqwest::header::HeaderMap) {
    if let Some(cc) = headers
        .get("cf-ipcountry")
        .and_then(|value| value.to_str().ok())
    {
        set_country(cc);
    }
}

fn current_country() -> Option<String> {
    country_slot().lock().ok().and_then(|g| g.clone())
}

#[derive(Deserialize)]
struct OpenMeteoResp {
    current: Option<OpenMeteoCurrent>,
}

#[derive(Deserialize)]
struct OpenMeteoCurrent {
    temperature_2m: Option<f64>,
    weather_code: Option<i32>,
    wind_speed_10m: Option<f64>,
    precipitation: Option<f64>,
}

async fn fetch_open_meteo(lat: f64, lon: f64) -> Result<(i32, f64, f64, f64), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("code-tabs")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation"
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let body: OpenMeteoResp = resp.json().await.map_err(|e| e.to_string())?;
    let cur = body
        .current
        .ok_or_else(|| "missing current block".to_string())?;
    Ok((
        cur.weather_code.unwrap_or(0),
        cur.temperature_2m.unwrap_or(0.0),
        cur.wind_speed_10m.unwrap_or(0.0),
        cur.precipitation.unwrap_or(0.0),
    ))
}

fn cache_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(WEATHER_CACHE_FILE))
}

fn load_cached(app: &AppHandle) -> Option<WeatherPayload> {
    let path = cache_path(app)?;
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_cached(app: &AppHandle, payload: &WeatherPayload) {
    let Some(path) = cache_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(payload) {
        let _ = crate::fs_atomic::write(&path, json.as_bytes());
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Spawn the long-lived poll loop and rehydrate any cached payload from
/// disk so the renderer has something to draw on first paint, before
/// the user's first API call. Idempotent: safe to call once at startup.
pub fn init(app: AppHandle) {
    if let Some(cached) = load_cached(&app) {
        if let Ok(mut g) = cache_slot().lock() {
            *g = Some(cached.clone());
        }
        if let Ok(mut g) = country_slot().lock() {
            *g = Some(cached.country.clone());
        }
    }

    tauri::async_runtime::spawn(async move {
        let mut retries = 0u32;
        loop {
            if let Some(cc) = current_country() {
                let Some((lat, lon, label)) = coords_for(&cc) else {
                    tokio::time::sleep(RETRY_INTERVAL + jitter(RETRY_JITTER_MAX)).await;
                    continue;
                };
                match fetch_open_meteo(lat, lon).await {
                    Ok((code, temp, wind, precip)) => {
                        retries = 0;
                        let payload = WeatherPayload {
                            country: cc,
                            label: label.to_string(),
                            weather_code: code,
                            temp_c: temp,
                            wind_kph: wind,
                            precip_mm: precip,
                            updated_at: now_secs(),
                        };
                        if let Ok(mut g) = cache_slot().lock() {
                            *g = Some(payload.clone());
                        }
                        save_cached(&app, &payload);
                        let _ = app.emit("weather-changed", &payload);
                        tokio::time::sleep(POLL_INTERVAL + jitter(SUCCESS_JITTER_MAX)).await;
                        continue;
                    }
                    Err(_) => {
                        tokio::time::sleep(retry_delay(retries)).await;
                        retries = retries.saturating_add(1);
                        continue;
                    }
                }
            }
            tokio::time::sleep(RETRY_INTERVAL + jitter(RETRY_JITTER_MAX)).await;
        }
    });
}

#[tauri::command]
pub fn get_current_weather() -> Option<WeatherPayload> {
    cache_slot().lock().ok().and_then(|g| g.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coords_known_country() {
        let (lat, _, label) = coords_for("AU").unwrap();
        assert!((lat + 35.27).abs() < 0.1);
        assert_eq!(label, "Canberra");
    }

    #[test]
    fn coords_table_covers_broader_country_set() {
        assert!(country_capitals().len() >= 190);
        assert_eq!(coords_for("AF").unwrap().2, "Kabul");
        assert_eq!(coords_for("cw").unwrap().2, "Willemstad");
        assert_eq!(coords_for("US").unwrap().2, "Washington, D.C.");
    }

    #[test]
    fn coords_unknown_returns_none() {
        assert!(coords_for("ZZ").is_none());
    }

    #[test]
    fn set_country_lowercases_and_stores() {
        if let Ok(mut g) = country_slot().lock() {
            *g = None;
        }
        set_country("au");
        assert_eq!(current_country().as_deref(), Some("AU"));
    }

    #[test]
    fn set_country_ignores_xx_and_short() {
        if let Ok(mut g) = country_slot().lock() {
            *g = None;
        }
        set_country("XX");
        assert!(current_country().is_none());
        set_country("X");
        assert!(current_country().is_none());
        set_country("xx");
        assert!(current_country().is_none());
    }

    #[test]
    fn observe_response_headers_reads_cloudflare_country() {
        if let Ok(mut g) = country_slot().lock() {
            *g = None;
        }
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("cf-ipcountry", "US".parse().unwrap());

        observe_response_headers(&headers);

        assert_eq!(current_country().as_deref(), Some("US"));
    }
}
