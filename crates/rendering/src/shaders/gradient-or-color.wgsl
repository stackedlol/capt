struct Uniforms {
	start: vec4<f32>,
	end: vec4<f32>,
	angle: f32,
	noise_intensity: f32,
	noise_scale: f32,
	_padding: f32,
	// (kind: 0 none, 1 dither, 2 halftone, 3 ascii, 4 stacked dither, 5 ascii
	// flow, 6 flow lines; cell px; strength; time in seconds for kinds 4+).
	pattern: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash22(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn value_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u_interp = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(hash22(i + vec2(0.0, 0.0)), hash22(i + vec2(1.0, 0.0)), u_interp.x),
        mix(hash22(i + vec2(0.0, 1.0)), hash22(i + vec2(1.0, 1.0)), u_interp.x),
        u_interp.y
    );
}

fn fbm(p: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var coord = p;
    for (var i = 0; i < 4; i++) {
        value += amplitude * value_noise(coord);
        coord *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

fn overlay_channel(base: f32, blend: f32) -> f32 {
    if base < 0.5 {
        return 2.0 * base * blend;
    } else {
        return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
    }
}

// Ramp " .:-=+*#%@" as 5x5 bitmaps, rows top to bottom, MSB left.
const ASCII_RAMP = array<u32, 10>(
    0u, 4u, 131200u, 31744u, 1016800u, 4357252u, 22511061u, 11512810u, 27070835u, 15261391u
);

fn bayer8(p: vec2<f32>) -> f32 {
    let x = u32(p.x) % 8u;
    let y = u32(p.y) % 8u;
    let v = x ^ y;
    // Bit-interleaved 8x8 Bayer index.
    let b = ((v & 1u) << 5u) | ((x & 1u) << 4u) | ((v & 2u) << 2u) | ((x & 2u) << 1u)
        | ((v & 4u) >> 1u) | ((x & 4u) >> 2u);
    return (f32(b) + 0.5) / 64.0;
}

fn modf_pos(x: f32, m: f32) -> f32 {
    return x - m * floor(x / m);
}

// 4x4 Bayer by the B4 = 4*B2(low bits) + B2(high bits) recursion, as in
// stacked-dither (no +0.5 offset, matching its thresholds exactly).
fn bayer4(c: vec2<f32>) -> f32 {
    let x = modf_pos(floor(c.x), 4.0);
    let y = modf_pos(floor(c.y), 4.0);
    let lo = modf_pos(2.0 * modf_pos(x, 2.0) + 3.0 * modf_pos(y, 2.0), 4.0);
    let hi = modf_pos(2.0 * floor(x / 2.0) + 3.0 * floor(y / 2.0), 4.0);
    return (4.0 * lo + hi) / 16.0;
}

fn sd_hash(p_in: vec2<f32>) -> f32 {
    var p = fract(p_in * vec2<f32>(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

fn sd_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(sd_hash(i), sd_hash(i + vec2<f32>(1.0, 0.0)), w.x),
        mix(sd_hash(i + vec2<f32>(0.0, 1.0)), sd_hash(i + vec2<f32>(1.0, 1.0)), w.x),
        w.y
    );
}

fn sd_fbm(p_in: vec2<f32>) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var p = p_in;
    let m = mat2x2<f32>(1.62, 1.18, -1.18, 1.62);
    for (var i = 0; i < 5; i++) {
        v += a * sd_noise(p);
        p = m * p;
        a *= 0.5;
    }
    return v;
}

// The stacked-dither field: (tone, crest). `uv` has y pointing up, like
// gl_FragCoord in the original, so its light and dark corners land the same.
fn stacked_field(uv: vec2<f32>, aspect: vec2<f32>, time: f32) -> vec2<f32> {
    let p = (uv - 0.5) * aspect * 2.5;
    let t = time * 0.11;
    let q = vec2<f32>(sd_fbm(p + vec2<f32>(0.0, t)), sd_fbm(p + vec2<f32>(5.2, -t * 0.8)));
    let r = vec2<f32>(
        sd_fbm(p + 2.6 * q + vec2<f32>(1.7, 9.2) + t * 0.22),
        sd_fbm(p + 2.6 * q + vec2<f32>(8.3, 2.8) - t * 0.17)
    );
    let f = sd_fbm(p + 3.1 * r);

    let ripple = sin((r.x * 3.4 + r.y * 2.2 + f * 5.6) * 3.6 - t * 2.6);
    let ripple2 = sin((q.x - q.y) * 6.2 + t * 1.7);
    var v = 0.03 + f * 0.54 + ripple * 0.26 + ripple2 * 0.09;

    let lift = 1.0 - clamp(distance(uv, vec2<f32>(0.24, 0.84)) * 0.95, 0.0, 1.0);
    v += 0.08 * pow(lift, 2.2);
    v -= 0.08 * pow(1.0 - clamp(distance(uv, vec2<f32>(0.86, 0.12)) * 1.4, 0.0, 1.0), 1.4);
    v = pow(clamp(v, 0.0, 1.0), 1.55);

    let glint = sd_noise(p * 1.7 + vec2<f32>(t * 0.9, -t * 0.6));
    var crest = smoothstep(0.94, 1.0, ripple) * 0.85;
    crest *= mix(0.4, 1.0, smoothstep(0.3, 0.7, glint));
    crest *= mix(0.55, 1.0, smoothstep(0.1, 0.45, v));
    return vec2<f32>(v, crest);
}

fn ascii_cover(frag: vec2<f32>, cell: f32, tone: f32) -> f32 {
    let size = vec2<f32>(cell * 2.0, cell * 2.8);
    let c = floor(frag / size);
    let q = (frag - c * size) / size;
    let gx = floor((q.x - 0.1) / 0.8 * 5.0);
    let gy = floor((q.y - 0.12) / 0.76 * 5.0);
    let idx = u32(clamp(tone * 9.99, 0.0, 9.0));
    if gx >= 0.0 && gx < 5.0 && gy >= 0.0 && gy < 5.0 {
        return f32((ASCII_RAMP[idx] >> ((4u - u32(gy)) * 5u + (4u - u32(gx)))) & 1u);
    }
    return 0.0;
}

fn flow_line_x(c: f32, phase: f32, row: f32, spacing: f32, px: f32, drift: f32) -> f32 {
    let jitter = (sd_hash(vec2<f32>(c, 3.17)) - 0.5) * spacing * 0.6;
    let bend = (sd_fbm(vec2<f32>(phase, row * 0.006 * px) + vec2<f32>(0.0, drift)) - 0.5)
        * spacing * 1.6;
    return (c + 0.5) * spacing + jitter + bend;
}

// Faint, nearly vertical lines after the andrewhunterlol background: each
// line wanders sideways with noise and fades between sparse specks and solid
// along its length, thresholded by the same 4x4 Bayer matrix.
fn flow_lines_cover(frag: vec2<f32>, cell: f32, res: vec2<f32>, time: f32) -> f32 {
    let px = max(round(cell / 3.0), 1.0);
    let g = floor(frag / px);
    let spacing = max(res.x / 10.0, 24.0) / px;
    let drift = time * 0.045;
    let col = floor(g.x / spacing);
    var on = 0.0;
    for (var k = -1; k <= 1; k++) {
        let c = col + f32(k);
        let phase = sd_hash(vec2<f32>(c, 7.31)) * 100.0;
        let x0 = flow_line_x(c, phase, g.y, spacing, px, drift);
        let x1 = flow_line_x(c, phase, g.y + 1.0, spacing, px, drift);
        // Cover the run between this row's x and the next one's so slanted
        // stretches stay connected, like the original's per-pixel tracer.
        if g.x >= floor(min(x0, x1)) && g.x <= floor(max(x0, x1)) {
            let density = 0.3 + 0.8 * sd_noise(vec2<f32>(g.y * 0.012 + phase, phase + drift * 2.0));
            on = max(on, step(bayer4(g), density));
        }
    }
    return on;
}

fn pattern_tone(uv: vec2<f32>) -> f32 {
    if all(u.start == u.end) {
        return clamp(1.15 - length(uv - vec2<f32>(0.5)) * 1.6, 0.0, 1.0);
    }
    return gradient_t(uv);
}

fn apply_pattern(base: vec4<f32>, uv: vec2<f32>, frag: vec2<f32>) -> vec4<f32> {
    let kind = u32(u.pattern.x + 0.5);
    if kind == 0u {
        return base;
    }
    let cell = max(u.pattern.y, 1.0);
    let strength = clamp(u.pattern.z, 0.0, 1.0);
    let t = pattern_tone(uv);

    var lo = u.start;
    var hi = u.end;
    if all(u.start == u.end) {
        lo = vec4<f32>(u.start.rgb * 0.22, u.start.a);
    }

    var cover = 0.0;
    let time = u.pattern.w;
    // tex_coords span the output exactly, so frag / uv recovers its size.
    let res = frag / max(uv, vec2<f32>(1e-6));
    let aspect = select(vec2<f32>(1.0, res.y / res.x), vec2<f32>(res.x / res.y, 1.0), res.x >= res.y);
    if kind == 4u {
        // Sample the field once per dither cell, like the original's
        // one-pixel-per-cell canvas.
        let c = floor(frag / cell);
        let cuv = (c + 0.5) * cell / res;
        let field = stacked_field(vec2<f32>(cuv.x, 1.0 - cuv.y), aspect, time);
        let d = bayer4(vec2<f32>(c.x, floor(res.y / cell) - 1.0 - c.y));
        cover = clamp(floor(field.x * 0.75 + d), 0.0, 1.0);
        if floor(field.y * 2.0 + d) > 0.5 {
            cover = 1.0;
        }
        return mix(base, mix(lo, hi, cover), strength);
    } else if kind == 5u {
        let size = vec2<f32>(cell * 2.0, cell * 2.8);
        let cuv = (floor(frag / size) + 0.5) * size / res;
        let field = stacked_field(vec2<f32>(cuv.x, 1.0 - cuv.y), aspect, time);
        // The field sits low (the original's ground colour); lift it so the
        // ramp reaches its denser glyphs instead of mostly blanks.
        let tone = clamp(pow(field.x, 0.6) * 1.25 + field.y * 0.6, 0.0, 1.0);
        cover = ascii_cover(frag, cell, tone);
        return mix(base, mix(lo, hi, cover), strength);
    } else if kind == 6u {
        cover = flow_lines_cover(frag, cell, res, time) * 0.6;
        return mix(base, mix(lo, hi, cover), strength);
    }
    if kind == 1u {
        cover = step(bayer8(floor(frag / cell)), t);
    } else if kind == 2u {
        let r = 0.7071;
        let rot = mat2x2<f32>(r, -r, r, r) * frag / (cell * 1.5);
        let d = length(fract(rot) - vec2<f32>(0.5));
        let radius = sqrt(t) * 0.62;
        cover = 1.0 - smoothstep(radius - 0.06, radius + 0.06, d);
    } else {
        let size = vec2<f32>(cell * 2.0, cell * 2.8);
        let c = floor(frag / size);
        let q = (frag - c * size) / size;
        let gx = floor((q.x - 0.1) / 0.8 * 5.0);
        let gy = floor((q.y - 0.12) / 0.76 * 5.0);
        let idx = u32(clamp(t * 9.99, 0.0, 9.0));
        if gx >= 0.0 && gx < 5.0 && gy >= 0.0 && gy < 5.0 {
            let bit = (ASCII_RAMP[idx] >> ((4u - u32(gy)) * 5u + (4u - u32(gx)))) & 1u;
            cover = f32(bit);
        }
    }

    let patterned = mix(lo, hi, cover);
    return mix(base, patterned, strength);
}

@fragment
fn fs_main(
    @builtin(position) frag_coord: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
) -> @location(0) vec4<f32> {
    var color = apply_pattern(gradient(tex_coords), tex_coords, frag_coord.xy);

    if u.noise_intensity > 0.0 {
        let freq = 0.3 + ((100.0 - u.noise_scale) / 100.0) * 1.2;
        let n = fbm(tex_coords * freq * 600.0);

        let blended = vec3<f32>(
            overlay_channel(color.r, n),
            overlay_channel(color.g, n),
            overlay_channel(color.b, n),
        );

        let intensity = (u.noise_intensity / 100.0) * 0.25;
        color = vec4<f32>(mix(color.rgb, blended, intensity), color.a);
    }

    return color;
}

fn gradient_t(uv: vec2<f32>) -> f32 {
		let angle_rad = radians(u.angle + 270.0);

		let dir = vec2<f32>(cos(angle_rad), sin(angle_rad));

		let proj = dot(uv - 0.5, dir) + 0.5;

		return clamp(proj, 0.0, 1.0);
}

fn gradient(uv: vec2<f32>) -> vec4<f32> {
		return mix(u.start, u.end, gradient_t(uv));
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(in_vertex_index & 1u) * 4 - 1);
    let y = f32(i32(in_vertex_index & 2u) * 2 - 1);
    out.tex_coords = vec2<f32>(x * 0.5 + 0.5, 1.0 - (y * 0.5 + 0.5));
    out.clip_position = vec4<f32>(x, y, 0.0, 1.0);

    return out;
}
