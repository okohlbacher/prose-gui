<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	export const tabsListVariants = tv({
		base: "rounded-lg p-[3px] group-data-horizontal/tabs:h-9 data-[variant=line]:rounded-none group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
		variants: {
			variant: {
				default: "bg-muted",
				line: "gap-1 bg-transparent p-0",
			},
		},
		defaultVariants: {
			// flat: an underlined tab row (in the accent), not a pill on a grey plate
			variant: "line",
		},
	});

	export type TabsListVariant = VariantProps<typeof tabsListVariants>["variant"];
</script>

<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		variant = "line",
		class: className,
		...restProps
	}: TabsPrimitive.ListProps & {
		variant?: TabsListVariant;
	} = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	data-variant={variant}
	class={cn(tabsListVariants({ variant }), className)}
	{...restProps}
/>
