import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const capDir = path.join(root, "packages/ui-solid/icons");
const nucleoDir = path.join(root, "packages/ui-solid/icons-nucleo");

const [source] = process.argv.slice(2);
if (!source) {
	console.error(
		"usage: node scripts/capt-brand/nucleo.mjs <dir containing nucleo-ui-essential-outline-18 and nucleo-pixel-essential>",
	);
	process.exit(1);
}

const outline = (name) =>
	path.join(
		source,
		"nucleo-ui-essential-outline-18/package/dist/components",
		`Icon${name}Outline18.js`,
	);
const pixel = (name) =>
	path.join(
		source,
		"nucleo-pixel-essential/package/dist/components",
		`Icon${name}.js`,
	);

export const CAP_OVERRIDES = {
	camera: outline("Video"),
	microphone: outline("Microphone"),
	settings: outline("Gear2"),
	gear: outline("Gear2"),
	image: outline("Image"),
	scissors: outline("Scissors"),
	trash: outline("Trash"),
	x: outline("Xmark"),
	"chevron-down": outline("ChevronDown"),
	"circle-info": outline("CircleInfo"),
	"circle-check": outline("CircleHalfDottedCheck"),
	hotkeys: outline("Keyboard"),
	screen: outline("Computer"),
	window: outline("WindowPointer"),
	search: outline("Magnifier"),
	link: outline("Link"),
	restart: outline("Refresh2"),
	cursor: outline("Pointer"),
	"audio-on": outline("VolumeUp"),
	gauge: outline("Gauge3"),
	filter: outline("Filter"),
	clapperboard: outline("Film"),
	"circle-plus": outline("SquarePlus"),
	pencil: outline("Pen3"),
};

export const NUCLEO = {
	check: outline("Check"),
	"chevron-left": outline("ChevronLeft"),
	"chevron-right": outline("ChevronRight"),
	"chevron-up": outline("ChevronUp"),
	"chevron-expand": outline("ChevronExpandY"),
	folder: outline("Folder"),
	"folder-open": outline("FolderOpen"),
	eye: outline("EyeOpen"),
	"eye-closed": outline("EyeClosed"),
	lock: outline("Lock"),
	stopwatch: outline("Stopwatch"),
	sliders: outline("Sliders"),
	crosshairs: outline("Crosshairs"),
	layers: outline("Layers3"),
	laptop: outline("Laptop"),
	keyboard: outline("Keyboard"),
	"microphone-slash": outline("MicrophoneSlash"),
	video: outline("Video"),
	film: outline("Film"),
	camera: outline("Camera"),
	bell: outline("Bell"),
	bug: outline("Bug"),
	plus: outline("Plus"),
	minus: outline("Minus"),
	xmark: outline("Xmark"),
	warning: outline("TriangleWarning"),
	pen: outline("Pen3"),
	magnifier: outline("Magnifier"),
	gear: outline("Gear2"),
	computer: outline("Computer"),
	"window-pointer": outline("WindowPointer"),
	image: outline("Image"),
	"text-tool": outline("TextTool2"),
	"volume-up": outline("VolumeUp"),
	volume: outline("Volume"),
	"inbox-arrow-down": outline("InboxArrowDown"),
	"pixel-film": pixel("Film"),
	"pixel-bolt": pixel("BoltLightning"),
	"pixel-image": pixel("Image"),
	"pixel-camera": pixel("Camera"),
	"pixel-microphone": pixel("Microphone"),
	"pixel-crosshairs": pixel("Crosshairs2"),
};

function toSvg(file) {
	const src = fs.readFileSync(file, "utf8");
	const box = /size: "(\d+)px"/.exec(src)?.[1] ?? "24";
	const strokeWidth = /strokeWidth = ([\d.]+)/.exec(src)?.[1] ?? "1.5";
	const elements = [
		...src.matchAll(/React\.createElement\("(\w+)", \{([^}]*)\}\)/g),
	];
	const body = elements
		.map(([, tag, props]) => {
			const attrs = [...props.matchAll(/"?([\w-]+)"?: (?:"([^"]*)"|(\w+))/g)]
				.filter(([, key]) => !key.startsWith("data-"))
				.map(([, key, value, ident]) => {
					const resolved =
						value ?? (ident === "strokeWidth" ? strokeWidth : ident);
					const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
					return `${kebab}="${resolved}"`;
				});
			return `\t<${tag} ${attrs.join(" ")}/>`;
		})
		.join("\n");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" fill="none">\n${body}\n</svg>\n`;
}

fs.mkdirSync(nucleoDir, { recursive: true });
for (const [name, file] of Object.entries(CAP_OVERRIDES)) {
	fs.writeFileSync(path.join(capDir, `${name}.svg`), toSvg(file));
}
for (const [name, file] of Object.entries(NUCLEO)) {
	fs.writeFileSync(path.join(nucleoDir, `${name}.svg`), toSvg(file));
}

const unique = new Set([
	...Object.values(CAP_OVERRIDES),
	...Object.values(NUCLEO),
]);
console.log(`${unique.size} distinct Nucleo icons`);
