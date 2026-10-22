import { Button } from "@cap/ui-solid";
import { createEventListener } from "@solid-primitives/event-listener";
import { createElementSize } from "@solid-primitives/resize-observer";
import { makePersisted } from "@solid-primitives/storage";
import { useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import {
	LogicalPosition,
	type PhysicalPosition,
	type PhysicalSize,
} from "@tauri-apps/api/dpi";
import {
	CheckMenuItem,
	Menu,
	MenuItem,
	PredefinedMenuItem,
} from "@tauri-apps/api/menu";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type as ostype } from "@tauri-apps/plugin-os";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Match,
	onCleanup,
	onMount,
	Show,
	Suspense,
	Switch,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import toast from "solid-toast";
import {
	CROP_ZERO,
	type CropBounds,
	Cropper,
	type CropperRef,
	createCropOptionsMenuItems,
	type Ratio,
} from "~/components/Cropper";
import ModeSelect from "~/components/ModeSelect";
import SelectionHint from "~/components/selection-hint";
import { generalSettingsStore } from "~/store";
import {
	AREA_SELECTION_STORAGE_KEY,
	AREA_SELECTION_STORAGE_SYNC,
	type AreaSelectionPreferences,
	createDefaultAreaSelectionPreferences,
	cropBoundsEqual,
	getLockedAreaBounds,
	QUICK_AREA_RATIOS,
	ratiosEqual,
} from "~/utils/area-selection";
import { getCameraWindow } from "~/utils/camera-window";
import { createDevicesQuery } from "~/utils/devices";
import { createCameraMutation, createOptionsQuery } from "~/utils/queries";
import { isRecordingStartCancelled } from "~/utils/recording";
import { createRecordingMenuPopup } from "~/utils/recording-menu";
import {
	type CameraInfo,
	commands,
	type DeviceOrModelID,
	type DisplayId,
	events,
	type ScreenCaptureTarget,
	type TargetUnderCursor,
} from "~/utils/tauri";
import { CameraSelectBase } from "./(window-chrome)/new-main/CameraSelect";
import InfoPill from "./(window-chrome)/new-main/InfoPill";
import {
	RecordingOptionsProvider,
	useRecordingOptions,
} from "./(window-chrome)/OptionsContext";

const MIN_SIZE = { width: 150, height: 150 };
const MIN_SCREENSHOT_SIZE = { width: 1, height: 1 };
const LOCKED_AREA_COMMIT_DELAY_MS = 180;
const LIQUID_GLASS_SURFACE_CLASS =
	"rounded-2xl border border-gray-12/10 bg-gray-1/82 shadow-xl shadow-black/20 backdrop-blur-xl dark:border-white/10 dark:bg-gray-2/82";

const capitalize = (str: string) => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

const findCamera = (cameras: CameraInfo[], id?: DeviceOrModelID | null) => {
	if (!id) return undefined;
	return cameras.find((camera) =>
		"DeviceID" in id
			? camera.device_id === id.DeviceID
			: camera.model_id === id.ModelID,
	);
};

async function repositionCameraForWindow(
	windowBounds: { x: number; y: number; width: number; height: number },
	displayId: DisplayId,
) {
	const win = await getCameraWindow();
	if (!win) return;

	const [physSize, scaleFactor] = await Promise.all([
		win.outerSize(),
		win.scaleFactor(),
	]);

	const displayInfo = await commands.displayInformation(displayId);
	const displayOriginX = displayInfo.logical_bounds?.position?.x ?? 0;
	const displayOriginY = displayInfo.logical_bounds?.position?.y ?? 0;

	const camSize = physSize.toLogical(scaleFactor);

	const winAbsX = windowBounds.x + displayOriginX;
	const winAbsY = windowBounds.y + displayOriginY;

	const padding = 16;
	if (
		camSize.width + padding * 2 > windowBounds.width ||
		camSize.height + padding * 2 > windowBounds.height
	) {
		return;
	}

	const newX = Math.round(
		winAbsX + windowBounds.width - camSize.width - padding,
	);
	const newY = Math.round(
		winAbsY + windowBounds.height - camSize.height - padding,
	);

	await win.setPosition(new LogicalPosition(newX, newY));
}

export default function () {
	return (
		<RecordingOptionsProvider>
			<Inner />
		</RecordingOptionsProvider>
	);
}

function useOptions() {
	const { rawOptions, setOptions } = createOptionsQuery();
	return [rawOptions, setOptions] as const;
}

function Inner() {
	const [params] = useSearchParams<{
		displayId: DisplayId;
		isHoveredDisplay: string;
		targetMode: "display" | "window" | "area";
		overlayInstance: string;
	}>();
	const [options, setOptions] = useOptions();
	const [areaSelectionPreferences, setAreaSelectionPreferences] = makePersisted(
		createStore<AreaSelectionPreferences>(
			createDefaultAreaSelectionPreferences(),
		),
		{
			name: AREA_SELECTION_STORAGE_KEY,
			sync: AREA_SELECTION_STORAGE_SYNC,
		},
	);

	onMount(() => {
		if (params.targetMode) {
			setOptions("targetMode", params.targetMode);
		}
		const instance = Number(params.overlayInstance);
		if (Number.isSafeInteger(instance) && instance > 0) {
			void commands.targetSelectOverlayReady(instance).catch((error) => {
				console.error("Failed to prepare target picker", error);
			});
		}
	});

	const [toggleModeSelect, setToggleModeSelect] = createSignal(false);

	const [targetUnderCursor, setTargetUnderCursor] =
		createStore<TargetUnderCursor>({
			display_id: null,
			window: null,
		});

	const unsubTargetUnderCursor = events.targetUnderCursor.listen((event) => {
		setTargetUnderCursor(reconcile(event.payload));
	});
	onCleanup(() => unsubTargetUnderCursor.then((unsub) => unsub()));

	const unsubSetTargetMode = events.requestSetTargetMode.listen((event) => {
		if (event.payload.target_mode) {
			setOptions("targetMode", event.payload.target_mode);
		}
	});
	onCleanup(() => unsubSetTargetMode.then((unsub) => unsub()));

	const windowIcon = useQuery(() => ({
		queryKey: ["windowIcon", targetUnderCursor.window?.id],
		queryFn: async () => {
			if (!targetUnderCursor.window?.id) return null;
			return await commands.getWindowIcon(
				targetUnderCursor.window.id.toString(),
			);
		},
		enabled: !!targetUnderCursor.window?.id,
		staleTime: 5 * 60 * 1000, // Cache for 5 minutes
	}));

	const displayInformation = useQuery(() => ({
		queryKey: ["displayId", params.displayId],
		queryFn: async () => {
			if (!params.displayId) return null;
			try {
				const info = await commands.displayInformation(params.displayId);
				return info;
			} catch (error) {
				console.error("Failed to fetch screen information:", error);
				return null;
			}
		},
		enabled: params.displayId !== undefined && options.targetMode === "display",
	}));

	const [crop, setCrop] = createSignal<CropBounds>(CROP_ZERO);
	type AreaTarget = Extract<ScreenCaptureTarget, { variant: "area" }>;
	const [pendingAreaTarget, setPendingAreaTarget] =
		createSignal<AreaTarget | null>(null);
	const [initialAreaBounds, setInitialAreaBounds] = createSignal<
		CropBounds | undefined
	>(undefined);

	createEffect(() => {
		const target = options.captureTarget;
		if (
			target.variant === "area" &&
			params.displayId &&
			target.screen === params.displayId
		) {
			setPendingAreaTarget({
				variant: "area",
				screen: target.screen,
				bounds: {
					position: {
						x: target.bounds.position.x,
						y: target.bounds.position.y,
					},
					size: {
						width: target.bounds.size.width,
						height: target.bounds.size.height,
					},
				},
			});
		}
	});

	createEffect(
		(prevMode: "display" | "window" | "area" | "camera" | null | undefined) => {
			const mode = options.targetMode ?? null;
			if (prevMode === "area" && mode !== "area") {
				const target = pendingAreaTarget();
				if (target) {
					setOptions(
						"captureTarget",
						reconcile({
							variant: "area",
							screen: target.screen,
							bounds: {
								position: {
									x: target.bounds.position.x,
									y: target.bounds.position.y,
								},
								size: {
									width: target.bounds.size.width,
									height: target.bounds.size.height,
								},
							},
						}),
					);
				}
				setPendingAreaTarget(null);
				setInitialAreaBounds(undefined);
			}
			return mode;
		},
	);

	createEffect(() => {
		if (!options.targetMode) {
			setTargetUnderCursor(reconcile({ display_id: null, window: null }));
		}
	});

	// Dismiss the picker because a recording is starting. The dismissal reason
	// rides along with `targetMode: null` so the main window never has to guess
	// (from possibly-stale query state) whether it may reveal itself again.
	const dismissPickerForRecordingStart = () => {
		if (options.mode === "screenshot") return;
		setOptions({ targetMode: null, targetModeDismissal: "recordingStudio" });
	};

	// This prevents browser keyboard shortcuts from firing.
	// Eg. on Windows Ctrl+P would open the print dialog without this
	createEventListener(document, "keydown", (e) => e.preventDefault());

	return (
		<Switch>
			<Match when={options.targetMode === "display" && params.displayId}>
				{(displayId) => (
					<div
						data-over={targetUnderCursor.display_id === displayId()}
						class="relative w-screen h-screen flex flex-col items-center justify-center data-[over='true']:bg-blue-600/40 transition-colors"
					>
						<div class="absolute inset-0 bg-black/60 -z-10" />

						<Show when={displayInformation.data} keyed>
							{(display) => (
								<div class="flex flex-col items-center text-white">
									<IconCapMonitor class="size-20 mb-3" />
									<span class="mb-2 text-3xl font-semibold">
										{display.name || "Monitor"}
									</span>
									<Show when={display.physical_size}>
										{(size) => (
											<span class="mb-2 text-xs">
												{`${size().width}x${size().height} · ${
													display.refresh_rate
												}FPS`}
											</span>
										)}
									</Show>
								</div>
							)}
						</Show>

						<Show when={toggleModeSelect()}>
							{/* Transparent overlay to capture outside clicks */}
							<div
								class="absolute inset-0 z-10"
								onClick={() => setToggleModeSelect(false)}
							/>
							<ModeSelect
								standalone
								onClose={() => setToggleModeSelect(false)}
							/>
						</Show>

						<RecordingControls
							setToggleModeSelect={setToggleModeSelect}
							target={{ variant: "display", id: displayId() }}
							onRecordingStart={dismissPickerForRecordingStart}
							onClose={() => {
								setOptions({
									targetMode: null,
									targetModeDismissal: "cancelled",
								});
								commands.closeTargetSelectOverlays();
							}}
						/>
					</div>
				)}
			</Match>
			<Match
				when={
					options.targetMode === "window" &&
					targetUnderCursor.display_id === params.displayId &&
					params.displayId
				}
			>
				{(_displayId) => {
					const [originalCameraBounds, setOriginalCameraBounds] = createSignal<{
						x: number;
						y: number;
					} | null>(null);

					const [selectedWindow, setSelectedWindow] =
						createSignal<TargetUnderCursor["window"]>(null);

					const [lockedIcon, setLockedIcon] = createSignal<string | null>(null);

					let lastRepositionedWindowId: string | null = null;

					const activeWindow = createMemo(
						() => selectedWindow() ?? targetUnderCursor.window,
					);

					createEffect(() => {
						const selected = selectedWindow();
						const icon = windowIcon.data;
						if (selected && icon && !lockedIcon()) {
							setLockedIcon(icon);
						}
					});

					onMount(async () => {
						try {
							const win = await getCameraWindow();
							if (!win) return;
							const [pos, factor] = await Promise.all([
								win.outerPosition(),
								win.scaleFactor(),
							]);
							const logical = pos.toLogical(factor);
							setOriginalCameraBounds({
								x: logical.x,
								y: logical.y,
							});
						} catch (_) {}
					});

					createEffect(() => {
						if (selectedWindow()) return;

						const window = targetUnderCursor.window;
						if (!window) {
							lastRepositionedWindowId = null;
							return;
						}

						const windowIdStr = String(window.id);
						if (windowIdStr === lastRepositionedWindowId) return;
						lastRepositionedWindowId = windowIdStr;

						const currentDisplayId = params.displayId;
						if (!currentDisplayId) return;

						repositionCameraForWindow(
							{
								x: window.bounds.position.x,
								y: window.bounds.position.y,
								width: window.bounds.size.width,
								height: window.bounds.size.height,
							},
							currentDisplayId,
						).catch((e) =>
							console.error("Failed to reposition camera for window", e),
						);
					});

					async function revertCamera() {
						const original = originalCameraBounds();
						if (!original) return;
						try {
							const win = await getCameraWindow();
							if (!win) return;
							await win.setPosition(
								new LogicalPosition(original.x, original.y),
							);
						} catch (_) {}
					}

					onCleanup(() => {
						if (originalCameraBounds()) {
							revertCamera();
						}
					});

					return (
						<Show when={activeWindow()} keyed>
							{(windowUnderCursor) => (
								<div
									data-over={targetUnderCursor.display_id === params.displayId}
									class="relative w-screen h-screen bg-black/70"
									onClick={() => {
										const current = selectedWindow();
										const hovered = targetUnderCursor.window;
										if (current && hovered && hovered.id !== current.id) {
											setLockedIcon(windowIcon.data ?? null);
											setSelectedWindow({
												id: hovered.id,
												bounds: {
													position: {
														x: hovered.bounds.position.x,
														y: hovered.bounds.position.y,
													},
													size: {
														width: hovered.bounds.size.width,
														height: hovered.bounds.size.height,
													},
												},
												app_name: hovered.app_name,
											});
											setOptions(
												"captureTarget",
												reconcile({
													variant: "window",
													id: hovered.id,
												}),
											);
										}
									}}
								>
									<div
										class="flex absolute flex-col justify-center items-center bg-blue-600/40"
										style={{
											width: `${windowUnderCursor.bounds.size.width}px`,
											height: `${windowUnderCursor.bounds.size.height}px`,
											left: `${windowUnderCursor.bounds.position.x}px`,
											top: `${windowUnderCursor.bounds.position.y}px`,
										}}
										onClick={() => {
											const current = selectedWindow();
											const hovered = targetUnderCursor.window;
											if (!current) {
												setOriginalCameraBounds(null);
												setLockedIcon(windowIcon.data ?? null);
												setSelectedWindow({
													id: windowUnderCursor.id,
													bounds: {
														position: {
															x: windowUnderCursor.bounds.position.x,
															y: windowUnderCursor.bounds.position.y,
														},
														size: {
															width: windowUnderCursor.bounds.size.width,
															height: windowUnderCursor.bounds.size.height,
														},
													},
													app_name: windowUnderCursor.app_name,
												});
												setOptions(
													"captureTarget",
													reconcile({
														variant: "window",
														id: windowUnderCursor.id,
													}),
												);
											} else if (hovered && hovered.id !== current.id) {
												setLockedIcon(windowIcon.data ?? null);
												setSelectedWindow({
													id: hovered.id,
													bounds: {
														position: {
															x: hovered.bounds.position.x,
															y: hovered.bounds.position.y,
														},
														size: {
															width: hovered.bounds.size.width,
															height: hovered.bounds.size.height,
														},
													},
													app_name: hovered.app_name,
												});
												setOptions(
													"captureTarget",
													reconcile({
														variant: "window",
														id: hovered.id,
													}),
												);
											}
										}}
									>
										<div class="flex flex-col justify-center items-center text-white">
											<div class="w-24 h-24">
												<Suspense>
													<Show
														when={
															selectedWindow()
																? (lockedIcon() ?? windowIcon.data)
																: windowIcon.data
														}
													>
														{(icon) => (
															<img
																src={icon()}
																alt={`${windowUnderCursor.app_name} icon`}
																class="mb-3 w-full h-full rounded-lg animate-in fade-in"
															/>
														)}
													</Show>
												</Suspense>
											</div>
											<span class="mb-2 text-3xl font-semibold">
												{windowUnderCursor.app_name}
											</span>
											<span class="mb-2 text-xs">
												{`${windowUnderCursor.bounds.size.width}x${windowUnderCursor.bounds.size.height}`}
											</span>
										</div>
										<div onClick={(e) => e.stopPropagation()}>
											<RecordingControls
												target={{
													variant: "window",
													id: windowUnderCursor.id,
												}}
												onRecordingStart={() => {
													setOriginalCameraBounds(null);
													if (options.mode === "screenshot") {
														// Only mark the dismissal here. takeScreenshot is
														// invoked from THIS webview right after, and closing
														// destroys the webview before the invoke is dispatched,
														// so the screenshot silently never happens. The start
														// handler hides these windows and closes them once the
														// capture is done.
														setOptions({
															targetMode: null,
															targetModeDismissal: "screenshot",
														});
													} else {
														dismissPickerForRecordingStart();
													}
												}}
												onClose={() => {
													setSelectedWindow(null);
													setLockedIcon(null);
													setOptions({
														targetMode: null,
														targetModeDismissal: "cancelled",
													});
													commands.closeTargetSelectOverlays();
												}}
											/>
										</div>

										<Button
											variant="dark"
											size="sm"
											onClick={(e) => {
												e.stopPropagation();
												setOriginalCameraBounds(null);
												const screenId = params.displayId;
												setInitialAreaBounds({
													x: windowUnderCursor.bounds.position.x,
													y: windowUnderCursor.bounds.position.y,
													width: windowUnderCursor.bounds.size.width,
													height: windowUnderCursor.bounds.size.height,
												});
												if (screenId) {
													setPendingAreaTarget({
														variant: "area",
														screen: screenId,
														bounds: {
															position: {
																x: windowUnderCursor.bounds.position.x,
																y: windowUnderCursor.bounds.position.y,
															},
															size: {
																width: windowUnderCursor.bounds.size.width,
																height: windowUnderCursor.bounds.size.height,
															},
														},
													});
												}
												setOptions("targetMode", "area");
												commands.closeTargetSelectOverlays().then(() => {
													commands.openTargetSelectOverlays(
														null,
														screenId ?? null,
														"area",
													);
												});
											}}
										>
											Adjust recording area
										</Button>
									</div>
								</div>
							)}
						</Show>
					);
				}}
			</Match>
			<Match when={options.targetMode === "area" && params.displayId}>
				{(displayId) => {
					let controlsEl: HTMLDivElement | undefined;
					let cropperRef: CropperRef | undefined;

					const [cameraWindow, setCameraWindow] =
						createSignal<WebviewWindow | null>(null);
					const [originalCameraBounds, setOriginalCameraBounds] = createSignal<{
						position: PhysicalPosition;
						size: PhysicalSize;
					} | null>(null);
					const [cachedScaleFactor, setCachedScaleFactor] = createSignal<
						number | null
					>(null);

					onMount(async () => {
						const win = await getCameraWindow();
						if (win) setCameraWindow(win);
					});

					const areaDisplayInfo = useQuery(() => ({
						queryKey: ["areaDisplayInfo", displayId()],
						queryFn: async () => {
							return await commands.displayInformation(displayId());
						},
					}));

					const [isInteracting, setIsInteracting] = createSignal(false);
					const [screenshotAspect, setScreenshotAspect] =
						createSignal<Ratio | null>(null);
					const [screenshotSnapToRatio, setScreenshotSnapToRatio] =
						createSignal(true);
					const minSize = () =>
						options.mode === "screenshot" ? MIN_SCREENSHOT_SIZE : MIN_SIZE;
					const currentAspect = () =>
						options.mode === "screenshot"
							? screenshotAspect()
							: areaSelectionPreferences.aspectRatio;
					const currentSnapToRatio = () =>
						options.mode === "screenshot"
							? screenshotSnapToRatio()
							: areaSelectionPreferences.snapToRatio;
					const effectiveInitialAreaBounds = createMemo(() => {
						const explicitBounds = initialAreaBounds();
						if (explicitBounds) return explicitBounds;
						if (options.mode === "screenshot") return undefined;
						return getLockedAreaBounds(
							areaSelectionPreferences,
							displayId(),
							minSize(),
						);
					});
					const linux = ostype() === "linux";
					const [localPointerInside, setLocalPointerInside] = createSignal<
						boolean | undefined
					>();
					if (linux) {
						const updateLocalPointer = (event: PointerEvent) => {
							setLocalPointerInside(
								event.clientX >= 0 &&
									event.clientY >= 0 &&
									event.clientX < window.innerWidth &&
									event.clientY < window.innerHeight,
							);
						};
						createEventListener(
							window,
							"pointerover",
							updateLocalPointer,
							true,
						);
						createEventListener(
							window,
							"pointermove",
							updateLocalPointer,
							true,
						);
						createEventListener(
							window,
							"pointerout",
							(event) => {
								if (event.relatedTarget === null) setLocalPointerInside(false);
							},
							true,
						);
						createEventListener(window, "blur", () =>
							setLocalPointerInside(false),
						);
					}
					const isActiveDisplay = createMemo(() => {
						const activeDisplayId = targetUnderCursor.display_id;
						if (activeDisplayId != null) {
							return activeDisplayId === displayId();
						}
						return linux
							? (localPointerInside() ?? params.isHoveredDisplay === "true")
							: params.isHoveredDisplay === "true";
					});
					const shouldShowOverlay = createMemo(
						() => isInteracting() || isActiveDisplay(),
					);
					const shouldShowSelectionHint = createMemo(() => {
						if (effectiveInitialAreaBounds() !== undefined) return false;
						if (!isActiveDisplay()) return false;
						const bounds = crop();
						return bounds.width <= 1 && bounds.height <= 1 && !isInteracting();
					});

					const isValid = createMemo(() => {
						const b = crop();
						const min = minSize();
						return b.width >= min.width && b.height >= min.height;
					});
					const isSelectionLocked = createMemo(
						() =>
							options.mode !== "screenshot" &&
							getLockedAreaBounds(
								areaSelectionPreferences,
								displayId(),
								minSize(),
							) !== undefined,
					);

					function setAspect(aspect: Ratio | null) {
						if (options.mode === "screenshot") {
							setScreenshotAspect(aspect);
							return;
						}
						setAreaSelectionPreferences(
							"aspectRatio",
							aspect ? [aspect[0], aspect[1]] : null,
						);
					}

					function setSnapToRatio(enabled: boolean) {
						if (options.mode === "screenshot") {
							setScreenshotSnapToRatio(enabled);
							return;
						}
						setAreaSelectionPreferences("snapToRatio", enabled);
					}

					function persistLockedSelection() {
						if (
							options.mode === "screenshot" ||
							!areaSelectionPreferences.locked ||
							areaSelectionPreferences.screenId !== displayId() ||
							!isValid()
						)
							return;

						const bounds = crop();
						if (!cropBoundsEqual(areaSelectionPreferences.bounds, bounds))
							setAreaSelectionPreferences("bounds", { ...bounds });
					}

					function toggleLockedSelection() {
						if (isSelectionLocked()) {
							setAreaSelectionPreferences("locked", false);
							return;
						}
						if (!isValid()) return;

						setAreaSelectionPreferences({
							locked: true,
							screenId: displayId(),
							bounds: { ...crop() },
						});
					}

					let lockedSelectionCommitTimer: ReturnType<typeof setTimeout> | null =
						null;
					createEffect(() => {
						const bounds = crop();
						if (lockedSelectionCommitTimer !== null) {
							clearTimeout(lockedSelectionCommitTimer);
							lockedSelectionCommitTimer = null;
						}
						if (
							isInteracting() ||
							options.mode === "screenshot" ||
							!areaSelectionPreferences.locked ||
							areaSelectionPreferences.screenId !== displayId() ||
							!isValid() ||
							cropBoundsEqual(areaSelectionPreferences.bounds, bounds)
						)
							return;

						lockedSelectionCommitTimer = setTimeout(() => {
							persistLockedSelection();
							lockedSelectionCommitTimer = null;
						}, LOCKED_AREA_COMMIT_DELAY_MS);
					});
					onCleanup(() => {
						if (lockedSelectionCommitTimer !== null)
							clearTimeout(lockedSelectionCommitTimer);
					});

					const [targetState, setTargetState] = createSignal<{
						x: number;
						y: number;
						width: number;
						height: number;
					} | null>(null);

					let lastApplied: {
						x: number;
						y: number;
						width: number;
						height: number;
					} | null = null;

					onMount(() => {
						let processing = false;
						let raf: number;

						const loop = async () => {
							const target = targetState();
							if (target && !processing) {
								const changed =
									!lastApplied ||
									Math.abs(lastApplied.x - target.x) > 1 ||
									Math.abs(lastApplied.y - target.y) > 1 ||
									Math.abs(lastApplied.width - target.width) > 1 ||
									Math.abs(lastApplied.height - target.height) > 1;

								if (changed) {
									processing = true;
									try {
										await commands.updateCameraOverlayBounds(
											target.x,
											target.y,
											target.width,
											target.height,
										);
										lastApplied = target;
									} catch (e) {
										console.error("Failed to update camera window", e);
									}
									processing = false;
								}
							}
							raf = requestAnimationFrame(loop);
						};
						raf = requestAnimationFrame(loop);
						onCleanup(() => cancelAnimationFrame(raf));
					});

					createEffect(async () => {
						if (options.mode === "screenshot") return;
						const bounds = crop();
						const interacting = isInteracting();
						const displayInfo = areaDisplayInfo.data;

						let win = cameraWindow();
						if (!win) {
							// Try to find it
							try {
								win = await getCameraWindow();
								if (win) setCameraWindow(win);
							} catch (e) {
								console.error("Failed to find camera window", e);
							}
						}

						if (!win || !interacting) return;

						// Initialize data
						if (!originalCameraBounds() || cachedScaleFactor() === null) {
							try {
								const pos = await win.outerPosition();
								const size = await win.outerSize();
								const factor = await win.scaleFactor();
								setOriginalCameraBounds({ position: pos, size });
								setCachedScaleFactor(factor);
							} catch (e) {
								console.error("Failed to init camera bounds", e);
							}
							return;
						}

						const original = originalCameraBounds();
						const scaleFactor = cachedScaleFactor() ?? 1;

						if (!original) return;

						const originalLogicalSize = original.size.toLogical(scaleFactor);

						const padding = 16;
						const TOOLBAR_HEIGHT = 56;
						const originalContentWidth = originalLogicalSize.width;
						const originalContentHeight = Math.max(
							0,
							originalLogicalSize.height - TOOLBAR_HEIGHT,
						);

						const selectionMinDim = Math.min(bounds.width, bounds.height);
						const targetContentMaxDim = Math.max(
							100,
							Math.min(
								Math.max(originalContentWidth, originalContentHeight),
								selectionMinDim * 0.5 - TOOLBAR_HEIGHT,
							),
						);

						const originalContentMaxDim = Math.max(
							originalContentWidth,
							originalContentHeight,
						);
						const scale =
							originalContentMaxDim > 0
								? targetContentMaxDim / originalContentMaxDim
								: 1;

						const newWidth = Math.round(originalContentWidth * scale);
						const newHeight =
							Math.round(originalContentHeight * scale) + TOOLBAR_HEIGHT;

						if (
							bounds.width > newWidth + padding * 2 &&
							bounds.height > newHeight + padding * 2
						) {
							const displayOriginX =
								displayInfo?.logical_bounds?.position?.x ?? 0;
							const displayOriginY =
								displayInfo?.logical_bounds?.position?.y ?? 0;

							const newX = Math.round(
								bounds.x + bounds.width - newWidth - padding,
							);
							const newY = Math.round(
								bounds.y + bounds.height - newHeight - padding,
							);

							// The command applies these as raw device pixels. On Windows
							// that means converting with the scale of the display the
							// target rect is on (the overlay's display) — the camera
							// window's own scale is wrong when it starts on a monitor
							// with different DPI. On macOS physical coordinates are
							// interpreted relative to the camera window's scale, so its
							// own factor is the correct (self-canceling) one, and on
							// Linux scap reports logical == physical so the display
							// ratio would collapse to 1 and lose the window scale.
							const targetScale = (() => {
								if (ostype() !== "windows") return scaleFactor;
								const physicalWidth = displayInfo?.physical_size?.width;
								const logicalWidth = displayInfo?.logical_size?.width;
								return physicalWidth && logicalWidth && logicalWidth > 0
									? physicalWidth / logicalWidth
									: scaleFactor;
							})();

							setTargetState({
								x: (newX + displayOriginX) * targetScale,
								y: (newY + displayOriginY) * targetScale,
								width: newWidth * targetScale,
								height: newHeight * targetScale,
							});
						}
					});

					async function revertCamera() {
						const original = originalCameraBounds();
						const win = cameraWindow();
						if (original && win) {
							await win.setPosition(original.position);
							await win.setSize(original.size);
							await commands.updateCameraOverlayBounds(
								original.position.x,
								original.position.y,
								original.size.width,
								original.size.height,
							);
							setOriginalCameraBounds(null);
							setTargetState(null);
							lastApplied = null;
						}
					}

					onCleanup(() => {
						revertCamera();
					});

					function resetSelection() {
						setAspect(null);
						setPendingAreaTarget(null);
						if (areaSelectionPreferences.screenId === displayId()) {
							setAreaSelectionPreferences({
								locked: false,
								screenId: null,
								bounds: null,
							});
						}
						cropperRef?.reset();
						revertCamera();
					}

					async function showCropOptionsMenu(e: UIEvent) {
						e.preventDefault();
						e.stopPropagation();
						const items = [
							{
								text: "Reset selection",
								action: resetSelection,
							},
							await PredefinedMenuItem.new({
								item: "Separator",
							}),
							...createCropOptionsMenuItems({
								aspect: currentAspect(),
								snapToRatioEnabled: currentSnapToRatio(),
								onAspectSet: setAspect,
								onSnapToRatioSet: setSnapToRatio,
							}),
						];
						const menu = await Menu.new({ items });
						await menu.popup();
					}

					// Spacing rules:
					// Prefer below the crop (smaller margin)
					// If no space below, place above the crop (larger top margin)
					// Otherwise, place inside at the top of the crop (small inner margin)
					const macos = ostype() === "macos";
					const SIDE_MARGIN = 16;
					const MARGIN_BELOW = 16;
					const MARGIN_TOP_OUTSIDE = 16;
					const MARGIN_TOP_INSIDE = macos ? 40 : 28;
					const TOP_SAFE_MARGIN = macos ? 40 : 10; // keep clear of notch on MacBooks

					const controlsSize = createElementSize(() => controlsEl);
					const [controllerInside, _setControllerInside] = createSignal(false);

					// This is required due to the use of a ResizeObserver within the createElementSize function
					// Otherwise there will be an infinite loop: ResizeObserver loop completed with undelivered notifications.
					let raf: number | null = null;
					function setControllerInside(value: boolean) {
						if (raf) cancelAnimationFrame(raf);
						raf = requestAnimationFrame(() => _setControllerInside(value));
					}
					onCleanup(() => {
						if (raf) cancelAnimationFrame(raf);
					});

					const controlsStyle = createMemo(() => {
						const bounds = crop();
						const size = controlsSize;
						if (!size?.width || !size?.height) return undefined;

						if (size.width === 0 || bounds.width === 0) {
							return { transform: "translate(-1000px, -1000px)" }; // Hide off-screen initially
						}

						const centerX = bounds.x + bounds.width / 2;
						let finalY: number;

						// Try below the crop
						const belowY = bounds.y + bounds.height + MARGIN_BELOW;
						if (belowY + size.height <= window.innerHeight) {
							finalY = belowY;
							setControllerInside(false);
						} else {
							// Try above the crop with a larger top margin
							const aboveY = bounds.y - size.height - MARGIN_TOP_OUTSIDE;
							if (aboveY >= TOP_SAFE_MARGIN) {
								finalY = aboveY;
								setControllerInside(false);
							} else {
								// Default to inside
								finalY = bounds.y + MARGIN_TOP_INSIDE;
								setControllerInside(true);
							}
						}

						const finalX = Math.max(
							SIDE_MARGIN,
							Math.min(
								centerX - size.width / 2,
								window.innerWidth - size.width - SIDE_MARGIN,
							),
						);

						return {
							transform: `translate(${finalX}px, ${finalY}px)`,
						};
					});

					createEffect(() => {
						if (isInteracting()) return;
						if (!isValid()) return;
						if (!isActiveDisplay()) return;
						const screenId = displayId();
						if (!screenId) return;
						const bounds = crop();
						setPendingAreaTarget({
							variant: "area",
							screen: screenId,
							bounds: {
								position: { x: bounds.x, y: bounds.y },
								size: { width: bounds.width, height: bounds.height },
							},
						});
					});

					const [wasInteracting, setWasInteracting] = createSignal(false);
					createEffect(async () => {
						const interacting = isInteracting();
						const was = wasInteracting();
						setWasInteracting(interacting);

						if (was && !interacting) {
							persistLockedSelection();
							if (options.mode === "screenshot" && isValid()) {
								const cropBounds = crop();
								const displayInfo = areaDisplayInfo.data;
								console.log("[Screenshot Debug] crop bounds:", cropBounds);
								console.log("[Screenshot Debug] display info:", displayInfo);
								console.log(
									"[Screenshot Debug] window.innerWidth/Height:",
									window.innerWidth,
									window.innerHeight,
								);

								const target: ScreenCaptureTarget = {
									variant: "area",
									screen: displayId(),
									bounds: {
										position: {
											x: cropBounds.x,
											y: cropBounds.y,
										},
										size: {
											width: cropBounds.width,
											height: cropBounds.height,
										},
									},
								};

								console.log(
									"[Screenshot Debug] target being sent:",
									JSON.stringify(target, null, 2),
								);

								try {
									await commands.suspendTargetSelectOverlays();
									// The overlay webview is hidden rather than closed (only
									// Windows closes it, and only after a successful capture), and
									// the next picker session reuses it with targetMode still
									// "area", so this branch stays mounted. Suspending ended this
									// session; drop its selection so the next area screenshot
									// starts empty: https://github.com/CapSoftware/Cap/issues/2432
									setInitialAreaBounds(undefined);
									cropperRef?.reset({ animate: false });
									await new Promise((resolve) => setTimeout(resolve, 50));

									const path = await commands.takeScreenshot(target);
									const shouldOpenEditor =
										await commands.automationShouldOpenScreenshotEditor(target);
									if (shouldOpenEditor) {
										await commands.showWindow({ ScreenshotEditor: { path } });
									}
									await commands.closeTargetSelectOverlays();
								} catch (e) {
									const message = e instanceof Error ? e.message : String(e);
									toast.error(`Failed to take screenshot: ${message}`);
									console.error("Failed to take screenshot", e);
								}
							}
						}
					});

					return (
						<div
							class="fixed w-screen h-screen"
							classList={{
								"opacity-0 pointer-events-none": !shouldShowOverlay(),
							}}
						>
							<Show when={isActiveDisplay()}>
								<div
									class="fixed left-1/2 z-[60] max-w-[calc(100vw-2rem)] -translate-x-1/2"
									classList={{
										"top-12": macos,
										"top-4": !macos,
									}}
								>
									<div
										class={`${LIQUID_GLASS_SURFACE_CLASS} flex h-12 items-center gap-1.5 p-1.5 text-gray-12`}
									>
										<div class="min-w-28 px-2 text-base font-normal leading-none tracking-[-0.01em] tabular-nums">
											{isValid()
												? `${Math.round(crop().width)} × ${Math.round(crop().height)}`
												: "Draw an area"}
										</div>

										<div class="h-6 w-px bg-gray-5" />

										<div class="flex items-center gap-0.5 rounded-xl bg-gray-12/6 p-0.5">
											<button
												type="button"
												class="h-8 rounded-lg px-2 text-xs font-normal transition-colors"
												classList={{
													"bg-gray-12/12 text-gray-12":
														currentAspect() === null,
													"text-gray-11 hover:bg-gray-12/8":
														currentAspect() !== null,
												}}
												onClick={() => setAspect(null)}
												aria-pressed={currentAspect() === null}
											>
												Free
											</button>
											<For each={QUICK_AREA_RATIOS}>
												{(ratio) => {
													const selected = () =>
														ratiosEqual(currentAspect(), ratio);
													return (
														<button
															type="button"
															class="h-8 rounded-lg px-2 text-xs font-normal tabular-nums transition-colors"
															classList={{
																"bg-gray-12/12 text-gray-12": selected(),
																"text-gray-11 hover:bg-gray-12/8": !selected(),
															}}
															onClick={() => setAspect(ratio)}
															aria-pressed={selected()}
														>
															{ratio[0]}:{ratio[1]}
														</button>
													);
												}}
											</For>
										</div>

										<button
											type="button"
											class="flex size-9 items-center justify-center rounded-xl text-gray-11 transition-colors hover:bg-gray-12/8 hover:text-gray-12"
											onClick={showCropOptionsMenu}
											title="More aspect ratios"
											aria-label="More aspect ratios"
										>
											<IconLucideRatio class="size-4" />
										</button>

										<div class="h-6 w-px bg-gray-5" />

										<button
											type="button"
											class="flex size-9 items-center justify-center rounded-xl text-gray-11 transition-colors hover:bg-gray-12/8 hover:text-gray-12"
											onClick={resetSelection}
											title="Reset selection"
											aria-label="Reset selection"
										>
											<IconLucideRotateCcw class="size-4" />
										</button>
										<button
											type="button"
											class="flex size-9 items-center justify-center rounded-xl text-gray-11 transition-colors hover:bg-gray-12/8 hover:text-gray-12"
											onClick={() => cropperRef?.fill()}
											title="Fill display"
											aria-label="Fill display"
										>
											<IconLucideMaximize2 class="size-4" />
										</button>
										<Show when={options.mode !== "screenshot"}>
											<button
												type="button"
												class="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-normal transition-colors disabled:cursor-not-allowed disabled:opacity-40"
												classList={{
													"bg-blue-9 text-white shadow-sm": isSelectionLocked(),
													"text-gray-11 hover:bg-gray-12/8 hover:text-gray-12":
														!isSelectionLocked(),
												}}
												disabled={!isValid()}
												onClick={toggleLockedSelection}
												aria-pressed={isSelectionLocked()}
												title={
													isSelectionLocked()
														? "Stop reusing this area"
														: "Reuse this area for future recordings"
												}
											>
												<IconLucideLock class="size-3.5" />
												{isSelectionLocked() ? "Locked" : "Lock"}
											</button>
										</Show>
									</div>
								</div>
							</Show>

							<div
								ref={controlsEl}
								class="fixed z-50 transition-opacity"
								style={controlsStyle()}
							>
								<div class="flex flex-col items-center">
									<Show when={options.mode !== "screenshot"}>
										<RecordingControls
											target={{
												variant: "area",
												screen: displayId(),
												bounds: {
													position: {
														x: crop().x,
														y: crop().y,
													},
													size: {
														width: crop().width,
														height: crop().height,
													},
												},
											}}
											disabled={!isValid()}
											showBackground={controllerInside()}
											onRecordingStart={() => {
												persistLockedSelection();
												setOriginalCameraBounds(null);
												dismissPickerForRecordingStart();
											}}
											onClose={() => {
												setOptions({
													targetMode: null,
													targetModeDismissal: "cancelled",
												});
												commands.closeTargetSelectOverlays();
											}}
										/>
									</Show>
									<Show when={!isValid()}>
										<div class="flex flex-col gap-1 items-center p-2.5 my-2 rounded-xl border min-w-fit w-fit bg-red-2 shadow-xs border-red-4 text-sm">
											<p>
												Minimum size is {minSize().width} x {minSize().height}
											</p>
											<small>
												<code>
													{crop().width} x {crop().height}
												</code>{" "}
												is too small
											</small>
										</div>
									</Show>
								</div>
							</div>

							<SelectionHint show={shouldShowSelectionHint()} />

							<Cropper
								ref={cropperRef}
								onInteraction={setIsInteracting}
								onCropChange={setCrop}
								initialCrop={() => effectiveInitialAreaBounds() ?? CROP_ZERO}
								showBounds={isValid()}
								aspectRatio={currentAspect() ?? undefined}
								snapToRatioEnabled={currentSnapToRatio()}
								onContextMenu={(e) => showCropOptionsMenu(e)}
							/>
						</div>
					);
				}}
			</Match>
		</Switch>
	);
}

function RecordingControls(props: {
	target: ScreenCaptureTarget;
	setToggleModeSelect?: (value: boolean) => void;
	showBackground?: boolean;
	disabled?: boolean;
	onRecordingStart?: () => void;
	onClose?: () => void;
}) {
	const { setOptions, rawOptions } = useRecordingOptions();

	const generalSetings = generalSettingsStore.createQuery();
	const devices = createDevicesQuery();
	const [dismissingPicker, setDismissingPicker] = createSignal(false);
	let controlsDisposed = false;
	onCleanup(() => {
		controlsDisposed = true;
	});
	const cameras = createMemo(() => devices.data?.cameras ?? []);
	const permissions = createMemo(() => devices.data?.permissions);
	const setCamera = createCameraMutation();
	const [restoringInputs, setRestoringInputs] = createSignal(true);

	onMount(async () => {
		if (rawOptions.cameraID) {
			try {
				await setCamera.rawMutate({ ...rawOptions.cameraID }, false);
			} catch (error) {
				console.error("Failed to restore camera input:", error);
			}
		}
		if (!controlsDisposed) setRestoringInputs(false);
	});

	const selectedCamera = createMemo(() => {
		if (!rawOptions.cameraID) return null;
		return findCamera(cameras(), rawOptions.cameraID) ?? null;
	});

	const startLoading = () =>
		dismissingPicker() ||
		devices.isPending ||
		restoringInputs() ||
		setCamera.isPending;
	const startDisabled = () => !!props.disabled || startLoading();

	const startRecording = async () => {
		if (startDisabled()) return;

		// Snapshot before onRecordingStart: dismissing the picker
		// (targetMode: null) disposes the <Match> branch that owns
		// this component, and the display/area target props call its
		// narrowed accessor — reading props.target afterwards throws
		// "Stale read from <Match>." and the recording never starts.
		const target = props.target;

		if (target.variant === "area") {
			setOptions(
				"captureTarget",
				reconcile({
					variant: "area",
					screen: target.screen,
					bounds: {
						position: {
							x: target.bounds.position.x,
							y: target.bounds.position.y,
						},
						size: {
							width: target.bounds.size.width,
							height: target.bounds.size.height,
						},
					},
				}),
			);
		}

		setDismissingPicker(true);
		try {
			await commands.suspendTargetSelectOverlays();
		} catch (error) {
			setDismissingPicker(false);
			toast.error("Could not dismiss the target picker. Please try again.");
			console.error("Failed to suspend target select overlays", error);
			return;
		}
		if (controlsDisposed) return;
		props.onRecordingStart?.();

		if (rawOptions.mode === "screenshot") {
			try {
				const path = await commands.takeScreenshot(target);
				const shouldOpenEditor =
					await commands.automationShouldOpenScreenshotEditor(target);
				if (shouldOpenEditor) {
					await commands.showWindow({ ScreenshotEditor: { path } });
				}
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				toast.error(`Failed to take screenshot: ${message}`);
				console.error("Failed to take screenshot", e);
			} finally {
				await commands
					.closeTargetSelectOverlays()
					.catch((e) =>
						console.error("Failed to close target select overlays", e),
					);
			}
			return;
		}

		commands
			.startRecording({
				capture_target: target,
				mode: rawOptions.mode,
				capture_system_audio: false,
			})
			.then((action) => {
				// On success the backend closes the overlay windows; the
				// non-Started actions leave our hidden windows behind.
				// User-facing feedback for them arrives via the backend's
				// StartFailed event in the main window.
				if (action !== "Started") void commands.closeTargetSelectOverlays();
			})
			.catch((e: unknown) => {
				const msg = e instanceof Error ? e.message : String(e);
				// This webview is hidden by now, so the toast is a
				// best-effort extra — the visible feedback comes from the
				// backend's StartFailed event toasted in the main window.
				if (!isRecordingStartCancelled(e)) {
					toast.error(`Failed to start recording: ${msg}`);
				}
				// An IPC-level rejection never reaches the backend, so no
				// StartFailed event fires; the picker flow hid the main
				// window and dismissal closed the overlays — without this,
				// the whole app visually vanishes with no recording.
				void commands.showWindow({
					Main: { init_target_mode: null },
				});
				void commands.closeTargetSelectOverlays();
			});
	};

	const menuModes = async () =>
		await Menu.new({
			items: [
				await CheckMenuItem.new({
					text: "Studio Mode",
					action: () => {
						setOptions("mode", "studio");
						commands.setRecordingMode("studio");
					},
					checked: rawOptions.mode === "studio",
				}),
				await CheckMenuItem.new({
					text: "Screenshot Mode",
					action: () => {
						setOptions("mode", "screenshot");
						commands.setRecordingMode("screenshot");
					},
					checked: rawOptions.mode === "screenshot",
				}),
			],
		});

	const countdownItems = async () => [
		await CheckMenuItem.new({
			text: "Off",
			action: () => generalSettingsStore.set({ recordingCountdown: 0 }),
			checked:
				!generalSetings.data?.recordingCountdown ||
				generalSetings.data?.recordingCountdown === 0,
		}),
		await CheckMenuItem.new({
			text: "3 seconds",
			action: () => generalSettingsStore.set({ recordingCountdown: 3 }),
			checked: generalSetings.data?.recordingCountdown === 3,
		}),
		await CheckMenuItem.new({
			text: "5 seconds",
			action: () => generalSettingsStore.set({ recordingCountdown: 5 }),
			checked: generalSetings.data?.recordingCountdown === 5,
		}),
		await CheckMenuItem.new({
			text: "10 seconds",
			action: () => generalSettingsStore.set({ recordingCountdown: 10 }),
			checked: generalSetings.data?.recordingCountdown === 10,
		}),
	];

	const preRecordingMenu = async () => {
		return await Menu.new({
			items: [
				await MenuItem.new({
					text: "Recording Countdown",
					enabled: false,
				}),
				...(await countdownItems()),
			],
		});
	};

	const popupRecordingMenu = createRecordingMenuPopup();

	function showMenu(createMenu: () => Promise<Menu>, e: UIEvent) {
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		void popupRecordingMenu(
			createMenu,
			new LogicalPosition(rect.x, rect.y + 40),
		).catch(() => toast.error("Could not open recording menu"));
	}

	return (
		<>
			<div class="flex flex-col gap-2.5 items-stretch my-2.5 w-104 max-w-[90vw]">
				<div class={`${LIQUID_GLASS_SURFACE_CLASS} p-3`}>
					<div class="flex gap-2.5 items-center">
						<div
							onClick={() => {
								if (props.onClose) {
									props.onClose();
								} else {
									setOptions({
										targetMode: null,
										targetModeDismissal: "cancelled",
									});
									commands.closeTargetSelectOverlays();
								}
							}}
							class="flex justify-center items-center rounded-sm transition-opacity bg-gray-12 size-9 hover:opacity-80"
						>
							<IconCapX class="invert will-change-transform size-3 dark:invert-0" />
						</div>
						<div
							data-disabled={startDisabled()}
							class="flex flex-1 min-w-0 max-w-[18rem] overflow-hidden flex-row h-11 rounded-sm text-white bg-linear-to-r from-blue-10 via-blue-10 to-blue-11 dark:from-blue-9 dark:via-blue-9 dark:to-blue-10 group"
							onClick={() => void startRecording()}
						>
							<div
								class="flex flex-1 items-center py-1 pl-4 transition-colors hover:bg-white/10 min-w-0"
								classList={{
									"opacity-60 cursor-not-allowed hover:bg-transparent":
										startDisabled(),
								}}
							>
								<Switch>
									<Match when={rawOptions.mode === "studio"}>
										<IconCapFilmCut class="size-4 shrink-0" />
									</Match>
									<Match when={(rawOptions.mode as string) === "screenshot"}>
										<IconCapCamera class="size-4 shrink-0" />
									</Match>
								</Switch>
								<div class="flex flex-col mr-2 ml-3 min-w-0">
									<span class="text-[0.95rem] font-medium text-white text-nowrap">
										{rawOptions.mode === "screenshot"
											? "Take Screenshot"
											: "Start Recording"}
									</span>
									<span class="text-[11px] flex items-center text-nowrap gap-1 transition-opacity duration-200 text-white/90 font-light -mt-0.5">
										{`${capitalize(rawOptions.mode)} Mode`}
									</span>
								</div>
							</div>
							<button
								type="button"
								aria-label="Choose recording mode"
								class="pl-2.5 pr-3 py-1.5 flex items-center border-l border-white/20 bg-white/5 transition-colors group-hover:bg-white/10"
								onClick={(e) => showMenu(menuModes, e)}
							>
								<IconCapCaretDown class="pointer-events-none" />
							</button>
						</div>
						<button
							type="button"
							aria-label="Recording countdown"
							class="flex justify-center items-center rounded-sm border transition-opacity bg-gray-6 text-gray-12 size-9 hover:opacity-80"
							onClick={(e) => showMenu(preRecordingMenu, e)}
						>
							<IconCapGear class="pointer-events-none will-change-transform size-5" />
						</button>
					</div>
				</div>
				<Show when={(rawOptions.mode as string) !== "screenshot"}>
					<div class={`${LIQUID_GLASS_SURFACE_CLASS} p-3`}>
						<div class="grid grid-cols-1 gap-2 w-full">
							<CameraSelectBase
								disabled={devices.isPending}
								options={cameras()}
								value={selectedCamera() ?? null}
								onChange={(camera) => {
									if (!camera) setCamera.mutate({ model: null });
									else if (camera.model_id)
										setCamera.mutate({ model: { ModelID: camera.model_id } });
									else
										setCamera.mutate({ model: { DeviceID: camera.device_id } });
								}}
								permissions={permissions()}
								PillComponent={InfoPill}
								class="flex flex-row gap-2 items-center px-2 w-full h-[42px] rounded-lg border border-gray-5 transition-colors cursor-default disabled:opacity-70 bg-gray-3 disabled:text-gray-11 KSelect"
								iconClass="text-gray-10 size-4"
							/>
						</div>
					</div>
				</Show>
			</div>
			<div class="flex justify-center items-center w-full">
				<div
					onClick={() => props.setToggleModeSelect?.(true)}
					class="flex gap-1 justify-center items-center self-center mb-5 transition-opacity duration-200 w-fit hover:opacity-60"
					classList={{
						"bg-black/50 p-2 rounded-lg border border-white/10 hover:bg-black/50 hover:opacity-80":
							props.showBackground,
						"hover:opacity-60": !props.showBackground,
					}}
				>
					<IconCapInfo class="opacity-70 will-change-transform size-3" />
					<p class="text-sm text-white drop-shadow-md">
						<span class="opacity-70">What is </span>
						<span class="font-medium">{capitalize(rawOptions.mode)} Mode</span>?
					</p>
				</div>
			</div>
		</>
	);
}
