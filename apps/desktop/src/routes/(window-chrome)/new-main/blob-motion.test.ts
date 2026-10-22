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

const idle: MotionInput = { open: true, hovered: null, pointer: null };

function run(state: MotionState, seconds: number, input: MotionInput) {
	let next = state;
	for (let t = 0; t < seconds; t += 1 / 60) next = step(next, 1 / 60, input);
	return next;
}

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
		let next = state;
		for (let t = 0; t < 2; t += 1 / 60) {
			next = step(next, 1 / 60, { ...idle, hovered: null });
			peak = Math.max(peak, next.blobs[0].x);
		}
		expect(peak).toBeGreaterThan(100);
		expect(peak).toBeLessThan(112);
		expect(settled(next, { ...idle }, DRIFT_AMPLITUDE)).toBe(true);
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
		const open = run(createMotion(HOMES, false), 0.5, idle);
		const closed = run(open, 2, { ...idle, open: false });
		expect(closed.blobs.every((b) => Math.hypot(b.x, b.y) < 0.5)).toBe(true);
	});

	it("pulls neighbours toward the hovered cell but not the hovered cell itself", () => {
		const base = run(createMotion(HOMES, false), 3, idle);
		const hovered = run(base, 3, { ...idle, hovered: 4 });
		const centre = hovered.blobs[4];
		expect(
			Math.hypot(centre.x - base.blobs[4].x, centre.y - base.blobs[4].y),
		).toBeLessThan(DRIFT_AMPLITUDE * 2);
		const neighbour = hovered.blobs[0];
		const before = Math.hypot(base.blobs[0].x, base.blobs[0].y);
		const after = Math.hypot(neighbour.x, neighbour.y);
		expect(before - after).toBeGreaterThan(HOVER_PULL - DRIFT_AMPLITUDE * 2);
	});

	it("clamps long frames so a stalled tab cannot explode the spring", () => {
		const start = createMotion(HOMES);
		const next = step(start, 5, idle);
		for (const blob of next.blobs) {
			expect(Number.isFinite(blob.x)).toBe(true);
			expect(Math.abs(blob.x)).toBeLessThan(200);
		}
	});

	it("eases the cursor blob toward the pointer and drops it when the pointer leaves", () => {
		let state = createMotion(HOMES, false);
		state = step(state, 1 / 60, { ...idle, pointer: { x: 10, y: 10 } });
		expect(state.cursor).toEqual({ x: 10, y: 10 });
		state = step(state, 1 / 60, { ...idle, pointer: { x: 70, y: 10 } });
		expect(state.cursor?.x).toBeGreaterThan(10);
		expect(state.cursor?.x).toBeLessThan(70);
		state = step(state, 1 / 60, idle);
		expect(state.cursor).toBeNull();
	});
});
