use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::ProjectUniforms;
use cap_project::{FxStackConfiguration, LensPalette};

/// The effects studio chain: one full-frame pass per live node, each reading
/// the previous pass. Runs after the lens, over the finished frame.
pub struct FxLayer {
    passes: usize,
    uniform_buffers: Vec<wgpu::Buffer>,
    pipeline: FxPipeline,
}

impl FxLayer {
    pub fn new(device: &wgpu::Device) -> Self {
        let uniform_buffers = (0..FxStackConfiguration::MAX_NODES)
            .map(|_| {
                device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("Fx Uniform Buffer"),
                    contents: bytemuck::cast_slice(&[FxUniforms::default()]),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                })
            })
            .collect();
        Self {
            passes: 0,
            uniform_buffers,
            pipeline: FxPipeline::new(device),
        }
    }

    pub fn pass_count(&self) -> usize {
        self.passes
    }

    pub fn prepare(&mut self, queue: &wgpu::Queue, uniforms: &ProjectUniforms) {
        self.passes = 0;
        let (w, h) = (uniforms.output_size.0 as f32, uniforms.output_size.1 as f32);
        let fps = uniforms.frame_rate.max(1) as f32;
        let time = uniforms.frame_number as f32 / fps;
        let pulse = uniforms.tracker_lock_pulse;

        for (index, node) in uniforms.project.fx.live_nodes().enumerate() {
            let mix = node.mix_at(time, pulse);
            if mix <= 0.0 {
                continue;
            }
            let stops = node
                .palette
                .stops()
                .or(LensPalette::Mono.stops())
                .unwrap_or_default();
            let stop = |i: usize| [stops[i][0], stops[i][1], stops[i][2], 1.0];
            let color = node.color.map(|c| c.min(255) as f32 / 255.0);

            queue.write_buffer(
                &self.uniform_buffers[self.passes],
                0,
                bytemuck::cast_slice(&[FxUniforms {
                    size_time: [w, h, time, 0.53 + index as f32 * 1.7],
                    params: [
                        node.op.shader_index(),
                        mix,
                        node.a_clamped(),
                        node.b_clamped(),
                    ],
                    color: [color[0], color[1], color[2], pulse],
                    p0: stop(0),
                    p1: stop(1),
                    p2: stop(2),
                    p3: stop(3),
                    p4: stop(4),
                }]),
            );
            self.passes += 1;
        }
    }

    pub fn render_pass(
        &self,
        index: usize,
        pass: &mut wgpu::RenderPass<'_>,
        device: &wgpu::Device,
        source_texture: &wgpu::TextureView,
    ) {
        pass.set_pipeline(&self.pipeline.render_pipeline);
        pass.set_bind_group(
            0,
            &self
                .pipeline
                .bind_group(device, &self.uniform_buffers[index], source_texture),
            &[],
        );
        pass.draw(0..3, 0..1);
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, Default)]
struct FxUniforms {
    size_time: [f32; 4],
    params: [f32; 4],
    color: [f32; 4],
    p0: [f32; 4],
    p1: [f32; 4],
    p2: [f32; 4],
    p3: [f32; 4],
    p4: [f32; 4],
}

struct FxPipeline {
    bind_group_layout: wgpu::BindGroupLayout,
    render_pipeline: wgpu::RenderPipeline,
}

impl FxPipeline {
    fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Fx Bind Group Layout"),
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
            label: Some("Fx Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/fx.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Fx Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Fx Pipeline"),
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
            label: Some("Fx Bind Group"),
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
