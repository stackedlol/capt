// One effects-studio operator per pass. The renderer ping-pongs the frame
// through one draw per live node, so each op sees the previous op's output.

struct Uniforms {
    // (width, height, time seconds, seed).
    size_time: vec4<f32>,
    // (op index, mix, a, b).
    params: vec4<f32>,
    // (r, g, b, click pulse).
    color: vec4<f32>,
    p0: vec4<f32>,
    p1: vec4<f32>,
    p2: vec4<f32>,
    p3: vec4<f32>,
    p4: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var frame_texture: texture_2d<f32>;

const TAU: f32 = 6.2831853;
const GOLDEN: f32 = 2.39996323;

const ASCII_RAMP = array<u32, 10>(
    0u, 4u, 131200u, 31744u, 1016800u, 4357252u, 22511061u, 11512810u, 27070835u, 15261391u
);

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

fn bilinear(p: vec2<f32>) -> vec4<f32> {
    let q = p - 0.5;
    let i = floor(q);
    let f = q - i;
    let a = load(i + vec2<f32>(0.5, 0.5));
    let b = load(i + vec2<f32>(1.5, 0.5));
    let c = load(i + vec2<f32>(0.5, 1.5));
    let d = load(i + vec2<f32>(1.5, 1.5));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn mirror_repeat(p: vec2<f32>) -> vec2<f32> {
    let res = u.size_time.xy;
    let t = p / res;
    let m = abs(t - 2.0 * floor((t + 1.0) * 0.5));
    return min(m, vec2<f32>(2.0) - m) * res;
}

fn bayer8(p: vec2<f32>) -> f32 {
    let x = u32(p.x) % 8u;
    let y = u32(p.y) % 8u;
    let v = x ^ y;
    let b = ((v & 1u) << 5u) | ((x & 1u) << 4u) | ((v & 2u) << 2u) | ((x & 2u) << 1u)
        | ((v & 4u) >> 1u) | ((x & 4u) >> 2u);
    return (f32(b) + 0.5) / 64.0;
}

fn rotate(v: vec2<f32>, angle: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec2<f32>(c * v.x - s * v.y, s * v.x + c * v.y);
}

fn hue_rotate(c: vec3<f32>, angle: f32) -> vec3<f32> {
    let k = vec3<f32>(0.57735);
    let cos_a = cos(angle);
    return c * cos_a + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - cos_a);
}

fn rot_x(v: vec3<f32>, angle: f32) -> vec3<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec3<f32>(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

fn rot_y(v: vec3<f32>, angle: f32) -> vec3<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec3<f32>(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn rot_z(v: vec3<f32>, angle: f32) -> vec3<f32> {
    let r = rotate(v.xy, angle);
    return vec3<f32>(r, v.z);
}

// The frame as a card floating in front of a perspective camera, Blender
// product-shot style. Angles are radians; `fit` is how much of the frame
// height the untilted card covers, so tilted corners stay in shot. Off the
// card is a soft studio backdrop in the node color with a contact shadow.
fn floating_card(coord: vec2<f32>, pitch: f32, yaw: f32, roll: f32, fit: f32) -> vec4<f32> {
    let res = u.size_time.xy;
    let aspect = res.x / res.y;
    let n = (coord - res * 0.5) / res.y;
    let focal = 1.8;
    let dist = focal / fit;
    let ray = vec3<f32>(n, focal);
    let centre = vec3<f32>(0.0, 0.0, dist);
    let normal = rot_z(rot_y(rot_x(vec3<f32>(0.0, 0.0, -1.0), pitch), yaw), roll);

    let floor_glow = 1.0 - smoothstep(0.0, 1.1, length(n * vec2<f32>(0.8, 1.3) - vec2<f32>(0.0, 0.18)));
    var colour = u.color.rgb * (0.25 + 0.75 * floor_glow);

    let denom = dot(ray, normal);
    if abs(denom) < 1e-4 {
        return vec4<f32>(colour, 1.0);
    }
    let t = dot(centre, normal) / denom;
    if t <= 0.0 {
        return vec4<f32>(colour, 1.0);
    }
    let hit = ray * t - centre;
    let local = rot_x(rot_y(rot_z(hit, -roll), -yaw), -pitch).xy;

    let half_size = vec2<f32>(aspect * 0.5, 0.5);
    let radius = 0.018;
    let q = abs(local) - half_size + radius;
    let sd = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - radius;
    let aa = 1.5 / (res.y * fit);

    colour *= 1.0 - 0.55 * exp(-max(sd, 0.0) * 14.0);
    let cover = 1.0 - smoothstep(-aa, aa, sd);
    if cover <= 0.0 {
        return vec4<f32>(colour, 1.0);
    }

    var card = bilinear(local * res.y + res * 0.5).rgb;
    let sheen_line = local.x * 0.7 + local.y * 0.5 + yaw * 0.9 - pitch * 0.4;
    card += vec3<f32>(pow(max(0.0, 1.0 - abs(sheen_line) / 0.45), 2.0) * 0.06);
    return vec4<f32>(mix(colour, card, cover), 1.0);
}

fn aces(x: vec3<f32>) -> vec3<f32> {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn apply(coord: vec2<f32>, src: vec4<f32>) -> vec4<f32> {
    let res = u.size_time.xy;
    let time = u.size_time.z;
    let seed = u.size_time.w;
    let op = i32(u.params.x + 0.5);
    let a = u.params.z;
    let b = u.params.w;
    let tint = u.color.rgb;
    let pulse = u.color.w;
    let px = res.y / 1080.0;
    let center = res * 0.5;
    let s = coord - center;

    switch op {
        // Pixelate: a = cell size.
        case 0: {
            let cell = mix(2.0, 64.0, pow(a, 1.5)) * px;
            return load((floor(coord / cell) + 0.5) * cell);
        }
        // Wave: a = amplitude, b = frequency.
        case 1: {
            let amp = a * 60.0 * px;
            let freq = mix(1.0, 30.0, b) * TAU;
            let off = vec2<f32>(
                sin(coord.y / res.y * freq + time * 3.0),
                0.5 * cos(coord.x / res.y * freq * 0.7 + time * 2.3)
            ) * amp;
            return bilinear(coord + off);
        }
        // Mirror: a picks left/right, top/bottom or quad; b picks the side kept.
        case 2: {
            var uv = coord / res;
            let keep_far = b > 0.5;
            if a < 0.34 || a >= 0.67 {
                let d = abs(uv.x - 0.5);
                uv.x = select(0.5 - d, 0.5 + d, keep_far);
            }
            if a >= 0.34 {
                let d = abs(uv.y - 0.5);
                uv.y = select(0.5 - d, 0.5 + d, keep_far);
            }
            return bilinear(uv * res);
        }
        // Kaleidoscope: a = segments, b = spin (0.5 still).
        case 3: {
            let segments = floor(mix(2.0, 16.0, a));
            let sector = TAU / segments;
            var angle = atan2(s.y, s.x) + time * (b - 0.5) * 2.0;
            angle = angle - sector * floor(angle / sector);
            angle = abs(angle - sector * 0.5);
            let r = length(s);
            return bilinear(mirror_repeat(center + vec2<f32>(cos(angle), sin(angle)) * r));
        }
        // Fisheye: a = bulge (0.5 flat, lower pinches), b = zoom.
        case 4: {
            let n = s / res.y;
            let k = (a - 0.5) * 2.4;
            let warped = n * (1.0 + k * dot(n, n)) / mix(0.6, 1.6, b) * (1.0 + max(k, 0.0) * 0.12);
            let p = center + warped * res.y;
            if any(p < vec2<f32>(0.0)) || any(p > res) {
                return vec4<f32>(0.0, 0.0, 0.0, src.a);
            }
            return bilinear(p);
        }
        // Transform: a = zoom (0.5 none), b = rotation (0.5 none). Tiles past edges.
        case 5: {
            let zoom = exp2((a - 0.5) * 3.0);
            let p = center + rotate(s, -(b - 0.5) * TAU) / zoom;
            return bilinear(mirror_repeat(p));
        }
        // RGB split: a = distance, b = angle.
        case 6: {
            let d = vec2<f32>(cos(b * TAU), sin(b * TAU)) * (a * 40.0 + pulse * 30.0) * px;
            return vec4<f32>(bilinear(coord + d).r, src.g, bilinear(coord - d).b, src.a);
        }
        // Blur: a = radius.
        case 7: {
            let r = a * 40.0 * px;
            if r < 0.5 {
                return src;
            }
            var acc = vec4<f32>(0.0);
            for (var i = 0; i < 28; i++) {
                let fi = f32(i);
                let ang = fi * GOLDEN;
                acc += bilinear(coord + vec2<f32>(cos(ang), sin(ang)) * sqrt((fi + 0.5) / 28.0) * r);
            }
            return acc / 28.0;
        }
        // Glow: a = radius, b = threshold.
        case 8: {
            let r = mix(8.0, 90.0, a) * px;
            var glow = vec3<f32>(0.0);
            for (var i = 0; i < 24; i++) {
                let fi = f32(i);
                let ang = fi * GOLDEN;
                let g = bilinear(coord + vec2<f32>(cos(ang), sin(ang)) * sqrt((fi + 0.5) / 24.0) * r).rgb;
                glow += g * smoothstep(b, b + 0.25, luma(g));
            }
            return vec4<f32>(src.rgb + glow / 24.0 * 1.8, src.a);
        }
        // Edges: a = strength, b = keep source color (else tinted lines on black).
        case 9: {
            let o = max(px, 1.0);
            let tl = luma(load(coord + vec2<f32>(-o, -o)).rgb);
            let t = luma(load(coord + vec2<f32>(0.0, -o)).rgb);
            let tr = luma(load(coord + vec2<f32>(o, -o)).rgb);
            let l = luma(load(coord + vec2<f32>(-o, 0.0)).rgb);
            let r = luma(load(coord + vec2<f32>(o, 0.0)).rgb);
            let bl = luma(load(coord + vec2<f32>(-o, o)).rgb);
            let bm = luma(load(coord + vec2<f32>(0.0, o)).rgb);
            let br = luma(load(coord + vec2<f32>(o, o)).rgb);
            let gx = tr + 2.0 * r + br - tl - 2.0 * l - bl;
            let gy = bl + 2.0 * bm + br - tl - 2.0 * t - tr;
            let e = clamp(length(vec2<f32>(gx, gy)) * mix(1.0, 8.0, a), 0.0, 1.0);
            return vec4<f32>(mix(tint * e, src.rgb * e * 1.6, b), src.a);
        }
        // Levels: a = contrast, b = brightness (0.5 neutral).
        case 10: {
            let contrast = exp2((a - 0.5) * 3.0);
            return vec4<f32>((src.rgb - 0.5) * contrast + 0.5 + (b - 0.5), src.a);
        }
        // Hue: a = rotation (0.5 none), b = saturation (0.5 unchanged).
        case 11: {
            let rotated = hue_rotate(src.rgb, (a - 0.5) * TAU);
            let l = luma(rotated);
            return vec4<f32>(mix(vec3<f32>(l), rotated, b * 2.0), src.a);
        }
        // Posterize: a = how few levels.
        case 12: {
            let levels = round(mix(16.0, 2.0, a));
            return vec4<f32>(floor(src.rgb * levels + 0.5) / levels, src.a);
        }
        // Threshold: a = level, b = softness; light parts take the node color.
        case 13: {
            let soft = b * 0.25 + 0.002;
            let t = smoothstep(a - soft, a + soft, luma(src.rgb));
            return vec4<f32>(tint * t, src.a);
        }
        case 14: {
            return vec4<f32>(1.0 - src.rgb, src.a);
        }
        // Gradient map through the node palette: a = contrast.
        case 15: {
            let l = (luma(src.rgb) - 0.5) * exp2((a - 0.5) * 2.0) + 0.5;
            return vec4<f32>(pal(l), src.a);
        }
        // Tint: duotone toward the node color; b lifts highlights to white.
        case 16: {
            let l = luma(src.rgb);
            let duo = tint * l * 1.4;
            return vec4<f32>(mix(duo, vec3<f32>(1.0), smoothstep(1.0 - b, 1.0, l) * b), src.a);
        }
        // Ordered dither: a = cell size, b = levels.
        case 17: {
            let cell = mix(1.0, 8.0, a) * px;
            let p = floor(coord / cell);
            let c = load((p + 0.5) * cell).rgb;
            let levels = round(mix(1.0, 5.0, b));
            return vec4<f32>(floor(c * levels + bayer8(p)) / levels, src.a);
        }
        // Halftone: a = cell size, b = screen angle.
        case 18: {
            let cell = mix(4.0, 40.0, a) * px;
            let angle = b * 1.5708;
            let q = rotate(coord, angle);
            let cell_center = (floor(q / cell) + 0.5) * cell;
            let c = load(rotate(cell_center, -angle)).rgb;
            let r = sqrt(luma(c)) * cell * 0.72;
            let cover = 1.0 - smoothstep(r - px, r + px, length(q - cell_center));
            return vec4<f32>(c * cover * 1.2, src.a);
        }
        // ASCII: a = cell size, b = node color instead of source color.
        case 19: {
            let cell = mix(3.0, 14.0, a) * px;
            let size = vec2<f32>(cell * 2.0, cell * 2.8);
            let c_idx = floor(coord / size);
            let c = load((c_idx + 0.5) * size).rgb;
            let q = (coord - c_idx * size) / size;
            let gx = floor((q.x - 0.1) / 0.8 * 5.0);
            let gy = floor((q.y - 0.12) / 0.76 * 5.0);
            let idx = u32(clamp(luma(c) * 9.99, 0.0, 9.0));
            var cover = 0.0;
            if gx >= 0.0 && gx < 5.0 && gy >= 0.0 && gy < 5.0 {
                cover = f32((ASCII_RAMP[idx] >> ((4u - u32(gy)) * 5u + (4u - u32(gx)))) & 1u);
            }
            return vec4<f32>(mix(c, tint, b) * cover, src.a);
        }
        // Scanlines: a = line size, b = roll speed.
        case 20: {
            let period = mix(2.0, 12.0, a) * px;
            let m = 0.5 + 0.5 * sin((coord.y / period - time * b * 20.0) * TAU);
            return vec4<f32>(src.rgb * (0.5 + 0.5 * m) * 1.15, src.a);
        }
        // LED grid (from ff-tracking's lens): a = cell size, b = glow.
        case 21: {
            let cell = mix(3.0, 24.0, a) * px;
            let c = load((floor(coord / cell) + 0.5) * cell).rgb;
            let cu = fract(coord / cell) - 0.5;
            let sub = 0.5 + 0.5 * cos(TAU * (vec3<f32>(cu.x + 0.5) - vec3<f32>(0.1667, 0.5, 0.8333)));
            let rowm = 1.0 - smoothstep(0.28, 0.5, abs(cu.y));
            let colm = 1.0 - smoothstep(0.36, 0.5, abs(cu.x));
            return vec4<f32>(c * rowm * colm * (0.4 + sub) * mix(1.5, 2.6, b), src.a);
        }
        // Grain: a = amount, b = grain size.
        case 22: {
            let size = mix(1.0, 4.0, b) * px;
            let n = hash(floor(coord / size) + vec2<f32>(seed, floor(time * 30.0))) - 0.5;
            return vec4<f32>(src.rgb + n * a * 0.45, src.a);
        }
        // Vignette: a = amount, b = softness.
        case 23: {
            let n = s / res.y * vec2<f32>(0.85, 1.15);
            let inner = mix(0.85, 0.15, a);
            let fall = smoothstep(inner, inner + mix(0.08, 0.8, b), length(n));
            return vec4<f32>(src.rgb * (1.0 - fall), src.a);
        }
        // Glitch: a = amount, b = band height. Click locks kick it harder.
        case 24: {
            let amt = clamp(a + pulse * 0.6, 0.0, 1.0);
            let step_t = floor(time * 12.0);
            let band = floor(coord.y / (mix(4.0, 60.0, b) * px));
            let n = hash(vec2<f32>(band, step_t * 1.7 + seed));
            let hit = step(1.0 - amt * 0.35, n);
            let shift = (hash(vec2<f32>(band, step_t + 9.0)) - 0.5) * 260.0 * px * amt * hit;
            let p = coord + vec2<f32>(shift, 0.0);
            let split = vec2<f32>(18.0 * px * amt * hit, 0.0);
            var c = vec3<f32>(bilinear(p + split).r, bilinear(p).g, bilinear(p - split).b);
            let block = floor(coord / (48.0 * px));
            if hash(block + vec2<f32>(step_t, seed)) > 1.0 - amt * amt * 0.012 {
                c = 1.0 - c;
            }
            return vec4<f32>(c, bilinear(p).a);
        }
        // Tilt: the frame as a card in 3D. a = pitch, b = yaw (0.5 flat).
        case 25: {
            let pitch = (a - 0.5) * 1.3;
            let yaw = (b - 0.5) * 1.5;
            let fit = 0.86 - 0.22 * max(abs(a - 0.5), abs(b - 0.5)) * 2.0;
            return floating_card(coord, pitch, yaw, 0.0, fit);
        }
        // Orbit: the card swings on a slow camera arc. a = swing, b = speed.
        case 26: {
            let w = mix(0.08, 1.0, b);
            let swing = a * 0.75;
            let yaw = sin(time * w) * swing;
            let pitch = 0.2 + sin(time * w * 0.7 + 1.3) * 0.08 * (0.3 + a);
            let roll = sin(time * w * 0.5) * 0.035 * a;
            return floating_card(coord, pitch, yaw, roll, 0.72 - a * 0.08);
        }
        // Dolly: slow push in and out with a drifting dutch angle. a = push, b = speed.
        case 27: {
            let w = mix(0.1, 1.2, b);
            let zoom = 1.0 + a * 0.35 * (0.5 - 0.5 * cos(time * w));
            let drift = vec2<f32>(sin(time * w * 0.6), cos(time * w * 0.45)) * a * 0.015 * res.y;
            let roll = sin(time * w * 0.3) * a * 0.035;
            return bilinear(mirror_repeat(center + rotate(s, roll) / zoom + drift / zoom));
        }
        // Tilt-shift depth of field: a = blur, b = focus line height.
        case 28: {
            let away = abs(coord.y / res.y - b);
            let r = a * 34.0 * px * smoothstep(0.06, 0.42, away);
            if r < 0.5 {
                return src;
            }
            var acc = vec4<f32>(0.0);
            for (var i = 0; i < 28; i++) {
                let fi = f32(i);
                let ang = fi * GOLDEN;
                acc += bilinear(coord + vec2<f32>(cos(ang), sin(ang)) * sqrt((fi + 0.5) / 28.0) * r);
            }
            return acc / 28.0;
        }
        // Letterbox: a = aspect (1.85:1 to 2.76:1), b = bar opacity. Bars take the node color.
        case 29: {
            let ratio = mix(1.85, 2.76, a);
            let visible = res.x / ratio;
            let edge = abs(coord.y - center.y) - visible * 0.5;
            let bar = smoothstep(-0.5, 0.5, edge) * clamp(0.25 + b * 0.75, 0.0, 1.0);
            return vec4<f32>(mix(src.rgb, tint, bar), src.a);
        }
        // Anamorphic streaks: horizontal lens flares off highlights. a = strength, b = threshold.
        case 30: {
            let reach = 0.35 * res.x;
            var streak = 0.0;
            for (var i = 0; i < 32; i++) {
                let fi = (f32(i) + 0.5) / 32.0;
                let x = (fi * 2.0 - 1.0) * reach;
                let l = luma(bilinear(coord + vec2<f32>(x, 0.0)).rgb);
                streak += smoothstep(b, b + 0.15, l) * pow(1.0 - abs(fi * 2.0 - 1.0), 3.0);
            }
            return vec4<f32>(src.rgb + tint * streak / 32.0 * a * 9.0, src.a);
        }
        // Halation: film's warm halo bleeding off bright edges. a = amount, b = radius.
        case 31: {
            let r = mix(4.0, 40.0, b) * px;
            var halo = 0.0;
            for (var i = 0; i < 20; i++) {
                let fi = f32(i);
                let ang = fi * GOLDEN;
                let g = bilinear(coord + vec2<f32>(cos(ang), sin(ang)) * sqrt((fi + 0.5) / 20.0) * r).rgb;
                halo += smoothstep(0.6, 0.95, luma(g));
            }
            return vec4<f32>(src.rgb + tint * halo / 20.0 * a * 1.4, src.a);
        }
        // Light leak: warm drifting glow screened over the frame. a = amount, b = drift speed.
        case 32: {
            let uv = coord / res;
            let t = time * mix(0.05, 0.6, b) + seed * 0.13;
            let p1 = vec2<f32>(0.15 + 0.25 * sin(t * 1.3), 0.2 + 0.3 * cos(t * 0.9));
            let p2 = vec2<f32>(0.9 + 0.15 * cos(t * 0.7), 0.75 + 0.2 * sin(t * 1.1));
            let d1 = length((uv - p1) * vec2<f32>(res.x / res.y, 1.0));
            let d2 = length((uv - p2) * vec2<f32>(res.x / res.y, 1.0));
            let leak = tint * exp(-d1 * d1 * 5.0) + tint.bgr * 0.6 * exp(-d2 * d2 * 7.0);
            let l = clamp(leak * a * 1.4, vec3<f32>(0.0), vec3<f32>(1.0));
            return vec4<f32>(1.0 - (1.0 - src.rgb) * (1.0 - l), src.a);
        }
        // Film grade: filmic tone curve with teal shadows and warm highlights.
        // a = strength, b = warmth (0.5 neutral).
        case 33: {
            let toned = aces(src.rgb * 1.15);
            let l = luma(toned);
            let warm = (b - 0.5) * 2.0;
            let shadow = vec3<f32>(-0.03, 0.02, 0.05) * (1.0 - warm * 0.5);
            let high = vec3<f32>(0.06, 0.02, -0.05) * (1.0 + warm);
            let graded = toned + shadow * (1.0 - smoothstep(0.0, 0.5, l)) + high * smoothstep(0.45, 1.0, l);
            return vec4<f32>(mix(src.rgb, graded, a), src.a);
        }
        // Lens: barrel distortion with radial chromatic fringing. a = fringing, b = barrel.
        case 34: {
            let n = s / res.y;
            let k = b * 0.35;
            let warped = n * (1.0 + k * dot(n, n)) / (1.0 + k * 0.25);
            let fringe = a * 0.025 * length(n);
            let pr = center + warped * (1.0 + fringe) * res.y;
            let pg = center + warped * res.y;
            let pb = center + warped * (1.0 - fringe) * res.y;
            if any(pr < vec2<f32>(0.0)) || any(pr > res) {
                return vec4<f32>(0.0, 0.0, 0.0, src.a);
            }
            return vec4<f32>(bilinear(pr).r, bilinear(pg).g, bilinear(pb).b, src.a);
        }
        default: {}
    }
    return src;
}

@fragment
fn fs_main(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
    let coord = frag_coord.xy;
    let src = load(coord);
    let out = apply(coord, src);
    let blended = mix(src, out, clamp(u.params.y, 0.0, 1.0));
    return clamp(blended, vec4<f32>(0.0), vec4<f32>(1.0));
}
