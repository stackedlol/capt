import type { Accessor } from "solid-js";

export type OrganizationBrandColors = {
	primary: string | null;
	secondary: string | null;
	accent: string | null;
	background: string | null;
};

export type DesktopOrganization = {
	id: string;
	name: string;
	brandColors: OrganizationBrandColors;
};

export type OrganizationBrandColorKey = keyof OrganizationBrandColors;

export type OrganizationBrandColorSwatch = {
	key: OrganizationBrandColorKey;
	label: string;
	color: string;
};

export function getOrganizationBrandColorSwatches(
	_organization: DesktopOrganization | null | undefined,
): OrganizationBrandColorSwatch[] {
	return [];
}

export function createSelectedOrganization(): {
	selectedOrganization: Accessor<DesktopOrganization | null>;
} {
	return { selectedOrganization: () => null };
}
