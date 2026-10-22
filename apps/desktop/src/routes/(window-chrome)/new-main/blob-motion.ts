export type Point = { x: number; y: number };

export type Blob = {
	home: Point;
	omega: number;
	seed: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	scale: number;
	scaleVelocity: number;
	hover: number;
	selected: number;
};

export type Cursor = Point & {
	present: boolean;
	size: number;
	sizeVelocity: number;
};

export type MotionState = {
	blobs: Blob[];
	cursor: Cursor | null;
	still: boolean;
	time: number;
};

export type MotionInput = {
	open: boolean;
	hovered: number | null;
	selected: number | null;
	pointer: Point | null;
};

export const DRIFT_AMPLITUDE = 3.5;
export const HOVER_PULL = 3;
export const HOVER_PULL_RANGE = 130;
export const HOVER_GROW = 0.03;
const STIFFNESS = 90;
const DAMPING_RATIO = 0.82;
const OMEGA_SPREAD = 0.08;
const SCALE_OMEGA = 24;
const SCALE_DAMPING_RATIO = 0.5;
const CURSOR_OMEGA = 26;
const CURSOR_DAMPING_RATIO = 0.7;
const CURSOR_FOLLOW = 18;
const HOVER_TAU = 0.05;
const SELECT_TAU = 0.09;
const SETTLE_SPEED = 4;
const MAX_STEP = 0.1;

type SpringStep = {
	decay: number;
	cos: number;
	sin: number;
	damped: number;
	alpha: number;
};

const positionSpring: SpringStep = {
	decay: 1,
	cos: 1,
	sin: 0,
	damped: 1,
	alpha: 0,
};
const scaleSpring: SpringStep = { ...positionSpring };
const cursorSpring: SpringStep = { ...positionSpring };
const sprung = { position: 0, velocity: 0 };
const goal: Point = { x: 0, y: 0 };

function prepare(out: SpringStep, omega: number, ratio: number, dt: number) {
	out.alpha = ratio * omega;
	out.damped = omega * Math.sqrt(1 - ratio * ratio);
	out.decay = Math.exp(-out.alpha * dt);
	out.cos = Math.cos(out.damped * dt);
	out.sin = Math.sin(out.damped * dt);
}

function advance(
	k: SpringStep,
	position: number,
	velocity: number,
	rest: number,
) {
	const offset = position - rest;
	const b = (velocity + k.alpha * offset) / k.damped;
	sprung.position = rest + k.decay * (offset * k.cos + b * k.sin);
	sprung.velocity =
		k.decay * (velocity * k.cos - (offset * k.damped + k.alpha * b) * k.sin);
}

export function createMotion(
	homes: Point[],
	fused = true,
	still = false,
): MotionState {
	return {
		blobs: homes.map((home, index) => ({
			home,
			omega: Math.sqrt(STIFFNESS) * (1 + OMEGA_SPREAD * Math.sin(index * 2.4)),
			seed: index * 1.618,
			x: fused && !still ? 0 : home.x,
			y: fused && !still ? 0 : home.y,
			vx: 0,
			vy: 0,
			scale: 1,
			scaleVelocity: 0,
			hover: 0,
			selected: 0,
		})),
		cursor: null,
		still,
		time: 0,
	};
}

export function drift(time: number, seed: number, out: Point = { x: 0, y: 0 }) {
	const a = time * 0.37 + seed;
	const b = time * 0.61 + seed * 1.7;
	out.x = DRIFT_AMPLITUDE * (Math.sin(a) * 0.6 + Math.sin(b * 1.3 + 0.8) * 0.4);
	out.y = DRIFT_AMPLITUDE * (Math.cos(a * 0.9 + 1.1) * 0.6 + Math.sin(b) * 0.4);
	return out;
}

export function target(
	state: MotionState,
	index: number,
	input: MotionInput,
	out: Point = { x: 0, y: 0 },
): Point {
	const blob = state.blobs[index];
	if (state.still) {
		out.x = blob.home.x;
		out.y = blob.home.y;
		return out;
	}
	if (!input.open) {
		out.x = 0;
		out.y = 0;
		return out;
	}
	drift(state.time, blob.seed, out);
	out.x += blob.home.x;
	out.y += blob.home.y;
	if (input.hovered !== null && input.hovered !== index) {
		const pole = state.blobs[input.hovered];
		if (pole) {
			const dx = pole.home.x - blob.home.x;
			const dy = pole.home.y - blob.home.y;
			const distance = Math.hypot(dx, dy);
			if (distance > 0 && distance < HOVER_PULL_RANGE) {
				out.x += (dx / distance) * HOVER_PULL;
				out.y += (dy / distance) * HOVER_PULL;
			}
		}
	}
	return out;
}

const scaleGoal = (state: MotionState, index: number, input: MotionInput) =>
	!state.still && input.open && input.hovered === index ? 1 + HOVER_GROW : 1;

function stepCursor(state: MotionState, dt: number, input: MotionInput) {
	const pointer = state.still ? null : input.pointer;
	let cursor = state.cursor;
	if (!cursor) {
		if (!pointer) return;
		cursor = state.cursor = {
			x: pointer.x,
			y: pointer.y,
			present: true,
			size: 0,
			sizeVelocity: 0,
		};
	} else if (pointer && !cursor.present) {
		cursor.x = pointer.x;
		cursor.y = pointer.y;
	} else if (pointer) {
		const follow = 1 - Math.exp(-CURSOR_FOLLOW * dt);
		cursor.x += (pointer.x - cursor.x) * follow;
		cursor.y += (pointer.y - cursor.y) * follow;
	}
	cursor.present = pointer !== null;
	prepare(cursorSpring, CURSOR_OMEGA, CURSOR_DAMPING_RATIO, dt);
	advance(cursorSpring, cursor.size, cursor.sizeVelocity, pointer ? 1 : 0);
	cursor.size = sprung.position;
	cursor.sizeVelocity = sprung.velocity;
	if (
		!pointer &&
		Math.abs(cursor.size) < 0.01 &&
		Math.abs(cursor.sizeVelocity) < 0.1
	) {
		state.cursor = null;
	}
}

export function step(
	state: MotionState,
	elapsed: number,
	input: MotionInput,
): MotionState {
	const dt = Math.min(Math.max(elapsed, 0), MAX_STEP);
	if (dt === 0) return state;
	state.time += dt;
	const hoverEase = 1 - Math.exp(-dt / HOVER_TAU);
	const selectEase = 1 - Math.exp(-dt / SELECT_TAU);
	prepare(scaleSpring, SCALE_OMEGA, SCALE_DAMPING_RATIO, dt);
	for (let index = 0; index < state.blobs.length; index++) {
		const blob = state.blobs[index];
		target(state, index, input, goal);
		if (state.still) {
			blob.x = goal.x;
			blob.y = goal.y;
			blob.vx = 0;
			blob.vy = 0;
		} else {
			prepare(positionSpring, blob.omega, DAMPING_RATIO, dt);
			advance(positionSpring, blob.x, blob.vx, goal.x);
			blob.x = sprung.position;
			blob.vx = sprung.velocity;
			advance(positionSpring, blob.y, blob.vy, goal.y);
			blob.y = sprung.position;
			blob.vy = sprung.velocity;
		}
		advance(
			scaleSpring,
			blob.scale,
			blob.scaleVelocity,
			scaleGoal(state, index, input),
		);
		blob.scale = sprung.position;
		blob.scaleVelocity = sprung.velocity;
		blob.hover += ((input.hovered === index ? 1 : 0) - blob.hover) * hoverEase;
		blob.selected +=
			((input.selected === index ? 1 : 0) - blob.selected) * selectEase;
	}
	stepCursor(state, dt, input);
	return state;
}

export function settled(
	state: MotionState,
	input: MotionInput,
	tolerance = 0.05,
) {
	const pointer = state.still ? null : input.pointer;
	const cursor = state.cursor;
	if (pointer) {
		if (
			!cursor ||
			Math.abs(cursor.size - 1) > 0.01 ||
			Math.hypot(pointer.x - cursor.x, pointer.y - cursor.y) > tolerance
		) {
			return false;
		}
	} else if (cursor) {
		return false;
	}
	for (let index = 0; index < state.blobs.length; index++) {
		const blob = state.blobs[index];
		target(state, index, input, goal);
		if (
			Math.hypot(goal.x - blob.x, goal.y - blob.y) >= tolerance ||
			Math.hypot(blob.vx, blob.vy) >= tolerance * SETTLE_SPEED ||
			Math.abs(blob.scale - scaleGoal(state, index, input)) > 0.001 ||
			Math.abs(blob.scaleVelocity) > 0.01 ||
			Math.abs(blob.hover - (input.hovered === index ? 1 : 0)) > 0.01 ||
			Math.abs(blob.selected - (input.selected === index ? 1 : 0)) > 0.01
		) {
			return false;
		}
	}
	return true;
}
