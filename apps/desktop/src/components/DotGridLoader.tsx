import { cx } from "cva";
import { createSignal, Index, onCleanup, onMount } from "solid-js";
import { CaptMark } from "./CaptMark";

// A 3x3 grid of square dots stepped frame by frame, like a braille spinner.
// Cells are numbered row by row:
//   0 1 2
//   3 4 5
//   6 7 8
export type DotGridPattern = "orbit" | "scan" | "pulse";

const RING = [0, 1, 2, 5, 8, 7, 6, 3];
const TRAIL = [1, 0.55, 0.3];
const DIM = 0.14;

function orbitFrames() {
	return RING.map((_, step) => {
		const frame = Array<number>(9).fill(DIM);
		frame[4] = 0.35;
		TRAIL.forEach((level, back) => {
			frame[RING[(step - back + RING.length) % RING.length]] = level;
		});
		return frame;
	});
}

function scanFrames() {
	return [0, 1, 2, 1].map((col, step, cols) => {
		const prev = cols[(step - 1 + cols.length) % cols.length];
		return Array.from({ length: 9 }, (_, i) =>
			i % 3 === col ? 1 : i % 3 === prev ? 0.35 : DIM,
		);
	});
}

function pulseFrames() {
	const rings = [[4], [1, 3, 5, 7], [0, 2, 6, 8]];
	return [0, 1, 2, 3].map((step) =>
		Array.from({ length: 9 }, (_, i) => {
			const ring = rings.findIndex((r) => r.includes(i));
			if (ring === step) return 1;
			if (ring === step - 1) return 0.4;
			return DIM;
		}),
	);
}

const FRAMES: Record<DotGridPattern, number[][]> = {
	orbit: orbitFrames(),
	scan: scanFrames(),
	pulse: pulseFrames(),
};

const STEP_MS: Record<DotGridPattern, number> = {
	orbit: 85,
	scan: 140,
	pulse: 160,
};

export function DotGridLoader(props: {
	class?: string;
	pattern?: DotGridPattern;
	label?: string;
}) {
	const pattern = () => props.pattern ?? "orbit";
	const [step, setStep] = createSignal(0);

	onMount(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		let timer: ReturnType<typeof setTimeout>;
		const tick = () => {
			setStep((s) => s + 1);
			timer = setTimeout(tick, STEP_MS[pattern()]);
		};
		timer = setTimeout(tick, STEP_MS[pattern()]);
		onCleanup(() => clearTimeout(timer));
	});

	const frame = () => {
		const frames = FRAMES[pattern()];
		return frames[step() % frames.length];
	};

	return (
		<svg
			viewBox="0 0 11 11"
			role="status"
			aria-label={props.label ?? "Loading"}
			class={cx("shrink-0", props.class ?? "size-3.5")}
		>
			<Index each={frame()}>
				{(level, i) => (
					<rect
						x={(i % 3) * 4}
						y={Math.floor(i / 3) * 4}
						width="3"
						height="3"
						rx="0.6"
						fill="currentColor"
						opacity={level()}
					/>
				)}
			</Index>
		</svg>
	);
}

/** Icon for solid-toast loading toasts: the dot grid for plain work. */
export function toastLoadingIcon() {
	return <DotGridLoader class="size-3.5 text-gray-11" />;
}

/** Icon for solid-toast loading toasts while an AI request is thinking. */
export function toastThinkingIcon() {
	return <CaptMark state="thinking" class="size-4 text-gray-12" />;
}
