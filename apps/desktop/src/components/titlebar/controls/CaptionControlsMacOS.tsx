import { getCurrentWindow } from "@tauri-apps/api/window";
import { cx } from "cva";
import {
	type ComponentProps,
	createSignal,
	onCleanup,
	onMount,
	Show,
	splitProps,
} from "solid-js";

export default function CaptionControlsMacOS(
	props: ComponentProps<"div"> & {
		showMinimize?: boolean;
		showZoom?: boolean;
		onZoom?: () => void;
	},
) {
	const [local, otherProps] = splitProps(props, [
		"class",
		"showMinimize",
		"showZoom",
		"onZoom",
	]);
	const currentWindow = getCurrentWindow();
	const [focused, setFocus] = createSignal(true);
	const [hovered, setHovered] = createSignal(false);

	let unlisten: (() => void) | undefined;
	onMount(async () => {
		unlisten = await currentWindow.onFocusChanged(({ payload: focused }) =>
			setFocus(focused),
		);
	});
	onCleanup(() => unlisten?.());

	const showMinimize = () => local.showMinimize ?? true;
	const showZoom = () => local.showZoom ?? true;

	return (
		<div
			class={cx(
				"flex flex-row items-center gap-2 h-full cursor-default select-none",
				local.class,
			)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			{...otherProps}
		>
			<TrafficLightButton
				type="close"
				focused={focused()}
				hovered={hovered()}
				onClick={() => currentWindow.close()}
			/>
			<Show when={showMinimize()}>
				<TrafficLightButton
					type="minimize"
					focused={focused()}
					hovered={hovered()}
					onClick={() => currentWindow.minimize()}
				/>
			</Show>
			<Show when={showZoom()}>
				<TrafficLightButton
					type="zoom"
					focused={focused()}
					hovered={hovered()}
					onClick={() => {
						if (local.onZoom) local.onZoom();
						else void currentWindow.toggleMaximize();
					}}
				/>
			</Show>
		</div>
	);
}

interface TrafficLightButtonProps {
	type: "close" | "minimize" | "zoom";
	focused: boolean;
	hovered: boolean;
	onClick: () => void;
}

const TRAFFIC_LIGHTS = {
	close: { fill: "#ff5f57", edge: "#e2463f", label: "Close window" },
	minimize: { fill: "#febc2e", edge: "#dfa023", label: "Minimize window" },
	zoom: {
		fill: "#28c840",
		edge: "#1dad2b",
		label: "Expand or collapse window",
	},
} as const;

function TrafficLightButton(props: TrafficLightButtonProps) {
	const light = () => TRAFFIC_LIGHTS[props.type];
	const active = () => props.focused;

	return (
		<button
			type="button"
			aria-label={light().label}
			class="relative flex size-3 items-center justify-center rounded-sm transition-[filter] duration-100 active:brightness-[0.82]"
			style={{
				"background-color": active() ? light().fill : "var(--gray-6)",
				"box-shadow": active()
					? `inset 0 0 0 0.5px ${light().edge}`
					: "inset 0 0 0 0.5px rgba(0, 0, 0, 0.12)",
			}}
			onClick={(e) => {
				e.stopPropagation();
				props.onClick();
			}}
		>
			<Show when={props.hovered && active()}>
				<TrafficLightGlyph type={props.type} />
			</Show>
		</button>
	);
}

function TrafficLightGlyph(props: { type: "close" | "minimize" | "zoom" }) {
	return (
		<svg
			width="8"
			height="8"
			viewBox="0 0 8 8"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			{props.type === "close" && (
				<path
					d="M1.5 1.5l5 5M6.5 1.5l-5 5"
					stroke="rgba(0, 0, 0, 0.55)"
					stroke-width="1.2"
					stroke-linecap="round"
				/>
			)}
			{props.type === "minimize" && (
				<path
					d="M1.5 4h5"
					stroke="rgba(0, 0, 0, 0.55)"
					stroke-width="1.2"
					stroke-linecap="round"
				/>
			)}
			{props.type === "zoom" && (
				<path
					d="M1.5 1.5h3.2L1.5 4.7V1.5ZM6.5 6.5H3.3L6.5 3.3v3.2Z"
					fill="rgba(0, 0, 0, 0.55)"
				/>
			)}
		</svg>
	);
}
