//! [WX-01] Weather scene with two-tier location resolution.
//!
//! Primary: the user's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
//! sent from the frontend at startup via [`set_user_timezone`]. The
//! embedded `timezone_coords.json` (generated from tzdb's zone1970.tab,
//! ~310 zones) maps that to a city centroid — e.g. `Australia/Perth` →
//! `(-31.95, 115.85)` rather than the country capital. This needs no
//! network call and handles every populated IANA zone.
//!
//! Fallback: when timezone is unknown or not yet set, the proxy fills in
//! `cf-ipcountry` via [`observe_response_headers`] and we resolve to the
//! country capital. Useful before the frontend has booted, or for users
//! whose timezone resolves to an entry we don't have coords for.
//!
//! Either way, we fetch current conditions from Open-Meteo every ~30
//! minutes, persist the latest payload to `<appdata>/weather.json`, and
//! emit a `weather-changed` Tauri event the renderer subscribes to.
//!
//! No API key is required: Open-Meteo is open and free for non-commercial
//! use. A failed fetch retries after one minute; success holds for 30 min.

use std::collections::HashMap;
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
static TIMEZONE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static CACHE: OnceLock<Mutex<Option<WeatherPayload>>> = OnceLock::new();
static COUNTRY_CAPITALS: OnceLock<Vec<CountryCapital>> = OnceLock::new();
static TIMEZONE_COORDS: OnceLock<HashMap<String, ZoneCoord>> = OnceLock::new();
static LOCATION_CHANGED: OnceLock<tokio::sync::Notify> = OnceLock::new();

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
    /// Hour-of-day (0..24) of today's sunrise in the location's local time.
    /// None when the upstream response didn't include it.
    #[serde(rename = "sunriseHour", skip_serializing_if = "Option::is_none", default)]
    pub sunrise_hour: Option<f64>,
    #[serde(rename = "sunsetHour", skip_serializing_if = "Option::is_none", default)]
    pub sunset_hour: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct CountryCapital {
    code: String,
    label: String,
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct ZoneCoord {
    lat: f64,
    lon: f64,
    label: String,
}

fn country_capitals() -> &'static [CountryCapital] {
    COUNTRY_CAPITALS.get_or_init(|| {
        serde_json::from_str(include_str!("country_capitals.json"))
            .expect("embedded country_capitals.json must be valid")
    })
}

fn timezone_coords() -> &'static HashMap<String, ZoneCoord> {
    TIMEZONE_COORDS.get_or_init(|| {
        serde_json::from_str(include_str!("timezone_coords.json"))
            .expect("embedded timezone_coords.json must be valid")
    })
}

fn location_changed() -> &'static tokio::sync::Notify {
    LOCATION_CHANGED.get_or_init(tokio::sync::Notify::new)
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

/// (lat, lon, label) for an IANA timezone name. Returns None when the zone
/// is missing from the embedded table — caller falls back to country code.
pub fn coords_for_timezone(tz: &str) -> Option<(f64, f64, &'static str)> {
    let trimmed = tz.trim();
    let zone = timezone_coords().get(trimmed)?;
    Some((zone.lat, zone.lon, zone.label.as_str()))
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

fn timezone_slot() -> &'static Mutex<Option<String>> {
    TIMEZONE.get_or_init(|| Mutex::new(None))
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
    let mut changed = false;
    if let Ok(mut guard) = country_slot().lock() {
        if guard.as_deref() != Some(upper.as_str()) {
            *guard = Some(upper);
            changed = true;
        }
    }
    if changed {
        location_changed().notify_one();
    }
}

/// Set the IANA timezone reported by the frontend. Only updates when the
/// value actually changes to avoid restarting an in-flight fetch. The
/// poll loop wakes up so a known-zone change is reflected immediately.
pub fn set_timezone(tz: &str) {
    let trimmed = tz.trim();
    if trimmed.is_empty() {
        return;
    }
    let mut changed = false;
    if let Ok(mut guard) = timezone_slot().lock() {
        if guard.as_deref() != Some(trimmed) {
            *guard = Some(trimmed.to_string());
            changed = true;
        }
    }
    if changed {
        location_changed().notify_one();
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

fn current_timezone() -> Option<String> {
    timezone_slot().lock().ok().and_then(|g| g.clone())
}

/// Resolve the best location we currently know: timezone first, country
/// second. Returns (lat, lon, label, location_id) where location_id is
/// the IANA zone or country code, suitable for the payload's `country`
/// field for backwards-compat.
fn current_location() -> Option<(f64, f64, String, String)> {
    if let Some(tz) = current_timezone() {
        if let Some((lat, lon, label)) = coords_for_timezone(&tz) {
            return Some((lat, lon, label.to_string(), tz));
        }
    }
    if let Some(cc) = current_country() {
        if let Some((lat, lon, label)) = coords_for(&cc) {
            return Some((lat, lon, label.to_string(), cc));
        }
    }
    None
}

#[derive(Deserialize)]
struct OpenMeteoResp {
    current: Option<OpenMeteoCurrent>,
    daily: Option<OpenMeteoDaily>,
}

#[derive(Deserialize)]
struct OpenMeteoCurrent {
    temperature_2m: Option<f64>,
    weather_code: Option<i32>,
    wind_speed_10m: Option<f64>,
    precipitation: Option<f64>,
}

#[derive(Deserialize)]
struct OpenMeteoDaily {
    sunrise: Option<Vec<String>>,
    sunset: Option<Vec<String>>,
}

/// Parse Open-Meteo's local-time string ("YYYY-MM-DDTHH:MM") into hour of
/// day (0..24). Returns None if the format doesn't match.
pub(crate) fn parse_local_hour(s: &str) -> Option<f64> {
    let time_part = s.split('T').nth(1).unwrap_or(s);
    let mut parts = time_part.split(':');
    let h: u32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h as f64 + m as f64 / 60.0)
}

struct OpenMeteoCurrentReading {
    code: i32,
    temp: f64,
    wind: f64,
    precip: f64,
    sunrise_hour: Option<f64>,
    sunset_hour: Option<f64>,
}

async fn fetch_open_meteo(lat: f64, lon: f64) -> Result<OpenMeteoCurrentReading, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("code-tabs")
        .build()
        .map_err(|e| e.to_string())?;
    // `timezone=auto` returns sunrise/sunset in the location's local time
    // (no Z suffix), which is what celestialPhase wants.
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}\
         &current=temperature_2m,weather_code,wind_speed_10m,precipitation\
         &daily=sunrise,sunset&timezone=auto"
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
    let sunrise_hour = body
        .daily
        .as_ref()
        .and_then(|d| d.sunrise.as_ref())
        .and_then(|v| v.first())
        .and_then(|s| parse_local_hour(s));
    let sunset_hour = body
        .daily
        .as_ref()
        .and_then(|d| d.sunset.as_ref())
        .and_then(|v| v.first())
        .and_then(|s| parse_local_hour(s));
    Ok(OpenMeteoCurrentReading {
        code: cur.weather_code.unwrap_or(0),
        temp: cur.temperature_2m.unwrap_or(0.0),
        wind: cur.wind_speed_10m.unwrap_or(0.0),
        precip: cur.precipitation.unwrap_or(0.0),
        sunrise_hour,
        sunset_hour,
    })
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
            // Prefer timezone over country code; either path lands here.
            if let Some((lat, lon, label, location_id)) = current_location() {
                match fetch_open_meteo(lat, lon).await {
                    Ok(reading) => {
                        retries = 0;
                        let payload = WeatherPayload {
                            country: location_id,
                            label,
                            weather_code: reading.code,
                            temp_c: reading.temp,
                            wind_kph: reading.wind,
                            precip_mm: reading.precip,
                            updated_at: now_secs(),
                            sunrise_hour: reading.sunrise_hour,
                            sunset_hour: reading.sunset_hour,
                        };
                        if let Ok(mut g) = cache_slot().lock() {
                            *g = Some(payload.clone());
                        }
                        save_cached(&app, &payload);
                        let _ = app.emit("weather-changed", &payload);
                        // Sleep for the success interval, but wake early if
                        // the user's location changes (e.g. timezone arrives
                        // after the first fetch).
                        let success_sleep = POLL_INTERVAL + jitter(SUCCESS_JITTER_MAX);
                        tokio::select! {
                            _ = tokio::time::sleep(success_sleep) => {}
                            _ = location_changed().notified() => {}
                        }
                        continue;
                    }
                    Err(_) => {
                        let retry_sleep = retry_delay(retries);
                        retries = retries.saturating_add(1);
                        tokio::select! {
                            _ = tokio::time::sleep(retry_sleep) => {}
                            _ = location_changed().notified() => { retries = 0; }
                        }
                        continue;
                    }
                }
            }
            // No location yet — wait briefly, but wake immediately when one
            // arrives via either set_country or set_timezone.
            let idle_sleep = RETRY_INTERVAL + jitter(RETRY_JITTER_MAX);
            tokio::select! {
                _ = tokio::time::sleep(idle_sleep) => {}
                _ = location_changed().notified() => {}
            }
        }
    });
}

/// Tauri command invoked once at frontend startup with the user's IANA
/// timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Triggers
/// an immediate weather refetch when the zone is known.
#[tauri::command]
pub fn set_user_timezone(tz: String) {
    set_timezone(&tz);
}

#[tauri::command]
pub fn get_current_weather() -> Option<WeatherPayload> {
    cache_slot().lock().ok().and_then(|g| g.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests touch shared static slots (COUNTRY, TIMEZONE) so they must run
    // serially. cargo test runs in parallel by default, which would otherwise
    // race the location-precedence cases.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn reset_state() {
        if let Ok(mut g) = country_slot().lock() {
            *g = None;
        }
        if let Ok(mut g) = timezone_slot().lock() {
            *g = None;
        }
    }

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
        let _g = TEST_LOCK.lock().unwrap();
        reset_state();
        set_country("au");
        assert_eq!(current_country().as_deref(), Some("AU"));
    }

    #[test]
    fn set_country_ignores_xx_and_short() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_state();
        set_country("XX");
        assert!(current_country().is_none());
        set_country("X");
        assert!(current_country().is_none());
        set_country("xx");
        assert!(current_country().is_none());
    }

    #[test]
    fn observe_response_headers_reads_cloudflare_country() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_state();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("cf-ipcountry", "US".parse().unwrap());

        observe_response_headers(&headers);

        assert_eq!(current_country().as_deref(), Some("US"));
    }

    #[test]
    fn timezone_table_resolves_perth_directly_not_canberra() {
        let (lat, _lon, label) = coords_for_timezone("Australia/Perth").unwrap();
        // Perth is on the west coast (~-31.95) — well clear of Canberra
        // (-35.27) which is what AU country-code resolution would give.
        assert!((lat + 31.95).abs() < 0.5, "lat {lat} not near Perth");
        assert_eq!(label, "Perth");
    }

    #[test]
    fn timezone_table_covers_major_zones() {
        // Sanity check: handful of major IANA zones the user is likely
        // to be in. Lat/lon precision is tighter than country capital.
        for tz in [
            "Australia/Sydney",
            "Australia/Melbourne",
            "America/New_York",
            "America/Los_Angeles",
            "Europe/London",
            "Asia/Tokyo",
            "Asia/Singapore",
        ] {
            assert!(
                coords_for_timezone(tz).is_some(),
                "missing timezone in embedded table: {tz}"
            );
        }
    }

    #[test]
    fn timezone_unknown_zone_returns_none() {
        assert!(coords_for_timezone("Mars/Olympus_Mons").is_none());
        assert!(coords_for_timezone("").is_none());
        assert!(coords_for_timezone("    ").is_none());
    }

    #[test]
    fn set_timezone_stores_and_normalises_whitespace() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_state();
        set_timezone("  Australia/Perth  ");
        assert_eq!(current_timezone().as_deref(), Some("Australia/Perth"));
    }

    #[test]
    fn set_timezone_ignores_empty_input() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_state();
        if let Ok(mut g) = timezone_slot().lock() {
            *g = Some("Asia/Tokyo".to_string());
        }
        set_timezone("");
        // unchanged
        assert_eq!(current_timezone().as_deref(), Some("Asia/Tokyo"));
    }

    #[test]
    fn current_location_prefers_timezone_over_country() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_state();
        if let Ok(mut g) = timezone_slot().lock() {
            *g = Some("Australia/Perth".to_string());
        }
        if let Ok(mut g) = country_slot().lock() {
            *g = Some("AU".to_string());
        }
        let (lat, _lon, label, id) = current_location().expect("location available");
        // Perth, not Canberra.
        assert!((lat + 31.95).abs() < 0.5);
        assert_eq!(label, "Perth");
        assert_eq!(id, "Australia/Perth");
    }

    #[test]
    fn parse_local_hour_handles_iso_and_bare_time() {
        // "YYYY-MM-DDTHH:MM" — what Open-Meteo's timezone=auto returns.
        let h = parse_local_hour("2026-04-29T06:23").unwrap();
        assert!((h - (6.0 + 23.0 / 60.0)).abs() < 1e-6, "got {h}");
        // Plain "HH:MM" also works.
        let h2 = parse_local_hour("17:46").unwrap();
        assert!((h2 - (17.0 + 46.0 / 60.0)).abs() < 1e-6);
        // Garbage rejected.
        assert!(parse_local_hour("").is_none());
        assert!(parse_local_hour("nope").is_none());
        assert!(parse_local_hour("25:00").is_none());
        assert!(parse_local_hour("12:99").is_none());
    }

    #[test]
    fn current_location_falls_back_to_country_when_timezone_unknown() {
        let _g = TEST_LOCK.lock().unwrap();
        reset_state();
        if let Ok(mut g) = timezone_slot().lock() {
            *g = Some("Mars/Olympus_Mons".to_string());
        }
        if let Ok(mut g) = country_slot().lock() {
            *g = Some("AU".to_string());
        }
        let (_lat, _lon, label, id) = current_location().expect("country fallback");
        assert_eq!(label, "Canberra");
        assert_eq!(id, "AU");
    }
}
