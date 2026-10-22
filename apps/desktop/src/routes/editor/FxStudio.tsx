import { cx } from "cva";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Index,
	onCleanup,
	Show,
} from "solid-js";
import toast from "solid-toast";
import { CaptMark } from "~/components/CaptMark";
import { toastThinkingIcon } from "~/components/DotGridLoader";
import { Toggle } from "~/components/Toggle";
import { commands, type FxNode, type FxOp } from "~/utils/tauri";
import IconLucideArrowRight from "~icons/lucide/arrow-right";
import IconLucideCopy from "~icons/lucide/copy";
import IconLucideEye from "~icons/lucide/eye";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import { RgbInput } from "./color-utils";
import { useEditorContext } from "./context";
import {
	categoryColor,
	createNode,
	EMPTY_FX,
	FX_CATEGORIES,
	FX_DRIVES,
	FX_OPS,
	FX_PRESETS,
	moveNode,
	opInfo,
	presetNodes,
} from "./fx-ops";
import { PALETTES } from "./LensTab";
import { Field, Section, Slider } from "./ui";

const NODE_W = 148;
const WIRE_W = 44;
const SLOT = NODE_W + WIRE_W;

const [selectedId, setSelectedId] = createSignal<string | null>(null);

const pct = (v: number) => `${Math.round(v * 100)}%`;

function useFx() {
	const { project, setProject } = useEditorContext();

	const fx = () => project.fx ?? EMPTY_FX;
	const nodes = () => fx().nodes;
	const indexOf = (id: string | null) =>
		id ? nodes().findIndex((n) => n.id === id) : -1;

	const ensure = () => {
		if (!project.fx) setProject("fx", { ...EMPTY_FX, nodes: [] });
	};
	const setNodes = (next: FxNode[]) => {
		ensure();
		setProject("fx", "nodes", next);
	};
	const update = <K extends keyof FxNode>(
		id: string,
		key: K,
		value: FxNode[K],
	) => {
		const index = indexOf(id);
		if (index < 0) return;
		setProject("fx", "nodes", index, key, value);
	};
	const add = (op: FxOp) => {
		const node = createNode(op);
		const after = indexOf(selectedId());
		const next = nodes().slice();
		next.splice(after < 0 ? next.length : after + 1, 0, node);
		setNodes(next);
		if (!fx().enabled) setProject("fx", "enabled", true);
		setSelectedId(node.id);
	};
	const remove = (id: string) => {
		const index = indexOf(id);
		if (index < 0) return;
		const next = nodes().filter((n) => n.id !== id);
		setNodes(next);
		setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null);
	};
	const duplicate = (id: string) => {
		const index = indexOf(id);
		if (index < 0) return;
		const { id: _, op, ...rest } = nodes()[index];
		const copy = createNode(op, rest);
		const next = nodes().slice();
		next.splice(index + 1, 0, copy);
		setNodes(next);
		setSelectedId(copy.id);
	};
	const move = (from: number, to: number) =>
		setNodes(moveNode(nodes(), from, to));
	const replace = (next: FxNode[]) => {
		setProject("fx", { enabled: true, nodes: next });
		setSelectedId(next[0]?.id ?? null);
	};

	return {
		fx,
		nodes,
		indexOf,
		update,
		add,
		remove,
		duplicate,
		move,
		replace,
		setEnabled: (v: boolean) => {
			ensure();
			setProject("fx", "enabled", v);
		},
	};
}

function DriveGlyph(props: { drive: FxNode["drive"] }) {
	const path = () => {
		switch (props.drive) {
			case "lfo":
				return "M0 5 C3 0 5 0 8 5 S13 10 16 5";
			case "strobe":
				return "M0 8 H4 V2 H8 V8 H12 V2 H16";
			case "ramp":
				return "M0 8 L8 2 V8 L16 2";
			case "click":
				return "M0 8 H6 L7 1 L8 8 H16";
			default:
				return "";
		}
	};
	return (
		<Show when={props.drive !== "none"}>
			<svg
				viewBox="0 0 16 10"
				class="w-4 h-2.5 text-ed-text-2"
				fill="none"
				stroke="currentColor"
				stroke-width="1.4"
				aria-hidden="true"
			>
				<path d={path()} />
			</svg>
		</Show>
	);
}

function Wire(props: { live: boolean }) {
	return (
		<svg
			width={WIRE_W}
			height="12"
			viewBox={`0 0 ${WIRE_W} 12`}
			class="shrink-0"
			aria-hidden="true"
		>
			<line
				x1="0"
				y1="6"
				x2={WIRE_W}
				y2="6"
				stroke="var(--ed-line-strong)"
				stroke-width="1.5"
			/>
			<Show when={props.live}>
				<rect width="4" height="4" y="4" rx="1" fill="var(--ed-accent)">
					<animate
						attributeName="x"
						from="-4"
						to={WIRE_W}
						dur="1.4s"
						repeatCount="indefinite"
					/>
				</rect>
			</Show>
		</svg>
	);
}

function Terminal(props: { label: string }) {
	return (
		<div class="flex shrink-0 justify-center items-center h-[88px] w-11 rounded-sm border border-dashed border-ed-line-strong text-[10px] font-semibold uppercase tracking-wider text-ed-text-3 [writing-mode:vertical-rl] rotate-180">
			{props.label}
		</div>
	);
}

function OperatorMenu(props: {
	onPick: (op: FxOp) => void;
	onClose: () => void;
}) {
	let ref: HTMLDivElement | undefined;
	const onDown = (e: PointerEvent) => {
		if (ref && !ref.contains(e.target as Node)) props.onClose();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") props.onClose();
	};
	document.addEventListener("pointerdown", onDown, true);
	document.addEventListener("keydown", onKey);
	onCleanup(() => {
		document.removeEventListener("pointerdown", onDown, true);
		document.removeEventListener("keydown", onKey);
	});

	return (
		<div
			ref={ref}
			class="absolute right-3 top-10 z-30 grid grid-cols-4 gap-3 p-3 rounded-md border shadow-ed-card border-ed-line bg-ed-card"
		>
			<For each={FX_CATEGORIES}>
				{(category) => (
					<div class="flex flex-col gap-0.5 min-w-[96px]">
						<div class="flex gap-1.5 items-center px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ed-text-3">
							<span
								class="size-1.5 rounded-[1px]"
								style={{ background: category.color }}
							/>
							{category.name}
						</div>
						<For each={FX_OPS.filter((op) => op.category === category.id)}>
							{(op) => (
								<button
									type="button"
									class="px-1.5 h-6 text-left rounded-sm text-[12px] text-ed-text-2 hover:bg-ed-ctl-hover hover:text-ed-text-1"
									onClick={() => props.onPick(op.id)}
								>
									{op.name}
								</button>
							)}
						</For>
					</div>
				)}
			</For>
		</div>
	);
}

export function FxNetwork() {
	const fx = useFx();
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [drag, setDrag] = createSignal<{
		from: number;
		startX: number;
		dx: number;
		active: boolean;
	} | null>(null);

	const target = createMemo(() => {
		const d = drag();
		if (!d?.active) return null;
		const to = d.from + Math.round(d.dx / SLOT);
		return Math.max(0, Math.min(fx.nodes().length - 1, to));
	});

	const shift = (index: number) => {
		const d = drag();
		const to = target();
		if (!d?.active || to === null) return 0;
		if (index === d.from) return d.dx;
		if (d.from < to && index > d.from && index <= to) return -SLOT;
		if (d.from > to && index >= to && index < d.from) return SLOT;
		return 0;
	};

	const onKey = (e: KeyboardEvent) => {
		const id = selectedId();
		if (!id || (e.target as HTMLElement).closest("input, textarea")) return;
		if (e.key === "Backspace" || e.key === "Delete") {
			e.preventDefault();
			fx.remove(id);
		}
	};

	createEffect(() => {
		if (selectedId() && fx.indexOf(selectedId()) < 0) setSelectedId(null);
	});

	return (
		<div
			class="flex relative flex-col h-full min-h-0 outline-hidden"
			tabIndex={-1}
			onKeyDown={onKey}
		>
			<div class="flex gap-3 justify-between items-center pb-2 shrink-0">
				<div class="flex gap-2 items-center">
					<span class="text-[12px] font-semibold text-ed-text-1">Network</span>
					<span class="text-[11px] tabular-nums text-ed-text-3">
						{fx.nodes().length}{" "}
						{fx.nodes().length === 1 ? "operator" : "operators"}
					</span>
				</div>
				<div class="flex gap-1 items-center">
					<button
						type="button"
						class="flex gap-1 items-center px-2 h-7 rounded-sm text-[12px] font-medium text-ed-text-1 bg-ed-ctl hover:bg-ed-ctl-hover"
						onClick={() => setMenuOpen((o) => !o)}
					>
						<IconLucidePlus class="size-3.5" />
						Operator
					</button>
				</div>
			</div>
			<Show when={menuOpen()}>
				<OperatorMenu
					onPick={(op) => {
						fx.add(op);
						setMenuOpen(false);
					}}
					onClose={() => setMenuOpen(false)}
				/>
			</Show>
			<div
				class="flex overflow-x-auto overflow-y-hidden flex-1 items-center px-1 min-h-0 rounded-md bg-ed-card-2"
				style={{
					"background-image":
						"radial-gradient(var(--ed-line-strong) 1px, transparent 1px)",
					"background-size": "16px 16px",
				}}
				onPointerDown={(e) => {
					if (e.target === e.currentTarget) setSelectedId(null);
				}}
			>
				<div class="flex items-center py-3 pr-3 pl-2 mx-auto">
					<Terminal label="In" />
					<Wire live={fx.fx().enabled && fx.nodes().length > 0} />
					<Index each={fx.nodes()}>
						{(node, index) => {
							const info = () => opInfo(node().op);
							const selected = () => selectedId() === node().id;
							const dragging = () => drag()?.active && drag()?.from === index;
							return (
								<>
									<div
										class={cx(
											"relative shrink-0 flex flex-col h-[88px] rounded-sm border bg-ed-card select-none touch-none cursor-grab",
											selected()
												? "border-ed-accent shadow-ed-card"
												: "border-ed-line hover:border-ed-line-strong",
											(!node().enabled || !fx.fx().enabled) && "opacity-45",
											dragging() && "z-20 cursor-grabbing shadow-ed-card",
										)}
										style={{
											width: `${NODE_W}px`,
											transform: `translateX(${shift(index)}px)`,
											transition: dragging()
												? "none"
												: "transform 160ms ease-out",
										}}
										onPointerDown={(e) => {
											if (e.button !== 0) return;
											if ((e.target as HTMLElement).closest("button")) return;
											e.currentTarget.setPointerCapture(e.pointerId);
											setDrag({
												from: index,
												startX: e.clientX,
												dx: 0,
												active: false,
											});
										}}
										onPointerMove={(e) => {
											const d = drag();
											if (!d || d.from !== index) return;
											const dx = e.clientX - d.startX;
											setDrag({
												...d,
												dx,
												active: d.active || Math.abs(dx) > 4,
											});
										}}
										onPointerUp={() => {
											const d = drag();
											const to = target();
											setDrag(null);
											if (!d) return;
											if (d.active && to !== null && to !== d.from) {
												fx.move(d.from, to);
											} else if (!d.active) {
												setSelectedId(node().id);
											}
										}}
										onPointerCancel={() => setDrag(null)}
									>
										<div
											class="h-[3px] rounded-t-[2px]"
											style={{ background: categoryColor(node().op) }}
										/>
										<div class="flex gap-1 justify-between items-center px-2 pt-1.5">
											<span class="text-[12px] font-semibold truncate text-ed-text-1">
												{info().name}
											</span>
											<div class="flex gap-1 items-center">
												<DriveGlyph drive={node().drive} />
												<button
													type="button"
													class="flex justify-center items-center rounded-sm size-5 text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover"
													title={node().enabled ? "Bypass" : "Enable"}
													onClick={() =>
														fx.update(node().id, "enabled", !node().enabled)
													}
												>
													<Show
														when={node().enabled}
														fallback={<IconLucideEyeOff class="size-3" />}
													>
														<IconLucideEye class="size-3" />
													</Show>
												</button>
											</div>
										</div>
										<div class="flex flex-col flex-1 gap-1 justify-end px-2 pb-2">
											<For
												each={[
													info().a && {
														label: info().a?.label ?? "",
														value: node().a,
													},
													info().b && {
														label: info().b?.label ?? "",
														value: node().b,
													},
													{ label: "Mix", value: node().mix },
												].filter(
													(p): p is { label: string; value: number } => !!p,
												)}
											>
												{(param) => (
													<div class="flex gap-1.5 items-center">
														<span class="w-12 text-[9px] uppercase tracking-wide truncate text-ed-text-3">
															{param.label}
														</span>
														<div class="overflow-hidden flex-1 h-1 rounded-[1px] bg-ed-ctl">
															<div
																class="h-full bg-ed-text-3"
																style={{ width: pct(param.value) }}
															/>
														</div>
													</div>
												)}
											</For>
										</div>
									</div>
									<Wire live={fx.fx().enabled && node().enabled} />
								</>
							);
						}}
					</Index>
					<Show when={fx.nodes().length === 0}>
						<button
							type="button"
							class="flex flex-col gap-1 justify-center items-center rounded-sm border border-dashed h-[88px] w-[148px] shrink-0 border-ed-line-strong text-[12px] text-ed-text-3 hover:text-ed-text-1 hover:border-ed-text-3"
							onClick={() => setMenuOpen(true)}
						>
							<IconLucidePlus class="size-4" />
							Add an operator
						</button>
						<Wire live={false} />
					</Show>
					<Terminal label="Out" />
				</div>
			</div>
		</div>
	);
}

function AiLook() {
	const fx = useFx();
	const [prompt, setPrompt] = createSignal("");
	const [busy, setBusy] = createSignal(false);

	const generate = async () => {
		const text = prompt().trim();
		if (!text || busy()) return;
		setBusy(true);
		const toastId = toast.loading("Designing the look...", {
			icon: toastThinkingIcon(),
		});
		try {
			const nodes = await commands.generateAiFxChain(text, fx.nodes());
			fx.replace(nodes);
			toast.success(
				`Built ${nodes.length} operator${nodes.length === 1 ? "" : "s"}`,
				{ id: toastId },
			);
		} catch (error) {
			toast.error(typeof error === "string" ? error : "AI look failed", {
				id: toastId,
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<Section name="Describe a look">
			<textarea
				class="px-2.5 py-2 w-full h-[68px] text-[12px] leading-snug rounded-sm border resize-none outline-hidden border-ed-line bg-ed-card-2 text-ed-text-1 placeholder:text-ed-text-3 focus:border-ed-accent"
				placeholder={
					fx.nodes().length
						? "Change it: more glitch on clicks, warmer, less blur..."
						: "Thermal security camera that glitches when I click"
				}
				value={prompt()}
				onInput={(e) => setPrompt(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						void generate();
					}
				}}
			/>
			<button
				type="button"
				disabled={busy() || !prompt().trim()}
				class="flex gap-1.5 justify-center items-center w-full h-8 rounded-sm text-[12px] font-medium text-white bg-ed-accent hover:bg-ed-accent-2 disabled:opacity-50"
				onClick={() => void generate()}
			>
				<CaptMark state={busy() ? "thinking" : "idle"} class="size-3.5" />
				{busy()
					? "Designing..."
					: fx.nodes().length
						? "Rework with AI"
						: "Build with AI"}
			</button>
		</Section>
	);
}

function Presets() {
	const fx = useFx();
	return (
		<Section name="Presets">
			<div class="grid grid-cols-3 gap-1.5">
				<For each={FX_PRESETS}>
					{(preset) => {
						const stops = () =>
							PALETTES.find((p) => p.id === preset.palette)?.stops ?? [];
						return (
							<button
								type="button"
								class="flex flex-col gap-1.5 p-1.5 rounded-sm border transition-colors border-ed-line hover:border-ed-line-strong hover:bg-ed-ctl-hover"
								onClick={() => fx.replace(presetNodes(preset))}
							>
								<div class="flex overflow-hidden h-3 rounded-[2px] bg-ed-ctl">
									<For each={stops()}>
										{(stop) => (
											<div class="flex-1" style={{ background: stop }} />
										)}
									</For>
								</div>
								<span class="text-[11px] text-left text-ed-text-2">
									{preset.name}
								</span>
							</button>
						);
					}}
				</For>
			</div>
		</Section>
	);
}

function NodeInspector(props: { node: FxNode; index: number }) {
	const fx = useFx();
	const info = () => opInfo(props.node.op);
	const set = <K extends keyof FxNode>(key: K, value: FxNode[K]) =>
		fx.update(props.node.id, key, value);

	return (
		<Section
			name={info().name}
			action={
				<div class="flex gap-0.5 items-center">
					<button
						type="button"
						class="flex justify-center items-center rounded-sm size-6 text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover disabled:opacity-40"
						title="Move earlier"
						disabled={props.index === 0}
						onClick={() => fx.move(props.index, props.index - 1)}
					>
						<IconLucideArrowLeft class="size-3.5" />
					</button>
					<button
						type="button"
						class="flex justify-center items-center rounded-sm size-6 text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover disabled:opacity-40"
						title="Move later"
						disabled={props.index === fx.nodes().length - 1}
						onClick={() => fx.move(props.index, props.index + 1)}
					>
						<IconLucideArrowRight class="size-3.5" />
					</button>
					<button
						type="button"
						class="flex justify-center items-center rounded-sm size-6 text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover"
						title="Duplicate"
						onClick={() => fx.duplicate(props.node.id)}
					>
						<IconLucideCopy class="size-3.5" />
					</button>
					<button
						type="button"
						class="flex justify-center items-center rounded-sm size-6 text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover"
						title="Delete"
						onClick={() => fx.remove(props.node.id)}
					>
						<IconLucideTrash2 class="size-3.5" />
					</button>
				</div>
			}
		>
			<div class="flex flex-col">
				<Field inline name="Mix" value={pct(props.node.mix)}>
					<Slider
						value={[props.node.mix]}
						onChange={(v) => set("mix", v[0])}
						minValue={0}
						maxValue={1}
						step={0.01}
						formatTooltip={pct}
					/>
				</Field>
				<Show when={info().a}>
					{(param) => (
						<Field inline name={param().label} value={pct(props.node.a)}>
							<Slider
								value={[props.node.a]}
								onChange={(v) => set("a", v[0])}
								minValue={0}
								maxValue={1}
								step={0.01}
								formatTooltip={pct}
							/>
						</Field>
					)}
				</Show>
				<Show when={info().b}>
					{(param) => (
						<Field inline name={param().label} value={pct(props.node.b)}>
							<Slider
								value={[props.node.b]}
								onChange={(v) => set("b", v[0])}
								minValue={0}
								maxValue={1}
								step={0.01}
								formatTooltip={pct}
							/>
						</Field>
					)}
				</Show>
			</div>
			<Show when={info().color}>
				<div>
					<span class="block mb-1 text-[11px] text-ed-text-3">Color</span>
					<RgbInput
						value={props.node.color as [number, number, number]}
						onChange={(c) => set("color", c)}
					/>
				</div>
			</Show>
			<Show when={info().usesPalette}>
				<div class="grid grid-cols-4 gap-1.5">
					<For each={PALETTES.filter((p) => p.id !== "none")}>
						{(palette) => (
							<button
								type="button"
								class={cx(
									"flex flex-col gap-1 p-1 rounded-sm border",
									props.node.palette === palette.id
										? "border-ed-accent"
										: "border-ed-line hover:border-ed-line-strong",
								)}
								onClick={() => set("palette", palette.id)}
							>
								<div class="flex overflow-hidden h-2.5 rounded-[2px]">
									<For each={palette.stops}>
										{(stop) => (
											<div class="flex-1" style={{ background: stop }} />
										)}
									</For>
								</div>
								<span class="text-[10px] text-ed-text-2">{palette.name}</span>
							</button>
						)}
					</For>
				</div>
			</Show>
			<div class="flex flex-col gap-2 pt-1">
				<span class="text-[11px] text-ed-text-3">Drive mix with</span>
				<div class="grid grid-cols-5 gap-1">
					<For each={FX_DRIVES}>
						{(drive) => (
							<button
								type="button"
								class={cx(
									"h-6 rounded-sm border text-[11px] transition-colors",
									props.node.drive === drive.id
										? "border-ed-accent text-ed-text-1 bg-ed-ctl"
										: "border-ed-line text-ed-text-3 hover:text-ed-text-1",
								)}
								onClick={() => set("drive", drive.id)}
							>
								{drive.name}
							</button>
						)}
					</For>
				</div>
				<Show when={props.node.drive !== "none"}>
					<div class="flex flex-col">
						<Show when={props.node.drive !== "click"}>
							<Field
								inline
								name="Rate"
								value={`${props.node.rate.toFixed(2)} Hz`}
							>
								<Slider
									value={[props.node.rate]}
									onChange={(v) => set("rate", v[0])}
									minValue={0.05}
									maxValue={8}
									step={0.05}
								/>
							</Field>
						</Show>
						<Field inline name="Depth" value={pct(props.node.depth)}>
							<Slider
								value={[props.node.depth]}
								onChange={(v) => set("depth", v[0])}
								minValue={0}
								maxValue={1}
								step={0.01}
								formatTooltip={pct}
							/>
						</Field>
					</div>
				</Show>
			</div>
		</Section>
	);
}

export function FxInspector() {
	const fx = useFx();
	const selectedIndex = createMemo(() => fx.indexOf(selectedId()));

	return (
		<div class="flex overflow-hidden flex-col flex-1 min-h-0 rounded-xl bg-ed-card shadow-ed-card">
			<div class="flex justify-between items-center px-4 h-12 border-b shrink-0 border-ed-line">
				<div class="flex flex-col">
					<span class="text-[13px] font-semibold text-ed-text-1">
						FX Studio
					</span>
					<span class="text-[11px] text-ed-text-3">
						Preview and export only
					</span>
				</div>
				<div class="flex gap-2 items-center">
					<Show when={fx.nodes().length > 0}>
						<button
							type="button"
							class="px-2 h-6 rounded-sm text-[11px] text-ed-text-3 hover:text-ed-text-1 hover:bg-ed-ctl-hover"
							onClick={() => fx.replace([])}
						>
							Clear
						</button>
					</Show>
					<Toggle checked={fx.fx().enabled} onChange={fx.setEnabled} />
				</div>
			</div>
			<div class="flex overflow-y-auto flex-col flex-1 gap-1 py-1 min-h-0">
				<Show when={selectedIndex() >= 0}>
					<NodeInspector
						node={fx.nodes()[selectedIndex()]}
						index={selectedIndex()}
					/>
					<div class="w-full border-t border-ed-line" />
				</Show>
				<AiLook />
				<div class="w-full border-t border-ed-line" />
				<Presets />
			</div>
		</div>
	);
}
