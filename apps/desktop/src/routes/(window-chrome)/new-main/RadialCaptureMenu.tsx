import { cx } from "cva";
import {
	type Component,
	type ComponentProps,
	createSignal,
	For,
	type JSX,
	Show,
} from "solid-js";
import IconCapLogo from "~icons/cap/logo";
import IconLucideCamera from "~icons/lucide/camera";
import IconLucideCrop from "~icons/lucide/crop";
import IconLucideMonitorPlay from "~icons/lucide/monitor-play";
import IconLucideSquareDashedMousePointer from "~icons/lucide/square-dashed-mouse-pointer";
import { DitherField } from "./DitherField";

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
const CORNER = 5;
const SQRT3 = Math.sqrt(3);
const HEX_W = RADIUS * 2;
const HEX_H = RADIUS * SQRT3;
const STAGE = 272;

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

const TAKEN = [{ q: 0, r: 0 }, ...CAPTURES];

const DIRECTIONS: Axial[] = [
	{ q: 1, r: 0 },
	{ q: 1, r: -1 },
	{ q: 0, r: -1 },
	{ q: -1, r: 0 },
	{ q: -1, r: 1 },
	{ q: 0, r: 1 },
];

function ring(radius: number): Axial[] {
	const out: Axial[] = [];
	let cell = { q: DIRECTIONS[4].q * radius, r: DIRECTIONS[4].r * radius };
	for (let side = 0; side < 6; side++) {
		for (let step = 0; step < radius; step++) {
			out.push(cell);
			cell = { q: cell.q + DIRECTIONS[side].q, r: cell.r + DIRECTIONS[side].r };
		}
	}
	return out;
}

const isFree = (cell: Axial) =>
	!TAKEN.some((t) => t.q === cell.q && t.r === cell.r);
const OPEN_CELLS = ring(1).filter(isFree);
const OUTER_COMB = ring(2);

function centre(cell: Axial) {
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

function placement(cell: Axial): JSX.CSSProperties {
	const { x, y } = centre(cell);
	return {
		left: `calc(50% + ${x - HEX_W / 2}px)`,
		top: `calc(50% + ${y - HEX_H / 2}px)`,
		width: `${HEX_W}px`,
		height: `${HEX_H}px`,
	};
}

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

export default function RadialCaptureMenu(props: {
	activeAction: CaptureAction | null;
	activeTarget: CaptureTarget | null;
	disabled?: boolean;
	onSelect: (action: CaptureAction, target: CaptureTarget) => void;
}) {
	const [hovered, setHovered] = createSignal<CaptureCell | null>(null);

	const isActive = (cell: CaptureCell) =>
		props.activeAction === cell.action && props.activeTarget === cell.target;

	const focus = () => hovered() ?? CAPTURES.find(isActive) ?? null;

	return (
		<div
			class="relative w-full shrink-0 lowercase"
			style={{ height: `${STAGE}px` }}
		>
			<DitherField class="absolute inset-0 size-full [mask-image:radial-gradient(closest-side,#000_72%,transparent)]" />

			<div
				aria-hidden="true"
				class="pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(closest-side,#000_40%,transparent)]"
			>
				<For each={OUTER_COMB}>
					{(cell) => (
						<div class="absolute" style={placement(cell)}>
							<HexFrame class="fill-transparent stroke-gray-6 [stroke-width:1]" />
						</div>
					)}
				</For>
			</div>

			<For each={OPEN_CELLS}>
				{(cell) => (
					<div
						aria-hidden="true"
						class="pointer-events-none absolute"
						style={placement(cell)}
					>
						<HexFrame class="fill-transparent stroke-gray-6 [stroke-width:1]" />
					</div>
				)}
			</For>

			<div
				class="absolute flex flex-col items-center justify-center gap-1 text-center"
				style={placement({ q: 0, r: 0 })}
			>
				<HexFrame class="fill-gray-1 stroke-gray-7 [stroke-width:1]" />
				<Show when={focus()} fallback={<IconCapLogo class="relative size-8" />}>
					{(cell) => (
						<>
							<span
								class={cx(
									LABEL_FIT,
									"text-[12px] tracking-[-0.01em] text-gray-12",
								)}
							>
								{cell().label}
							</span>
						</>
					)}
				</Show>
			</div>

			<For each={CAPTURES}>
				{(cell) => (
					<button
						type="button"
						disabled={props.disabled}
						aria-pressed={isActive(cell) ? "true" : "false"}
						aria-label={`${cell.group}: ${cell.label}`}
						onClick={() => props.onSelect(cell.action, cell.target)}
						onPointerEnter={() => setHovered(cell)}
						onPointerLeave={() => setHovered(null)}
						onFocus={() => setHovered(cell)}
						onBlur={() => setHovered(null)}
						style={{ ...placement(cell), "clip-path": HEX_CLIP }}
						class={cx(
							"group absolute flex flex-col items-center justify-center gap-1 text-center outline-hidden transition-transform duration-150 active:scale-[0.97]",
							props.disabled && "pointer-events-none opacity-50",
						)}
					>
						<HexFrame
							class={cx(
								"[stroke-width:1] group-focus-visible:stroke-blue-9 group-focus-visible:[stroke-width:2]",
								isActive(cell)
									? "fill-blue-3 stroke-blue-8 dark:fill-blue-4"
									: "fill-gray-2 stroke-gray-6 group-hover:fill-gray-3 group-hover:stroke-gray-8",
							)}
						/>
						<cell.Icon
							class={cx(
								"relative size-[18px] transition-colors duration-150",
								isActive(cell)
									? "text-blue-10"
									: "text-gray-10 group-hover:text-gray-12",
							)}
						/>
						<span
							class={cx(
								LABEL_FIT,
								"text-[11px]",
								isActive(cell) ? "text-blue-11" : "text-gray-12",
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
