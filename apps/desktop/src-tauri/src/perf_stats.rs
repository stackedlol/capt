use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use specta::Type;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Serialize, Type, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceStats {
    pub cpu_percent: f32,
    pub app_cpu_percent: f32,
    pub memory_used_bytes: f64,
    pub memory_total_bytes: f64,
    pub app_memory_bytes: f64,
}

static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();

// CPU usage is a delta between two refreshes, so the System has to outlive
// each call; the first sample after launch reads as 0%.
#[tauri::command]
#[specta::specta]
pub fn get_performance_stats() -> PerformanceStats {
    let mut system = SYSTEM
        .get_or_init(|| Mutex::new(System::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    system.refresh_cpu_usage();
    system.refresh_memory();

    let pid = sysinfo::get_current_pid().ok();
    if let Some(pid) = pid {
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );
    }

    let cores = system.cpus().len().max(1) as f32;
    let (app_cpu_percent, app_memory_bytes) = pid
        .and_then(|pid| system.process(pid))
        .map(|process| (process.cpu_usage() / cores, process.memory() as f64))
        .unwrap_or((0.0, 0.0));

    PerformanceStats {
        cpu_percent: system.global_cpu_usage(),
        app_cpu_percent,
        memory_used_bytes: system.used_memory() as f64,
        memory_total_bytes: system.total_memory() as f64,
        app_memory_bytes,
    }
}
