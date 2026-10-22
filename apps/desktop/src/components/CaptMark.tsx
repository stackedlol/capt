import { cx } from "cva";
import { For } from "solid-js";
import "./capt-loaders.css";

// Same geometry as scripts/capt-brand/mark.mjs: a navy rounded-square border
// around a pastel band with an empty centre, drawn cell by cell so each dot
// can animate on its own.
const RING_MID = 0.7;
const RING_INNER = 0.48;
const CORNER = 0.24;
const NAVY = "#1b2d6b";
const PASTEL = "#aebbe0";

type Tone = "hot" | "pastel";
type MarkCell = {
	x: number;
	y: number;
	tone: Tone;
	// 0..1 clockwise from 12 o'clock.
	angle: number;
	// 0 at the outer edge, rising towards the centre.
	depth: number;
};

function roundBoxDistance(
	px: number,
	py: number,
	half: number,
	corner: number,
) {
	const qx = Math.abs(px) - half + corner;
	const qy = Math.abs(py) - half + corner;
	return (
		Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
		Math.min(Math.max(qx, qy), 0) -
		corner
	);
}

function squareGauge(px: number, py: number) {
	let lo = 0;
	let hi = 3;
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (roundBoxDistance(px, py, mid, CORNER * mid) <= 0) hi = mid;
		else lo = mid;
	}
	return hi;
}

const cache = new Map<string, MarkCell[]>();

function markCells(n: number, mono: boolean) {
	const key = `${n}:${mono}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const radius = n / 2 - 0.5;
	const c = n / 2;
	// Checker the pastel band from the centre so all four corners mirror.
	const fold = (i: number) => (Math.abs(2 * i - (n - 1)) - 1) / 2;
	const cells: MarkCell[] = [];
	for (let row = 0; row < n; row++) {
		for (let col = 0; col < n; col++) {
			const dx = col + 0.5 - c;
			const dy = row + 0.5 - c;
			const d = squareGauge(dx / radius, dy / radius);
			if (d > 1 || d <= RING_INNER) continue;
			const tone: Tone = d > RING_MID ? "hot" : "pastel";
			if (mono && tone === "pastel" && (fold(col) + fold(row)) % 2 === 1)
				continue;
			cells.push({
				x: col,
				y: row,
				tone,
				angle: (Math.atan2(dy, dx) / (Math.PI * 2) + 1.25) % 1,
				depth: (1 - d) / (1 - RING_INNER),
			});
		}
	}
	cache.set(key, cells);
	return cells;
}

export type CaptMarkState = "idle" | "thinking" | "loading";

/**
 * The capt mark as live cells. `thinking` sweeps a comet around the border
 * while the pastel band counter-rotates; `loading` ripples from the border
 * inwards. Mono follows `currentColor`; `brand` uses navy and pastel.
 */
export function CaptMark(props: {
	class?: string;
	state?: CaptMarkState;
	variant?: "mono" | "brand";
	cells?: number;
	gap?: number;
	dither?: boolean;
	label?: string;
}) {
	const n = () => props.cells ?? 14;
	const inset = () => (props.gap ?? 0) / 2;
	const cells = () =>
		markCells(n(), props.variant !== "brand" || props.dither === true);
	const busy = () => (props.state ?? "idle") !== "idle";

	return (
		<svg
			viewBox={`1 1 ${n() - 2} ${n() - 2}`}
			shape-rendering="crispEdges"
			role={busy() ? "status" : undefined}
			aria-label={busy() ? (props.label ?? "Working") : undefined}
			aria-hidden={busy() ? undefined : "true"}
			class={cx(
				"capt-mark shrink-0",
				`capt-mark-${props.state ?? "idle"}`,
				props.class,
			)}
		>
			<For each={cells()}>
				{(cell) => (
					<rect
						x={cell.x + inset()}
						y={cell.y + inset()}
						width={1 - inset() * 2}
						height={1 - inset() * 2}
						class={cell.tone}
						fill={
							props.variant === "brand"
								? cell.tone === "hot"
									? NAVY
									: PASTEL
								: "currentColor"
						}
						style={{
							"--a": cell.angle.toFixed(3),
							"--d": cell.depth.toFixed(3),
						}}
					/>
				)}
			</For>
		</svg>
	);
}
