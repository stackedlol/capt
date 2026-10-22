import { createSignal } from "solid-js";
import toast from "solid-toast";
import { toastThinkingIcon } from "~/components/DotGridLoader";
import { commands, type ZoomSegment } from "~/utils/tauri";

const [planning, setPlanning] = createSignal(false);

export const isPlanningAiZoom = planning;

export async function planZoomsWithAi(options: {
	apply: (segments: ZoomSegment[]) => void;
	shouldApply?: () => boolean;
}) {
	if (planning()) return;
	setPlanning(true);
	const toastId = toast.loading("Planning zooms with AI...", {
		icon: toastThinkingIcon(),
	});
	try {
		const segments = await commands.generateAiZoomSegments();
		if (segments.length === 0) {
			toast.error("AI found nothing worth zooming into", { id: toastId });
			return;
		}
		if (options.shouldApply && !options.shouldApply()) {
			toast("Kept your zoom edits instead of the AI plan", { id: toastId });
			return;
		}
		options.apply(segments);
		toast.success(
			`Planned ${segments.length} zoom${segments.length === 1 ? "" : "s"}`,
			{ id: toastId },
		);
	} catch (error) {
		console.error("AI zoom planning failed:", error);
		toast.error(typeof error === "string" ? error : "AI planning failed", {
			id: toastId,
		});
	} finally {
		setPlanning(false);
	}
}
