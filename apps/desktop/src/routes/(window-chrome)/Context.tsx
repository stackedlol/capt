import { createContextProvider } from "@solid-primitives/context";
import {
	createSignal,
	getOwner,
	type JSX,
	onCleanup,
	runWithOwner,
} from "solid-js";

interface WindowChromeState {
	hideMaximize?: boolean;
	maximized?: boolean;
	onMaximize?: () => void;
	items?: JSX.Element;
}

export const [WindowChromeContext, useWindowChromeContext] =
	createContextProvider(() => {
		const [state, setState] = createSignal<WindowChromeState>();

		return { state, setState };
	});

export function useWindowChrome(state: WindowChromeState) {
	const ctx = useWindowChromeContext();
	if (!ctx)
		throw new Error(
			"useWindowChrome must be used within a WindowChromeContext",
		);

	ctx.setState?.(state);
	onCleanup(() => {
		ctx.setState?.();
	});
}

export function WindowChromeHeader(props: {
	hideMaximize?: boolean;
	maximized?: boolean;
	onMaximize?: () => void;
	children?: JSX.Element;
}) {
	// The layout renders these items outside this component, so build them under
	// this component's owner; otherwise header items can't see providers that
	// wrap the page (the main window's ControlIsland threw without its
	// RecordingOptionsProvider, so the window never signalled ready).
	const owner = getOwner();
	useWindowChrome({
		get hideMaximize() {
			return props.hideMaximize;
		},
		get maximized() {
			return props.maximized;
		},
		get onMaximize() {
			return props.onMaximize;
		},
		get items() {
			return runWithOwner(owner, () => props.children);
		},
	});

	return null;
}
