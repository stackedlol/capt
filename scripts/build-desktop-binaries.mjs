import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
	releaseBinaryMatchesDebugBinary,
	stagedBinariesAreCurrent,
} from "./build-desktop-binaries-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const binariesDir = path.join(
	repoRoot,
	"apps",
	"desktop",
	"src-tauri",
	"binaries",
);

function detectHostTriple() {
	const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
	if (result.status !== 0) {
		const reason =
			result.stderr || result.error?.message || `exit ${result.status}`;
		throw new Error(`rustc -vV failed: ${reason}`);
	}
	const match = result.stdout.match(/^host:\s*(.+)$/m);
	if (!match) throw new Error("Could not parse host triple from rustc -vV");
	return match[1].trim();
}

async function fileExists(p) {
	return await fs
		.access(p)
		.then(() => true)
		.catch(() => false);
}

async function main() {
	const args = process.argv.slice(2);
	const profileArg = args.find((arg) => arg.startsWith("--profile="));
	const profile = profileArg
		? profileArg.slice("--profile=".length)
		: "release";
	const target =
		args.find((arg) => !arg.startsWith("--")) ||
		process.env.RUST_TARGET_TRIPLE ||
		detectHostTriple();
	const ext = target.includes("windows") ? ".exe" : "";

	await fs.mkdir(binariesDir, { recursive: true });

	for (const sidecar of [
		{
			packageName: "cap-muxer",
			sourceBinary: "cap-muxer",
			destBinaries: ["cap-muxer"],
			watchPaths: [
				path.join(repoRoot, "crates", "cap-muxer"),
				path.join(repoRoot, "crates", "cap-muxer-protocol"),
				path.join(repoRoot, "Cargo.lock"),
			],
		},
		{
			packageName: "cap",
			sourceBinary: "cap",
			destBinaries: ["cap-cli", "cap-exporter"],
			watchPaths: [
				path.join(repoRoot, "apps", "cli"),
				path.join(repoRoot, "crates", "cli-install"),
				path.join(repoRoot, "crates", "editor"),
				path.join(repoRoot, "crates", "enc-ffmpeg"),
				path.join(repoRoot, "crates", "export"),
				path.join(repoRoot, "crates", "media"),
				path.join(repoRoot, "crates", "media-info"),
				path.join(repoRoot, "crates", "project"),
				path.join(repoRoot, "crates", "rendering"),
				path.join(repoRoot, "Cargo.lock"),
			],
		},
	]) {
		await buildSidecar(sidecar, target, ext, profile);
	}
}

async function buildSidecar(sidecar, target, ext, profile) {
	const src = path.join(
		repoRoot,
		"target",
		target,
		profile,
		`${sidecar.sourceBinary}${ext}`,
	);
	const dests = sidecar.destBinaries.map((destBinary) =>
		path.join(binariesDir, `${destBinary}-${target}${ext}`),
	);
	const debugBinaries = [
		path.join(
			repoRoot,
			"target",
			target,
			"debug",
			`${sidecar.sourceBinary}${ext}`,
		),
	];
	// `tauri dev` copies each staged sidecar to target/debug/<dest>, so when a
	// sidecar keeps its source name (cap-muxer) that path holds a byte-identical
	// copy of the release binary, not a debug build. Comparing against it made
	// every launch discard and restage the sidecar, which restarted `tauri dev`.
	if (!sidecar.destBinaries.includes(sidecar.sourceBinary)) {
		debugBinaries.push(
			path.join(repoRoot, "target", "debug", `${sidecar.sourceBinary}${ext}`),
		);
	}

	if (await releaseBinaryMatchesDebugBinary(src, debugBinaries)) {
		console.warn(
			`Discarding debug binary found in release artifact path: ${src}`,
		);
		await fs.rm(src);
	}

	if (
		await stagedBinariesAreCurrent(
			src,
			dests,
			sidecar.watchPaths,
			debugBinaries,
		)
	) {
		console.log(
			`${sidecar.destBinaries.join(", ")} desktop binaries up to date`,
		);
		return;
	}

	console.log(
		`Building ${sidecar.destBinaries.join(", ")} desktop binaries for ${target} (${profile})...`,
	);
	const cargo = spawnSync(
		"cargo",
		[
			"build",
			"--profile",
			profile,
			"-p",
			sidecar.packageName,
			"--target",
			target,
		],
		{ stdio: "inherit", cwd: repoRoot },
	);
	if (cargo.status !== 0) {
		process.exit(cargo.status ?? 1);
	}

	if (!(await fileExists(src))) {
		console.error(`error: built binary not found at ${src}`);
		process.exit(1);
	}

	for (const dest of dests) {
		await fs.copyFile(src, dest);
		console.log(`Copied ${src} -> ${dest}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
