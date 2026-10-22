import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cx } from "cva";
import {
	createResource,
	createSignal,
	type JSX,
	onCleanup,
	onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import { teleprompterDefaults, teleprompterStore } from "~/store";
import type { RecordingMode, RecordingTargetMode } from "~/utils/tauri";
import { commands } from "~/utils/tauri";
import {
	openTeleprompter,
	TELEPROMPTER_WINDOW_LABEL,
} from "~/utils/teleprompter";
import IconCapLogo from "~icons/cap/logo";
import IconLucideCamera from "~icons/lucide/camera";
import IconLucideFlipHorizontal from "~icons/lucide/flip-horizontal-2";
import IconLucideListOrdered from "~icons/lucide/list-ordered";
import IconLucideMinus from "~icons/lucide/minus";
import IconLucideMonitor from "~icons/lucide/monitor";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideScanText from "~icons/lucide/scan-text";
import IconLucideSquareDashed from "~icons/lucide/square-dashed";
import IconLucideVideo from "~icons/lucide/video";
import { useRecordingOptions } from "../OptionsContext";

const EXPANDED_HEIGHT = 128;
const EXPANDED_INSET = 10;
const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 220;
const WPM_STEP = 10;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const MODE_LABELS: Record<RecordingMode, string> = {
	studio: "Studio",
	instant: "Studio",
	screenshot: "Screenshot",
};

type Frame = { left: number; top: number; width: number; height: number };

function Chip(props: {
	active?: boolean;
	label: string;
	onClick: () => void;
	children?: JSX.Element;
	class?: string;
}) {
	return (
		<button
			type="button"
			aria-label={props.label}
			aria-pressed={props.active ? "true" : "false"}
			onClick={() => props.onClick()}
			class={cx(
				"flex h-7 items-center justify-center gap-1.5 px-2.5 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-8",
				props.active
					? "bg-blue-9 text-white"
					: "bg-white/8 text-white/75 hover:bg-white/14 hover:text-white",
				props.class,
			)}
		>
			{props.children}
		</button>
	);
}

function Row(props: { label: string; children: JSX.Element }) {
	return (
		<div class="flex items-center gap-2">
			<span class="w-12 shrink-0 text-[10px] font-semibold text-white/45">
				{props.label}
			</span>
			<div class="flex flex-1 items-center gap-1">{props.children}</div>
		</div>
	);
}

export default function ControlIsland() {
	const { rawOptions, setOptions } = useRecordingOptions();
	const [expanded, setExpanded] = createSignal(false);
	const [anchor, setAnchor] = createSignal<Frame>();
	const [viewportWidth, setViewportWidth] = createSignal(window.innerWidth);
	const [prompterOpen, setPrompterOpen] = createSignal(false);
	const [prompter, { mutate: setPrompter }] = createResource(async () => ({
		...teleprompterDefaults,
		...(await teleprompterStore.get()),
	}));
	let anchorRef!: HTMLDivElement;
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;

	const measure = () => {
		const rect = anchorRef.getBoundingClientRect();
		setAnchor({
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
		});
		setViewportWidth(window.innerWidth);
	};

	const refreshPrompterOpen = async () => {
		setPrompterOpen(
			!!(await WebviewWindow.getByLabel(TELEPROMPTER_WINDOW_LABEL)),
		);
	};

	onMount(() => {
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(anchorRef);
		observer.observe(document.body);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setExpanded(false);
		};
		window.addEventListener("keydown", onKeyDown);
		const unlisten = teleprompterStore.listen((data) => {
			if (data) setPrompter({ ...teleprompterDefaults, ...data });
		});
		onCleanup(() => {
			clearTimeout(hoverTimer);
			observer.disconnect();
			window.removeEventListener("keydown", onKeyDown);
			void unlisten.then((dispose) => dispose());
		});
	});

	const open = () => {
		measure();
		setExpanded(true);
		void refreshPrompterOpen();
	};

	const scheduleOpen = () => {
		clearTimeout(hoverTimer);
		if (expanded()) return;
		hoverTimer = setTimeout(open, OPEN_DELAY_MS);
	};

	const scheduleClose = () => {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => setExpanded(false), CLOSE_DELAY_MS);
	};

	const frame = (): Frame | undefined => {
		const compact = anchor();
		if (!compact || !expanded()) return compact;
		return {
			left: EXPANDED_INSET,
			top: compact.top,
			width: viewportWidth() - EXPANDED_INSET * 2,
			height: EXPANDED_HEIGHT,
		};
	};

	const mode = () =>
		rawOptions.mode === "screenshot" ? "screenshot" : "studio";

	const selectMode = async (next: RecordingMode) => {
		setOptions({ mode: next });
		await commands.setRecordingMode(next);
	};

	const capture = async (target: RecordingTargetMode) => {
		setExpanded(false);
		await commands.showWindow({ Main: { init_target_mode: target } });
	};

	const updatePrompter = async (
		patch: Partial<{
			mirror: boolean;
			showCueMarkers: boolean;
			wordsPerMinute: number;
		}>,
	) => {
		const current = prompter();
		if (!current) return;
		setPrompter({ ...current, ...patch });
		await teleprompterStore.set(patch);
	};

	const togglePrompter = async () => {
		const existing = await WebviewWindow.getByLabel(TELEPROMPTER_WINDOW_LABEL);
		if (existing) await existing.close();
		else await openTeleprompter();
		setTimeout(() => void refreshPrompterOpen(), 400);
	};

	const stepWpm = (delta: number) =>
		void updatePrompter({
			wordsPerMinute: Math.min(
				300,
				Math.max(60, (prompter()?.wordsPerMinute ?? 150) + delta),
			),
		});

	return (
		<>
			<div ref={anchorRef} class="h-[22px] w-[96px] shrink-0" />
			<Portal>
				<div
					role="group"
					aria-label="capt island"
					aria-expanded={expanded() ? "true" : "false"}
					onMouseEnter={scheduleOpen}
					onMouseLeave={scheduleClose}
					onClick={() => {
						if (!expanded()) open();
					}}
					style={{
						left: `${frame()?.left ?? 0}px`,
						top: `${frame()?.top ?? 0}px`,
						width: `${frame()?.width ?? 0}px`,
						height: `${frame()?.height ?? 0}px`,
						visibility: frame() ? "visible" : "hidden",
						"transition-property": "left, top, width, height, box-shadow",
						"transition-duration": expanded() ? "420ms" : "340ms",
						"transition-timing-function": EASE,
					}}
					class={cx(
						"fixed z-60 select-none overflow-hidden bg-black font-sans text-white will-change-[left,top,width,height] motion-reduce:transition-none! [contain:layout_paint]",
						expanded()
							? "shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
							: "cursor-pointer shadow-none",
					)}
				>
					<div
						aria-hidden={expanded() ? "true" : "false"}
						style={{ "transition-timing-function": EASE }}
						class={cx(
							"absolute inset-x-0 top-0 flex h-[22px] items-center justify-center gap-1.5 px-2.5 transition-[opacity,transform] motion-reduce:transition-none",
							expanded()
								? "pointer-events-none -translate-y-1 opacity-0 duration-100"
								: "translate-y-0 opacity-100 delay-75 duration-200",
						)}
					>
						<IconCapLogo class="size-3 shrink-0 brightness-0 invert" />
						<span class="truncate text-[10.5px] font-semibold">
							{MODE_LABELS[mode()]}
						</span>
						<span
							class={cx(
								"size-1 shrink-0 bg-blue-9 transition-opacity duration-200",
								prompterOpen() ? "opacity-100" : "opacity-0",
							)}
						/>
					</div>
					<div
						inert={expanded() ? undefined : true}
						style={{
							width: `${viewportWidth() - EXPANDED_INSET * 2}px`,
							"transition-timing-function": EASE,
						}}
						class={cx(
							"absolute left-0 top-0 flex h-[128px] flex-col justify-center gap-2 px-3 transition-[opacity,transform,filter] motion-reduce:transition-none",
							expanded()
								? "translate-y-0 scale-100 opacity-100 blur-[0px] delay-[90ms] duration-300"
								: "pointer-events-none -translate-y-1.5 scale-[0.98] opacity-0 blur-[2px] duration-150",
						)}
					>
						<Row label="Mode">
							<Chip
								label="Studio mode"
								active={mode() === "studio"}
								onClick={() => void selectMode("studio")}
							>
								<IconLucideVideo class="size-3.5" />
								Studio
							</Chip>
							<Chip
								label="Screenshot mode"
								active={mode() === "screenshot"}
								onClick={() => void selectMode("screenshot")}
							>
								<IconLucideCamera class="size-3.5" />
								Screenshot
							</Chip>
						</Row>
						<Row label="Capture">
							<Chip
								label="Capture whole screen"
								onClick={() => void capture("display")}
							>
								<IconLucideMonitor class="size-3.5" />
								Screen
							</Chip>
							<Chip
								label="Capture custom area"
								onClick={() => void capture("area")}
							>
								<IconLucideSquareDashed class="size-3.5" />
								Area
							</Chip>
						</Row>
						<Row label="Prompter">
							<Chip
								label={
									prompterOpen() ? "Close teleprompter" : "Open teleprompter"
								}
								active={prompterOpen()}
								onClick={() => void togglePrompter()}
							>
								<IconLucideScanText class="size-3.5" />
							</Chip>
							<Chip
								label="Mirror text"
								active={prompter()?.mirror}
								onClick={() =>
									void updatePrompter({ mirror: !prompter()?.mirror })
								}
							>
								<IconLucideFlipHorizontal class="size-3.5" />
							</Chip>
							<Chip
								label="Cue markers"
								active={prompter()?.showCueMarkers}
								onClick={() =>
									void updatePrompter({
										showCueMarkers: !prompter()?.showCueMarkers,
									})
								}
							>
								<IconLucideListOrdered class="size-3.5" />
							</Chip>
							<div class="ml-auto flex items-center gap-0.5">
								<Chip
									label="Slower"
									class="px-1.5"
									onClick={() => stepWpm(-WPM_STEP)}
								>
									<IconLucideMinus class="size-3" />
								</Chip>
								<span class="w-11 text-center text-[10.5px] font-semibold tabular-nums">
									{prompter()?.wordsPerMinute ?? 150} wpm
								</span>
								<Chip
									label="Faster"
									class="px-1.5"
									onClick={() => stepWpm(WPM_STEP)}
								>
									<IconLucidePlus class="size-3" />
								</Chip>
							</div>
						</Row>
					</div>
				</div>
			</Portal>
		</>
	);
}
