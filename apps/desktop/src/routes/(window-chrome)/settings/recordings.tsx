import { Button } from "@cap/ui-solid";
import Tooltip from "@corvu/tooltip";
import {
	createQuery,
	queryOptions,
	useQueryClient,
} from "@tanstack/solid-query";
import { ask, confirm } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import * as shell from "@tauri-apps/plugin-shell";
import { cx } from "cva";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	type ParentProps,
	Show,
} from "solid-js";
import CapTooltip from "~/components/Tooltip";
import { Input } from "~/routes/editor/ui";
import { createTauriEventListener } from "~/utils/createEventListener";
import { importVideoFromPicker, showImportError } from "~/utils/importMedia";
import { openRecordingFolder } from "~/utils/recording";
import { createRecordingThumbnail } from "~/utils/recording-thumbnail";
import {
	commands,
	events,
	type RecordingMetaWithMetadata,
} from "~/utils/tauri";
import IconLucideImport from "~icons/lucide/import";
import IconLucideSearch from "~icons/lucide/search";
import { Section, SettingsPageContent } from "./Setting";

type Recording = {
	meta: RecordingMetaWithMetadata;
	path: string;
	prettyName: string;
};

const Tabs = [
	{
		id: "all",
		label: "Show all",
	},
	{
		id: "studio",
		icon: <IconCapFilmCut class="invert size-3 dark:invert-0" />,
		label: "Studio",
	},
] satisfies { id: string; label: string; icon?: JSX.Element }[];

const PAGE_SIZE = 20;

const hasActiveRecording = (recording: Recording) => {
	const status = recording.meta.status.status;
	return status === "InProgress" || status === "NeedsRemux";
};

const recordingsQuery = queryOptions<Recording[]>({
	queryKey: ["recordings"],
	queryFn: async () => {
		const result = await commands.listRecordings().catch(() => [] as const);

		const recordings = await Promise.all(
			result.map(async (file) => {
				const [path, meta] = file;

				return {
					meta,
					path,
					prettyName: meta.pretty_name,
				};
			}),
		);
		return recordings;
	},
	reconcile: "path",
	refetchInterval: (query) => {
		const data = query.state.data;
		if (!data) return false;
		return data.some(hasActiveRecording) ? 2000 : false;
	},
});

export default function Recordings() {
	const [activeTab, setActiveTab] = createSignal<(typeof Tabs)[number]["id"]>(
		Tabs[0].id,
	);
	const [search, setSearch] = createSignal("");
	const trimmedSearch = createMemo(() => search().trim());
	const normalizedSearch = createMemo(() => trimmedSearch().toLowerCase());
	const [visibleCount, setVisibleCount] = createSignal(PAGE_SIZE);
	const recordings = createQuery(() => recordingsQuery);

	createTauriEventListener(events.recordingDeleted, () => recordings.refetch());

	createEffect(() => {
		activeTab();
		trimmedSearch();
		setVisibleCount(PAGE_SIZE);
	});

	const filteredRecordings = createMemo(() => {
		const data = recordings.data ?? [];
		const scopedRecordings =
			activeTab() === "all"
				? data
				: data.filter((recording) => recording.meta.mode === activeTab());
		const query = normalizedSearch();
		if (!query) return scopedRecordings;
		return scopedRecordings.filter((recording) =>
			recording.prettyName.toLowerCase().includes(query),
		);
	});

	const visibleRecordings = createMemo(() => {
		const items = filteredRecordings();
		if (normalizedSearch()) return items;
		return items.slice(0, visibleCount());
	});

	const hasMoreRecordings = createMemo(
		() => !normalizedSearch() && filteredRecordings().length > visibleCount(),
	);

	const emptyMessage = createMemo(() => {
		const tabLabel =
			activeTab() === "all" ? "recordings" : `${activeTab()} recordings`;
		const prefix = trimmedSearch() ? "No matching" : "No";
		return `${prefix} ${tabLabel}`;
	});

	const handleRecordingClick = (recording: Recording) => {
		events.newStudioRecordingAdded.emit({ path: recording.path });
	};

	const handleOpenFolder = (recording: Recording) => {
		openRecordingFolder(recording.path, recording.meta.mode).catch((error) => {
			console.error("Failed to open recording folder:", error);
		});
	};

	const handleCopyVideoToClipboard = (path: string) => {
		commands.copyVideoToClipboard(path);
	};

	const handleOpenEditor = (path: string) => {
		commands.showWindow({
			Editor: { project_path: path },
		});
	};

	const handleVideoImport = async () => {
		try {
			await importVideoFromPicker();
		} catch (e) {
			console.error("Failed to import video:", e);
			await showImportError("video", e);
		}
	};

	return (
		<div class="cap-settings-page flex relative flex-col w-full h-full custom-scroll">
			<SettingsPageContent class="max-w-none space-y-4">
				<Section
					title="Recordings"
					description="Manage your recordings and perform actions."
					right={
						<Button
							variant="gray"
							size="sm"
							class="h-[36px] px-3 shrink-0 flex items-center gap-1.5"
							onClick={handleVideoImport}
						>
							<IconLucideImport class="size-3.5" />
							<span>Import</span>
						</Button>
					}
				>
					<Show
						when={recordings.data && recordings.data.length > 0}
						fallback={
							<p class="text-center text-(--text-tertiary) absolute flex items-center justify-center w-full h-full">
								No recordings found
							</p>
						}
					>
						<div class="flex flex-col gap-3 pb-4 w-full border-b border-gray-2">
							<div class="flex flex-wrap gap-3 items-center">
								<For each={Tabs}>
									{(tab) => (
										<div
											class={cx(
												"flex gap-1.5 items-center transition-colors duration-200 p-2 px-3 border rounded-sm",
												activeTab() === tab.id
													? "bg-gray-5 cursor-default border-gray-5"
													: "bg-transparent hover:bg-gray-3 border-gray-5",
											)}
											onClick={() => setActiveTab(tab.id)}
										>
											{tab.icon && tab.icon}
											<p class="text-xs text-gray-12">{tab.label}</p>
										</div>
									)}
								</For>
							</div>
							<div class="relative w-full max-w-[260px] h-[36px] flex items-center">
								<IconLucideSearch class="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none size-3 text-gray-10" />
								<Input
									type="search"
									class="py-2 pl-6 h-full w-full"
									value={search()}
									onInput={(event) => setSearch(event.currentTarget.value)}
									onKeyDown={(event) => {
										if (event.key === "Escape" && search()) {
											event.preventDefault();
											setSearch("");
										}
									}}
									placeholder="Search"
									autoCapitalize="off"
									autocorrect="off"
									autocomplete="off"
									spellcheck={false}
									aria-label="Search recordings"
								/>
							</div>
						</div>

						<div class="flex relative flex-col flex-1 mt-4 rounded-xl border custom-scroll bg-gray-2 border-gray-3">
							<Show when={filteredRecordings().length === 0}>
								<p class="text-center text-(--text-tertiary) absolute flex items-center justify-center w-full h-full">
									{emptyMessage()}
								</p>
							</Show>
							<ul class="flex flex-col w-full text-(--text-primary)">
								<For each={visibleRecordings()}>
									{(recording) => (
										<RecordingItem
											recording={recording}
											onClick={() => handleRecordingClick(recording)}
											onOpenFolder={() => handleOpenFolder(recording)}
											onOpenEditor={() => handleOpenEditor(recording.path)}
											onCopyVideoToClipboard={() =>
												handleCopyVideoToClipboard(recording.path)
											}
										/>
									)}
								</For>
							</ul>
							<Show when={hasMoreRecordings()}>
								<div class="flex justify-center p-3 border-t border-gray-3">
									<Button
										variant="gray"
										size="sm"
										onClick={() =>
											setVisibleCount((count) =>
												Math.min(
													count + PAGE_SIZE,
													filteredRecordings().length,
												),
											)
										}
									>
										Load more
									</Button>
								</div>
							</Show>
						</div>
					</Show>
				</Section>
			</SettingsPageContent>
		</div>
	);
}

function RecordingItem(props: {
	recording: Recording;
	onClick: () => void;
	onOpenFolder: () => void;
	onOpenEditor: () => void;
	onCopyVideoToClipboard: () => void;
}) {
	const [imageExists, setImageExists] = createSignal(true);
	const thumbnail = createRecordingThumbnail(() => props.recording.path);
	createEffect(() => {
		thumbnail();
		setImageExists(true);
	});
	const mode = () => props.recording.meta.mode;
	const firstLetterUpperCase = () =>
		mode().charAt(0).toUpperCase() + mode().slice(1);

	const queryClient = useQueryClient();
	const studioCompleteCheck = () =>
		mode() === "studio" && props.recording.meta.status.status === "Complete";

	return (
		<li
			onClick={() => {
				if (studioCompleteCheck()) {
					props.onOpenEditor();
				}
			}}
			class={cx(
				"flex flex-row justify-between p-3 not-last:border-b not-last:border-gray-3 items-center w-full  transition-colors duration-200",
				studioCompleteCheck() ? "hover:bg-gray-3" : "cursor-default",
			)}
		>
			<div class="flex gap-5 items-center">
				<Show
					when={imageExists()}
					fallback={<div class="mr-4 rounded-sm bg-gray-10 size-11" />}
				>
					<img
						class="object-cover rounded-sm size-12"
						alt="Recording thumbnail"
						src={thumbnail()}
						onError={() => setImageExists(false)}
					/>
				</Show>
				<div class="flex flex-col gap-2">
					<span>{props.recording.prettyName}</span>
					<div class="flex space-x-1">
						<div
							class={cx(
								"px-2 py-0.5 flex items-center gap-1.5 font-medium text-[11px] text-gray-12 rounded-sm w-fit",
								mode() === "instant" ? "bg-blue-100" : "bg-gray-4",
							)}
						>
							{mode() === "instant" ? (
								<IconCapInstant class="invert size-2.5 dark:invert-0" />
							) : (
								<IconCapFilmCut class="invert size-2.5 dark:invert-0" />
							)}
							<p>{firstLetterUpperCase()}</p>
						</div>

						<Show when={props.recording.meta.clip_count > 1}>
							<div class="px-2 py-0.5 flex items-center font-medium text-[11px] text-gray-12 rounded-sm w-fit bg-gray-4">
								<p>{props.recording.meta.clip_count} clips</p>
							</div>
						</Show>

						<Show when={props.recording.meta.status.status === "InProgress"}>
							<div
								class={cx(
									"px-2 py-0.5 flex items-center gap-1.5 font-medium text-[11px] text-gray-12 rounded-sm w-fit bg-blue-500 leading-none text-center",
								)}
							>
								<IconPhRecordFill class="invert size-2.5 dark:invert-0" />
								<p>Recording in progress</p>
							</div>
						</Show>

						<Show when={props.recording.meta.status.status === "Failed"}>
							<CapTooltip
								content={
									<span>
										{props.recording.meta.status.status === "Failed"
											? props.recording.meta.status.error
											: ""}
									</span>
								}
							>
								<div
									class={cx(
										"px-2 py-0.5 flex items-center gap-1.5 font-medium text-[11px] text-gray-12 rounded-sm w-fit bg-red-9 leading-none text-center",
									)}
								>
									<IconPhWarningBold class="invert size-2.5 dark:invert-0" />
									<p>Recording failed</p>
								</div>
							</CapTooltip>
						</Show>
					</div>
				</div>
			</div>
			<div class="flex gap-2 items-center">
				<Show when={mode() === "studio"}>
					<Show when={props.recording.meta.sharing}>
						{(sharing) => (
							<TooltipIconButton
								tooltipText="Open link"
								onClick={() => shell.open(sharing().link)}
							>
								<IconCapLink class="size-4" />
							</TooltipIconButton>
						)}
					</Show>
					<TooltipIconButton
						tooltipText="Edit"
						onClick={async () => {
							if (
								props.recording.meta.status.status === "Failed" &&
								!(await confirm(
									"The recording failed so this file may have issues in the editor! If your having issues recovering the file please reach out to support!",
									{
										title: "Recording is potentially corrupted",
										kind: "warning",
									},
								))
							)
								return;
							props.onOpenEditor();
						}}
						disabled={props.recording.meta.status.status === "InProgress"}
					>
						<IconLucideEdit class="size-4" />
					</TooltipIconButton>
				</Show>
				<TooltipIconButton
					tooltipText="Open recording bundle"
					onClick={() => {
						props.onOpenFolder();
					}}
				>
					<IconLucideFolder class="size-4" />
				</TooltipIconButton>
				<TooltipIconButton
					tooltipText="Delete"
					onClick={async () => {
						if (!(await ask("Are you sure you want to delete this recording?")))
							return;
						await remove(props.recording.path, { recursive: true });

						queryClient.refetchQueries(recordingsQuery);
					}}
				>
					<IconCapTrash class="size-4" />
				</TooltipIconButton>
			</div>
		</li>
	);
}

function TooltipIconButton(
	props: ParentProps<{
		onClick: () => void;
		tooltipText: string;
		disabled?: boolean;
	}>,
) {
	return (
		<Tooltip>
			<Tooltip.Trigger
				onClick={(e: MouseEvent) => {
					e.stopPropagation();
					props.onClick();
				}}
				disabled={props.disabled}
				class="p-2.5 opacity-70 will-change-transform hover:opacity-100 rounded-sm transition-all duration-200 hover:bg-gray-3 dark:hover:bg-gray-5 disabled:pointer-events-none disabled:opacity-45 disabled:hover:opacity-45"
			>
				{props.children}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content class="py-2 px-3 font-medium bg-gray-2 text-gray-12 border border-gray-3 text-xs rounded-lg animate-in fade-in slide-in-from-top-0.5">
					{props.tooltipText}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip>
	);
}
