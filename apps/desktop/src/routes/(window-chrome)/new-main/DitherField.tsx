import { cx } from "cva";
import { onCleanup, onMount } from "solid-js";

const CELL_W = 8;
const CELL_H = 11;
const FONT_SIZE = 10;
const FRAME_MS = 90;
const RAMP = " .:-=+*#";
const ALPHA = 0.32;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
	(v) => (v + 0.5) / 16,
);

function field(u: number, v: number, t: number) {
	const a = Math.sin(u * 3.1 + t * 0.6);
	const b = Math.sin(v * 2.3 - t * 0.45);
	const c = Math.sin((u + v) * 1.7 + t * 0.3);
	const d = Math.sin(Math.hypot(u - 0.5, v - 0.5) * 7 - t * 0.8);
	return (a + b + c + d) / 8 + 0.5;
}

function draw(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	ink: string,
	t: number,
) {
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = ink;
	ctx.globalAlpha = ALPHA;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = `600 ${FONT_SIZE}px Manrope, sans-serif`;
	const cols = Math.ceil(width / CELL_W);
	const rows = Math.ceil(height / CELL_H);
	const levels = RAMP.length - 1;
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const value = field(x / cols, y / rows, t);
			const threshold = BAYER[(y & 3) * 4 + (x & 3)];
			const index = Math.min(
				levels,
				Math.max(0, Math.floor(value * levels + threshold - 0.5)),
			);
			if (index === 0) continue;
			ctx.fillText(
				RAMP[index],
				x * CELL_W + CELL_W / 2,
				y * CELL_H + CELL_H / 2,
			);
		}
	}
	ctx.globalAlpha = 1;
}

export function DitherField(props: { class?: string }) {
	let canvas: HTMLCanvasElement | undefined;

	onMount(() => {
		if (!canvas) return;
		const target = canvas;
		const ctx = target.getContext("2d");
		if (!ctx) return;
		const reducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		let width = 0;
		let height = 0;
		let raf = 0;
		let last = 0;
		const start = performance.now();

		const paint = (now: number) => {
			draw(
				ctx,
				width,
				height,
				getComputedStyle(target).color,
				(now - start) / 1000,
			);
		};

		const resize = () => {
			const rect = target.getBoundingClientRect();
			if (rect.width < 1 || rect.height < 1) return;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			width = rect.width;
			height = rect.height;
			target.width = Math.round(width * dpr);
			target.height = Math.round(height * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			paint(performance.now());
		};

		const frame = (now: number) => {
			raf = requestAnimationFrame(frame);
			if (document.hidden || now - last < FRAME_MS) return;
			last = now;
			paint(now);
		};

		const observer = new ResizeObserver(resize);
		observer.observe(target);
		resize();
		void document.fonts
			.load(`600 ${FONT_SIZE}px Manrope`)
			.catch(() => {})
			.finally(resize);
		if (!reducedMotion) raf = requestAnimationFrame(frame);

		onCleanup(() => {
			observer.disconnect();
			cancelAnimationFrame(raf);
		});
	});

	return (
		<canvas
			ref={canvas}
			aria-hidden="true"
			class={cx("block pointer-events-none text-gray-12", props.class)}
		/>
	);
}
