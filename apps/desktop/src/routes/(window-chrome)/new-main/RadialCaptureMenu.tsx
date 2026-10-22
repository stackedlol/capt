import { cx } from "cva";
import {
	type Component,
	type ComponentProps,
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { CaptMark } from "~/components/CaptMark";
import {
	type Blob,
	createMotion,
	type MotionInput,
	type Point,
	settled,
	step,
} from "./blob-motion";
import {
	type BlobRenderer,
	type BlobShape,
	HexBlobCanvas,
	MAX_BLOBS,
} from "./HexBlobCanvas";
import { createPerformanceMetrics, MetricBlock } from "./PerformanceStrip";

export type CaptureAction = "studio" | "screenshot";
export type CaptureTarget = "display" | "area";

type Axial = { q: number; r: number };

type CaptureCell = Axial & {
	action: CaptureAction;
	target: CaptureTarget;
	label: string;
	group: string;
	Icon: Component<ComponentProps<"svg">>;
};

// Heavy rounded glyphs in the style of the macOS screenshot toolbar.
function IconDisplay(props: ComponentProps<"svg">) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
			<rect
				x="3"
				y="4.5"
				width="18"
				height="15"
				rx="3.25"
				stroke="currentColor"
				stroke-width="2"
			/>
			<rect x="6" y="14" width="12" height="2.75" rx="1" fill="currentColor" />
		</svg>
	);
}

function IconArea(props: ComponentProps<"svg">) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
			<path
				stroke="currentColor"
				stroke-width="2"
				d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16M10.25 4h3.5M20 10.25v3.5M13.75 20h-3.5M4 13.75v-3.5"
			/>
		</svg>
	);
}

const RADIUS = 47;
const PITCH = 50;
const CORNER = 6;
const SQRT3 = Math.sqrt(3);
const HEX_W = RADIUS * 2;
const HEX_H = RADIUS * SQRT3;
const APOTHEM = (RADIUS - 0.5) * (SQRT3 / 2) * 0.9;
const STAGE = 272;
const SELECT_DELAY_MS = 220;
const IDLE_FRAME_MS = 1000;
const CALM_FRAME_MS = 32;
const CURSOR_APOTHEM = 6;

const CAPTURES: CaptureCell[] = [
	{
		q: -1,
		r: 0,
		action: "studio",
		target: "display",
		group: "Record",
		label: "Record Desktop",
		Icon: IconDisplay,
	},
	{
		q: -1,
		r: 1,
		action: "studio",
		target: "area",
		group: "Record",
		label: "Custom\nArea",
		Icon: IconArea,
	},
	{
		q: 1,
		r: -1,
		action: "screenshot",
		target: "display",
		group: "Screenshot",
		label: "Capture Desktop",
		Icon: IconDisplay,
	},
	{
		q: 1,
		r: 0,
		action: "screenshot",
		target: "area",
		group: "Screenshot",
		label: "Custom Bounds",
		Icon: IconArea,
	},
];

const CENTRE: Axial = { q: 0, r: 0 };
const OPEN_CELLS: Axial[] = [
	{ q: 0, r: -1 },
	{ q: 0, r: 1 },
];
const CELLS: Axial[] = [...CAPTURES, CENTRE, ...OPEN_CELLS];
const CENTRE_INDEX = CAPTURES.length;

function centre(cell: Axial): Point {
	return {
		x: PITCH * 1.5 * cell.q,
		y: PITCH * SQRT3 * (cell.r + cell.q / 2),
	};
}

function smoothstep(edge0: number, edge1: number, value: number) {
	const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
	return t * t * (3 - 2 * t);
}

function hexPath(radius: number, corner: number) {
	const cx = HEX_W / 2;
	const cy = HEX_H / 2;
	const points = Array.from({ length: 6 }, (_, i) => {
		const a = (Math.PI / 3) * i;
		return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
	});
	let d = "";
	for (let i = 0; i < 6; i++) {
		const prev = points[(i + 5) % 6];
		const curr = points[i];
		const next = points[(i + 1) % 6];
		const into = Math.hypot(curr.x - prev.x, curr.y - prev.y);
		const out = Math.hypot(next.x - curr.x, next.y - curr.y);
		const a = {
			x: curr.x + ((prev.x - curr.x) * corner) / into,
			y: curr.y + ((prev.y - curr.y) * corner) / into,
		};
		const b = {
			x: curr.x + ((next.x - curr.x) * corner) / out,
			y: curr.y + ((next.y - curr.y) * corner) / out,
		};
		d += `${i === 0 ? "M" : "L"}${a.x.toFixed(2)} ${a.y.toFixed(2)}Q${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
	}
	return `${d}Z`;
}

const HEX_PATH = hexPath(RADIUS - 0.5, CORNER);
// A flat-top hexagon narrows towards its top and bottom; two label lines under
// the icon sit where the cell is still ~66px wide, so cap labels there and let
// long ones break onto a second balanced line instead of touching the edges.
const LABEL_FIT =
	"relative max-w-[64px] font-medium leading-[1.15] tracking-[-0.01em] normal-case whitespace-pre-line text-balance break-words";
const HEX_CLIP =
	"polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";

const cellBox: JSX.CSSProperties = {
	left: `calc(50% - ${HEX_W / 2}px)`,
	top: `calc(50% - ${HEX_H / 2}px)`,
	width: `${HEX_W}px`,
	height: `${HEX_H}px`,
};

function HexFrame(props: { class?: string }) {
	return (
		<svg
			aria-hidden="true"
			class="absolute inset-0 overflow-visible"
			width={HEX_W}
			height={HEX_H}
			viewBox={`0 0 ${HEX_W} ${HEX_H}`}
		>
			<path
				d={HEX_PATH}
				class={cx(
					"transition-[fill,stroke] duration-150 [vector-effect:non-scaling-stroke]",
					props.class,
				)}
			/>
		</svg>
	);
}

const TOOL_ROW_Y = -122;
const TOOL_ROW_X = 88;

export default function RadialCaptureMenu(props: {
	activeAction: CaptureAction | null;
	activeTarget: CaptureTarget | null;
	disabled?: boolean;
	onSelect: (action: CaptureAction, target: CaptureTarget) => void;
	topLeft?: JSX.Element;
	topRight?: JSX.Element;
}) {
	const reducedMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	const [renderer, setRenderer] = createSignal<BlobRenderer | null>(null);
	const [webgl, setWebgl] = createSignal(true);
	const metrics = createPerformanceMetrics();
	const elements: (HTMLElement | undefined)[] = [];
	const placed = CELLS.map(() => ({ transform: "", opacity: "" }));
	const shapes: BlobShape[] = Array.from({ length: MAX_BLOBS }, () => ({
		x: 0,
		y: 0,
		apothem: 0,
		corner: 0,
		vx: 0,
		vy: 0,
		hover: 0,
		selected: 0,
	}));
	const pointerAt: Point = { x: 0, y: 0 };
	const motion = createMotion(CELLS.map(centre), true, reducedMotion);
	const input: MotionInput = {
		open: reducedMotion,
		hovered: null,
		selected: null,
		pointer: null,
	};
	let stage!: HTMLDivElement;
	let stageRect: DOMRect | null = null;
	let selectTimer: ReturnType<typeof setTimeout> | undefined;

	const isActive = (cell: CaptureCell) =>
		props.activeAction === cell.action && props.activeTarget === cell.target;
	const selectedIndex = createMemo(() => {
		const index = CAPTURES.findIndex(isActive);
		return index < 0 ? null : index;
	});
	const selected = () => {
		const index = selectedIndex();
		return index === null ? null : CAPTURES[index];
	};

	const place = (blob: Blob, index: number) => {
		const element = elements[index];
		if (!element) return;
		const reach = Math.hypot(blob.home.x, blob.home.y);
		const fade =
			reach > 0
				? smoothstep(0.35, 0.85, Math.hypot(blob.x, blob.y) / reach)
				: 1;
		const visible = fade * (props.disabled && index < CENTRE_INDEX ? 0.5 : 1);
		const transform = `translate3d(${blob.x.toFixed(2)}px, ${blob.y.toFixed(2)}px, 0)`;
		const opacity = visible > 0.995 ? "" : visible.toFixed(3);
		const last = placed[index];
		if (last.transform !== transform) {
			element.style.transform = transform;
			last.transform = transform;
		}
		if (last.opacity !== opacity) {
			element.style.opacity = opacity;
			last.opacity = opacity;
		}
	};

	const paint = () => {
		const target = renderer();
		if (target) {
			let count = 0;
			for (const blob of motion.blobs) {
				const shape = shapes[count++];
				shape.x = blob.x;
				shape.y = blob.y;
				shape.apothem = APOTHEM * blob.scale;
				shape.corner = CORNER;
				shape.vx = blob.vx;
				shape.vy = blob.vy;
				shape.hover = blob.hover;
				shape.selected = blob.selected;
			}
			const cursor = motion.cursor;
			if (cursor && cursor.size > 0.01 && count < MAX_BLOBS) {
				const shape = shapes[count++];
				shape.x = cursor.x;
				shape.y = cursor.y;
				shape.apothem = CURSOR_APOTHEM * cursor.size;
				shape.corner = Math.min(CORNER, shape.apothem * 0.6);
				shape.vx = 0;
				shape.vy = 0;
				shape.hover = 1;
				shape.selected = 0;
			}
			target.draw(shapes, count);
		}
		motion.blobs.forEach(place);
	};

	onMount(() => {
		let raf = 0;
		let last = performance.now();
		let lastPaint = 0;

		const frame = (now: number) => {
			raf = requestAnimationFrame(frame);
			if (document.hidden) {
				last = now;
				return;
			}
			input.selected = selectedIndex();
			const budget = settled(motion, input, 1)
				? document.hasFocus()
					? CALM_FRAME_MS
					: IDLE_FRAME_MS
				: 0;
			if (now - lastPaint < budget) return;
			step(motion, (now - last) / 1000, input);
			last = now;
			lastPaint = now;
			paint();
		};

		if (!input.open) {
			requestAnimationFrame(() => {
				input.open = true;
			});
		}
		raf = requestAnimationFrame(frame);
		const onVisibility = () => {
			last = performance.now();
		};
		const observer = new ResizeObserver(() => {
			stageRect = null;
		});
		observer.observe(stage);
		document.addEventListener("visibilitychange", onVisibility);
		onCleanup(() => {
			cancelAnimationFrame(raf);
			clearTimeout(selectTimer);
			observer.disconnect();
			document.removeEventListener("visibilitychange", onVisibility);
		});
	});

	const select = (cell: CaptureCell) => {
		if (props.disabled || selectTimer) return;
		if (reducedMotion) {
			props.onSelect(cell.action, cell.target);
			return;
		}
		input.open = false;
		selectTimer = setTimeout(() => {
			selectTimer = undefined;
			props.onSelect(cell.action, cell.target);
			input.open = true;
		}, SELECT_DELAY_MS);
	};

	const trackPointer = (event: PointerEvent) => {
		stageRect ??= stage.getBoundingClientRect();
		pointerAt.x = event.clientX - stageRect.left - stageRect.width / 2;
		pointerAt.y = event.clientY - stageRect.top - stageRect.height / 2;
		input.pointer = reducedMotion ? null : pointerAt;
	};
	const hover = (index: number) => {
		input.hovered = index;
	};
	const unhover = (index: number) => {
		if (input.hovered === index) input.hovered = null;
	};

	return (
		<div
			ref={stage}
			class="relative w-full shrink-0 lowercase"
			style={{ height: `${STAGE}px` }}
			onPointerEnter={(event) => {
				stageRect = null;
				trackPointer(event);
			}}
			onPointerMove={trackPointer}
			onPointerLeave={() => {
				input.pointer = null;
			}}
		>
			<Show when={webgl()}>
				<HexBlobCanvas
					class="absolute inset-0"
					onRenderer={(next) => {
						setRenderer(next);
						if (next === null && renderer() === null) setWebgl(false);
					}}
				/>
			</Show>

			<div
				class="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5"
				style={{
					left: `calc(50% - ${TOOL_ROW_X}px)`,
					top: `calc(50% + ${TOOL_ROW_Y}px)`,
				}}
			>
				{props.topLeft}
			</div>
			<div
				class="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5"
				style={{
					left: `calc(50% + ${TOOL_ROW_X}px)`,
					top: `calc(50% + ${TOOL_ROW_Y}px)`,
				}}
			>
				{props.topRight}
			</div>

			<For each={OPEN_CELLS}>
				{(_, index) => (
					<div
						ref={(element) => {
							elements[CENTRE_INDEX + 1 + index()] = element;
						}}
						class="pointer-events-auto absolute flex items-center justify-center will-change-[transform,opacity]"
						style={cellBox}
					>
						<Show when={!webgl()}>
							<HexFrame class="fill-gray-1 stroke-gray-6 [stroke-width:1]" />
						</Show>
						<MetricBlock
							metrics={index() === 0 ? metrics.slice(0, 1) : metrics.slice(1)}
						/>
					</div>
				)}
			</For>

			<div
				ref={(element) => {
					elements[CENTRE_INDEX] = element;
				}}
				data-tauri-drag-region
				class="absolute flex cursor-grab flex-col items-center justify-center gap-1 text-center will-change-transform active:cursor-grabbing [&>*]:pointer-events-none"
				style={{ ...cellBox, "clip-path": HEX_CLIP }}
			>
				<Show when={!webgl()}>
					<HexFrame class="fill-gray-1 stroke-gray-7 [stroke-width:1]" />
				</Show>
				<Show
					when={selected()}
					fallback={
						<CaptMark
							state="thinking"
							variant="brand"
							cells={18}
							gap={0.22}
							class="relative size-8 [--capt-band:3.6s] [--capt-sweep:2.4s]"
						/>
					}
				>
					{(cell) => (
						<span
							class={cx(
								LABEL_FIT,
								"text-[11px] tracking-[-0.01em]",
								webgl() ? "text-[#1c1c1e]" : "text-gray-12",
							)}
						>
							{cell().label}
						</span>
					)}
				</Show>
			</div>

			<For each={CAPTURES}>
				{(cell, index) => (
					<button
						ref={(element) => {
							elements[index()] = element;
						}}
						type="button"
						disabled={props.disabled}
						aria-pressed={isActive(cell) ? "true" : "false"}
						aria-label={`${cell.group}: ${cell.label}`}
						onClick={() => select(cell)}
						onPointerEnter={() => hover(index())}
						onPointerLeave={() => unhover(index())}
						onFocus={() => hover(index())}
						onBlur={() => unhover(index())}
						style={{ ...cellBox, "clip-path": HEX_CLIP }}
						class={cx(
							"group absolute flex flex-col items-center justify-center gap-[5px] text-center outline-hidden will-change-[transform,opacity]",
							props.disabled && "pointer-events-none",
						)}
					>
						<Show when={!webgl()}>
							<HexFrame
								class={cx(
									"[stroke-width:1] group-focus-visible:stroke-blue-9 group-focus-visible:[stroke-width:2]",
									isActive(cell)
										? "fill-blue-3 stroke-blue-8 dark:fill-blue-4"
										: "fill-gray-2 stroke-gray-6 group-hover:fill-gray-3 group-hover:stroke-gray-8",
								)}
							/>
						</Show>
						<cell.Icon
							class={cx(
								"relative size-[26px] shrink-0 transition-colors duration-150",
								isActive(cell)
									? "text-[#15255c]"
									: webgl()
										? "text-[#1c1c1e]"
										: "text-gray-12",
							)}
						/>
						<span
							class={cx(
								LABEL_FIT,
								"text-[10px] transition-colors duration-150",
								isActive(cell)
									? "text-[#22397f]"
									: webgl()
										? "text-[#7c7c83] group-hover:text-[#4a4a50]"
										: "text-gray-10 group-hover:text-gray-11",
							)}
						>
							{cell.label}
						</span>
					</button>
				)}
			</For>
		</div>
	);
}
