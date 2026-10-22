import { For, Show } from "solid-js";
import { Toggle } from "~/components/Toggle";
import type {
	BackgroundPattern,
	BackgroundPatternConfiguration,
	LensConfiguration,
	LensPalette,
	TrackerConfiguration,
} from "~/utils/tauri";
import { RgbInput } from "./color-utils";
import { useEditorContext } from "./context";
import { Field, Section, Slider, Subfield } from "./ui";

// Five stops per palette, mirrored from cap_project::LensPalette::stops.
const PALETTES: { id: LensPalette; name: string; stops: string[] }[] = [
	{ id: "none", name: "Off", stops: [] },
	{
		id: "crimson",
		name: "Crimson",
		stops: ["#050001", "#3a0206", "#8f0a12", "#e3262d", "#ffe0db"],
	},
	{
		id: "thermal",
		name: "Thermal",
		stops: ["#050310", "#3a0b6b", "#b3306a", "#f6862a", "#fcf6b4"],
	},
	{
		id: "phosphor",
		name: "Phosphor",
		stops: ["#010604", "#05361b", "#13a85a", "#7dffb4", "#eafff3"],
	},
	{
		id: "amber",
		name: "Amber",
		stops: ["#070300", "#3d1a02", "#b35a09", "#ffae3d", "#fff3d6"],
	},
	{
		id: "neon",
		name: "Neon",
		stops: ["#000502", "#003d1e", "#00c46a", "#5dffae", "#f0fff6"],
	},
	{
		id: "mono",
		name: "Mono",
		stops: ["#050506", "#2b2c2e", "#8a8c90", "#d9dadc", "#ffffff"],
	},
	{
		id: "navy",
		name: "Navy",
		stops: ["#071451", "#0d2a8c", "#4a63d6", "#b8c4ff", "#f4f6ff"],
	},
	{
		id: "paper",
		name: "Paper",
		stops: ["#ecebe6", "#c9c8c2", "#77766f", "#2a2a28", "#0c0c0c"],
	},
];

const LENS_SLIDERS: {
	key: Exclude<keyof LensConfiguration, "palette">;
	name: string;
}[] = [
	{ key: "bloom", name: "Bloom" },
	{ key: "aberration", name: "Aberration" },
	{ key: "ledGrid", name: "LED grid" },
	{ key: "depthOfField", name: "Depth of field" },
	{ key: "grain", name: "Grain" },
	{ key: "vignette", name: "Vignette" },
	{ key: "scanlines", name: "Scanlines" },
];

const DEFAULT_LENS: LensConfiguration = {
	palette: "none",
	bloom: 0,
	aberration: 0,
	ledGrid: 0,
	grain: 0,
	depthOfField: 0,
	vignette: 0,
	scanlines: 0,
};

const DEFAULT_TRACKER: TrackerConfiguration = {
	enabled: false,
	color: [236, 235, 230],
	lockColor: [255, 33, 25],
	size: 1,
	hatch: true,
	labels: true,
	lockDuration: 0.7,
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function LensTab() {
	const { project, setProject } = useEditorContext();

	const lens = () => project.lens ?? DEFAULT_LENS;
	const tracker = () => project.tracker ?? DEFAULT_TRACKER;

	const setLens = <K extends keyof LensConfiguration>(
		key: K,
		value: LensConfiguration[K],
	) => {
		if (!project.lens) setProject("lens", { ...DEFAULT_LENS });
		setProject("lens", key, value);
	};
	const setTracker = <K extends keyof TrackerConfiguration>(
		key: K,
		value: TrackerConfiguration[K],
	) => {
		if (!project.tracker) setProject("tracker", { ...DEFAULT_TRACKER });
		setProject("tracker", key, value);
	};

	return (
		<>
			<Section
				name="Lens"
				action={
					<Show
						when={
							lens().palette !== "none" ||
							LENS_SLIDERS.some((s) => lens()[s.key] > 0)
						}
					>
						<button
							type="button"
							class="font-mono text-[11px] uppercase tracking-wider text-ed-text-3 hover:text-ed-text-1"
							onClick={() => setProject("lens", { ...DEFAULT_LENS })}
						>
							Reset
						</button>
					</Show>
				}
			>
				<div class="grid grid-cols-3 gap-1.5">
					<For each={PALETTES}>
						{(palette) => (
							<button
								type="button"
								class="flex flex-col gap-1.5 p-1.5 rounded-[5px] border text-left transition-colors"
								classList={{
									"border-ed-accent bg-ed-ctl": lens().palette === palette.id,
									"border-ed-line hover:border-ed-text-3":
										lens().palette !== palette.id,
								}}
								onClick={() => setLens("palette", palette.id)}
							>
								<div class="flex h-3 overflow-hidden rounded-[2px] bg-ed-ctl">
									<For each={palette.stops}>
										{(stop) => (
											<div class="flex-1" style={{ background: stop }} />
										)}
									</For>
								</div>
								<span class="font-mono text-[10px] uppercase tracking-wider text-ed-text-2">
									{palette.name}
								</span>
							</button>
						)}
					</For>
				</div>
				<div class="flex flex-col">
					<For each={LENS_SLIDERS}>
						{(slider) => (
							<Field inline name={slider.name} value={pct(lens()[slider.key])}>
								<Slider
									value={[lens()[slider.key]]}
									onChange={(v) => setLens(slider.key, v[0])}
									minValue={0}
									maxValue={1}
									step={0.01}
									formatTooltip={pct}
								/>
							</Field>
						)}
					</For>
				</div>
				<p class="text-[11px] leading-relaxed text-ed-text-3">
					Applied in preview and export only. Recording stays untouched.
				</p>
			</Section>

			<div class="w-full border-t border-ed-line" />

			<Section name="Tracker">
				<Subfield name="Lock onto cursor and clicks">
					<Toggle
						checked={tracker().enabled}
						onChange={(v) => setTracker("enabled", v)}
					/>
				</Subfield>
				<Show when={tracker().enabled}>
					<Field inline name="Box size" value={`${tracker().size.toFixed(1)}×`}>
						<Slider
							value={[tracker().size]}
							onChange={(v) => setTracker("size", v[0])}
							minValue={0.4}
							maxValue={3}
							step={0.05}
						/>
					</Field>
					<Field
						inline
						name="Lock hold"
						value={`${tracker().lockDuration.toFixed(1)}s`}
					>
						<Slider
							value={[tracker().lockDuration]}
							onChange={(v) => setTracker("lockDuration", v[0])}
							minValue={0.2}
							maxValue={2}
							step={0.05}
						/>
					</Field>
					<Subfield name="Hatch">
						<Toggle
							checked={tracker().hatch}
							onChange={(v) => setTracker("hatch", v)}
						/>
					</Subfield>
					<Subfield name="Coordinates">
						<Toggle
							checked={tracker().labels}
							onChange={(v) => setTracker("labels", v)}
						/>
					</Subfield>
					<div class="flex gap-3">
						<div class="flex-1 min-w-0">
							<span class="block mb-1 text-[11px] text-ed-text-3">Box</span>
							<RgbInput
								value={tracker().color as [number, number, number]}
								onChange={(c) => setTracker("color", c)}
							/>
						</div>
						<div class="flex-1 min-w-0">
							<span class="block mb-1 text-[11px] text-ed-text-3">Lock</span>
							<RgbInput
								value={tracker().lockColor as [number, number, number]}
								onChange={(c) => setTracker("lockColor", c)}
							/>
						</div>
					</div>
				</Show>
			</Section>
		</>
	);
}

const PATTERNS: { id: BackgroundPattern; name: string }[] = [
	{ id: "none", name: "None" },
	{ id: "dither", name: "Dither" },
	{ id: "halftone", name: "Halftone" },
	{ id: "ascii", name: "ASCII" },
];

const DEFAULT_PATTERN: BackgroundPatternConfiguration = {
	kind: "none",
	scale: 6,
	strength: 1,
};

export function PatternControls(props: {
	value: BackgroundPatternConfiguration | null | undefined;
	onChange: (value: BackgroundPatternConfiguration) => void;
}) {
	const pattern = () => props.value ?? DEFAULT_PATTERN;
	const update = (patch: Partial<BackgroundPatternConfiguration>) =>
		props.onChange({ ...pattern(), ...patch });

	return (
		<div class="flex flex-col">
			<Field inline name="Pattern">
				<div class="flex gap-1">
					<For each={PATTERNS}>
						{(p) => (
							<button
								type="button"
								class="px-2 h-[24px] rounded-[4px] border font-mono text-[10px] uppercase tracking-wider transition-colors"
								classList={{
									"border-ed-accent text-ed-text-1 bg-ed-ctl":
										pattern().kind === p.id,
									"border-ed-line text-ed-text-3 hover:text-ed-text-1":
										pattern().kind !== p.id,
								}}
								onClick={() => update({ kind: p.id })}
							>
								{p.name}
							</button>
						)}
					</For>
				</div>
			</Field>
			<Show when={pattern().kind !== "none"}>
				<Field inline name="Cell" value={`${Math.round(pattern().scale)}px`}>
					<Slider
						value={[pattern().scale]}
						onChange={(v) => update({ scale: v[0] })}
						minValue={2}
						maxValue={32}
						step={1}
					/>
				</Field>
				<Field inline name="Strength" value={pct(pattern().strength)}>
					<Slider
						value={[pattern().strength]}
						onChange={(v) => update({ strength: v[0] })}
						minValue={0}
						maxValue={1}
						step={0.01}
						formatTooltip={pct}
					/>
				</Field>
			</Show>
		</div>
	);
}
