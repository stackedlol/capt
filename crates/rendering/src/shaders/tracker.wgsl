// Tracker boxes in the style of ff-tracking: corner brackets, an optional
// hatch, a center tick and a coordinate pill drawn with a 3x5 pixel font.
// One instance per box; the label strip sits under the box inside the quad.

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct Uniforms {
    // Quad (x, y, w, h) in output px; the box is the top `box_h` of it.
    position_size: vec4<f32>,
    // (output w, output h, box w px, box h px).
    output_size: vec4<f32>,
    // (label h px, unused, unused, unused).
    label: vec4<f32>,
    screen_bounds: vec4<f32>,
    color: vec4<f32>,
    // (opacity, hatch, line px, glyph count).
    params: vec4<f32>,
    glyphs: array<vec4<u32>, 4>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

// Rows top to bottom, 3 bits each, MSB left: 0-9, X, Y, ':', space.
const FONT = array<u32, 14>(
    31599u, 11415u, 29671u, 29647u, 23497u, 31183u, 31215u, 29257u, 31727u, 31695u,
    23213u, 23186u, 1040u, 0u
);

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var corners = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0)
    );

    let local_uv = corners[vertex_index];
    let pos = vec2<f32>(local_uv.x, -local_uv.y);

    var adjusted_pos = u.position_size.xy;
    adjusted_pos.y = u.output_size.y - adjusted_pos.y;

    let final_pos = ((pos * u.position_size.zw) + adjusted_pos)
        / u.output_size.xy * 2.0 - 1.0;

    var output: VertexOutput;
    output.position = vec4<f32>(final_pos, 0.0, 1.0);
    output.uv = local_uv;
    return output;
}

fn screen_bounds_mask(frag_pos: vec2<f32>) -> f32 {
    let b = u.screen_bounds;
    let inside = min(
        min(frag_pos.x - b.x, b.z - frag_pos.x),
        min(frag_pos.y - b.y, b.w - frag_pos.y),
    );
    return clamp(inside + 0.5, 0.0, 1.0);
}

fn glyph_at(i: u32) -> u32 {
    let v = u.glyphs[i / 4u];
    let k = i % 4u;
    if k == 0u { return v.x; }
    if k == 1u { return v.y; }
    if k == 2u { return v.z; }
    return v.w;
}

fn box_alpha(p: vec2<f32>, size: vec2<f32>, line: f32, hatch: f32) -> f32 {
    let edge = min(min(p.x, size.x - p.x), min(p.y, size.y - p.y));
    let outline = (1.0 - smoothstep(line * 0.5, line * 0.5 + 1.0, edge)) * 0.45;

    let arm = min(size.x, size.y) * 0.24;
    let near_x = min(p.x, size.x - p.x);
    let near_y = min(p.y, size.y - p.y);
    let corner_band = 1.0 - smoothstep(line * 1.5, line * 1.5 + 1.0, edge);
    let in_corner = step(near_x, arm) * step(near_y, arm);
    let bracket = corner_band * in_corner;

    let c = abs(p - size * 0.5);
    let tick_len = min(size.x, size.y) * 0.08;
    let tick = (step(c.x, line * 0.5) * step(c.y, tick_len) + step(c.y, line * 0.5) * step(c.x, tick_len));

    var hatch_a = 0.0;
    if hatch > 0.5 {
        let stripe = fract((p.x + p.y) / (line * 6.0));
        hatch_a = (1.0 - smoothstep(0.18, 0.28, stripe)) * 0.22;
    }

    return clamp(max(max(outline, bracket), max(min(tick, 1.0), hatch_a)), 0.0, 1.0);
}

fn label_alpha(p: vec2<f32>, label_h: f32, count: u32) -> f32 {
    // Pill with knocked-out glyphs: 3x5 cells, one column of spacing.
    let scale = max(1.0, floor(label_h / 7.0));
    let pad = scale;
    let text_w = f32(count) * 4.0 * scale - scale;
    let pill_w = text_w + pad * 2.0;
    if p.x > pill_w || p.y < 0.0 || p.y > label_h {
        return 0.0;
    }
    let q = vec2<f32>(p.x - pad, p.y - (label_h - 5.0 * scale) * 0.5);
    if q.x < 0.0 || q.y < 0.0 || q.y >= 5.0 * scale || q.x >= text_w {
        return 1.0;
    }
    let cell = floor(q / scale);
    let gi = u32(cell.x) / 4u;
    let col = u32(cell.x) % 4u;
    if col == 3u {
        return 1.0;
    }
    let bits = FONT[min(glyph_at(gi), 13u)];
    let row = u32(cell.y);
    let bit = (bits >> ((4u - row) * 3u + (2u - col))) & 1u;
    return select(1.0, 0.0, bit == 1u);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let size = u.position_size.zw;
    let p = input.uv * size;
    let box_w = u.output_size.z;
    let box_h = u.output_size.w;
    let label_h = u.label.x;
    let line = u.params.z;

    var a = 0.0;
    if p.y <= box_h {
        if p.x <= box_w {
            a = box_alpha(p, vec2<f32>(box_w, box_h), line, u.params.y);
        }
    } else if label_h > 0.0 && u.params.w > 0.0 {
        a = label_alpha(vec2<f32>(p.x, p.y - box_h - line * 2.0), label_h, u32(u.params.w));
    }

    a *= u.color.a * u.params.x * screen_bounds_mask(input.position.xy);
    a = clamp(a, 0.0, 1.0);
    return vec4<f32>(u.color.rgb * a, a);
}
