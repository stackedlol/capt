import { describe, expect, it } from "vitest";
import {
	createMotion,
	DRIFT_AMPLITUDE,
	drift,
	HOVER_PULL,
	type MotionInput,
	type MotionState,
	settled,
	step,
} from "./blob-motion";

const HOMES = [
	{ x: -75, y: -43 },
	{ x: 75, y: -43 },
	{ x: -75, y: 43 },
	{ x: 75, y: 43 },
	{ x: 0, y: 0 },
];

const idle: MotionInput = {
	open: true,
	hovered: null,
	selected: null,
	pointer: null,
};

function run(
	state: MotionState,
	seconds: number,
	input: MotionInput,
	fps = 60,
) {
	const frames = Math.round(seconds * fps);
	for (let i = 0; i < frames; i++) step(state, 1 / fps, input);
	return state;
}

const positions = (state: MotionState) =>
	state.blobs.map((blob) => ({ x: blob.x, y: blob.y }));

describe("blob motion", () => {
	it("starts fused at the centre and springs out to the homes", () => {
		const start = createMotion(HOMES);
		expect(start.blobs.every((b) => b.x === 0 && b.y === 0)).toBe(true);
		const after = run(start, 1.5, idle);
		for (const [index, blob] of after.blobs.entries()) {
			expect(
				Math.hypot(blob.x - HOMES[index].x, blob.y - HOMES[index].y),
			).toBeLessThan(DRIFT_AMPLITUDE * 2 + 0.5);
		}
	});

	it("overshoots a little on the way out, then settles", () => {
		const state = createMotion([{ x: 100, y: 0 }]);
		let peak = 0;
		for (let t = 0; t < 2; t += 1 / 60) {
			step(state, 1 / 60, idle);
			peak = Math.max(peak, state.blobs[0].x);
		}
		expect(peak).toBeGreaterThan(100);
		expect(peak).toBeLessThan(112);
		expect(settled(state, idle, DRIFT_AMPLITUDE)).toBe(true);
	});

	it("moves the same way at 60Hz, 120Hz and with dropped frames", () => {
		const at60 = positions(run(createMotion(HOMES), 0.4, idle, 60));
		const at120 = positions(run(createMotion(HOMES), 0.4, idle, 120));
		const at20 = positions(run(createMotion(HOMES), 0.4, idle, 20));
		for (const [index, point] of at60.entries()) {
			expect(Math.abs(point.x - at120[index].x)).toBeLessThan(0.5);
			expect(Math.abs(point.y - at120[index].y)).toBeLessThan(0.5);
			expect(Math.abs(point.x - at20[index].x)).toBeLessThan(1.5);
			expect(Math.abs(point.y - at20[index].y)).toBeLessThan(1.5);
		}
	});

	it("drifts within the amplitude and never jumps", () => {
		let previous = drift(0, 2);
		for (let t = 0.016; t < 60; t += 0.016) {
			const now = drift(t, 2);
			expect(Math.abs(now.x)).toBeLessThanOrEqual(DRIFT_AMPLITUDE);
			expect(Math.abs(now.y)).toBeLessThanOrEqual(DRIFT_AMPLITUDE);
			expect(Math.hypot(now.x - previous.x, now.y - previous.y)).toBeLessThan(
				0.2,
			);
			previous = now;
		}
	});

	it("collapses back to the centre when closed", () => {
		const state = run(createMotion(HOMES, false), 0.5, idle);
		run(state, 2, { ...idle, open: false });
		expect(state.blobs.every((b) => Math.hypot(b.x, b.y) < 0.5)).toBe(true);
	});

	it("pulls neighbours toward the hovered cell but not the hovered cell itself", () => {
		const state = run(createMotion(HOMES, false), 3, idle);
		const base = positions(state);
		run(state, 3, { ...idle, hovered: 4 });
		const centre = state.blobs[4];
		expect(Math.hypot(centre.x - base[4].x, centre.y - base[4].y)).toBeLessThan(
			DRIFT_AMPLITUDE * 2,
		);
		const before = Math.hypot(base[0].x, base[0].y);
		const after = Math.hypot(state.blobs[0].x, state.blobs[0].y);
		expect(before - after).toBeGreaterThan(HOVER_PULL - DRIFT_AMPLITUDE * 2);
	});

	it("eases hover and selection instead of snapping", () => {
		const state = run(createMotion(HOMES, false), 1, idle);
		step(state, 1 / 60, { ...idle, hovered: 1, selected: 2 });
		expect(state.blobs[1].hover).toBeGreaterThan(0);
		expect(state.blobs[1].hover).toBeLessThan(0.5);
		expect(state.blobs[2].selected).toBeGreaterThan(0);
		expect(state.blobs[2].selected).toBeLessThan(0.5);
		run(state, 1, { ...idle, hovered: 1, selected: 2 });
		expect(state.blobs[1].hover).toBeCloseTo(1, 2);
		expect(state.blobs[1].scale).toBeGreaterThan(1);
		expect(state.blobs[2].selected).toBeCloseTo(1, 2);
	});

	it("clamps long frames so a stalled tab cannot explode the spring", () => {
		const start = createMotion(HOMES);
		const next = step(start, 5, idle);
		for (const blob of next.blobs) {
			expect(Number.isFinite(blob.x)).toBe(true);
			expect(Math.abs(blob.x)).toBeLessThan(200);
		}
	});

	it("grows the cursor blob in at the pointer, follows it, and shrinks it away", () => {
		const state = run(createMotion(HOMES, false), 0.5, idle);
		step(state, 1 / 60, { ...idle, pointer: { x: 10, y: 10 } });
		expect(state.cursor?.x).toBe(10);
		expect(state.cursor?.size).toBeGreaterThan(0);
		expect(state.cursor?.size).toBeLessThan(1);
		step(state, 1 / 60, { ...idle, pointer: { x: 70, y: 10 } });
		expect(state.cursor?.x).toBeGreaterThan(10);
		expect(state.cursor?.x).toBeLessThan(70);
		step(state, 1 / 60, idle);
		expect(state.cursor).not.toBeNull();
		expect(settled(state, idle, 1)).toBe(false);
		run(state, 1, idle);
		expect(state.cursor).toBeNull();
	});

	it("keeps reduced motion still at the homes", () => {
		const state = createMotion(HOMES, true, true);
		run(state, 0.5, { ...idle, open: false, pointer: { x: 0, y: 0 } });
		for (const [index, blob] of state.blobs.entries()) {
			expect(blob.x).toBe(HOMES[index].x);
			expect(blob.y).toBe(HOMES[index].y);
		}
		expect(state.cursor).toBeNull();
	});
});
