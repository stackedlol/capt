import type { RouteSectionProps } from "@solidjs/router";
import { A } from "@solidjs/router";
import { getVersion } from "@tauri-apps/api/app";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createSignal, For, onMount, Show, Suspense } from "solid-js";
import toast from "solid-toast";
import { CapErrorBoundary } from "~/components/CapErrorBoundary";
import IconLucideSlidersHorizontal from "~icons/lucide/sliders-horizontal";
import IconLucideTerminal from "~icons/lucide/terminal";
import IconLucideZap from "~icons/lucide/zap";

function SettingsContentSkeleton() {
	return (
		<div class="cap-settings-page flex flex-col h-full custom-scroll">
			<div class="px-6 py-6 space-y-7 max-w-[42rem]" aria-hidden="true">
				<div class="space-y-2.5">
					<div class="px-1 space-y-1.5">
						<div class="h-4 w-28 rounded-sm bg-gray-4 animate-pulse" />
						<div class="h-3 w-72 max-w-full rounded-sm bg-gray-4 animate-pulse" />
					</div>
					<div class="cap-settings-card overflow-hidden rounded-xl border border-gray-3 bg-gray-2 divide-y divide-gray-3">
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-40 rounded-sm bg-gray-4 animate-pulse" />
							<div class="h-3 w-64 max-w-full rounded-sm bg-gray-4 animate-pulse" />
						</div>
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-36 rounded-sm bg-gray-4 animate-pulse" />
							<div class="h-3 w-56 max-w-full rounded-sm bg-gray-4 animate-pulse" />
						</div>
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-44 rounded-sm bg-gray-4 animate-pulse" />
							<div class="h-3 w-60 max-w-full rounded-sm bg-gray-4 animate-pulse" />
						</div>
					</div>
				</div>
				<div class="space-y-2.5">
					<div class="px-1 space-y-1.5">
						<div class="h-4 w-36 rounded-sm bg-gray-4 animate-pulse" />
						<div class="h-3 w-64 max-w-full rounded-sm bg-gray-4 animate-pulse" />
					</div>
					<div class="cap-settings-card overflow-hidden rounded-xl border border-gray-3 bg-gray-2 divide-y divide-gray-3">
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-48 rounded-sm bg-gray-4 animate-pulse" />
							<div class="h-3 w-52 max-w-full rounded-sm bg-gray-4 animate-pulse" />
						</div>
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-32 rounded-sm bg-gray-4 animate-pulse" />
							<div class="h-3 w-72 max-w-full rounded-sm bg-gray-4 animate-pulse" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function Settings(props: RouteSectionProps) {
	const [version, setVersion] = createSignal<string | null>(null);
	const settingsItems = [
		{
			href: "general",
			name: "General",
			icon: IconCapSettings,
		},
		{
			href: "quality",
			name: "Recording quality",
			icon: IconLucideSlidersHorizontal,
		},
		{
			href: "hotkeys",
			name: "Shortcuts",
			icon: IconCapHotkeys,
		},
		{
			href: "cli",
			name: "CLI",
			icon: IconLucideTerminal,
		},
		{
			href: "recordings",
			name: "Recordings",
			icon: IconLucideSquarePlay,
		},
		{
			href: "screenshots",
			name: "Screenshots",
			icon: IconLucideImage,
		},
		{
			href: "automations",
			name: "Automations",
			icon: IconLucideZap,
		},
		{
			href: "transcription",
			name: "Transcription",
			icon: IconCapCaptions,
		},
		{
			href: "experimental",
			name: "Experimental",
			icon: IconCapSettings,
		},
	];

	onMount(() => {
		void getVersion()
			.then(setVersion)
			.catch((error) => console.error("Failed to load app version:", error));
	});

	const copyVersion = async (appVersion: string) => {
		try {
			await writeText(appVersion);
			toast.success("Version copied to clipboard");
		} catch (error) {
			console.error("Failed to copy app version:", error);
			toast.error("Failed to copy version");
		}
	};

	return (
		<div class="cap-settings-shell flex-1 flex flex-row divide-x divide-gray-3 text-[0.875rem] leading-5 overflow-y-hidden">
			<div
				class="cap-settings-sidebar flex flex-col h-full bg-gray-2"
				data-tauri-drag-region
			>
				<div class="cap-settings-window-spacer" data-tauri-drag-region />
				<ul class="cap-settings-nav min-w-48 h-full p-2.5 space-y-1 text-gray-12">
					<For each={settingsItems}>
						{(item) => (
							<li>
								<A
									href={item.href}
									activeClass="bg-gray-5 pointer-events-none"
									class="cap-settings-nav-item rounded-lg h-8 hover:bg-gray-3 text-[13px] px-2 flex flex-row items-center gap-1.5 transition-colors"
								>
									<item.icon class="opacity-60 size-4" aria-hidden="true" />
									<span>{item.name}</span>
								</A>
							</li>
						)}
					</For>
				</ul>
				<div class="cap-settings-account p-2.5 text-left flex flex-col">
					<Show when={version()}>
						{(v) => (
							<div class="mb-2 text-xs text-gray-11 flex flex-col items-start gap-1.5">
								<button
									type="button"
									class="-ml-1 cursor-copy rounded px-1 py-0.5 transition-colors hover:bg-gray-3 hover:text-gray-12"
									title="Copy version to clipboard"
									aria-label={`Copy version ${v()} to clipboard`}
									onClick={() => copyVersion(v())}
								>
									v{v()}
								</button>
							</div>
						)}
					</Show>
				</div>
			</div>
			<div class="cap-settings-content overflow-y-hidden flex-1 min-w-0">
				<CapErrorBoundary>
					<Suspense fallback={<SettingsContentSkeleton />}>
						{props.children}
					</Suspense>
				</CapErrorBoundary>
			</div>
		</div>
	);
}
