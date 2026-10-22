import { cva, type VariantProps } from "cva";
import { type ComponentProps, splitProps } from "solid-js";

const styles = cva(
	"inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium outline-offset-2 transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-blue-9 disabled:cursor-default disabled:opacity-50",
	{
		defaultVariants: {
			variant: "primary",
			size: "md",
		},
		variants: {
			variant: {
				primary: "bg-gray-12 text-gray-1 hover:bg-gray-11 active:bg-gray-12",
				blue: "bg-blue-9 text-white hover:bg-blue-10 active:bg-blue-9",
				destructive: "bg-red-9 text-white hover:bg-red-10 active:bg-red-9",
				outline:
					"border border-gray-6 bg-transparent text-gray-12 hover:bg-gray-3 active:bg-gray-4",
				white:
					"border border-gray-5 bg-gray-1 text-gray-12 hover:bg-gray-2 active:bg-gray-3",
				ghost: "bg-transparent text-gray-11 hover:bg-gray-3 hover:text-gray-12",
				gray: "bg-gray-3 text-gray-12 hover:bg-gray-4 active:bg-gray-5 data-[selected=true]:bg-gray-5",
				dark: "bg-gray-12 text-gray-1 hover:bg-gray-11 active:bg-gray-12",
			},
			size: {
				xs: "h-6 px-2 text-[11px]",
				sm: "h-7 px-2.5 text-xs",
				md: "h-8 px-3 text-[13px]",
				lg: "h-9 px-4 text-[13px]",
			},
		},
	},
);

export function Button(
	props: VariantProps<typeof styles> & ComponentProps<"button">,
) {
	const [local, otherProps] = splitProps(props, ["class", "size", "variant"]);

	return (
		<button
			type="button"
			{...otherProps}
			data-size={local.size ?? "md"}
			data-variant={local.variant ?? "primary"}
			class={styles({
				class: local.class,
				size: local.size,
				variant: local.variant,
			})}
		/>
	);
}
