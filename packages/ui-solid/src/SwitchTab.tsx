import { Tabs as KTabs } from "@kobalte/core/tabs";
import { cx } from "cva";
import { type ComponentProps, splitProps, type ValidComponent } from "solid-js";

function Root(props: ComponentProps<typeof KTabs>) {
	return <KTabs {...props} />;
}

function List(props: ComponentProps<typeof KTabs.List>) {
	const [local, others] = splitProps(props, ["class", "children"]);
	return (
		<KTabs.List
			{...others}
			class={cx(
				"relative flex flex-row items-center rounded-md bg-gray-3 p-0.5",
				local.class,
			)}
		>
			{local.children}
			<KTabs.Indicator class="absolute inset-y-0.5 flex transition-transform duration-150 peer-focus-visible:outline-solid outline-2 outline-blue-9 outline-offset-2 rounded-sm overflow-hidden">
				<div class="flex-1 rounded-sm bg-gray-1 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.04)]" />
			</KTabs.Indicator>
		</KTabs.List>
	);
}

function Trigger<T extends ValidComponent = "button">(
	props: ComponentProps<typeof KTabs.Trigger<T>>,
) {
	const [local, others] = splitProps(
		props as ComponentProps<typeof KTabs.Trigger<"button">>,
		["class"],
	);
	return (
		<KTabs.Trigger
			{...others}
			class={cx(
				"peer z-10 flex-1 rounded-sm py-1 text-[12px] font-medium text-gray-11 outline-hidden transition-colors duration-100 data-selected:text-gray-12",
				local.class,
			)}
		/>
	);
}

export const SwitchTab = Object.assign(Root, {
	List,
	Trigger,
});
