import { describe, expect, it } from "vitest";
import { getOrganizationBrandColorSwatches } from "./organization-branding";

describe("organization branding", () => {
	it("has no brand swatches in the local-only app", () => {
		expect(
			getOrganizationBrandColorSwatches({
				id: "org-1",
				name: "Acme",
				brandColors: {
					primary: "#4785FF",
					secondary: null,
					accent: null,
					background: null,
				},
			}),
		).toEqual([]);
		expect(getOrganizationBrandColorSwatches(null)).toEqual([]);
	});
});
