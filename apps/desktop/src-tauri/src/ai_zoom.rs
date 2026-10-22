use std::{path::Path, time::Duration};

use cap_project::{
    CursorClickEvent, CursorMoveEvent, GlideDirection, KeyboardSettings, ProjectConfiguration,
    ZoomMode, ZoomSegment,
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tracing::{info, warn};

use crate::{editor_window::WindowEditorInstance, recording};

const ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL: &str = "deepseek-flash";
const DEFAULT_EFFORT: &str = "low";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
const PENDING_MARKER: &str = "ai-zoom.pending";

const MIN_AMOUNT: f64 = 1.2;
const MAX_AMOUNT: f64 = 3.0;
const MIN_SEGMENT_SECS: f64 = 1.2;
const MERGE_GAP_SECS: f64 = 0.4;
const END_CLEARANCE_SECS: f64 = 0.3;
const MAX_SEGMENTS: usize = 30;

const CLICK_CLUSTER_SECS: f64 = 1.5;
const CLICK_CLUSTER_DISTANCE: f64 = 0.08;
const DWELL_RADIUS: f64 = 0.04;
const DWELL_MIN_SECS: f64 = 1.2;
const MAX_SIGNALS: usize = 60;
const MAX_TRANSCRIPT_CHARS: usize = 6000;

const SYSTEM_PROMPT: &str = r#"You are a video editor planning camera zooms for a screen recording. You cannot see the video; you get a timeline of what the presenter did. Plan zooms that help a viewer read what matters and stay out of the way the rest of the time.

Rules:
- Zoom in when the viewer needs detail: a burst of clicks on one spot, typing, or the cursor resting on something while the narration talks about it.
- Do not zoom during fast cursor travel or while the narration is introducing or summarising.
- Each zoom lasts 1.5 to 8 seconds. Start about 0.4 s before the action and hold about 1.5 s after it.
- Leave at least 1 second between zooms; merge actions that are close together into one zoom.
- Zoomed time should stay under 45% of the recording.
- amount is the magnification: 1.4 to 1.7 for a broad area or a window, 1.8 to 2.5 for small targets and typing.

Reply with json only, in exactly this shape:
{"segments":[{"start":seconds,"end":seconds,"amount":number,"reason":"few words"}]}"#;

#[derive(Debug, Deserialize)]
struct PlannedSegment {
    start: f64,
    end: f64,
    amount: f64,
}

#[derive(Debug, Deserialize)]
struct Plan {
    #[serde(default)]
    segments: Vec<PlannedSegment>,
}

pub(crate) fn api_key(app: &AppHandle) -> Option<String> {
    let from_settings = app
        .store("store")
        .ok()
        .and_then(|store| store.get("ai"))
        .and_then(|ai| ai.get("deepseekApiKey")?.as_str().map(str::to_string));
    from_settings
        .or_else(|| std::env::var("DEEPSEEK_API_KEY").ok())
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn position_at(moves: &[CursorMoveEvent], time_ms: f64) -> Option<(f64, f64)> {
    let index = moves.partition_point(|event| event.time_ms <= time_ms);
    let event = moves.get(index.checked_sub(1)?)?;
    Some((round2(event.x), round2(event.y)))
}

fn click_signals(clicks: &[CursorClickEvent], moves: &[CursorMoveEvent]) -> Vec<serde_json::Value> {
    let mut downs: Vec<(f64, Option<(f64, f64)>)> = clicks
        .iter()
        .filter(|click| click.down && click.time_ms.is_finite())
        .map(|click| (click.time_ms / 1000.0, position_at(moves, click.time_ms)))
        .collect();
    downs.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut clusters: Vec<(f64, f64, usize, Option<(f64, f64)>)> = Vec::new();
    for (time, position) in downs {
        if let Some(last) = clusters.last_mut() {
            let near = match (last.3, position) {
                (Some((ax, ay)), Some((bx, by))) => {
                    (ax - bx).hypot(ay - by) <= CLICK_CLUSTER_DISTANCE
                }
                _ => true,
            };
            if time - last.1 <= CLICK_CLUSTER_SECS && near {
                last.1 = time;
                last.2 += 1;
                continue;
            }
        }
        clusters.push((time, time, 1, position));
    }

    clusters
        .into_iter()
        .take(MAX_SIGNALS)
        .map(|(start, end, count, position)| {
            json!({
                "start": round2(start),
                "end": round2(end),
                "clicks": count,
                "at": position.map(|(x, y)| [x, y]),
            })
        })
        .collect()
}

fn dwell_signals(moves: &[CursorMoveEvent]) -> Vec<serde_json::Value> {
    let mut dwells = Vec::new();
    let mut anchor = 0;
    for index in 1..=moves.len() {
        let left_anchor = moves.get(index).is_none_or(|event| {
            (event.x - moves[anchor].x).hypot(event.y - moves[anchor].y) > DWELL_RADIUS
        });
        if !left_anchor {
            continue;
        }
        let start = moves[anchor].time_ms / 1000.0;
        let end = moves[index - 1].time_ms / 1000.0;
        if end - start >= DWELL_MIN_SECS && start.is_finite() && end.is_finite() {
            dwells.push(json!({
                "start": round2(start),
                "end": round2(end),
                "at": [round2(moves[anchor].x), round2(moves[anchor].y)],
            }));
        }
        anchor = index;
    }
    dwells.into_iter().take(MAX_SIGNALS).collect()
}

fn typing_signals(
    meta: &cap_project::RecordingMeta,
    project: &ProjectConfiguration,
) -> Vec<serde_json::Value> {
    let Some(timeline) = project.timeline.as_ref() else {
        return Vec::new();
    };
    cap_project::generate_project_keyboard_segments(meta, timeline, &KeyboardSettings::default())
        .unwrap_or_default()
        .into_iter()
        .take(MAX_SIGNALS)
        .map(|segment| {
            json!({
                "start": round2(segment.start),
                "end": round2(segment.end),
                "keys": segment.keys.len(),
            })
        })
        .collect()
}

fn transcript_signals(project: &ProjectConfiguration) -> Vec<serde_json::Value> {
    let Some(captions) = project.captions.as_ref() else {
        return Vec::new();
    };
    let mut budget = MAX_TRANSCRIPT_CHARS;
    let mut lines = Vec::new();
    for segment in &captions.segments {
        let text = segment.text.trim();
        if text.is_empty() {
            continue;
        }
        if text.len() > budget {
            break;
        }
        budget -= text.len();
        lines.push(json!({
            "start": round2(f64::from(segment.start)),
            "end": round2(f64::from(segment.end)),
            "text": text,
        }));
    }
    lines
}

fn sanitize(planned: Vec<PlannedSegment>, duration: f64) -> Vec<ZoomSegment> {
    let limit = duration - END_CLEARANCE_SECS;
    if limit <= MIN_SEGMENT_SECS {
        return Vec::new();
    }

    let mut spans: Vec<(f64, f64, f64)> = planned
        .into_iter()
        .filter(|segment| {
            segment.start.is_finite()
                && segment.end.is_finite()
                && segment.amount.is_finite()
                && segment.amount >= 1.1
                && segment.end > segment.start
        })
        .filter_map(|segment| {
            let start = segment.start.max(0.0);
            let mut end = segment.end.min(limit);
            if end - start < MIN_SEGMENT_SECS {
                end = (start + MIN_SEGMENT_SECS).min(limit);
            }
            let start = start.min(end - MIN_SEGMENT_SECS).max(0.0);
            (end - start >= MIN_SEGMENT_SECS).then_some((
                start,
                end,
                segment.amount.clamp(MIN_AMOUNT, MAX_AMOUNT),
            ))
        })
        .collect();
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut merged: Vec<(f64, f64, f64)> = Vec::new();
    for span in spans {
        if let Some(last) = merged.last_mut()
            && span.0 <= last.1 + MERGE_GAP_SECS
        {
            last.1 = last.1.max(span.1);
            last.2 = last.2.max(span.2);
            continue;
        }
        merged.push(span);
    }

    merged
        .into_iter()
        .take(MAX_SEGMENTS)
        .map(|(start, end, amount)| ZoomSegment {
            start: round2(start),
            end: round2(end),
            amount: round2(amount),
            mode: ZoomMode::Auto,
            glide_direction: GlideDirection::None,
            glide_speed: 0.5,
            instant_animation: false,
            edge_snap_ratio: 0.25,
        })
        .collect()
}

pub(crate) async fn deepseek_json<T: DeserializeOwned>(
    key: &str,
    system: &str,
    user: String,
) -> Result<T, String> {
    let model = std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    let effort = std::env::var("DEEPSEEK_EFFORT").unwrap_or_else(|_| DEFAULT_EFFORT.to_string());
    let body = json!({
        "model": model,
        "reasoning_effort": effort,
        "temperature": 0.2,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not start the AI request: {error}"))?;
    let response = client
        .post(ENDPOINT)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "DeepSeek took too long to answer".to_string()
            } else {
                format!("Could not reach DeepSeek: {error}")
            }
        })?;

    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("DeepSeek sent an unreadable reply: {error}"))?;
    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("request failed");
        return Err(format!("DeepSeek error ({status}): {message}"));
    }

    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(serde_json::Value::as_str)
        .ok_or("DeepSeek returned an empty reply")?;
    serde_json::from_str(content)
        .map_err(|error| format!("DeepSeek returned invalid JSON: {error}"))
}

async fn request_plan(key: &str, prompt: &serde_json::Value) -> Result<Plan, String> {
    deepseek_json(key, SYSTEM_PROMPT, prompt.to_string()).await
}

async fn plan_zoom_segments(
    key: &str,
    meta: &cap_project::RecordingMeta,
    duration: f64,
    project: &ProjectConfiguration,
) -> Result<Vec<ZoomSegment>, String> {
    let (clicks, mut moves) = recording::project_cursor_events(meta);
    moves.sort_by(|a, b| a.time_ms.total_cmp(&b.time_ms));

    let prompt = json!({
        "durationSeconds": round2(duration),
        "coordinates": "x and y are 0..1 across the captured screen, origin top-left",
        "clickBursts": click_signals(&clicks, &moves),
        "cursorRests": dwell_signals(&moves),
        "typing": typing_signals(meta, project),
        "transcript": transcript_signals(project),
    });

    let plan = request_plan(key, &prompt).await?;
    let planned = plan.segments.len();
    let segments = sanitize(plan.segments, duration);
    info!(planned, kept = segments.len(), "AI zoom plan ready");
    if segments.is_empty() {
        warn!("AI zoom plan had no usable segments");
    }
    Ok(segments)
}

#[tauri::command]
#[specta::specta]
pub async fn generate_ai_zoom_segments(
    app: AppHandle,
    editor_instance: WindowEditorInstance,
) -> Result<Vec<ZoomSegment>, String> {
    let key = api_key(&app).ok_or("Add a DeepSeek API key in Settings to plan zooms with AI")?;
    let project = editor_instance.project_config.1.borrow().clone();
    plan_zoom_segments(
        &key,
        editor_instance.meta(),
        editor_instance.recordings.duration(),
        &project,
    )
    .await
}

/// Flags a fresh recording so the editor replaces its click zooms with an AI
/// plan the first time it opens; planning takes 10-20 s, too long to hold up
/// the recording finishing.
pub(crate) fn mark_pending(app: &AppHandle, project_path: &Path) {
    if api_key(app).is_none() {
        return;
    }
    if let Err(error) = std::fs::write(project_path.join(PENDING_MARKER), b"") {
        warn!(%error, "Could not mark the recording for AI zoom planning");
    }
}

#[tauri::command]
#[specta::specta]
pub async fn take_pending_ai_zoom(
    app: AppHandle,
    editor_instance: WindowEditorInstance,
) -> Result<bool, String> {
    let marker = editor_instance.project_path.join(PENDING_MARKER);
    if !marker.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&marker).map_err(|error| error.to_string())?;
    Ok(api_key(&app).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "calls the DeepSeek API; set AI_ZOOM_PROJECT and DEEPSEEK_API_KEY"]
    async fn plans_zooms_for_a_real_project() {
        let path = std::path::PathBuf::from(std::env::var("AI_ZOOM_PROJECT").unwrap());
        let key = std::env::var("DEEPSEEK_API_KEY").unwrap();
        let meta = cap_project::RecordingMeta::load_for_project(&path).unwrap();
        let studio = meta.studio_meta().unwrap().clone();
        let recordings = cap_rendering::ProjectRecordingsMeta::new(&path, &studio).unwrap();
        let project = ProjectConfiguration::load(&path).unwrap_or_default();
        let started = std::time::Instant::now();
        let segments = plan_zoom_segments(&key, &meta, recordings.duration(), &project)
            .await
            .unwrap();
        println!(
            "duration {:.1}s, planned in {:.1}s",
            recordings.duration(),
            started.elapsed().as_secs_f64()
        );
        for segment in &segments {
            println!(
                "{:>6.2} -> {:>6.2}  x{:.2}",
                segment.start, segment.end, segment.amount
            );
        }
        assert!(segments.iter().all(|s| s.end <= recordings.duration()));
    }

    fn planned(start: f64, end: f64, amount: f64) -> PlannedSegment {
        PlannedSegment { start, end, amount }
    }

    #[test]
    fn keeps_valid_segments_in_order() {
        let result = sanitize(vec![planned(8.0, 10.0, 2.0), planned(2.0, 4.0, 1.5)], 20.0);
        let spans: Vec<_> = result.iter().map(|s| (s.start, s.end, s.amount)).collect();
        assert_eq!(spans, vec![(2.0, 4.0, 1.5), (8.0, 10.0, 2.0)]);
    }

    #[test]
    fn drops_no_zoom_and_broken_segments() {
        let result = sanitize(
            vec![
                planned(0.0, 3.0, 1.0),
                planned(f64::NAN, 3.0, 2.0),
                planned(5.0, 4.0, 2.0),
                planned(6.0, 9.0, 2.0),
            ],
            20.0,
        );
        assert_eq!(result.len(), 1);
        assert_eq!((result[0].start, result[0].end), (6.0, 9.0));
    }

    #[test]
    fn clamps_amount_and_stretches_short_segments() {
        let result = sanitize(vec![planned(3.0, 3.3, 9.0)], 20.0);
        assert_eq!(result[0].amount, MAX_AMOUNT);
        assert!((result[0].end - result[0].start - MIN_SEGMENT_SECS).abs() < 0.011);
    }

    #[test]
    fn merges_overlapping_and_near_segments() {
        let result = sanitize(
            vec![
                planned(1.0, 4.0, 1.5),
                planned(4.2, 6.0, 2.2),
                planned(3.0, 5.0, 1.6),
            ],
            20.0,
        );
        assert_eq!(result.len(), 1);
        assert_eq!(
            (result[0].start, result[0].end, result[0].amount),
            (1.0, 6.0, 2.2)
        );
    }

    #[test]
    fn keeps_segments_inside_the_recording() {
        let result = sanitize(
            vec![planned(-2.0, 3.0, 2.0), planned(18.5, 30.0, 2.0)],
            20.0,
        );
        assert_eq!(result[0].start, 0.0);
        assert!(
            result
                .iter()
                .all(|s| s.end <= 20.0 - END_CLEARANCE_SECS + 0.001)
        );
        assert!(
            result
                .iter()
                .all(|s| s.end - s.start >= MIN_SEGMENT_SECS - 0.011)
        );
    }

    #[test]
    fn clusters_nearby_clicks_into_one_burst() {
        let click = |time_ms: f64| CursorClickEvent {
            active_modifiers: Vec::new(),
            cursor_num: 0,
            cursor_id: "0".into(),
            time_ms,
            down: true,
        };
        let moves = vec![CursorMoveEvent {
            active_modifiers: Vec::new(),
            cursor_id: "0".into(),
            time_ms: 0.0,
            x: 0.4,
            y: 0.3,
        }];
        let bursts = click_signals(&[click(1000.0), click(1500.0), click(9000.0)], &moves);
        assert_eq!(bursts.len(), 2);
        assert_eq!(bursts[0]["clicks"], 2);
        assert_eq!(bursts[0]["at"], json!([0.4, 0.3]));
    }
}
