use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use super::cursor::CursorPlacement;
use crate::{Coord, FrameSpace, ProjectUniforms};
use cap_project::XY;

/// Full-frame ff-tracking lens over the finished composition. It only runs in
/// the editor preview and export, never during capture.
pub struct LensLayer {
    active: bool,
    uniforms_buffer: wgpu::Buffer,
    pipeline: LensPipeline,
}

impl LensLayer {
    pub fn new(device: &wgpu::Device) -> Self {
        Self {
            active: false,
            uniforms_buffer: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Lens Uniform Buffer"),
                contents: bytemuck::cast_slice(&[LensUniforms::default()]),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            }),
            pipeline: LensPipeline::new(device),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn prepare(&mut self, queue: &wgpu::Queue, uniforms: &ProjectUniforms) {
        let lens = uniforms.project.lens.clamped();
        self.active = lens.is_active();
        if !self.active {
            return;
        }

        let (w, h) = (uniforms.output_size.0 as f32, uniforms.output_size.1 as f32);
        let focus = uniforms
            .interpolated_cursor
            .as_ref()
            .map(|cursor| {
                let zero = Coord::<FrameSpace>::new(XY::new(0.0, 0.0));
                let (ps, _) = CursorPlacement { uniforms }.map(
                    cursor.position.coord,
                    zero,
                    XY::new(0.0, 0.0),
                    1.0,
                );
                [ps[0], ps[1]]
            })
            .filter(|p| p.iter().all(|v| v.is_finite()))
            .unwrap_or([w * 0.5, h * 0.5]);

        let stops = lens.palette.stops();
        let stop = |i: usize| {
            stops
                .map(|s| [s[i][0], s[i][1], s[i][2], 1.0])
                .unwrap_or_default()
        };
        let fps = uniforms.frame_rate.max(1) as f32;

        queue.write_buffer(
            &self.uniforms_buffer,
            0,
            bytemuck::cast_slice(&[LensUniforms {
                size_time: [w, h, uniforms.frame_number as f32 / fps, 0.37],
                focus: [
                    focus[0],
                    focus[1],
                    lens.depth_of_field,
                    uniforms.tracker_lock_pulse,
                ],
                fx_a: [lens.bloom, lens.aberration, lens.led_grid, lens.grain],
                fx_b: [
                    lens.vignette,
                    lens.scanlines,
                    if stops.is_some() { 1.0 } else { 0.0 },
                    (h / 270.0).max(3.0),
                ],
                p0: stop(0),
                p1: stop(1),
                p2: stop(2),
                p3: stop(3),
                p4: stop(4),
            }]),
        );
    }

    pub fn render(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        device: &wgpu::Device,
        source_texture: &wgpu::TextureView,
    ) {
        pass.set_pipeline(&self.pipeline.render_pipeline);
        pass.set_bind_group(
            0,
            &self
                .pipeline
                .bind_group(device, &self.uniforms_buffer, source_texture),
            &[],
        );
        pass.draw(0..3, 0..1);
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, Default)]
struct LensUniforms {
    size_time: [f32; 4],
    focus: [f32; 4],
    fx_a: [f32; 4],
    fx_b: [f32; 4],
    p0: [f32; 4],
    p1: [f32; 4],
    p2: [f32; 4],
    p3: [f32; 4],
    p4: [f32; 4],
}

struct LensPipeline {
    bind_group_layout: wgpu::BindGroupLayout,
    render_pipeline: wgpu::RenderPipeline,
}

impl LensPipeline {
    fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("lens Bind Group Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Lens Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/lens.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Lens Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Lens Pipeline"),
            layout: Some(&pipeline_layout),
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
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[],
                    zero_initialize_workgroup_memory: false,
                },
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });
        Self {
            bind_group_layout,
            render_pipeline,
        }
    }

    fn bind_group(
        &self,
        device: &wgpu::Device,
        uniform_buffer: &wgpu::Buffer,
        texture_view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Lens Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(texture_view),
                },
            ],
        })
    }
}
