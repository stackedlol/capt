import { cx } from "cva";
import { onCleanup, onMount } from "solid-js";

type Peak = { x: number; height: number; width: number; skew: number };

const CELL_W = 9;
const CELL_H = 14;
const FONT_SIZE = 12;

const RANGES: { peaks: Peak[]; alpha: number; lift: number; seed: number }[] = [
	{
		alpha: 0.32,
		lift: 0.1,
		seed: 11,
		peaks: [
			{ x: 0.08, height: 0.5, width: 0.16, skew: 0.2 },
			{ x: 0.3, height: 0.62, width: 0.14, skew: -0.1 },
			{ x: 0.74, height: 0.66, width: 0.15, skew: 0.15 },
			{ x: 0.95, height: 0.52, width: 0.14, skew: -0.2 },
		],
	},
	{
		alpha: 0.78,
		lift: 0,
		seed: 29,
		peaks: [
			{ x: 0.2, height: 0.42, width: 0.12, skew: 0.3 },
			{ x: 0.44, height: 0.7, width: 0.1, skew: -0.25 },
			{ x: 0.56, height: 0.94, width: 0.085, skew: 0.35 },
			{ x: 0.64, height: 0.8, width: 0.07, skew: -0.2 },
			{ x: 0.86, height: 0.46, width: 0.13, skew: 0.1 },
		],
	},
];

function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function ridge(cols: number, peaks: Peak[], seed: number) {
	const rand = mulberry32(seed);
	const octaves = [0.6, 1.7, 4.3, 9.1].map((freq) => ({
		freq,
		phase: rand() * Math.PI * 2,
	}));
	const heights: number[] = [];
	for (let col = 0; col < cols; col++) {
		const u = col / Math.max(1, cols - 1);
		let h = 0;
		for (const p of peaks) {
			const dx = u - p.x;
			const side = dx < 0 ? 1 - p.skew : 1 + p.skew;
			const t = Math.abs(dx) / (p.width * side);
			h = Math.max(h, p.height * Math.max(0, 1 - t ** 1.15));
		}
		let n = 0;
		for (const [i, o] of octaves.entries()) {
			n += Math.sin(u * Math.PI * 2 * o.freq + o.phase) / 2 ** (i + 1);
		}
		heights.push(Math.max(0, h + n * 0.05 * (0.4 + h)));
	}
	return heights;
}

const ROCK = [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"];

function draw(canvas: HTMLCanvasElement) {
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (width === 0 || height === 0) return;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);
	ctx.font = `600 ${FONT_SIZE}px Manrope, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	const cols = Math.ceil(width / CELL_W);
	const rows = Math.ceil(height / CELL_H);
	const cells = new Map<number, { char: string; alpha: number }>();

	for (const range of RANGES) {
		const heights = ridge(cols, range.peaks, range.seed);
		const rand = mulberry32(range.seed * 7);
		for (let col = 0; col < cols; col++) {
			const h = heights[col] * (1 - range.lift) + range.lift * 0.6;
			const top = Math.round(rows * (1 - h));
			const slope =
				(heights[col + 1] ?? heights[col]) - (heights[col - 1] ?? heights[col]);
			const peak = h > (heights[col - 1] ?? 0) && h >= (heights[col + 1] ?? 0);
			const lit = slope > 0;
			for (let row = Math.max(0, top); row < rows; row++) {
				const depth = (row - top) / Math.max(1, rows - top);
				const snow = h > 0.55 && row - top < (h - 0.5) * rows * 0.35;
				let char: string;
				let alpha = range.alpha;
				if (row === top) {
					char = peak
						? "^"
						: Math.abs(slope) < 0.004
							? "_"
							: slope > 0
								? "/"
								: "\\";
					alpha = Math.min(1, range.alpha + 0.2);
				} else if (snow) {
					char = rand() < 0.55 ? (lit ? "*" : "+") : ".";
					alpha = Math.min(1, range.alpha + 0.15);
				} else {
					const shade =
						(lit ? 0.35 : 0.65) + depth * 0.25 + (rand() - 0.5) * 0.3;
					const index = Math.max(
						0,
						Math.min(ROCK.length - 1, Math.round(shade * (ROCK.length - 1))),
					);
					char = ROCK[index];
					alpha = range.alpha * (1 - depth * 0.55);
				}
				cells.set(row * cols + col, { char, alpha });
			}
		}
	}

	for (const [key, { char, alpha }] of cells) {
		if (char === " ") continue;
		const col = key % cols;
		const row = Math.floor(key / cols);
		ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
		ctx.fillText(char, col * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2);
	}
}

export function AsciiMountains(props: { class?: string }) {
	let canvas: HTMLCanvasElement | undefined;

	onMount(() => {
		if (!canvas) return;
		const target = canvas;
		let frame = 0;
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => draw(target));
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(target);
		void document.fonts
			.load(`600 ${FONT_SIZE}px Manrope`)
			.catch(() => {})
			.finally(schedule);
		onCleanup(() => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		});
	});

	return (
		<canvas
			ref={canvas}
			aria-hidden="true"
			class={cx("block w-full pointer-events-none", props.class)}
		/>
	);
}
