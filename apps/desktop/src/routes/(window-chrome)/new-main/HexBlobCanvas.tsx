import { cx } from "cva";
import { onCleanup, onMount } from "solid-js";

export type BlobCell = {
	x: number;
	y: number;
	apothem: number;
	state: 0 | 1 | 2;
};

export type BlobFrame = {
	cells: BlobCell[];
	cursor: { x: number; y: number } | null;
	time: number;
};

export type BlobRenderer = {
	draw: (frame: BlobFrame) => void;
	resize: () => void;
	dispose: () => void;
};

const MAX_CELLS = 8;
const CORNER = 6;
const SMOOTH = 9;
const CURSOR_APOTHEM = 6;

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
uniform float u_time;
uniform float u_smooth;
uniform float u_corner;
uniform int u_count;
uniform vec4 u_cells[${MAX_CELLS}];
uniform vec4 u_cursor;
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

float smin(float a, float b, float k) {
	float h = max(k - abs(a - b), 0.0) / k;
	return min(a, b) - h * h * k * 0.25;
}

void main() {
	vec2 p = vec2(gl_FragCoord.x / u_dpr - u_size.x * 0.5, u_size.y * 0.5 - gl_FragCoord.y / u_dpr);

	float field = 1e5;
	float weightSum = 0.0;
	vec3 fillSum = vec3(0.0);
	for (int i = 0; i < ${MAX_CELLS}; i++) {
		if (i >= u_count) break;
		vec4 c = u_cells[i];
		float d = sdRoundHexagon(p - c.xy, c.z, u_corner);
		field = smin(field, d, u_smooth);
		float w = exp(-d * 0.25);
		fillSum += (c.w > 1.5 ? u_fillSelected : (c.w > 0.5 ? u_fillHover : u_fill)) * w;
		weightSum += w;
	}
	if (u_cursor.w > 0.5) {
		float d = sdRoundHexagon(p - u_cursor.xy, u_cursor.z, min(u_corner, u_cursor.z * 0.6));
		field = smin(field, d, u_smooth);
		float w = exp(-d * 0.25);
		fillSum += u_fillHover * w;
		weightSum += w;
	}
	vec3 fill = weightSum > 0.0 ? fillSum / weightSum : u_fill;

	float rim = smoothstep(-6.0, 0.0, field);
	float aa = max(fwidth(field), 0.5);
	float inside = 1.0 - smoothstep(-aa, aa, field);
	vec3 color = mix(fill, u_ink, rim * rim * 0.1);
	float alpha = inside;
	color *= alpha;
	outColor = vec4(color, alpha);
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

	const uniform = (name: string) => gl.getUniformLocation(program, name);
	const locations = {
		size: uniform("u_size"),
		dpr: uniform("u_dpr"),
		time: uniform("u_time"),
		smooth: uniform("u_smooth"),
		corner: uniform("u_corner"),
		count: uniform("u_count"),
		cells: uniform("u_cells"),
		cursor: uniform("u_cursor"),
	};
	for (const [name, value] of Object.entries(THEME_COLORS)) {
		gl.uniform3fv(uniform(name), parseHex(value));
	}

	let width = 0;
	let height = 0;
	let dpr = 1;
	const cellData = new Float32Array(MAX_CELLS * 4);

	const resize = () => {
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
		gl.uniform1f(locations.smooth, SMOOTH);
		gl.uniform1f(locations.corner, CORNER);
	};

	const draw = (frame: BlobFrame) => {
		if (width === 0) resize();
		if (width === 0) return;
		const count = Math.min(frame.cells.length, MAX_CELLS);
		for (let i = 0; i < count; i++) {
			const c = frame.cells[i];
			cellData[i * 4] = c.x;
			cellData[i * 4 + 1] = c.y;
			cellData[i * 4 + 2] = c.apothem;
			cellData[i * 4 + 3] = c.state;
		}
		gl.uniform4fv(locations.cells, cellData);
		gl.uniform1i(locations.count, count);
		gl.uniform4f(
			locations.cursor,
			frame.cursor?.x ?? 0,
			frame.cursor?.y ?? 0,
			CURSOR_APOTHEM,
			frame.cursor ? 1 : 0,
		);
		gl.uniform1f(locations.time, frame.time);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	return {
		draw,
		resize,
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
