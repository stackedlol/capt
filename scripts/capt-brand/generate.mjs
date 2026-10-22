import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
	NAVY,
	PASTEL,
	PLATE,
	PLATE_EDGE,
	RING_OF_PLATE,
	ringField,
	ringRects,
} from "./mark.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const iconsDir = path.join(root, "apps/desktop/src-tauri/icons");
const outDir = path.join(here, "out");

const args = new Set(process.argv.slice(2));

function plateGeometry(size) {
	const inset = Math.round(size * 0.0977);
	const body = size - inset * 2;
	return { inset, body, radius: body * 0.2237 };
}

function rectsToPath(rects) {
	const byFill = new Map();
	for (const r of rects) {
		const d = `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`;
		byFill.set(r.fill, `${byFill.get(r.fill) ?? ""}${d}`);
	}
	return [...byFill]
		.map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`)
		.join("");
}

function markRects(cx, cy, ringPx, cell, options = {}) {
	const { mono = false, fill, gap = 0 } = options;
	const field = ringField(ringPx / cell);
	const x = Math.round(cx - (field.n * cell) / 2);
	const y = Math.round(cy - (field.n * cell) / 2);
	return ringRects(field, { x, y, cell, mono, fill, gap });
}

function plateSvg(x, y, w, radius, hair) {
	return `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${radius}" fill="${PLATE}" shape-rendering="geometricPrecision"/><rect x="${x + hair / 2}" y="${y + hair / 2}" width="${w - hair}" height="${w - hair}" rx="${radius - hair / 2}" fill="none" stroke="${PLATE_EDGE}" stroke-width="${hair}" shape-rendering="geometricPrecision"/>`;
}

function markSettings(size) {
	if (size >= 256) return { cell: size / 128, gap: 0.3 };
	if (size >= 128) return { cell: size / 64 };
	return { cell: 1 };
}

function iconSvg(size) {
	const geo = plateGeometry(size);
	const { cell, ...options } = markSettings(size);
	const ringPx = geo.body * RING_OF_PLATE;
	const rects = markRects(size / 2, size / 2, ringPx, cell, options);
	const hair = Math.max(1, size / 512);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">
${plateSvg(geo.inset, geo.inset, geo.body, geo.radius, hair)}
${rectsToPath(rects)}
</svg>`;
}

function bareMarkSvg() {
	const field = ringField(41);
	const cell = 4;
	const rects = ringRects(field, {
		cell,
		mono: true,
		fill: () => "currentColor",
	});
	const extent = field.n * cell;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" fill="currentColor" shape-rendering="crispEdges">${rectsToPath(rects)}</svg>\n`;
}

function smallMarkSvg(cells = 16, fill = "currentColor") {
	const rects = markRects(cells / 2, cells / 2, cells / 2 - 0.5, 1, {
		mono: true,
		fill: () => fill,
	});
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${cells}" height="${cells}" viewBox="0 0 ${cells} ${cells}" shape-rendering="crispEdges">${rectsToPath(rects)}</svg>\n`;
}

function badge(size) {
	const cell = size / 40;
	const rects = markRects(size / 2, size / 2, size * 0.47, cell, {
		gap: cell >= 2 ? 0.3 : 0,
	});
	return rectsToPath(rects);
}

function logoSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" fill="none" shape-rendering="crispEdges">${badge(80)}</svg>\n`;
}

function logoFullSvg(ink) {
	const text = `<text x="50" y="28" fill="${ink}" font-family="Manrope, sans-serif" font-size="28" font-weight="700" letter-spacing="-0.5">capt</text>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="124" height="40" viewBox="0 0 124 40" fill="none" shape-rendering="crispEdges">${badge(40)}${text}</svg>\n`;
}

async function png(svg, size, file) {
	await sharp(Buffer.from(svg), { density: 72 })
		.resize(size, size, { kernel: "nearest" })
		.png({ compressionLevel: 9 })
		.toFile(file);
}

const TRAY_PX = 440;
const TRAY_GRID = 22;

function traySvg(body) {
	const unit = TRAY_PX / TRAY_GRID;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${TRAY_PX}" height="${TRAY_PX}" viewBox="0 0 ${TRAY_GRID} ${TRAY_GRID}" shape-rendering="crispEdges" data-unit="${unit}">${body}</svg>`;
}

function monoRings(cx, cy, radius, options = {}) {
	return rectsToPath(
		markRects(cx, cy, radius, 1, {
			mono: true,
			fill: () => "#000",
			...options,
		}),
	);
}

function trayMarkBody() {
	return monoRings(TRAY_GRID / 2, TRAY_GRID / 2, 9);
}

const NUCLEO_TRAY = {
	studio: "pixel-film",
	instant: "pixel-bolt",
	screenshot: "pixel-image",
};

function nucleoPixelSvgBody(name, color = "#000") {
	const file = path.join(root, "packages/ui-solid/icons-nucleo", `${name}.svg`);
	const svg = fs.readFileSync(file, "utf8");
	const inner = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
	return inner.replaceAll("currentColor", color).replace(/\s+/g, " ").trim();
}

function trayStopSvg() {
	const rings = monoRings(TRAY_GRID / 2, TRAY_GRID / 2, 9);
	return traySvg(`${rings}<rect x="8" y="8" width="6" height="6"/>`);
}

function linuxSymbolic(inner, viewBox) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${viewBox}" shape-rendering="crispEdges">
	<g class="ColorScheme-Text" style="fill:currentColor">${inner}</g>
</svg>
`;
}

function writeIco(entries, file) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);
	const dir = Buffer.alloc(16 * entries.length);
	let offset = 6 + dir.length;
	entries.forEach(({ size, data }, i) => {
		const o = i * 16;
		dir.writeUInt8(size >= 256 ? 0 : size, o);
		dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
		dir.writeUInt8(0, o + 2);
		dir.writeUInt8(0, o + 3);
		dir.writeUInt16LE(1, o + 4);
		dir.writeUInt16LE(32, o + 6);
		dir.writeUInt32LE(data.length, o + 8);
		dir.writeUInt32LE(offset, o + 12);
		offset += data.length;
	});
	fs.writeFileSync(
		file,
		Buffer.concat([header, dir, ...entries.map((e) => e.data)]),
	);
}

async function renderSize(size) {
	return sharp(Buffer.from(iconSvg(size)), { density: 72 })
		.resize(size, size, { kernel: "nearest" })
		.png({ compressionLevel: 9 })
		.toBuffer();
}

async function main() {
	fs.mkdirSync(outDir, { recursive: true });
	const masterSvg = iconSvg(1024);
	fs.writeFileSync(path.join(here, "capt-icon.svg"), masterSvg);
	fs.writeFileSync(path.join(here, "capt-mark.svg"), bareMarkSvg());
	fs.writeFileSync(path.join(here, "capt-mark-16.svg"), smallMarkSvg(16));
	const uiIcons = path.join(root, "packages/ui-solid/icons");
	fs.writeFileSync(path.join(uiIcons, "logo.svg"), logoSvg());
	fs.writeFileSync(path.join(uiIcons, "logo-full.svg"), logoFullSvg("#0b0b0c"));
	fs.writeFileSync(
		path.join(uiIcons, "logo-full-dark.svg"),
		logoFullSvg("#ededed"),
	);
	const masterPng = path.join(here, "capt-icon-1024.png");
	await png(masterSvg, 1024, masterPng);

	for (const size of [16, 32, 64, 128, 256, 512]) {
		fs.writeFileSync(
			path.join(outDir, `icon-${size}.png`),
			await renderSize(size),
		);
	}

	if (!args.has("--icons")) return;

	execFileSync("bun", ["run", "tauri", "icon", masterPng], {
		cwd: path.join(root, "apps/desktop"),
		stdio: "inherit",
	});

	const native = {
		"32x32.png": 32,
		"128x128.png": 128,
		"128x128@2x.png": 256,
		"icon.png": 512,
		"macos/icon.png": 512,
		"Square30x30Logo.png": 30,
		"Square44x44Logo.png": 44,
		"Square71x71Logo.png": 71,
		"Square89x89Logo.png": 89,
		"Square107x107Logo.png": 107,
		"Square142x142Logo.png": 142,
		"Square150x150Logo.png": 150,
		"Square284x284Logo.png": 284,
		"Square310x310Logo.png": 310,
		"StoreLogo.png": 50,
	};
	for (const [name, size] of Object.entries(native)) {
		const file = path.join(iconsDir, name);
		if (!fs.existsSync(path.dirname(file))) continue;
		fs.writeFileSync(file, await renderSize(size));
	}

	const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "capt-iconset-"));
	const setDir = path.join(iconset, "capt.iconset");
	fs.mkdirSync(setDir);
	for (const base of [16, 32, 128, 256, 512]) {
		fs.writeFileSync(
			path.join(setDir, `icon_${base}x${base}.png`),
			await renderSize(base),
		);
		fs.writeFileSync(
			path.join(setDir, `icon_${base}x${base}@2x.png`),
			await renderSize(base * 2),
		);
	}
	const icns = path.join(iconset, "capt.icns");
	execFileSync("iconutil", ["-c", "icns", setDir, "-o", icns]);
	fs.copyFileSync(icns, path.join(iconsDir, "icon.icns"));
	fs.copyFileSync(icns, path.join(iconsDir, "macos/icon.icns"));
	fs.rmSync(iconset, { recursive: true, force: true });

	const icoEntries = [];
	for (const size of [16, 24, 32, 48, 64, 256]) {
		icoEntries.push({ size, data: await renderSize(size) });
	}
	writeIco(icoEntries, path.join(iconsDir, "icon.ico"));

	const trays = {
		"tray-default-icon.png": traySvg(trayMarkBody()),
		"tray-stop-icon.png": trayStopSvg(),
	};
	for (const [name, svg] of Object.entries(trays)) {
		await sharp(Buffer.from(svg), { density: 72 })
			.resize(TRAY_PX, TRAY_PX)
			.png({ compressionLevel: 9 })
			.toFile(path.join(iconsDir, name));
	}

	const linux = path.join(iconsDir, "linux");
	const symbolicRings = () => monoRings(8, 8, 7).replace(/ fill="#000"/g, "");
	fs.writeFileSync(
		path.join(linux, "so.cap.desktop-tray-default-symbolic.svg"),
		linuxSymbolic(symbolicRings(), "0 0 16 16"),
	);
	fs.writeFileSync(
		path.join(linux, "so.cap.desktop-tray-stop-symbolic.svg"),
		linuxSymbolic(
			`${symbolicRings()}<rect x="6" y="6" width="4" height="4"/>`,
			"0 0 16 16",
		),
	);
	for (const [mode, name] of Object.entries(NUCLEO_TRAY)) {
		const body = nucleoPixelSvgBody(name, "currentColor");
		fs.writeFileSync(
			path.join(linux, `so.cap.desktop-tray-${mode}-symbolic.svg`),
			linuxSymbolic(body, "0 0 24 24"),
		);
	}
	console.log(`rings ${NAVY} / ${PASTEL}`);
}

await main();
