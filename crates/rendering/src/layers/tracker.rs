use bytemuck::{Pod, Zeroable};
use cap_project::XY;
use wgpu::{include_wgsl, util::DeviceExt};

use super::cursor::{CursorPlacement, cursor_height_px};
use crate::{Coord, FrameSpace, ProjectUniforms, RenderVideoConstants};

/// The follow box plus this many click locks at most.
pub const MAX_TRACKER_LOCKS: usize = 6;
const MAX_TRACKER_BOXES: usize = MAX_TRACKER_LOCKS + 1;

/// Box side relative to the un-shrunk cursor height.
const BOX_SCALE: f32 = 2.4;
/// A lock lands from this multiple of the box size.
const LOCK_START_SCALE: f32 = 1.9;

const SLOT_SIZE: u64 = 256;
const MAX_GLYPHS: usize = 16;

pub struct TrackerLayer {
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    render_pipeline: wgpu::RenderPipeline,
    instance_count: u32,
}

impl TrackerLayer {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Tracker Bind Group Layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(
                        std::mem::size_of::<TrackerUniforms>() as u64
                    ),
                },
                count: None,
            }],
        });

        let shader = device.create_shader_module(include_wgsl!("../shaders/tracker.wgsl"));
        let premultiplied = wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
            operation: wgpu::BlendOperation::Add,
        };

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Tracker Pipeline"),
            layout: Some(
                &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("Tracker Pipeline Layout"),
                    bind_group_layouts: &[&bind_group_layout],
                    push_constant_ranges: &[],
                }),
            ),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[],
                    zero_initialize_workgroup_memory: false,
                },
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: Some(wgpu::BlendState {
                        color: premultiplied,
                        alpha: premultiplied,
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[],
                    zero_initialize_workgroup_memory: false,
                },
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleStrip,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Tracker Uniform Buffer"),
            contents: &[0u8; MAX_TRACKER_BOXES * SLOT_SIZE as usize],
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &uniform_buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(std::mem::size_of::<TrackerUniforms>() as u64),
                }),
            }],
            label: Some("Tracker Bind Group"),
        });

        Self {
            uniform_buffer,
            bind_group,
            render_pipeline,
            instance_count: 0,
        }
    }

    pub fn prepare(&mut self, uniforms: &ProjectUniforms, constants: &RenderVideoConstants) {
        self.instance_count = 0;

        let tracker = &uniforms.project.tracker;
        let visibility = uniforms.cursor_clip_visibility.clamp(0.0, 1.0);
        if !tracker.enabled || visibility <= f32::EPSILON {
            return;
        }

        let display = &uniforms.display;
        let base = cursor_height_px(
            display.frame_size[1],
            display.crop_bounds[3] - display.crop_bounds[1],
            display.target_size[1],
            uniforms.cursor_size,
            1.0,
        ) * BOX_SCALE
            * tracker.size_clamped();
        if !base.is_finite() || base <= 0.0 {
            return;
        }

        let output_h = uniforms.output_size.1 as f32;
        let line = (output_h / 540.0).round().max(1.0);
        let label_h = if tracker.labels {
            (base * 0.2).max(7.0 * line).floor()
        } else {
            0.0
        };
        let rgba = |c: [u16; 3], a: f32| {
            [
                c[0] as f32 / 255.0,
                c[1] as f32 / 255.0,
                c[2] as f32 / 255.0,
                a,
            ]
        };

        let mut boxes: Vec<(XY<f64>, f32, [f32; 4], f32)> = Vec::with_capacity(MAX_TRACKER_BOXES);
        for lock in uniforms.tracker_locks.iter().take(MAX_TRACKER_LOCKS) {
            let p = lock.progress.clamp(0.0, 1.0);
            let land = 1.0 - (1.0 - (p / 0.3).min(1.0)).powi(3);
            let scale = LOCK_START_SCALE + (1.0 - LOCK_START_SCALE) * land;
            let opacity = 1.0 - smoothstep(0.55, 1.0, p);
            boxes.push((
                lock.position.coord,
                base * scale,
                rgba(tracker.lock_color, 1.0),
                opacity,
            ));
        }
        if let Some(cursor) = &uniforms.interpolated_cursor {
            boxes.push((cursor.position.coord, base, rgba(tracker.color, 0.9), 1.0));
        }

        let placement = CursorPlacement { uniforms };
        let mut slots = [0u8; MAX_TRACKER_BOXES * SLOT_SIZE as usize];
        let mut count = 0usize;

        for (position_uv, side, color, opacity) in boxes {
            if !position_uv.x.is_finite() || !position_uv.y.is_finite() || opacity <= 0.0 {
                continue;
            }

            let glyphs = if tracker.labels {
                coordinate_glyphs(
                    position_uv.x * display.frame_size[0] as f64,
                    position_uv.y * display.frame_size[1] as f64,
                )
            } else {
                Vec::new()
            };
            let scale = (label_h / 7.0).floor().max(1.0);
            let pill_w = if glyphs.is_empty() {
                0.0
            } else {
                glyphs.len() as f32 * 4.0 * scale + scale
            };
            let quad_w = side.max(pill_w);
            let quad_h = side
                + if glyphs.is_empty() {
                    0.0
                } else {
                    label_h + line * 2.0
                };

            let size = Coord::<FrameSpace>::new(XY::new(quad_w as f64, quad_h as f64));
            let hotspot = XY::new((side * 0.5 / quad_w) as f64, (side * 0.5 / quad_h) as f64);
            let (position_size, opacity) =
                placement.map(position_uv, size, hotspot, opacity * visibility);
            if !position_size.iter().all(|v| v.is_finite()) {
                continue;
            }

            let mut packed = [[13u32; 4]; 4];
            for (i, g) in glyphs.iter().take(MAX_GLYPHS).enumerate() {
                packed[i / 4][i % 4] = *g;
            }

            let slot = TrackerUniforms {
                position_size,
                output_size: [uniforms.output_size.0 as f32, output_h, side, side],
                label: [label_h, 0.0, 0.0, 0.0],
                screen_bounds: display.target_bounds,
                color,
                params: [
                    opacity,
                    if tracker.hatch { 1.0 } else { 0.0 },
                    line,
                    glyphs.len().min(MAX_GLYPHS) as f32,
                ],
                glyphs: packed,
            };

            let offset = count * SLOT_SIZE as usize;
            slots[offset..offset + std::mem::size_of::<TrackerUniforms>()]
                .copy_from_slice(bytemuck::bytes_of(&slot));
            count += 1;
        }

        if count == 0 {
            return;
        }

        constants.queue.write_buffer(
            &self.uniform_buffer,
            0,
            &slots[..count * SLOT_SIZE as usize],
        );
        self.instance_count = count as u32;
    }

    pub fn render(&self, pass: &mut wgpu::RenderPass<'_>) {
        if self.instance_count == 0 {
            return;
        }

        pass.set_pipeline(&self.render_pipeline);
        for i in 0..self.instance_count {
            pass.set_bind_group(0, &self.bind_group, &[i * SLOT_SIZE as u32]);
            pass.draw(0..4, 0..1);
        }
    }
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Font indices for `X:1403 Y:559`: digits are themselves, then X, Y, ':'
/// and space.
fn coordinate_glyphs(x: f64, y: f64) -> Vec<u32> {
    let mut out = Vec::with_capacity(MAX_GLYPHS);
    let push_number = |out: &mut Vec<u32>, v: f64| {
        let v = if v.is_finite() {
            v.round().max(0.0) as u32
        } else {
            0
        };
        out.extend(v.to_string().bytes().map(|b| (b - b'0') as u32));
    };
    out.extend([10, 12]);
    push_number(&mut out, x);
    out.extend([13, 11, 12]);
    push_number(&mut out, y);
    out.truncate(MAX_GLYPHS);
    out
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, Default)]
struct TrackerUniforms {
    position_size: [f32; 4],
    output_size: [f32; 4],
    label: [f32; 4],
    screen_bounds: [f32; 4],
    color: [f32; 4],
    params: [f32; 4],
    glyphs: [[u32; 4]; 4],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinate_glyphs_spell_the_label() {
        assert_eq!(
            coordinate_glyphs(1403.2, 559.0),
            vec![10, 12, 1, 4, 0, 3, 13, 11, 12, 5, 5, 9]
        );
    }

    #[test]
    fn coordinate_glyphs_clamp_bad_input() {
        assert_eq!(
            coordinate_glyphs(f64::NAN, -4.0),
            vec![10, 12, 0, 13, 11, 12, 0]
        );
    }
}
