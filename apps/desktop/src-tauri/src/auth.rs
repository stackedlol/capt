use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::api::Organization;

#[derive(Serialize, Deserialize, Type, Debug)]
pub struct AuthStore {
    pub secret: AuthSecret,
    pub user_id: Option<String>,
    pub plan: Option<Plan>,
    #[serde(default)]
    pub organizations: Vec<Organization>,
    #[serde(default)]
    pub organizations_updated_at: Option<i32>,
}

#[derive(Serialize, Deserialize, Type, Debug)]
#[serde(untagged)]
pub enum AuthSecret {
    ApiKey { api_key: String },
    Session { token: String, expires: i32 },
}

#[derive(Serialize, Deserialize, Type, Debug)]
pub struct Plan {
    pub upgraded: bool,
    pub manual: bool,
    pub last_checked: i32,
}

impl AuthStore {
    pub fn get<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Self>, String> {
        let Ok(Some(store)) = app.store("store").map(|s| s.get("auth")) else {
            return Ok(None);
        };

        serde_json::from_value(store).map_err(|e| e.to_string())
    }

    pub fn is_upgraded(&self) -> bool {
        match &self.plan {
            Some(plan) => plan.upgraded || plan.manual,
            None => false,
        }
    }
}
