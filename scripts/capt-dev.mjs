#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const repo = path.resolve(import.meta.dirname, "..");
const bin = path.join(repo, "node_modules", ".bin");
const desktop = path.join(repo, "apps", "desktop");
const port = process.env.CAPT_PORT || "9999";
const watch = process.env.CAPT_WATCH === "1";
const verbose = process.env.CAPT_VERBOSE === "1";
const note = process.env.CAPT_NOTE || "";
const tty = process.stdout.isTTY && !verbose;

const logPath = path.join(repo, "target", "capt-dev.log");
mkdirSync(path.dirname(logPath), { recursive: true });
const log = createWriteStream(logPath);

const color = process.stdout.isTTY;
const rgb = (r, g, b) => (s) =>
	color ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : s;
const c = {
	navy: rgb(110, 134, 214),
	pastel: rgb(174, 187, 224),
	ok: rgb(134, 200, 160),
	warn: rgb(230, 190, 120),
	err: rgb(232, 112, 112),
	dim: (s) => (color ? `\x1b[2m${s}\x1b[22m` : s),
	bold: (s) => (color ? `\x1b[1m${s}\x1b[22m` : s),
};

const stripAnsi = stripVTControlCharacters;
const cols = () => Math.min(process.stdout.columns || 80, 76);
const out = (s = "") => process.stdout.write(`${s}\n`);
const elapsed = (t) => {
	const s = (Date.now() - t) / 1000;
	return s < 60
		? `${s.toFixed(1)}s`
		: `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};
const fit = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LABEL = 14;

let current = null;
let timer = null;
let cursorHidden = false;

function row(icon, label, detail, meta = "") {
	const room = cols() - LABEL - 6 - stripAnsi(meta).length - 2;
	const d = fit(detail, Math.max(10, room));
	const pad = " ".repeat(Math.max(1, room - d.length + 2));
	return `  ${icon} ${label.padEnd(LABEL)}${d}${meta ? pad + c.dim(meta) : ""}`;
}

function draw() {
	if (!tty || !current) return;
	const f = c.navy(frames[Math.floor(Date.now() / 80) % frames.length]);
	const detail = current.render
		? current.render()
		: c.dim(fit(current.detail, Math.max(10, cols() - LABEL - 6)));
	process.stdout.write(
		`\r\x1b[2K  ${f} ${current.label.padEnd(LABEL)}${detail}`,
	);
}

function hideCursor() {
	if (tty && !cursorHidden) {
		process.stdout.write("\x1b[?25l");
		cursorHidden = true;
	}
}

function showCursor() {
	if (cursorHidden) {
		process.stdout.write("\x1b[?25h");
		cursorHidden = false;
	}
}

function begin(label, detail = "") {
	current = { label, detail, start: Date.now() };
	if (tty) {
		hideCursor();
		timer = setInterval(draw, 80);
		draw();
	}
	return current;
}

function clearLive() {
	if (tty && current) process.stdout.write("\r\x1b[2K");
}

function above(line) {
	clearLive();
	out(line);
	draw();
}

function end(icon, detail, meta) {
	clearInterval(timer);
	timer = null;
	clearLive();
	const step = current;
	if (!step) return;
	current = null;
	showCursor();
	out(row(icon, step.label, detail, meta ?? elapsed(step.start)));
}

const done = (detail, meta) => end(c.ok("✓"), detail, meta);
const fail = (detail, meta) => end(c.err("✗"), c.err(detail), meta);

function splitLines(onLine) {
	let buf = "";
	return (chunk) => {
		buf += chunk.toString();
		const parts = buf.split(/\r\n|\n|\r/);
		buf = parts.pop();
		for (const p of parts) onLine(p);
	};
}

function header() {
	const version =
		readFileSync(path.join(desktop, "src-tauri", "Cargo.toml"), "utf8").match(
			/^version\s*=\s*"([^"]+)"/m,
		)?.[1] ?? "";
	const sub = [`v${version}`, watch ? "watching rust" : null, note || null]
		.filter(Boolean)
		.join(" · ");
	out();
	out(`  ${c.navy("⣿⠛⠛⣿")}  ${c.bold(c.pastel("capt"))}  ${c.dim("dev")}`);
	out(`  ${c.navy("⣿⣤⣤⣿")}  ${c.dim(sub)}`);
	out();
}

function rule(title) {
	const head = `  ${c.dim("──")} ${c.dim(title)} `;
	out();
	out(
		head +
			c.dim(
				"─".repeat(Math.max(4, Math.min(cols(), 72) - stripAnsi(head).length)),
			),
	);
}

function run(label, cmd, args, cwd, summarize) {
	const step = begin(label);
	const lines = [];
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			cwd,
			env: { ...process.env, FORCE_COLOR: "0" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		const onLine = splitLines((raw) => {
			const line = stripAnsi(raw).trim();
			log.write(`[${label}] ${line}\n`);
			if (verbose) out(raw);
			if (!line || line.startsWith("$ ")) return;
			lines.push(line);
			step.detail = line;
		});
		child.stdout.on("data", onLine);
		child.stderr.on("data", onLine);
		child.on("close", (code) => {
			if (code === 0) {
				done(summarize(lines));
				return resolve();
			}
			fail(`exited with ${code}`);
			out();
			for (const l of lines.slice(-40)) out(`    ${c.dim("│")} ${l}`);
			out();
			out(`  ${c.dim(`full log: ${logPath}`)}`);
			finish(code ?? 1);
		});
	});
}

function bar(done, total, width) {
	const filled = Math.round((done / total) * width);
	return c.navy("━".repeat(filled)) + c.dim("─".repeat(width - filled));
}

function runTauri() {
	const config = JSON.stringify({
		build: {
			devUrl: `http://localhost:${port}`,
			beforeDevCommand: `${bin}/dotenv -e ../../.env -- ${bin}/vinxi dev --port ${port}`,
		},
	});
	const args = [
		"-e",
		"../../.env",
		"--",
		`${bin}/tauri`,
		"dev",
		...(watch ? [] : ["--no-watch"]),
		"--config",
		config,
	];
	const child = spawn(`${bin}/dotenv`, args, {
		cwd: desktop,
		env: {
			...process.env,
			CARGO_TERM_PROGRESS_WHEN: "always",
			CARGO_TERM_PROGRESS_WIDTH: "120",
			CLICOLOR_FORCE: "1",
			FORCE_COLOR: "1",
		},
		stdio: ["inherit", "pipe", "pipe"],
	});

	let phase = "ui";
	let block = null;
	let warnings = 0;
	let progress = null;
	let crate = "";
	let errored = false;

	const ui = begin("ui server", "starting vinxi");

	const startRust = () => {
		if (phase !== "ui") return;
		done(`http://localhost:${port}`, elapsed(ui.start));
		phase = "rust";
		progress = null;
		crate = "";
		warnings = 0;
		const step = begin("rust", "checking");
		step.render = () => {
			if (progress) {
				const w = Math.max(10, Math.min(28, cols() - LABEL - 40));
				return `${bar(progress.done, progress.total, w)}  ${c.dim(`${progress.done}/${progress.total}`)}  ${c.dim(fit(progress.what, Math.max(8, cols() - LABEL - w - 22)))}`;
			}
			return c.dim(crate ? `compiling ${crate}` : step.detail);
		};
	};

	const rustDone = (took) => {
		const meta = warnings
			? `${c.warn(`${warnings} warning${warnings === 1 ? "" : "s"}`)}  ${took}`
			: took;
		done("compiled", meta);
		phase = "app";
		begin("app", "launching");
	};

	const appRunning = () => {
		done("running", "ctrl+c to quit");
		phase = "logs";
		rule("logs");
	};

	const handle = (raw) => {
		const line = stripAnsi(raw);
		const t = line.trim();
		log.write(`${line}\n`);
		if (verbose) return out(raw);

		if (phase === "logs") {
			if (/^\s*Info\s+File .* changed\. Rebuilding/.test(line)) {
				out(`  ${c.navy("↻")} ${c.dim("rust changed, rebuilding")}`);
				phase = "ui";
				return startRust();
			}
			if (/^\s*Running DevCommand|^\s*Running BeforeDevCommand/.test(line))
				return;
			if (/^\s*(Compiling|Building|Finished)\b/.test(line)) return;
			return out(raw);
		}

		if (
			block &&
			/^(Compiling|Building|Finished|Running|warning|error)\b/.test(t)
		)
			block = null;
		if (block) {
			if (t === "") {
				if (block === "error") above(raw);
				block = null;
				return;
			}
			if (block === "error") above(raw);
			return;
		}

		if (
			/^(vinxi\b|➜ Network|Network:|Warn Waiting for your frontend|Running BeforeDevCommand|\$ )/.test(
				t,
			)
		) {
			if (/^vinxi v/.test(t)) ui.detail = t;
			return;
		}

		if (/^error(\[E\d+\])?:|^error: could not compile/.test(t)) {
			errored = true;
			block = "error";
			return above(raw);
		}
		if (/^warning:/.test(t)) {
			const m = t.match(/generated (\d+) warnings?/);
			if (m) warnings += Number(m[1]);
			else if (!/build failed|warnings? emitted/.test(t)) block = "warning";
			return;
		}

		if (phase === "ui") {
			if (/Local:\s+http/.test(t) || /^Running DevCommand/.test(t))
				return startRust();
			if (
				/^vinxi\b|Network:|Waiting for your frontend|BeforeDevCommand|^\$ /.test(
					t,
				) ||
				!t
			) {
				if (/^vinxi v/.test(t)) ui.detail = t;
				return;
			}
			return above(`    ${c.dim(t)}`);
		}

		if (phase === "rust") {
			let m = t.match(/^Building \[.*\]\s+(\d+)\/(\d+):\s*(.*)$/);
			if (m) {
				progress = { done: Number(m[1]), total: Number(m[2]), what: m[3] };
				return;
			}
			m = t.match(/^Compiling (\S+)/);
			if (m) {
				crate = m[1];
				return;
			}
			m = t.match(/^Finished .* in (.+)$/);
			if (m) return rustDone(m[1]);
			if (
				/^(Running DevCommand|Fresh|Checking|Blocking|Downloaded|Downloading|Updating|Locking)\b/.test(
					t,
				)
			) {
				if (/^Blocking/.test(t)) current.detail = "waiting for build lock";
				return;
			}
			if (!t) return;
			return above(`    ${c.dim(t)}`);
		}

		if (phase === "app") {
			if (/^Running `/.test(t)) return appRunning();
			if (!t) return;
			appRunning();
			return out(raw);
		}
	};

	const onLine = splitLines(handle);
	child.stdout.on("data", onLine);
	child.stderr.on("data", onLine);

	process.removeAllListeners("SIGINT");
	process.on("SIGINT", () => {});
	process.on("SIGTERM", () => child.kill("SIGTERM"));

	child.on("close", (code, signal) => {
		if (current) {
			if (errored) fail("build failed");
			else if (code === 0 || signal) end(c.dim("·"), c.dim("stopped"), "");
			else fail(`exited with ${code}`);
		}
		out();
		if (errored || (code && code !== 130))
			out(`  ${c.dim(`full log: ${logPath}`)}`);
		else out(`  ${c.dim("capt stopped")}`);
		out();
		finish(signal ? 0 : (code ?? 0));
	});
}

function finish(code) {
	showCursor();
	log.end(() => process.exit(code));
}

process.on("exit", showCursor);
process.on("SIGINT", () => {
	clearLive();
	showCursor();
	out();
	process.exit(130);
});

header();

const dotenv = path.join(bin, "dotenv");
const platform =
	{ darwin: "macOS", win32: "windows", linux: "linux" }[process.platform] ??
	process.platform;

await run(
	"native deps",
	dotenv,
	["-e", ".env", "--", "node", "scripts/setup.js"],
	repo,
	(lines) =>
		lines.some((l) =>
			/^(Downloading|Downloaded|Extracted|Copied|Prepared|Signed|Trimmed)/.test(
				l,
			),
		)
			? "updated"
			: "cached",
);
await run(
	"sidecars",
	"node",
	["../../scripts/build-desktop-binaries.mjs", "--profile=sidecar-dev"],
	desktop,
	(lines) =>
		lines.every((l) => /up to date/.test(l)) ? "up to date" : "rebuilt",
);
await run(
	"tauri config",
	dotenv,
	["-e", "../../.env", "--", "node", "scripts/prepare.js"],
	desktop,
	() => platform,
);

runTauri();
