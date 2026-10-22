use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::sync::watch;

pub(crate) struct Startup {
    started: Instant,
    ready: watch::Sender<bool>,
}

impl Default for Startup {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            ready: watch::channel(false).0,
        }
    }
}

impl Startup {
    pub(crate) fn mark_ready(&self) {
        if !self.ready.send_replace(true) {
            tracing::info!(
                elapsed_ms = self.started.elapsed().as_millis(),
                "Startup frontend ready"
            );
        }
    }

    async fn wait(&self) {
        let mut ready = self.ready.subscribe();
        let remaining = Duration::from_secs(5).saturating_sub(self.started.elapsed());
        let _ = tokio::time::timeout(remaining, ready.wait_for(|ready| *ready)).await;
    }
}

pub(crate) async fn wait_for_window(app: &AppHandle) -> bool {
    app.state::<Startup>().wait().await;
    !crate::app_is_exiting(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn readiness_releases_both_existing_and_late_waiters() {
        let startup = Startup::default();
        assert!(
            tokio::time::timeout(Duration::from_millis(10), startup.wait())
                .await
                .is_err()
        );
        startup.mark_ready();
        startup.mark_ready();
        tokio::time::timeout(Duration::from_millis(100), startup.wait())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_failed_frontend_does_not_disable_recovery() {
        let startup = Startup {
            started: Instant::now().checked_sub(Duration::from_secs(6)).unwrap(),
            ..Startup::default()
        };
        tokio::time::timeout(Duration::from_millis(100), startup.wait())
            .await
            .unwrap();
    }
}
