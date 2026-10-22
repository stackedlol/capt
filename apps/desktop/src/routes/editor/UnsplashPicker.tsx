import { Dialog as KDialog } from "@kobalte/core/dialog";
import * as shell from "@tauri-apps/plugin-shell";
import { cx } from "cva";
import {
	type ComponentProps,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import toast from "solid-toast";
import {
	commands,
	type UnsplashAttribution,
	type UnsplashPhoto,
	type UnsplashPick,
} from "~/utils/tauri";
import IconLucideSearch from "~icons/lucide/search";
import { Dialog, Input } from "./ui";

export const UNSPLASH_BLACK = "#111111";

export function UnsplashMark(props: ComponentProps<"svg">) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
			<path d="M7.5 6.75V0h9v6.75h-9zm9 3.75H24V24H0V10.5h7.5v6.75h9V10.5z" />
		</svg>
	);
}

export function UnsplashCredit(props: {
	attribution: UnsplashAttribution;
	class?: string;
}) {
	const open = (url: string) => void shell.open(url);
	return (
		<span
			class={cx(
				"flex items-center gap-1 text-[11px] text-ed-text-2",
				props.class,
			)}
		>
			<span>Photo by</span>
			<button
				type="button"
				class="font-medium text-ed-text-1 underline-offset-2 hover:underline"
				onClick={() => open(props.attribution.photographerUrl)}
			>
				{props.attribution.photographer}
			</button>
			<span>on</span>
			<button
				type="button"
				class="flex items-center gap-1 font-medium text-ed-text-1 underline-offset-2 hover:underline"
				onClick={() => open(props.attribution.pageUrl)}
			>
				<UnsplashMark class="size-3" />
				Unsplash
			</button>
		</span>
	);
}

export function UnsplashButton(props: { onClick: () => void; class?: string }) {
	return (
		<button
			type="button"
			onClick={() => props.onClick()}
			class={cx(
				"flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[#111111] text-[13px] font-medium text-white transition-colors hover:bg-[#2b2b2b] dark:bg-white dark:text-[#111111] dark:hover:bg-[#e8e8e8]",
				props.class,
			)}
		>
			<UnsplashMark class="size-4" />
			Choose from Unsplash
		</button>
	);
}

export function UnsplashPicker(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (pick: UnsplashPick) => void;
}) {
	const [query, setQuery] = createSignal("");
	const [submitted, setSubmitted] = createSignal("");
	const [page, setPage] = createSignal(1);
	const [picking, setPicking] = createSignal<string | null>(null);
	const [results] = createResource(
		() => (props.open ? { query: submitted(), page: page() } : null),
		(request) => commands.unsplashSearch(request.query, request.page),
	);

	const search = () => {
		setPage(1);
		setSubmitted(query().trim());
	};

	const pick = async (photo: UnsplashPhoto) => {
		if (picking()) return;
		setPicking(photo.id);
		try {
			const result = await commands.unsplashPick(photo);
			props.onPick(result);
			props.onOpenChange(false);
		} catch (error) {
			toast.error(
				typeof error === "string" ? error : "Could not use that photo",
			);
		} finally {
			setPicking(null);
		}
	};

	return (
		<Dialog.Root
			open={props.open}
			onOpenChange={props.onOpenChange}
			size="lg"
			contentClass="w-[640px]"
		>
			<Dialog.Header>
				<div class="flex w-full items-center gap-3">
					<span class="flex size-7 items-center justify-center rounded-sm bg-[#111111] text-white dark:bg-white dark:text-[#111111]">
						<UnsplashMark class="size-4" />
					</span>
					<KDialog.Title class="text-[13px] font-medium text-ed-text-1">
						Unsplash
					</KDialog.Title>
					<span class="text-[11px] text-ed-text-3">free photos</span>
					<form
						class="ml-auto flex w-64 items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							search();
						}}
					>
						<Input
							value={query()}
							placeholder="Search photos"
							onInput={(event) => setQuery(event.currentTarget.value)}
						/>
						<button
							type="submit"
							aria-label="Search"
							class="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-ed-ctl text-ed-text-2 transition-colors hover:bg-ed-ctl-hover hover:text-ed-text-1"
						>
							<IconLucideSearch class="size-4" />
						</button>
					</form>
				</div>
			</Dialog.Header>
			<Dialog.Content class="h-[420px] overflow-y-auto p-3">
				<Show
					when={!results.error}
					fallback={
						<p class="p-6 text-center text-[13px] text-ed-text-2">
							{String(results.error)}
						</p>
					}
				>
					<Show
						when={results()?.photos.length}
						fallback={
							<p class="p-6 text-center text-[13px] text-ed-text-3">
								{results.loading ? "Loading photos..." : "No photos found"}
							</p>
						}
					>
						<div class="columns-3 gap-2 [&>*]:mb-2">
							<For each={results()?.photos}>
								{(photo) => (
									<button
										type="button"
										disabled={picking() !== null}
										onClick={() => void pick(photo)}
										title={photo.description ?? undefined}
										class={cx(
											"group relative block w-full break-inside-avoid overflow-hidden rounded-md outline-hidden transition-opacity focus-visible:ring-2 focus-visible:ring-ed-accent",
											picking() && picking() !== photo.id && "opacity-50",
										)}
										style={{
											"background-color": photo.color ?? "#e5e5e5",
											"aspect-ratio": `${photo.width} / ${photo.height}`,
										}}
									>
										<img
											src={photo.thumbUrl}
											alt={photo.description ?? ""}
											loading="lazy"
											class="block size-full object-cover"
										/>
										<span class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
											{photo.photographer}
										</span>
										<Show when={picking() === photo.id}>
											<span class="absolute inset-0 flex items-center justify-center bg-black/40 text-[11px] font-medium text-white">
												Downloading...
											</span>
										</Show>
									</button>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</Dialog.Content>
			<Dialog.Footer
				leftFooterContent={
					<span class="text-[11px] text-ed-text-3">
						Photos are free to use under the Unsplash License.
					</span>
				}
			>
				<Show when={(results()?.totalPages ?? 0) > 1}>
					<button
						type="button"
						disabled={page() <= 1 || results.loading}
						onClick={() => setPage((p) => Math.max(1, p - 1))}
						class="rounded-[7px] px-2.5 py-1 text-[12px] text-ed-text-2 transition-colors hover:bg-ed-ctl-hover disabled:opacity-40"
					>
						Previous
					</button>
					<span class="text-[11px] tabular-nums text-ed-text-3">
						{page()} / {results()?.totalPages}
					</span>
					<button
						type="button"
						disabled={page() >= (results()?.totalPages ?? 1) || results.loading}
						onClick={() => setPage((p) => p + 1)}
						class="rounded-[7px] px-2.5 py-1 text-[12px] text-ed-text-2 transition-colors hover:bg-ed-ctl-hover disabled:opacity-40"
					>
						Next
					</button>
				</Show>
				<Dialog.CloseButton />
			</Dialog.Footer>
		</Dialog.Root>
	);
}
