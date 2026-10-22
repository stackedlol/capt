import { cx } from "cva";
import { onCleanup, onMount } from "solid-js";

export type BlobShape = {
	x: number;
	y: number;
	apothem: number;
	corner: number;
	vx: number;
	vy: number;
	hover: number;
	selected: number;
};

export type BlobRenderer = {
	draw: (shapes: readonly BlobShape[], count: number) => void;
	resize: () => void;
	dispose: () => void;
};

export const MAX_BLOBS = 8;
const SMOOTH_REST = 12;
const SMOOTH_MOTION = 28;
const SMOOTH_SPEED = 320;
const MAX_STRETCH = 0.12;
const STRETCH_SPEED = 450;

const THEME_COLORS = {
	u_fill: "#ffffff",
	u_fillHover: "#f4f4f4",
	u_fillSelected: "#dfe5f5",
	u_ink: "#202020",
} as const;

const VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
	gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 u_size;
uniform float u_dpr;
uniform float u_smooth;
uniform int u_count;
uniform vec4 u_shape[${MAX_BLOBS}];
uniform vec4 u_style[${MAX_BLOBS}];
uniform vec3 u_fill;
uniform vec3 u_fillHover;
uniform vec3 u_fillSelected;
uniform vec3 u_ink;

out vec4 outColor;

float sdHexagon(vec2 p, float apothem) {
	const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
	p = abs(p);
	p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
	p -= vec2(clamp(p.x, -k.z * apothem, k.z * apothem), apothem);
	return length(p) * sign(p.y);
}

float sdRoundHexagon(vec2 p, float apothem, float corner) {
	return sdHexagon(p, apothem - corner) - corner;
}

float blobDistance(vec2 p, vec4 shape, vec2 stretch) {
	vec2 q = p - shape.xy;
	float amount = length(stretch);
	vec2 dir = amount > 1e-4 ? stretch / amount : vec2(1.0, 0.0);
	float grow = 1.0 + amount;
	float thin = inversesqrt(grow);
	float along = dot(q, dir);
	q = dir * (along / grow) + (q - dir * along) / thin;
	return sdRoundHexagon(q, shape.z, shape.w) * thin;
}

float smin(float a, float b, float k) {
	float h = max(k - abs(a - b), 0.0) / k;
	return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

void main() {
	vec2 p = vec2(gl_FragCoord.x / u_dpr - u_size.x * 0.5, u_size.y * 0.5 - gl_FragCoord.y / u_dpr);

	float field = 1e5;
	float weightSum = 0.0;
	vec3 fillSum = vec3(0.0);
	for (int i = 0; i < ${MAX_BLOBS}; i++) {
		if (i >= u_count) break;
		vec4 style = u_style[i];
		float d = blobDistance(p, u_shape[i], style.xy);
		field = smin(field, d, u_smooth);
		float w = exp(-d * 0.25);
		fillSum += mix(mix(u_fill, u_fillHover, style.z), u_fillSelected, style.w) * w;
		weightSum += w;
	}
	vec3 fill = weightSum > 0.0 ? fillSum / weightSum : u_fill;

	float rim = smoothstep(-6.0, 0.0, field);
	float aa = max(fwidth(field), 0.5);
	float inside = 1.0 - smoothstep(-aa, aa, field);
	vec3 color = mix(fill, u_ink, rim * rim * 0.1);
	outColor = vec4(color * inside, inside);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error("Hex blob shader failed:", gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function parseHex(value: string): [number, number, number] {
	const hex = value.replace("#", "");
	return [0, 2, 4].map(
		(i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255,
	) as [number, number, number];
}

export function createBlobRenderer(
	canvas: HTMLCanvasElement,
): BlobRenderer | null {
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		premultipliedAlpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		powerPreference: "low-power",
	});
	if (!gl) return null;
	const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
	const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
	const program = gl.createProgram();
	if (!vertex || !fragment || !program) return null;
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.error("Hex blob program failed:", gl.getProgramInfoLog(program));
		return null;
	}
	gl.useProgram(program);
	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);
	gl.disable(gl.DEPTH_TEST);
	gl.disable(gl.BLEND);
	gl.clearColor(0, 0, 0, 0);

	const uniform = (name: string) => gl.getUniformLocation(program, name);
	const locations = {
		size: uniform("u_size"),
		dpr: uniform("u_dpr"),
		smooth: uniform("u_smooth"),
		count: uniform("u_count"),
		shape: uniform("u_shape"),
		style: uniform("u_style"),
	};
	for (const [name, value] of Object.entries(THEME_COLORS)) {
		gl.uniform3fv(uniform(name), parseHex(value));
	}

	let width = 0;
	let height = 0;
	let dpr = 1;
	let count = 0;
	let smooth = SMOOTH_REST;
	const shapeData = new Float32Array(MAX_BLOBS * 4);
	const styleData = new Float32Array(MAX_BLOBS * 4);

	const measure = () => {
		const rect = canvas.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return;
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		width = rect.width;
		height = rect.height;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform2f(locations.size, width, height);
		gl.uniform1f(locations.dpr, dpr);
	};

	const render = () => {
		if (width === 0) return;
		gl.uniform4fv(locations.shape, shapeData);
		gl.uniform4fv(locations.style, styleData);
		gl.uniform1i(locations.count, count);
		gl.uniform1f(locations.smooth, smooth);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	const draw = (shapes: readonly BlobShape[], length: number) => {
		count = Math.min(length, MAX_BLOBS);
		let fastest = 0;
		for (let i = 0; i < count; i++) {
			const shape = shapes[i];
			const speed = Math.hypot(shape.vx, shape.vy);
			const stretch =
				speed > 1e-3
					? (Math.min(speed / STRETCH_SPEED, 1) * MAX_STRETCH) / speed
					: 0;
			fastest = Math.max(fastest, speed);
			shapeData[i * 4] = shape.x;
			shapeData[i * 4 + 1] = shape.y;
			shapeData[i * 4 + 2] = shape.apothem;
			shapeData[i * 4 + 3] = shape.corner;
			styleData[i * 4] = shape.vx * stretch;
			styleData[i * 4 + 1] = shape.vy * stretch;
			styleData[i * 4 + 2] = shape.hover;
			styleData[i * 4 + 3] = shape.selected;
		}
		smooth =
			SMOOTH_REST +
			(SMOOTH_MOTION - SMOOTH_REST) * Math.min(fastest / SMOOTH_SPEED, 1);
		if (width === 0 || dpr !== Math.min(window.devicePixelRatio || 1, 2)) {
			measure();
		}
		render();
	};

	return {
		draw,
		resize: () => {
			measure();
			render();
		},
		dispose: () => {
			gl.deleteProgram(program);
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
			gl.deleteVertexArray(vao);
		},
	};
}

export function HexBlobCanvas(props: {
	class?: string;
	onRenderer: (renderer: BlobRenderer | null) => void;
}) {
	let canvas: HTMLCanvasElement | undefined;

	onMount(() => {
		if (!canvas) return;
		const target = canvas;
		const renderer = createBlobRenderer(target);
		props.onRenderer(renderer);
		if (!renderer) return;
		const observer = new ResizeObserver(() => renderer.resize());
		observer.observe(target);
		onCleanup(() => {
			observer.disconnect();
			renderer.dispose();
			props.onRenderer(null);
		});
	});

	return (
		<canvas
			ref={canvas}
			aria-hidden="true"
			class={cx("block size-full pointer-events-none", props.class)}
		/>
	);
}
