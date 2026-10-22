use std::time::{SystemTime, UNIX_EPOCH};

use cap_project::{FxDrive, FxNode, FxOp, FxStackConfiguration, LensPalette};
use serde::Deserialize;
use serde_json::json;
use tauri::AppHandle;
use tracing::info;

use crate::ai_zoom::{api_key, deepseek_json};

const MAX_PROMPT_CHARS: usize = 600;

const SYSTEM_PROMPT: &str = r##"You design looks for screen recordings in a node-based effects studio, like a TouchDesigner TOP chain. Nodes run in order; each reads the previous node's output. Every node has mix 0..1 and two parameters a and b, both 0..1.

Operators (a / b):
- pixelate: cell size / unused
- wave: amplitude / frequency
- mirror: mode (<0.34 left-right, <0.67 top-bottom, else quad) / which side is kept
- kaleidoscope: segments / spin speed (0.5 = still)
- fisheye: bulge (0.5 flat, lower pinches) / zoom (0.5 none)
- transform: zoom (0.5 none) / rotation (0.5 none)
- rgbSplit: distance / angle
- blur: radius / unused
- glow: radius / brightness threshold
- edges: strength / keep source color (0 = lines in node color on black)
- levels: contrast (0.5 neutral) / brightness (0.5 neutral)
- hue: hue rotation (0.5 none) / saturation (0.5 unchanged, 0 grey)
- posterize: how few color levels / unused
- threshold: level / softness; light areas become the node color, the rest black
- invert: unused / unused
- gradientMap: contrast (0.5 neutral) / unused; maps brightness onto the node palette
- tint: duotone toward the node color / highlight lift
- dither: cell size / color levels
- halftone: dot cell size / screen angle
- ascii: character cell size / 1 = draw characters in the node color
- scanlines: line size / roll speed
- ledGrid: LED cell size / glow
- grain: amount / grain size
- vignette: amount / softness
- glitch: amount / band height
- tilt: camera pitch (0.5 flat) / yaw (0.5 flat); shows the recording as a card floating in 3D on a studio backdrop in the node color
- orbit: swing / speed; the 3D card sways on a slow camera arc, backdrop in the node color
- dolly: push-in amount / speed; slow cinematic push in and out with a drifting dutch angle
- tiltShift: blur / focus line height (0 top, 1 bottom); miniature-style depth of field
- letterbox: aspect (0 = 1.85:1, 1 = 2.76:1) / bar opacity; bars in the node color
- anamorphic: streak strength / highlight threshold; horizontal lens flares in the node color
- halation: amount / radius; warm film halo around bright edges in the node color
- lightLeak: amount / drift speed; drifting light leak in the node color
- filmGrade: strength / warmth (0.5 neutral); filmic tone curve, teal shadows, warm highlights
- lens: chromatic fringing / barrel distortion

Palettes: thermal, phosphor, amber, neon, mono, navy, paper, crimson.
Drives animate the mix: none, lfo (smooth sine), strobe (on/off), ramp (sawtooth), click (pulses when the presenter clicks). rate is cycles per second (0.05-12). mix is the peak: with a drive the mix swings between mix*(1-depth) and mix, so a node that should only appear on clicks has mix near 1, drive click and depth 1. Never set mix to 0.

Keep the recording readable: text on screen must stay legible unless the user asks for something extreme. Use 2 to 7 nodes. Put geometry (pixelate, wave, mirror, kaleidoscope, fisheye, transform, lens) before color and stylize operators. Camera moves (tilt, orbit, dolly) go after the look so the backdrop stays clean, then letterbox, with grain or vignette last. For cinematic or product-film requests reach for filmGrade, halation, anamorphic, tiltShift and a camera move rather than heavy stylizing. If a current chain is given, edit it to satisfy the request instead of starting over, unless asked for something new.

Reply with json only, in exactly this shape:
{"name":"two or three words","nodes":[{"op":"glitch","mix":0.8,"a":0.4,"b":0.5,"color":"#ff2119","palette":"thermal","drive":"click","rate":1,"depth":1}]}"##;

#[derive(Debug, Deserialize)]
struct PlannedNode {
    op: String,
    #[serde(default = "one")]
    mix: f32,
    #[serde(default = "half")]
    a: f32,
    #[serde(default = "half")]
    b: f32,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    palette: Option<String>,
    #[serde(default)]
    drive: Option<String>,
    #[serde(default = "one")]
    rate: f32,
    #[serde(default = "one")]
    depth: f32,
}

#[derive(Debug, Deserialize)]
struct PlannedChain {
    #[serde(default)]
    nodes: Vec<PlannedNode>,
}

fn one() -> f32 {
    1.0
}

fn half() -> f32 {
    0.5
}

fn parse_enum<T: serde::de::DeserializeOwned>(value: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(value.trim().to_string())).ok()
}

fn parse_hex(value: &str) -> Option<[u16; 3]> {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let channel = |i: usize| u16::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

fn finite_unit(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        fallback
    }
}

fn into_nodes(planned: Vec<PlannedNode>) -> Vec<FxNode> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    planned
        .into_iter()
        .filter_map(|node| {
            let op: FxOp = parse_enum(&node.op)?;
            Some((op, node))
        })
        .take(FxStackConfiguration::MAX_NODES)
        .enumerate()
        .map(|(index, (op, node))| {
            let drive = node
                .drive
                .as_deref()
                .and_then(parse_enum)
                .unwrap_or(FxDrive::None);
            let mut mix = finite_unit(node.mix, 1.0);
            if drive != FxDrive::None && mix < 0.05 {
                mix = 1.0;
            }
            (index, op, node, drive, mix)
        })
        .map(|(index, op, node, drive, mix)| FxNode {
            id: format!("ai-{stamp}-{index}"),
            op,
            enabled: true,
            mix,
            a: finite_unit(node.a, 0.5),
            b: finite_unit(node.b, 0.5),
            color: node
                .color
                .as_deref()
                .and_then(parse_hex)
                .unwrap_or([255, 255, 255]),
            palette: node
                .palette
                .as_deref()
                .and_then(parse_enum)
                .filter(|p| *p != LensPalette::None)
                .unwrap_or(LensPalette::Thermal),
            drive,
            rate: if node.rate.is_finite() {
                node.rate.clamp(FxNode::RATE_RANGE.0, FxNode::RATE_RANGE.1)
            } else {
                1.0
            },
            depth: finite_unit(node.depth, 1.0),
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub async fn generate_ai_fx_chain(
    app: AppHandle,
    prompt: String,
    current: Vec<FxNode>,
) -> Result<Vec<FxNode>, String> {
    let key = api_key(&app).ok_or("Add a DeepSeek API key in Settings to design looks with AI")?;
    let request: String = prompt.trim().chars().take(MAX_PROMPT_CHARS).collect();
    if request.is_empty() {
        return Err("Describe the look you want".to_string());
    }

    let current: Vec<serde_json::Value> = current
        .iter()
        .map(|node| {
            json!({
                "op": node.op,
                "enabled": node.enabled,
                "mix": node.mix,
                "a": node.a,
                "b": node.b,
                "color": format!("#{:02x}{:02x}{:02x}", node.color[0].min(255), node.color[1].min(255), node.color[2].min(255)),
                "palette": node.palette,
                "drive": node.drive,
                "rate": node.rate,
                "depth": node.depth,
            })
        })
        .collect();
    let user = json!({ "request": request, "currentChain": current }).to_string();

    let chain: PlannedChain = deepseek_json(&key, SYSTEM_PROMPT, user).await?;
    let planned = chain.nodes.len();
    let nodes = into_nodes(chain.nodes);
    info!(planned, kept = nodes.len(), "AI effects chain ready");
    if nodes.is_empty() {
        return Err("AI did not return any usable effects".to_string());
    }
    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn planned(op: &str) -> PlannedNode {
        PlannedNode {
            op: op.to_string(),
            mix: 2.0,
            a: f32::NAN,
            b: 0.3,
            color: Some("#FF2119".to_string()),
            palette: Some("phosphor".to_string()),
            drive: Some("click".to_string()),
            rate: 100.0,
            depth: 0.5,
        }
    }

    #[test]
    fn keeps_known_ops_and_clamps_values() {
        let nodes = into_nodes(vec![
            planned("glitch"),
            planned("teleport"),
            planned("rgbSplit"),
        ]);
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].op, FxOp::Glitch);
        assert_eq!(nodes[1].op, FxOp::RgbSplit);
        assert_eq!(nodes[0].mix, 1.0);
        assert_eq!(nodes[0].a, 0.5);
        assert_eq!(nodes[0].color, [255, 33, 25]);
        assert_eq!(nodes[0].palette, LensPalette::Phosphor);
        assert_eq!(nodes[0].drive, FxDrive::Click);
        assert_eq!(nodes[0].rate, FxNode::RATE_RANGE.1);
        assert_ne!(nodes[0].id, nodes[1].id);
    }

    #[test]
    fn parses_camera_and_film_ops() {
        let nodes = into_nodes(vec![
            planned("tiltShift"),
            planned("lightLeak"),
            planned("filmGrade"),
            planned("orbit"),
        ]);
        let ops: Vec<FxOp> = nodes.iter().map(|n| n.op).collect();
        assert_eq!(
            ops,
            [FxOp::TiltShift, FxOp::LightLeak, FxOp::FilmGrade, FxOp::Orbit]
        );
    }

    #[test]
    fn driven_nodes_never_stay_invisible() {
        let mut node = planned("glitch");
        node.mix = 0.0;
        assert_eq!(into_nodes(vec![node])[0].mix, 1.0);

        let mut undriven = planned("grain");
        undriven.mix = 0.0;
        undriven.drive = None;
        assert_eq!(into_nodes(vec![undriven])[0].mix, 0.0);
    }

    #[tokio::test]
    #[ignore = "calls the DeepSeek API; set DEEPSEEK_API_KEY"]
    async fn designs_a_look_from_a_prompt() {
        let key = std::env::var("DEEPSEEK_API_KEY").unwrap();
        let user = json!({
            "request": "thermal security camera that glitches when I click",
            "currentChain": [],
        })
        .to_string();
        let chain: PlannedChain = deepseek_json(&key, SYSTEM_PROMPT, user).await.unwrap();
        let nodes = into_nodes(chain.nodes);
        println!("{nodes:#?}");
        assert!(!nodes.is_empty());
    }

    #[test]
    fn rejects_bad_hex() {
        assert_eq!(parse_hex("#12345"), None);
        assert_eq!(parse_hex("zzzzzz"), None);
        assert_eq!(parse_hex("1b2d6b"), Some([0x1b, 0x2d, 0x6b]));
    }
}
