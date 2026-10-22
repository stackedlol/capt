use cap_project::{
    BackgroundPattern, BackgroundPatternConfiguration, BackgroundSource, CursorEvents,
    ProjectConfiguration, RecordingMeta, XY,
};
use cap_rendering::{
    DecodedSegmentFrames, FrameRenderer, ProjectUniforms, RenderOptions, RenderVideoConstants,
    RendererLayers, ZoomTransformTimeline,
};

const ANIMATED: [BackgroundPattern; 3] = [
    BackgroundPattern::StackedDither,
    BackgroundPattern::AsciiFlow,
    BackgroundPattern::FlowLines,
];

/// Animated background patterns must be reproducible for a given frame (so
/// preview and export agree) and must actually move between frames. Set
/// `CAPT_PATTERN_SNAPSHOTS=<dir>` to also write each rendered frame as a PNG.
#[tokio::test]
async fn animated_patterns_are_deterministic_and_move() {
    let recording_meta: RecordingMeta = serde_json::from_value(serde_json::json!({
        "pretty_name": "background-patterns",
        "display": { "path": "display.mp4", "fps": 30 },
        "camera": null,
        "audio": null,
        "cursor": null
    }))
    .unwrap();
    let meta = recording_meta.studio_meta().unwrap().clone();
    let screen_size = XY::new(1280, 720);
    let constants = RenderVideoConstants::new_with_options(
        RenderOptions {
            screen_size,
            camera_size: None,
            preserve_screen_alpha: false,
        },
        recording_meta,
        meta,
    )
    .await
    .unwrap();
    let cursor = CursorEvents::default();
    let frames = DecodedSegmentFrames {
        screen_size,
        screen_frame: None,
        camera_frame: None,
        segment_time: 0.0,
        recording_time: 0.0,
        segment_has_camera: false,
    };
    let snapshots = std::env::var_os("CAPT_PATTERN_SNAPSHOTS").map(std::path::PathBuf::from);

    for kind in ANIMATED {
        let mut project = ProjectConfiguration::default();
        project.background.source = BackgroundSource::Gradient {
            from: [27, 45, 107],
            to: [174, 187, 224],
            angle: 135,
            noise_intensity: None,
            noise_scale: None,
            animated: None,
            animation_speed: None,
        };
        project.background.padding = 12.0;
        project.background.pattern = Some(BackgroundPatternConfiguration {
            kind,
            ..Default::default()
        });
        project.cursor.hide = true;
        let project = std::sync::Arc::new(project);
        let zoom = ZoomTransformTimeline::from_project(&project, &cursor, 1.0, screen_size);
        let mut renderer = FrameRenderer::new(&constants);
        let mut layers = RendererLayers::new_for_preparing_preview(
            &constants.device,
            &constants.queue,
            constants.is_software_adapter,
            &project,
        )
        .unwrap();

        let mut render = async |frame_number: u32| {
            let uniforms = ProjectUniforms::new(
                &constants,
                &project,
                frame_number,
                30,
                XY::new(1280, 720),
                &cursor,
                &frames,
                1.0,
                &zoom,
            );
            let frame = renderer
                .render_immediate(frames.clone(), uniforms, &cursor, false, &mut layers)
                .await
                .unwrap();
            let row = frame.width as usize * 4;
            let mut pixels = Vec::with_capacity(row * frame.height as usize);
            for y in 0..frame.height as usize {
                let start = y * frame.padded_bytes_per_row as usize;
                pixels.extend_from_slice(&frame.data[start..start + row]);
            }
            (frame.width, frame.height, pixels)
        };

        let (width, height, first) = render(0).await;
        let (_, _, repeat) = render(0).await;
        let (_, _, later) = render(45).await;

        assert_eq!(first, repeat, "{kind:?}: frame 0 differs between renders");
        assert_ne!(first, later, "{kind:?}: pattern did not move by frame 45");

        if let Some(dir) = &snapshots {
            std::fs::create_dir_all(dir).unwrap();
            for (label, pixels) in [("f0", &first), ("f45", &later)] {
                image::RgbaImage::from_raw(width, height, pixels.clone())
                    .unwrap()
                    .save(dir.join(format!("{kind:?}-{label}.png")))
                    .unwrap();
            }
        }
    }
}
