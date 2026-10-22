import { cx } from "cva";
import {
	type Component,
	type ComponentProps,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import IconCapLogo from "~icons/cap/logo";
import IconLucideCamera from "~icons/lucide/camera";
import IconLucideCrop from "~icons/lucide/crop";
import IconLucideMonitorPlay from "~icons/lucide/monitor-play";
import IconLucideSquareDashedMousePointer from "~icons/lucide/square-dashed-mouse-pointer";
import {
	createMotion,
	type MotionInput,
	type MotionState,
	type Point,
	settled,
	step,
} from "./blob-motion";
import {
	type BlobCell,
	type BlobRenderer,
	HexBlobCanvas,
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

const CAPTURES: CaptureCell[] = [
	{
		q: -1,
		r: 0,
		action: "studio",
		target: "display",
		group: "Record",
		label: "record desktop",
		Icon: IconLucideMonitorPlay,
	},
	{
		q: -1,
		r: 1,
		action: "studio",
		target: "area",
		group: "Record",
		label: "custom area",
		Icon: IconLucideSquareDashedMousePointer,
	},
	{
		q: 1,
		r: -1,
		action: "screenshot",
		target: "display",
		group: "Screenshot",
		label: "capture desktop",
		Icon: IconLucideCamera,
	},
	{
		q: 1,
		r: 0,
		action: "screenshot",
		target: "area",
		group: "Screenshot",
		label: "custom bounds",
		Icon: IconLucideCrop,
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
	"relative max-w-[64px] font-medium leading-[1.15] text-balance break-words";
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
	const [hovered, setHovered] = createSignal<number | null>(null);
	const [open, setOpen] = createSignal(reducedMotion);
	const [pointer, setPointer] = createSignal<Point | null>(null);
	const metrics = createPerformanceMetrics();
	const elements: (HTMLElement | undefined)[] = [];
	let stage!: HTMLDivElement;
	let motion: MotionState = createMotion(CELLS.map(centre), !reducedMotion);
	let selectTimer: ReturnType<typeof setTimeout> | undefined;

	const isActive = (cell: CaptureCell) =>
		props.activeAction === cell.action && props.activeTarget === cell.target;
	const selected = () => CAPTURES.find(isActive) ?? null;

	const cellState = (index: number): BlobCell["state"] => {
		const capture = CAPTURES[index];
		if (capture && isActive(capture)) return 2;
		return hovered() === index ? 1 : 0;
	};

	const place = (blob: Point, index: number) => {
		const element = elements[index];
		if (!element) return;
		element.style.transform = `translate(${blob.x.toFixed(2)}px, ${blob.y.toFixed(2)}px)`;
	};

	const paint = () => {
		const frame = {
			cells: motion.blobs.map((blob, index) => ({
				x: blob.x,
				y: blob.y,
				apothem: APOTHEM * (hovered() === index ? 1.03 : 1),
				state: cellState(index),
			})),
			cursor: motion.cursor,
			time: motion.time,
		};
		renderer()?.draw(frame);
		motion.blobs.forEach(place);
	};

	onMount(() => {
		let raf = 0;
		let last = performance.now();
		let lastPaint = 0;

		const input = (): MotionInput => ({
			open: open(),
			hovered: hovered(),
			pointer: pointer(),
		});

		const frame = (now: number) => {
			raf = requestAnimationFrame(frame);
			if (document.hidden) {
				last = now;
				return;
			}
			const idle = !document.hasFocus() && settled(motion, input(), 1);
			if (idle && now - lastPaint < IDLE_FRAME_MS) return;
			const elapsed = (now - last) / 1000;
			last = now;
			lastPaint = now;
			if (!reducedMotion) motion = step(motion, elapsed, input());
			paint();
		};

		if (!open()) requestAnimationFrame(() => setOpen(true));
		raf = requestAnimationFrame(frame);
		const onVisibility = () => {
			last = performance.now();
		};
		document.addEventListener("visibilitychange", onVisibility);
		onCleanup(() => {
			cancelAnimationFrame(raf);
			clearTimeout(selectTimer);
			document.removeEventListener("visibilitychange", onVisibility);
		});
	});

	const select = (cell: CaptureCell) => {
		if (props.disabled || selectTimer) return;
		if (reducedMotion) {
			props.onSelect(cell.action, cell.target);
			return;
		}
		setOpen(false);
		selectTimer = setTimeout(() => {
			selectTimer = undefined;
			props.onSelect(cell.action, cell.target);
			setOpen(true);
		}, SELECT_DELAY_MS);
	};

	const trackPointer = (event: PointerEvent) => {
		const rect = stage.getBoundingClientRect();
		setPointer({
			x: event.clientX - rect.left - rect.width / 2,
			y: event.clientY - rect.top - rect.height / 2,
		});
	};

	return (
		<div
			ref={stage}
			class="relative w-full shrink-0 lowercase"
			style={{ height: `${STAGE}px` }}
			onPointerMove={trackPointer}
			onPointerLeave={() => setPointer(null)}
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
						class="pointer-events-auto absolute flex items-center justify-center"
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
				class="absolute flex cursor-grab flex-col items-center justify-center gap-1 text-center active:cursor-grabbing [&>*]:pointer-events-none"
				style={{ ...cellBox, "clip-path": HEX_CLIP }}
			>
				<Show when={!webgl()}>
					<HexFrame class="fill-gray-1 stroke-gray-7 [stroke-width:1]" />
				</Show>
				<Show
					when={selected()}
					fallback={
						<IconCapLogo
							class={cx("relative size-8", webgl() && "text-[#1c1c1e]")}
						/>
					}
				>
					{(cell) => (
						<span
							class={cx(
								LABEL_FIT,
								"text-[12px] tracking-[-0.01em]",
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
						onPointerEnter={() => setHovered(index())}
						onPointerLeave={() =>
							setHovered((current) => (current === index() ? null : current))
						}
						onFocus={() => setHovered(index())}
						onBlur={() =>
							setHovered((current) => (current === index() ? null : current))
						}
						style={{ ...cellBox, "clip-path": HEX_CLIP }}
						class={cx(
							"group absolute flex flex-col items-center justify-center gap-1 text-center outline-hidden will-change-transform",
							props.disabled && "pointer-events-none opacity-50",
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
								"relative size-[18px] transition-colors duration-150",
								isActive(cell)
									? "text-[#15255c]"
									: webgl()
										? "text-[#6e6e75] group-hover:text-[#1c1c1e]"
										: "text-gray-10 group-hover:text-gray-12",
							)}
						/>
						<span
							class={cx(
								LABEL_FIT,
								"text-[11px]",
								isActive(cell)
									? "text-[#22397f]"
									: webgl()
										? "text-[#1c1c1e]"
										: "text-gray-12",
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
