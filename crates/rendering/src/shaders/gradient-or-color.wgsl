struct Uniforms {
	start: vec4<f32>,
	end: vec4<f32>,
	angle: f32,
	noise_intensity: f32,
	noise_scale: f32,
	_padding: f32,
	// (kind: 0 none, 1 dither, 2 halftone, 3 ascii; cell px; strength; unused).
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
