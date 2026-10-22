import { CaptMark } from "~/components/CaptMark";

export function AbsoluteInsetLoader() {
	return (
		<div class="w-full h-full flex items-center justify-center">
			<CaptMark
				state="loading"
				variant="brand"
				cells={18}
				gap={0.22}
				class="size-16"
				label="Loading"
			/>
		</div>
	);
}
