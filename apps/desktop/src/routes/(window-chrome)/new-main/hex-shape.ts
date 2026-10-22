export function roundedHexPath(
	width: number,
	height: number,
	corner = 4,
	point = Math.min(width / 4, height / Math.sqrt(3)),
) {
	const mid = height / 2;
	const vertices: [number, number][] = [
		[point, 0],
		[width - point, 0],
		[width, mid],
		[width - point, height],
		[point, height],
		[0, mid],
	];
	const radius = Math.min(corner, point * 0.6, height * 0.2);
	let d = "";
	vertices.forEach(([x, y], i) => {
		const [px, py] = vertices[(i + 5) % 6];
		const [nx, ny] = vertices[(i + 1) % 6];
		const into = Math.hypot(x - px, y - py) || 1;
		const out = Math.hypot(nx - x, ny - y) || 1;
		const ax = x + ((px - x) * radius) / into;
		const ay = y + ((py - y) * radius) / into;
		const bx = x + ((nx - x) * radius) / out;
		const by = y + ((ny - y) * radius) / out;
		d += `${i === 0 ? "M" : "L"}${ax.toFixed(2)} ${ay.toFixed(2)}Q${x.toFixed(2)} ${y.toFixed(2)} ${bx.toFixed(2)} ${by.toFixed(2)}`;
	});
	return `${d}Z`;
}

export function hexClip(width: number, height: number, corner = 4) {
	return `path("${roundedHexPath(width, height, corner)}")`;
}
