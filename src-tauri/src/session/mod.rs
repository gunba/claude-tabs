pub mod persistence;
pub mod types;

use std::collections::HashMap;
use std::sync::RwLock;

use types::{Session, SessionSnapshot, SessionState};

#[derive(Default)]
struct SessionRegistry {
    sessions: HashMap<String, Session>,
    tab_order: Vec<String>,
    active_tab: Option<String>,
}

pub struct SessionManager {
    state: RwLock<SessionRegistry>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(SessionRegistry::default()),
        }
    }

    pub fn restore_from_snapshots(&self, snapshots: Vec<SessionSnapshot>) {
        let mut state = self.state.write().unwrap();

        for snap in snapshots {
            let session = Session {
                id: snap.id.clone(),
                name: snap.name,
                config: snap.config,
                state: SessionState::Dead, // All restored sessions start as dead
                metadata: snap.metadata,
                created_at: snap.created_at,
                last_active: snap.last_active,
            };
            state.tab_order.push(snap.id.clone());
            state.sessions.insert(snap.id, session);
        }
    }

    pub fn add_session(&self, session: Session) -> String {
        let id = session.id.clone();
        let mut state = self.state.write().unwrap();

        state.sessions.insert(id.clone(), session);
        state.tab_order.push(id.clone());
        state.active_tab = Some(id.clone());
        id
    }

    pub fn remove_session(&self, id: &str) -> Option<Session> {
        let mut state = self.state.write().unwrap();

        state.tab_order.retain(|x| x != id);

        if state.active_tab.as_deref() == Some(id) {
            state.active_tab = state.tab_order.last().cloned();
        }

        state.sessions.remove(id)
    }

    pub fn set_active(&self, id: &str) {
        let mut state = self.state.write().unwrap();
        if state.sessions.contains_key(id) {
            state.active_tab = Some(id.to_string());
        }
    }

    pub fn reorder_tabs(&self, new_order: Vec<String>) {
        let mut state = self.state.write().unwrap();
        state.tab_order = new_order
            .into_iter()
            .filter(|id| state.sessions.contains_key(id))
            .collect();
    }

    pub fn list_sessions(&self) -> Vec<Session> {
        let state = self.state.read().unwrap();
        state
            .tab_order
            .iter()
            .filter_map(|id| state.sessions.get(id).cloned())
            .collect()
    }
}
