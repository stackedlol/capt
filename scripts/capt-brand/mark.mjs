export const NAVY = "#1b2d6b";
export const PASTEL = "#aebbe0";
export const PLATE = "#ffffff";
export const PLATE_EDGE = "#e7eaf0";

export const RING_MID = 0.7;
export const RING_INNER = 0.48;
export const RING_OF_PLATE = 0.36;
export const CORNER = 0.24;

function roundBoxDistance(px, py, half, corner) {
	const qx = Math.abs(px) - half + corner;
	const qy = Math.abs(py) - half + corner;
	return (
		Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
		Math.min(Math.max(qx, qy), 0) -
		corner
	);
}

export function squareGauge(px, py, corner = CORNER) {
	let lo = 0;
	let hi = 3;
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (roundBoxDistance(px, py, mid, corner * mid) <= 0) hi = mid;
		else lo = mid;
	}
	return hi;
}

// Each cell takes the band its centre falls in, with no dithering at the band
// edges, and the grid always has an even number of cells centred on the mark.
// That keeps all four corners identical (mirror-symmetric on both axes) and
// rounded the same way at every size; dithered edges left each corner ragged
// in its own way and an odd grid sat half a cell off centre.
export function ringField(radius) {
	const n = Math.ceil(radius) * 2 + 2;
	const c = n / 2;

	const tone = (sx, sy) => {
		const d = squareGauge((sx - c) / radius, (sy - c) / radius);
		if (d > 1) return null;
		if (d > RING_MID) return "hot";
		if (d > RING_INNER) return "pastel";
		return null;
	};

	const cells = [];
	for (let row = 0; row < n; row++) {
		for (let col = 0; col < n; col++) {
			const value = tone(col + 0.5, row + 0.5);
			if (value) cells.push({ col, row, tone: value });
		}
	}
	return { n, cells };
}

export function toneFill(tone) {
	return tone === "hot" ? NAVY : PASTEL;
}

export function ringRects(
	field,
	{ x = 0, y = 0, cell = 1, fill = toneFill, mono = false, gap = 0 },
) {
	const inset = (cell * gap) / 2;
	// Checker the pastel band by distance from the centre rather than from the
	// top-left cell: on an even grid a plain checkerboard starts each corner on a
	// different colour, while this mirrors identically into all four corners.
	const fold = (i) => (Math.abs(2 * i - (field.n - 1)) - 1) / 2;
	const rects = [];
	for (const p of field.cells) {
		if (mono && p.tone === "pastel" && (fold(p.col) + fold(p.row)) % 2 === 1)
			continue;
		rects.push({
			x: x + p.col * cell + inset,
			y: y + p.row * cell + inset,
			w: cell - inset * 2,
			h: cell - inset * 2,
			fill: fill(p.tone),
		});
	}
	return rects;
}
