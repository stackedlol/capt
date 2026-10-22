import type {
	FxDrive,
	FxNode,
	FxOp,
	FxStackConfiguration,
	LensPalette,
} from "~/utils/tauri";

export type FxCategory =
	| "camera"
	| "film"
	| "distort"
	| "filter"
	| "color"
	| "stylize"
	| "texture";

export type FxParam = { label: string; value: number };

export type FxOpInfo = {
	id: FxOp;
	name: string;
	category: FxCategory;
	a?: FxParam;
	b?: FxParam;
	color?: [number, number, number];
	usesPalette?: boolean;
};

export const FX_CATEGORIES: { id: FxCategory; name: string; color: string }[] =
	[
		{ id: "camera", name: "Camera", color: "#2b9fb3" },
		{ id: "film", name: "Film", color: "#c98a1c" },
		{ id: "distort", name: "Distort", color: "#4a63d6" },
		{ id: "filter", name: "Filter", color: "#13a85a" },
		{ id: "color", name: "Color", color: "#f6862a" },
		{ id: "stylize", name: "Stylize", color: "#b3306a" },
		{ id: "texture", name: "Texture", color: "#8a8c90" },
	];

export const FX_OPS: FxOpInfo[] = [
	{
		id: "pixelate",
		name: "Pixelate",
		category: "distort",
		a: { label: "Cell", value: 0.25 },
	},
	{
		id: "wave",
		name: "Wave",
		category: "distort",
		a: { label: "Amplitude", value: 0.2 },
		b: { label: "Frequency", value: 0.3 },
	},
	{
		id: "mirror",
		name: "Mirror",
		category: "distort",
		a: { label: "Axis", value: 0 },
		b: { label: "Side", value: 0 },
	},
	{
		id: "kaleidoscope",
		name: "Kaleido",
		category: "distort",
		a: { label: "Segments", value: 0.3 },
		b: { label: "Spin", value: 0.5 },
	},
	{
		id: "fisheye",
		name: "Fisheye",
		category: "distort",
		a: { label: "Bulge", value: 0.7 },
		b: { label: "Zoom", value: 0.5 },
	},
	{
		id: "transform",
		name: "Transform",
		category: "distort",
		a: { label: "Zoom", value: 0.5 },
		b: { label: "Rotate", value: 0.5 },
	},
	{
		id: "rgbSplit",
		name: "RGB split",
		category: "filter",
		a: { label: "Distance", value: 0.2 },
		b: { label: "Angle", value: 0 },
	},
	{
		id: "blur",
		name: "Blur",
		category: "filter",
		a: { label: "Radius", value: 0.2 },
	},
	{
		id: "glow",
		name: "Glow",
		category: "filter",
		a: { label: "Radius", value: 0.4 },
		b: { label: "Threshold", value: 0.55 },
	},
	{
		id: "edges",
		name: "Edges",
		category: "filter",
		a: { label: "Strength", value: 0.5 },
		b: { label: "Source color", value: 0 },
		color: [184, 196, 255],
	},
	{
		id: "levels",
		name: "Levels",
		category: "color",
		a: { label: "Contrast", value: 0.6 },
		b: { label: "Brightness", value: 0.5 },
	},
	{
		id: "hue",
		name: "Hue / sat",
		category: "color",
		a: { label: "Hue", value: 0.5 },
		b: { label: "Saturation", value: 0.5 },
	},
	{
		id: "posterize",
		name: "Posterize",
		category: "color",
		a: { label: "Reduce", value: 0.6 },
	},
	{
		id: "threshold",
		name: "Threshold",
		category: "color",
		a: { label: "Level", value: 0.5 },
		b: { label: "Softness", value: 0.1 },
		color: [255, 255, 255],
	},
	{ id: "invert", name: "Invert", category: "color" },
	{
		id: "gradientMap",
		name: "Gradient map",
		category: "color",
		a: { label: "Contrast", value: 0.55 },
		usesPalette: true,
	},
	{
		id: "tint",
		name: "Tint",
		category: "color",
		b: { label: "Highlights", value: 0.3 },
		color: [74, 99, 214],
	},
	{
		id: "dither",
		name: "Dither",
		category: "stylize",
		a: { label: "Cell", value: 0.15 },
		b: { label: "Levels", value: 0.2 },
	},
	{
		id: "halftone",
		name: "Halftone",
		category: "stylize",
		a: { label: "Cell", value: 0.2 },
		b: { label: "Angle", value: 0.25 },
	},
	{
		id: "ascii",
		name: "ASCII",
		category: "stylize",
		a: { label: "Cell", value: 0.25 },
		b: { label: "Ink color", value: 0 },
		color: [125, 255, 180],
	},
	{
		id: "ledGrid",
		name: "LED grid",
		category: "stylize",
		a: { label: "Cell", value: 0.2 },
		b: { label: "Glow", value: 0.4 },
	},
	{
		id: "glitch",
		name: "Glitch",
		category: "stylize",
		a: { label: "Amount", value: 0.25 },
		b: { label: "Bands", value: 0.4 },
	},
	{
		id: "tilt",
		name: "3D tilt",
		category: "camera",
		a: { label: "Pitch", value: 0.62 },
		b: { label: "Yaw", value: 0.35 },
		color: [14, 16, 22],
	},
	{
		id: "orbit",
		name: "Orbit",
		category: "camera",
		a: { label: "Swing", value: 0.5 },
		b: { label: "Speed", value: 0.3 },
		color: [14, 16, 22],
	},
	{
		id: "dolly",
		name: "Dolly",
		category: "camera",
		a: { label: "Push", value: 0.5 },
		b: { label: "Speed", value: 0.3 },
	},
	{
		id: "tiltShift",
		name: "Tilt-shift",
		category: "camera",
		a: { label: "Blur", value: 0.6 },
		b: { label: "Focus", value: 0.5 },
	},
	{
		id: "lens",
		name: "Lens",
		category: "camera",
		a: { label: "Fringing", value: 0.4 },
		b: { label: "Barrel", value: 0.3 },
	},
	{
		id: "filmGrade",
		name: "Film grade",
		category: "film",
		a: { label: "Strength", value: 0.8 },
		b: { label: "Warmth", value: 0.55 },
	},
	{
		id: "halation",
		name: "Halation",
		category: "film",
		a: { label: "Amount", value: 0.5 },
		b: { label: "Radius", value: 0.4 },
		color: [255, 90, 40],
	},
	{
		id: "anamorphic",
		name: "Anamorphic",
		category: "film",
		a: { label: "Streaks", value: 0.5 },
		b: { label: "Threshold", value: 0.6 },
		color: [90, 140, 255],
	},
	{
		id: "lightLeak",
		name: "Light leak",
		category: "film",
		a: { label: "Amount", value: 0.4 },
		b: { label: "Drift", value: 0.3 },
		color: [255, 130, 60],
	},
	{
		id: "letterbox",
		name: "Letterbox",
		category: "film",
		a: { label: "Aspect", value: 0.2 },
		b: { label: "Opacity", value: 1 },
		color: [0, 0, 0],
	},
	{
		id: "scanlines",
		name: "Scanlines",
		category: "texture",
		a: { label: "Line size", value: 0.2 },
		b: { label: "Roll", value: 0.1 },
	},
	{
		id: "grain",
		name: "Grain",
		category: "texture",
		a: { label: "Amount", value: 0.3 },
		b: { label: "Size", value: 0.2 },
	},
	{
		id: "vignette",
		name: "Vignette",
		category: "texture",
		a: { label: "Amount", value: 0.5 },
		b: { label: "Softness", value: 0.5 },
	},
];

const OPS_BY_ID = new Map(FX_OPS.map((op) => [op.id, op]));

export function opInfo(op: FxOp): FxOpInfo {
	return OPS_BY_ID.get(op) ?? FX_OPS[0];
}

export function categoryColor(op: FxOp) {
	const category = opInfo(op).category;
	return FX_CATEGORIES.find((c) => c.id === category)?.color ?? "#8a8c90";
}

export const FX_DRIVES: { id: FxDrive; name: string }[] = [
	{ id: "none", name: "Off" },
	{ id: "lfo", name: "LFO" },
	{ id: "strobe", name: "Strobe" },
	{ id: "ramp", name: "Ramp" },
	{ id: "click", name: "Click" },
];

export const EMPTY_FX: FxStackConfiguration = { enabled: true, nodes: [] };

const newId = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `fx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createNode(
	op: FxOp,
	overrides: Partial<Omit<FxNode, "id" | "op">> = {},
): FxNode {
	const info = opInfo(op);
	return {
		id: newId(),
		op,
		enabled: true,
		mix: 1,
		a: info.a?.value ?? 0.5,
		b: info.b?.value ?? 0.5,
		color: info.color ?? [255, 255, 255],
		palette: "thermal",
		drive: "none",
		rate: 1,
		depth: 1,
		...overrides,
	};
}

export function moveNode(nodes: FxNode[], from: number, to: number) {
	if (from === to || from < 0 || from >= nodes.length) return nodes;
	const next = nodes.slice();
	const [node] = next.splice(from, 1);
	next.splice(Math.max(0, Math.min(to, next.length)), 0, node);
	return next;
}

type PresetNode = [FxOp, Partial<Omit<FxNode, "id" | "op">>?];

export const FX_PRESETS: {
	name: string;
	palette?: LensPalette;
	nodes: PresetNode[];
}[] = [
	{
		name: "Hero shot",
		palette: "navy",
		nodes: [
			["filmGrade", { a: 0.8, b: 0.55 }],
			["halation", { a: 0.4, b: 0.35 }],
			["tilt", { a: 0.6, b: 0.36, color: [14, 16, 22] }],
			["vignette", { a: 0.35, b: 0.7 }],
			["grain", { a: 0.12, b: 0.2 }],
		],
	},
	{
		name: "Orbit reveal",
		palette: "mono",
		nodes: [
			["filmGrade", { a: 0.7, b: 0.5 }],
			["orbit", { a: 0.45, b: 0.25, color: [12, 14, 20] }],
			["grain", { a: 0.1, b: 0.2 }],
		],
	},
	{
		name: "Anamorphic",
		palette: "navy",
		nodes: [
			["filmGrade", { a: 0.85, b: 0.45 }],
			["anamorphic", { a: 0.55, b: 0.62, color: [90, 140, 255] }],
			["letterbox", { a: 1, b: 1, color: [0, 0, 0] }],
			["grain", { a: 0.18, b: 0.25 }],
		],
	},
	{
		name: "Film stock",
		palette: "amber",
		nodes: [
			["filmGrade", { a: 1, b: 0.62 }],
			["halation", { a: 0.6, b: 0.4 }],
			["lightLeak", { a: 0.3, b: 0.2, color: [255, 130, 60] }],
			["letterbox", { a: 0, b: 1, color: [0, 0, 0] }],
			["grain", { a: 0.32, b: 0.35 }],
			["vignette", { a: 0.4, b: 0.6 }],
		],
	},
	{
		name: "Miniature",
		palette: "neon",
		nodes: [
			["levels", { a: 0.62, b: 0.52 }],
			["hue", { a: 0.5, b: 0.72 }],
			["tiltShift", { a: 0.75, b: 0.5 }],
		],
	},
	{
		name: "Dolly push",
		palette: "paper",
		nodes: [
			["lens", { a: 0.4, b: 0.25 }],
			["filmGrade", { a: 0.6, b: 0.55 }],
			["dolly", { a: 0.55, b: 0.25 }],
			["vignette", { a: 0.35, b: 0.6 }],
		],
	},
	{
		name: "Thermal cam",
		palette: "thermal",
		nodes: [
			["gradientMap", { palette: "thermal", a: 0.6 }],
			["glow", { a: 0.45, b: 0.55, mix: 0.8 }],
			["grain", { a: 0.3 }],
			["vignette", { a: 0.45 }],
		],
	},
	{
		name: "Phosphor",
		palette: "phosphor",
		nodes: [
			["gradientMap", { palette: "phosphor", a: 0.6 }],
			["scanlines", { a: 0.15, b: 0.08, mix: 0.7 }],
			["glow", { a: 0.5, b: 0.5, mix: 0.7 }],
			["vignette", { a: 0.5 }],
		],
	},
	{
		name: "Click lock",
		palette: "crimson",
		nodes: [
			["glitch", { a: 0.05, b: 0.4, drive: "click" }],
			["rgbSplit", { a: 0.15, drive: "click" }],
		],
	},
	{
		name: "LED wall",
		palette: "neon",
		nodes: [
			["levels", { a: 0.65 }],
			["ledGrid", { a: 0.18, b: 0.5 }],
			["glow", { a: 0.6, b: 0.45, mix: 0.8 }],
		],
	},
	{
		name: "Terminal",
		palette: "phosphor",
		nodes: [
			["ascii", { a: 0.2, b: 1, color: [125, 255, 180] }],
			["glow", { a: 0.4, b: 0.4, mix: 0.6 }],
		],
	},
	{
		name: "Newsprint",
		palette: "paper",
		nodes: [
			["hue", { a: 0.5, b: 0 }],
			["levels", { a: 0.7 }],
			["halftone", { a: 0.18, b: 0.25 }],
			["grain", { a: 0.2, b: 0.4 }],
		],
	},
	{
		name: "Blueprint",
		palette: "navy",
		nodes: [
			["edges", { a: 0.6, b: 0, color: [244, 246, 255] }],
			["gradientMap", { palette: "navy", a: 0.5 }],
			["vignette", { a: 0.35 }],
		],
	},
	{
		name: "VHS",
		palette: "amber",
		nodes: [
			["wave", { a: 0.03, b: 0.85 }],
			["rgbSplit", { a: 0.1 }],
			["levels", { a: 0.6, b: 0.52 }],
			["scanlines", { a: 0.2, b: 0.3, mix: 0.6 }],
			["grain", { a: 0.4, b: 0.3 }],
		],
	},
	{
		name: "Kaleido",
		palette: "neon",
		nodes: [
			["kaleidoscope", { a: 0.3, b: 0.58 }],
			["hue", { a: 0.5, b: 0.65, drive: "lfo", rate: 0.2, depth: 0.6 }],
		],
	},
];

export function presetNodes(preset: (typeof FX_PRESETS)[number]) {
	return preset.nodes.map(([op, overrides]) => createNode(op, overrides));
}
