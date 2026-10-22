export type Point = { x: number; y: number };

export type Blob = {
	home: Point;
	x: number;
	y: number;
	vx: number;
	vy: number;
	seed: number;
};

export type MotionState = {
	blobs: Blob[];
	cursor: Point | null;
	cursorTarget: Point | null;
	time: number;
};

export type MotionInput = {
	open: boolean;
	hovered: number | null;
	pointer: Point | null;
};

export const DRIFT_AMPLITUDE = 3.5;
export const HOVER_PULL = 3;
export const HOVER_PULL_RANGE = 130;
const STIFFNESS = 90;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.82;
const MAX_STEP = 1 / 30;
const CURSOR_FOLLOW = 18;

export function createMotion(homes: Point[], fused = true): MotionState {
	return {
		blobs: homes.map((home, index) => ({
			home,
			x: fused ? 0 : home.x,
			y: fused ? 0 : home.y,
			vx: 0,
			vy: 0,
			seed: index * 1.618,
		})),
		cursor: null,
		cursorTarget: null,
		time: 0,
	};
}

export function drift(time: number, seed: number): Point {
	const a = time * 0.37 + seed;
	const b = time * 0.61 + seed * 1.7;
	return {
		x: DRIFT_AMPLITUDE * (Math.sin(a) * 0.6 + Math.sin(b * 1.3 + 0.8) * 0.4),
		y: DRIFT_AMPLITUDE * (Math.cos(a * 0.9 + 1.1) * 0.6 + Math.sin(b) * 0.4),
	};
}

export function target(
	state: MotionState,
	index: number,
	input: MotionInput,
): Point {
	const blob = state.blobs[index];
	if (!input.open) return { x: 0, y: 0 };
	const wobble = drift(state.time, blob.seed);
	let x = blob.home.x + wobble.x;
	let y = blob.home.y + wobble.y;
	if (input.hovered !== null && input.hovered !== index) {
		const pole = state.blobs[input.hovered];
		if (pole) {
			const dx = pole.home.x - blob.home.x;
			const dy = pole.home.y - blob.home.y;
			const distance = Math.hypot(dx, dy);
			if (distance > 0 && distance < HOVER_PULL_RANGE) {
				x += (dx / distance) * HOVER_PULL;
				y += (dy / distance) * HOVER_PULL;
			}
		}
	}
	return { x, y };
}

export function step(
	state: MotionState,
	elapsed: number,
	input: MotionInput,
): MotionState {
	const dt = Math.min(Math.max(elapsed, 0), MAX_STEP);
	const time = state.time + dt;
	const next: MotionState = { ...state, time };
	next.blobs = state.blobs.map((blob, index) => {
		const goal = target(next, index, input);
		const ax = STIFFNESS * (goal.x - blob.x) - DAMPING * blob.vx;
		const ay = STIFFNESS * (goal.y - blob.y) - DAMPING * blob.vy;
		const vx = blob.vx + ax * dt;
		const vy = blob.vy + ay * dt;
		return { ...blob, vx, vy, x: blob.x + vx * dt, y: blob.y + vy * dt };
	});
	next.cursorTarget = input.pointer;
	if (!input.pointer) {
		next.cursor = null;
	} else if (!state.cursor) {
		next.cursor = { ...input.pointer };
	} else {
		const k = Math.min(1, CURSOR_FOLLOW * dt);
		next.cursor = {
			x: state.cursor.x + (input.pointer.x - state.cursor.x) * k,
			y: state.cursor.y + (input.pointer.y - state.cursor.y) * k,
		};
	}
	return next;
}

export function settled(
	state: MotionState,
	input: MotionInput,
	tolerance = 0.05,
) {
	return state.blobs.every((blob, index) => {
		const goal = target(state, index, input);
		return (
			Math.hypot(goal.x - blob.x, goal.y - blob.y) < tolerance &&
			Math.hypot(blob.vx, blob.vy) < tolerance
		);
	});
}
