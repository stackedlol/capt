import { cx } from "cva";
import { createSignal, For, onCleanup, onMount } from "solid-js";
import { commands, type PerformanceStats } from "~/utils/tauri";

const SAMPLE_MS = 1000;
const HISTORY = 24;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const LEFT_DOTS = [0x40, 0x04, 0x02, 0x01];
const RIGHT_DOTS = [0x80, 0x20, 0x10, 0x08];
const TRACK = String.fromCharCode(0x28ff).repeat(HISTORY / 2);

function brailleLine(values: number[], max: number) {
	const padded = [
		...Array<number>(Math.max(0, HISTORY - values.length)).fill(Number.NaN),
		...values,
	];
	const row = (v: number) =>
		Number.isNaN(v) ? -1 : Math.max(0, Math.min(3, Math.round((v / max) * 3)));
	let out = "";
	for (let i = 0; i < padded.length; i += 2) {
		let bits = 0;
		const left = row(padded[i]);
		const right = row(padded[i + 1] ?? Number.NaN);
		if (left >= 0) bits |= LEFT_DOTS[left];
		if (right >= 0) bits |= RIGHT_DOTS[right];
		out += String.fromCharCode(0x2800 + bits);
	}
	return out;
}

const push = (list: number[], value: number) =>
	[...list, value].slice(-HISTORY);

type Metric = {
	label: string;
	value: () => string;
	detail: () => string;
	history: () => number[];
	max: () => number;
	hot: () => boolean;
};

export default function PerformanceStrip(props: { class?: string }) {
	const [fps, setFps] = createSignal<number[]>([]);
	const [cpu, setCpu] = createSignal<number[]>([]);
	const [ram, setRam] = createSignal<number[]>([]);
	const [stats, setStats] = createSignal<PerformanceStats | null>(null);
	const [available, setAvailable] = createSignal(true);

	onMount(() => {
		let frames = 0;
		let windowStart = performance.now();
		let raf = 0;
		const countFrame = (now: number) => {
			raf = requestAnimationFrame(countFrame);
			frames++;
			const elapsed = now - windowStart;
			if (elapsed >= SAMPLE_MS) {
				if (!document.hidden) {
					setFps((list) => push(list, Math.round((frames * 1000) / elapsed)));
				}
				frames = 0;
				windowStart = now;
			}
		};
		raf = requestAnimationFrame(countFrame);

		const sample = async () => {
			if (document.hidden || !available()) return;
			try {
				const next = await commands.getPerformanceStats();
				setStats(next);
				setCpu((list) => push(list, next.cpuPercent));
				setRam((list) =>
					push(
						list,
						next.memoryTotalBytes > 0
							? (next.memoryUsedBytes / next.memoryTotalBytes) * 100
							: 0,
					),
				);
			} catch (error) {
				setAvailable(false);
				console.warn("Performance stats are unavailable:", error);
			}
		};
		void sample();
		const timer = window.setInterval(() => void sample(), SAMPLE_MS);

		onCleanup(() => {
			cancelAnimationFrame(raf);
			window.clearInterval(timer);
		});
	});

	const last = (list: number[]) => list[list.length - 1];

	const metrics: Metric[] = [
		{
			label: "FPS",
			value: () => (fps().length ? String(last(fps())) : "--"),
			detail: () => "Frames per second in this window",
			history: fps,
			max: () => Math.max(60, ...fps()),
			hot: () => fps().length > 0 && last(fps()) < 30,
		},
		{
			label: "CPU",
			value: () =>
				stats() ? `${Math.round(stats()?.cpuPercent ?? 0)}%` : "--",
			detail: () => {
				const s = stats();
				return s
					? `System ${s.cpuPercent.toFixed(1)}% · capt core ${s.appCpuPercent.toFixed(1)}%`
					: "CPU usage";
			},
			history: cpu,
			max: () => 100,
			hot: () => (stats()?.cpuPercent ?? 0) > 85,
		},
		{
			label: "RAM",
			value: () => {
				const s = stats();
				return s ? `${(s.memoryUsedBytes / GIB).toFixed(1)}G` : "--";
			},
			detail: () => {
				const s = stats();
				return s
					? `${(s.memoryUsedBytes / GIB).toFixed(1)} of ${(s.memoryTotalBytes / GIB).toFixed(0)} GB used · capt core ${Math.round(s.appMemoryBytes / MIB)} MB`
					: "Memory usage";
			},
			history: ram,
			max: () => 100,
			hot: () => {
				const s = stats();
				return !!s && s.memoryUsedBytes / s.memoryTotalBytes > 0.9;
			},
		},
	];

	return (
		<div
			class={cx("grid w-full grid-cols-3 gap-3 select-none", props.class)}
			data-tauri-drag-region
		>
			<For each={metrics}>
				{(metric) => (
					<div
						class="flex min-w-0 flex-col items-center gap-0.5"
						title={metric.detail()}
					>
						<div class="flex items-baseline justify-center gap-1.5">
							<span class="text-[10px] font-semibold text-gray-10">
								{metric.label}
							</span>
							<span
								class={cx(
									"text-[11px] font-medium tabular-nums tracking-[-0.01em]",
									metric.hot() ? "text-red-9" : "text-gray-12",
								)}
							>
								{metric.value()}
							</span>
						</div>
						<span
							aria-hidden="true"
							class="relative block overflow-hidden whitespace-nowrap text-[11px] leading-none text-blue-9 dark:text-blue-11"
						>
							<span class="opacity-15">{TRACK}</span>
							<span class="absolute inset-0">
								{brailleLine(metric.history(), metric.max())}
							</span>
						</span>
					</div>
				)}
			</For>
		</div>
	);
}
