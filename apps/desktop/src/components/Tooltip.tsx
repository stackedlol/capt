import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { type as ostype } from "@tauri-apps/plugin-os";
import { cx } from "cva";
import type { ComponentProps, JSX } from "solid-js";

interface Props extends ComponentProps<typeof KTooltip> {
	content?: JSX.Element;
	childClass?: string;
	kbd?: string[];
}

type Os = "android" | "ios" | "linux" | "macos" | "windows";

const kbdSymbolModifier = (key: string, os: Os) => {
	if (os === "macos") {
		const symbols: Record<string, string> = {
			meta: "⌘",
			ctrl: "⌃",
			shift: "⇧",
			alt: "⌥",
		};
		return symbols[key] || key;
	}
	const labels: Record<string, string> = {
		meta: "Ctrl",
		ctrl: "Ctrl",
		shift: "Shift",
		alt: "Alt",
	};
	return labels[key] || key;
};

export default function Tooltip(props: Props) {
	const os = ostype();
	return (
		<KTooltip {...props} openDelay={props.openDelay ?? 200}>
			<KTooltip.Trigger class={cx(props.childClass)} as="div">
				{props.children}
			</KTooltip.Trigger>
			<KTooltip.Portal>
				<KTooltip.Content class="z-50 flex items-center gap-1.5 rounded-md bg-gray-12 px-2 py-1 text-center text-[11px] font-medium text-gray-1 shadow-[0_2px_8px_rgba(0,0,0,0.18)] duration-100 animate-in fade-in slide-in-from-top-1">
					<span>{props.content}</span>
					{props.kbd && props.kbd.length > 0 && (
						<div class="space-x-1">
							{props.kbd?.map((kbd) => (
								<kbd class="rounded-sm bg-gray-1/15 px-1 py-px font-sans text-[10px] text-gray-1">
									{kbdSymbolModifier(kbd, os)}
								</kbd>
							))}
						</div>
					)}
				</KTooltip.Content>
			</KTooltip.Portal>
		</KTooltip>
	);
}
