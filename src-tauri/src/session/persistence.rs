use std::fs;
use std::path::PathBuf;

use super::types::SessionSnapshot;

#[derive(serde::Serialize, serde::Deserialize)]
struct PersistedSessions {
    version: u32,
    sessions: Vec<SessionSnapshot>,
}

fn data_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("code-tabs");
    fs::create_dir_all(&dir).ok();
    dir
}

fn sessions_file() -> PathBuf {
    data_dir().join("sessions.json")
}

pub fn load_sessions() -> Result<Vec<SessionSnapshot>, String> {
    let path = sessions_file();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    parse_sessions_data(&data)
}

fn parse_sessions_data(data: &str) -> Result<Vec<SessionSnapshot>, String> {
    if let Ok(wrapped) = serde_json::from_str::<PersistedSessions>(&data) {
        if wrapped.version == 1 {
            return Ok(wrapped.sessions);
        }
        return Err(format!(
            "unsupported sessions.json version {}",
            wrapped.version
        ));
    }
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

pub fn save_sessions_json(json: &str) -> Result<(), String> {
    let encoded = encode_sessions_json(json)?;
    crate::fs_atomic::write(&sessions_file(), &encoded)
        .map_err(|e| format!("Failed to write sessions: {e}"))
}

fn encode_sessions_json(json: &str) -> Result<Vec<u8>, String> {
    let sessions: Vec<SessionSnapshot> =
        serde_json::from_str(json).map_err(|e| format!("invalid sessions JSON: {e}"))?;
    let wrapped = PersistedSessions {
        version: 1,
        sessions,
    };
    let encoded =
        serde_json::to_vec_pretty(&wrapped).map_err(|e| format!("serialize sessions JSON: {e}"))?;
    let round_trip: PersistedSessions = serde_json::from_slice(&encoded)
        .map_err(|e| format!("sessions JSON failed round-trip validation: {e}"))?;
    if round_trip.version != 1 {
        return Err("sessions JSON failed version validation".into());
    }
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::super::types::{
        PermissionMode, SessionConfig, SessionMetadata, SessionSnapshot, SessionState,
    };
    use super::*;

    fn snapshot() -> SessionSnapshot {
        SessionSnapshot {
            id: "s1".into(),
            name: "Session 1".into(),
            config: SessionConfig {
                working_dir: "/tmp".into(),
                permission_mode: PermissionMode::Default,
                ..SessionConfig::default()
            },
            state: SessionState::Dead,
            metadata: SessionMetadata::default(),
            created_at: Utc::now(),
            last_active: Utc::now(),
        }
    }

    #[test]
    fn parse_sessions_data_accepts_legacy_array() {
        let json = serde_json::to_string(&vec![snapshot()]).unwrap();
        let sessions = parse_sessions_data(&json).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "s1");
    }

    #[test]
    fn encode_sessions_json_wraps_with_version() {
        let json = serde_json::to_string(&vec![snapshot()]).unwrap();
        let encoded = encode_sessions_json(&json).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(value["version"], 1);
        assert_eq!(value["sessions"][0]["id"], "s1");
    }

    #[test]
    fn parse_sessions_data_rejects_unknown_version() {
        let err = parse_sessions_data(r#"{"version":2,"sessions":[]}"#).unwrap_err();
        assert!(err.contains("unsupported sessions.json version 2"));
    }
}
