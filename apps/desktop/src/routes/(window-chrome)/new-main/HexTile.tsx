import { cx } from "cva";
import { type ComponentProps, type JSX, splitProps } from "solid-js";
import { hexClip } from "./hex-shape";

const SURFACE =
	"relative flex items-center justify-center text-[#1c1c1e] select-none";
const WHITE = "bg-white";

export function HexTile(
	props: ComponentProps<"div"> & { width: number; height: number },
) {
	const [local, rest] = splitProps(props, [
		"width",
		"height",
		"class",
		"style",
		"children",
	]);
	return (
		<div
			{...rest}
			style={{
				width: `${local.width}px`,
				height: `${local.height}px`,
				"clip-path": hexClip(local.width, local.height),
				...(typeof local.style === "object" ? local.style : {}),
			}}
			class={cx(SURFACE, WHITE, local.class)}
		>
			{local.children}
		</div>
	);
}

export function HexIconButton(
	props: ComponentProps<"button"> & {
		width?: number;
		height?: number;
		active?: boolean;
		tone?: "white" | "red";
		children: JSX.Element;
	},
) {
	const [local, rest] = splitProps(props, [
		"width",
		"height",
		"active",
		"tone",
		"class",
		"children",
	]);
	const width = () => local.width ?? 28;
	const height = () => local.height ?? Math.round((width() * Math.sqrt(3)) / 2);
	return (
		<button
			{...rest}
			type="button"
			style={{
				width: `${width()}px`,
				height: `${height()}px`,
				"clip-path": hexClip(width(), height(), 3),
			}}
			class={cx(
				SURFACE,
				"outline-hidden transition-[background-color,transform,filter] duration-150 active:scale-[0.94] disabled:opacity-50",
				local.tone === "red"
					? "bg-[#ff5f57] text-white hover:brightness-[1.05] focus-visible:brightness-[1.1]"
					: cx(
							WHITE,
							"hover:bg-[#f0f0f0] focus-visible:bg-[#dfe5f5]",
							local.active && "bg-[#dfe5f5] text-[#22397f]",
						),
				local.class,
			)}
		>
			{local.children}
		</button>
	);
}
