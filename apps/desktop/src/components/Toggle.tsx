import { Switch as KSwitch } from "@kobalte/core/switch";
import { cva } from "cva";
import { type ComponentProps, splitProps } from "solid-js";

const toggleControlStyles = cva(
	"cap-toggle rounded-sm bg-gray-6 data-disabled:opacity-50 data-checked:bg-blue-9 transition-[background-color] duration-150",
	{
		variants: {
			size: {
				sm: "w-[30px] h-[18px] p-[2px]",
				md: "w-[38px] h-[22px] p-[2px]",
				lg: "w-[46px] h-[26px] p-[2px]",
			},
		},
		defaultVariants: {
			size: "md",
		},
	},
);

const toggleThumbStyles = cva(
	"cap-toggle-thumb bg-white rounded-[2px] shadow-[0_1px_2px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(0,0,0,0.06)] transition-transform duration-150 data-checked:translate-x-[calc(100%)]",
	{
		variants: {
			size: {
				sm: "size-[14px]",
				md: "size-[18px]",
				lg: "size-[22px]",
			},
		},
		defaultVariants: {
			size: "md",
		},
	},
);

export function Toggle(
	props: ComponentProps<typeof KSwitch> & { size?: "sm" | "md" | "lg" },
) {
	const [local, others] = splitProps(props, ["size"]);

	return (
		<KSwitch class="relative" {...others}>
			<KSwitch.Input class="peer absolute inset-0 opacity-0" />
			<KSwitch.Control class={toggleControlStyles({ size: local.size })}>
				<KSwitch.Thumb class={toggleThumbStyles({ size: local.size })} />
			</KSwitch.Control>
		</KSwitch>
	);
}
