// Port of the ff-tracking lens (github.com/mrsarac/ff-tracking, MIT,
// Copyright (c) 2026 Mustafa Saraç) to a full-frame post pass.
// Order: tear -> depth of field (with chromatic aberration) -> palette ->
// bloom -> LED grid -> vignette, scanlines, grain.
// The original films a tilted screen; here the frame stays flat and depth of
// field falls off with distance from the tracked point (the cursor).

struct Uniforms {
    // (width, height, time seconds, seed).
    size_time: vec4<f32>,
    // (focus x px, focus y px, depth of field, lock pulse 0..1).
    focus: vec4<f32>,
    // (bloom, aberration, led grid, grain).
    fx_a: vec4<f32>,
    // (vignette, scanlines, palette on, led cell px).
    fx_b: vec4<f32>,
    p0: vec4<f32>,
    p1: vec4<f32>,
    p2: vec4<f32>,
    p3: vec4<f32>,
    p4: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var frame_texture: texture_2d<f32>;

const TAPS: i32 = 24;
const GLOW_TAPS: i32 = 16;
const GOLDEN: f32 = 2.39996323;
const LOCK_RED: vec3<f32> = vec3<f32>(1.0, 0.13, 0.10);

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn pal(x: f32) -> vec3<f32> {
    let t = clamp(x, 0.0, 1.0) * 4.0;
    if t < 1.0 { return mix(u.p0.rgb, u.p1.rgb, t); }
    if t < 2.0 { return mix(u.p1.rgb, u.p2.rgb, t - 1.0); }
    if t < 3.0 { return mix(u.p2.rgb, u.p3.rgb, t - 2.0); }
    return mix(u.p3.rgb, u.p4.rgb, t - 3.0);
}

fn load(p: vec2<f32>) -> vec4<f32> {
    let dims = u.size_time.xy;
    let c = clamp(p, vec2<f32>(0.0), dims - vec2<f32>(1.0));
    return textureLoad(frame_texture, vec2<i32>(c), 0);
}

fn snap(q: vec2<f32>, cell: f32, led: f32) -> vec2<f32> {
    if led <= 0.0 {
        return q;
    }
    return (floor(q / cell) + 0.5) * cell;
}

@fragment
fn fs_main(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
    let res = u.size_time.xy;
    let time = u.size_time.z;
    let frame_seed = vec2<f32>(u.size_time.w, floor(time * 30.0));
    let coord = frag_coord.xy;
    let px_scale = res.y / 1080.0;

    let dof = u.focus.z;
    let lock = u.focus.w;
    let bloom = u.fx_a.x;
    let aberration = u.fx_a.y;
    let led = u.fx_a.z;
    let grain = u.fx_a.w;
    let vignette = u.fx_b.x;
    let scanlines = u.fx_b.y;
    let palette_on = u.fx_b.z;
    let cell = max(u.fx_b.w, 2.0);

    // Tear: on a click lock a few rows slide sideways.
    var px = coord;
    let shake = lock * aberration;
    if shake > 0.0 {
        let band = floor(coord.y / (16.0 * px_scale));
        let n = hash(vec2<f32>(band, frame_seed.x * 3.7 + frame_seed.y));
        let hit = step(0.93 - 0.18 * shake, n);
        px.x += hit * (hash(vec2<f32>(band, frame_seed.y + 9.0)) - 0.5) * 220.0 * px_scale * shake;
    }

    let s = (px - 0.5 * res) / res.y;

    // Depth of field: circle of confusion grows with distance from the focus.
    let dist = length((px - u.focus.xy) / res.y);
    let r = dof * smoothstep(0.03, 0.55, dist) * 26.0 * px_scale;

    // Chromatic aberration grows toward the edges and on a lock.
    let ca = s * aberration * (0.006 + 0.016 * lock) * res.y;

    let spin = hash(coord * 0.37 + frame_seed) * 6.2831;
    let taps = select(1, TAPS, r > 0.5);
    var acc_g = vec3<f32>(0.0);
    var acc_r = vec3<f32>(0.0);
    var acc_b = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var i = 0; i < taps; i++) {
        let fi = f32(i);
        let a = fi * GOLDEN + spin;
        let rr = sqrt((fi + 0.5) / f32(taps)) * r;
        let q = snap(px + vec2<f32>(cos(a), sin(a)) * rr, cell, led);
        let g = load(q).rgb;
        let l = luma(g);
        let w = 1.0 + 7.0 * l * l * l;
        acc_g += g * w;
        acc_r += load(q + ca).rgb * w;
        acc_b += load(q - ca).rgb * w;
        wsum += w;
    }
    acc_g /= wsum;
    acc_r /= wsum;
    acc_b /= wsum;

    var col: vec3<f32>;
    if palette_on > 0.5 {
        col = vec3<f32>(pal(luma(acc_r)).r, pal(luma(acc_g)).g, pal(luma(acc_b)).b);
        // Red marks a lock (the tracker); it stays red in every palette.
        let red = clamp((acc_g.r - max(acc_g.g, acc_g.b)) * 1.4, 0.0, 1.0);
        col = mix(col, LOCK_RED, red);
    } else {
        col = vec3<f32>(acc_r.r, acc_g.g, acc_b.b);
    }

    // Bloom: a wide ring of taps lifts everything around bright areas.
    if bloom > 0.0 {
        let glow_r = 26.0 * px_scale + r * 0.6;
        var glow = 0.0;
        var glow_col = vec3<f32>(0.0);
        var glow_red = 0.0;
        for (var j = 0; j < GLOW_TAPS; j++) {
            let fj = f32(j);
            let a = fj * GOLDEN + spin * 0.5;
            let rr = sqrt((fj + 0.5) / f32(GLOW_TAPS)) * glow_r;
            let g = load(px + vec2<f32>(cos(a), sin(a)) * rr).rgb;
            let l = luma(g);
            glow += l * l;
            glow_col += g * l * l;
            glow_red += clamp(g.r - max(g.g, g.b), 0.0, 1.0);
        }
        glow /= f32(GLOW_TAPS);
        glow_col /= f32(GLOW_TAPS);
        glow_red /= f32(GLOW_TAPS);
        if palette_on > 0.5 {
            col += pal(min(1.0, glow * 1.6)) * glow * 0.75 * bloom;
            col += vec3<f32>(1.0, 0.1, 0.05) * glow_red * 0.9 * bloom;
        } else {
            col += glow_col * 0.9 * bloom;
        }
    }

    // LED grid: equal-area RGB stripes per cell inside rounded LED rows; it
    // fades out where the depth of field blurs past a cell.
    if led > 0.0 {
        let cu = fract(px / cell) - 0.5;
        let uu = cu.x + 0.5;
        let sub = 0.5 + 0.5 * cos(6.2831853 * (vec3<f32>(uu) - vec3<f32>(0.1667, 0.5, 0.8333)));
        let rowm = 1.0 - smoothstep(0.28, 0.5, abs(cu.y));
        let colm = 1.0 - smoothstep(0.36, 0.5, abs(cu.x));
        let led_px = rowm * colm * (0.4 + 1.0 * sub);
        let led_amt = (1.0 - smoothstep(0.8, 3.5, r / cell)) * led;
        col *= mix(vec3<f32>(1.0), led_px * 1.3, led_amt * 0.9);
    }

    // Vignette, rolling flicker, grain.
    let v = s * vec2<f32>(0.85, 1.15);
    col *= 1.0 - 0.42 * dot(v, v) * vignette * 1.6;
    col *= 1.0 - scanlines * (0.06 - 0.06 * sin(coord.y * 0.9 / px_scale - time * 55.0));
    col += (hash(coord + frame_seed * 1.31) - 0.5) * 0.12 * grain;

    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), load(px).a);
}
