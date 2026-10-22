import type { Annotation, ProjectConfiguration } from "~/utils/tauri";
import { getArrowHeadPoints } from "./arrow";

export type ScreenshotExportStatus = "idle" | "rendering" | "encoding";

const hasNoVisibleBackground = (source: {
	type: string;
	path?: string | null;
	alpha?: number;
}) => {
	if (source.type === "color") {
		return (source.alpha ?? 255) === 0;
	}
	if (source.type === "wallpaper" || source.type === "image") {
		return !source.path;
	}
	return false;
};

const drawAnnotations = (
	ctx: CanvasRenderingContext2D,
	annotations: Annotation[],
) => {
	for (const ann of annotations) {
		if (ann.type === "mask") continue;
		ctx.save();
		ctx.globalAlpha = ann.opacity;
		ctx.strokeStyle = ann.strokeColor;
		ctx.lineWidth = ann.strokeWidth;
		ctx.fillStyle = ann.fillColor;

		if (ann.type === "rectangle") {
			if (ann.fillColor !== "transparent") {
				ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
			}
			ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
		} else if (ann.type === "circle") {
			ctx.beginPath();
			const cx = ann.x + ann.width / 2;
			const cy = ann.y + ann.height / 2;
			const rx = Math.abs(ann.width / 2);
			const ry = Math.abs(ann.height / 2);
			ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
			if (ann.fillColor !== "transparent") {
				ctx.fill();
			}
			ctx.stroke();
		} else if (ann.type === "arrow") {
			ctx.beginPath();
			ctx.lineCap = "round";
			const x1 = ann.x;
			const y1 = ann.y;
			const x2 = ann.x + ann.width;
			const y2 = ann.y + ann.height;
			const angle = Math.atan2(y2 - y1, x2 - x1);
			const head = getArrowHeadPoints(x2, y2, angle, ann.strokeWidth);

			ctx.moveTo(x1, y1);
			ctx.lineTo(head.base.x, head.base.y);
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(head.points[0].x, head.points[0].y);
			ctx.lineTo(head.points[1].x, head.points[1].y);
			ctx.lineTo(head.points[2].x, head.points[2].y);
			ctx.closePath();
			ctx.fillStyle = ann.strokeColor;
			ctx.fill();
		} else if (ann.type === "draw" && ann.points && ann.points.length >= 2) {
			ctx.beginPath();
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			const w = ann.width || 1;
			const h = ann.height || 1;
			const pts = ann.points.map(
				(p) => [ann.x + p[0] * w, ann.y + p[1] * h] as [number, number],
			);
			ctx.moveTo(pts[0][0], pts[0][1]);
			if (pts.length === 2) {
				ctx.lineTo(pts[1][0], pts[1][1]);
			} else {
				for (let i = 0; i < pts.length - 1; i++) {
					const mx = (pts[i][0] + pts[i + 1][0]) / 2;
					const my = (pts[i][1] + pts[i + 1][1]) / 2;
					ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
				}
				const last = pts[pts.length - 1];
				ctx.lineTo(last[0], last[1]);
			}
			ctx.stroke();
		} else if (ann.type === "text" && ann.text) {
			ctx.fillStyle = ann.strokeColor;
			ctx.font = `${ann.height}px sans-serif`;
			ctx.fillText(ann.text, ann.x, ann.y + ann.height);
		}

		ctx.restore();
	}
};

const blurRegion = (
	ctx: CanvasRenderingContext2D,
	source: HTMLCanvasElement,
	startX: number,
	startY: number,
	regionWidth: number,
	regionHeight: number,
	level: number,
) => {
	const scale = Math.max(2, Math.round(level / 4));
	const temp = document.createElement("canvas");
	temp.width = Math.max(1, Math.floor(regionWidth / scale));
	temp.height = Math.max(1, Math.floor(regionHeight / scale));
	const tempCtx = temp.getContext("2d");
	if (!tempCtx) return;

	tempCtx.imageSmoothingEnabled = true;
	tempCtx.drawImage(
		source,
		startX,
		startY,
		regionWidth,
		regionHeight,
		0,
		0,
		temp.width,
		temp.height,
	);

	ctx.drawImage(
		temp,
		0,
		0,
		temp.width,
		temp.height,
		startX,
		startY,
		regionWidth,
		regionHeight,
	);
};

const applyMaskAnnotations = (
	ctx: CanvasRenderingContext2D,
	source: HTMLCanvasElement,
	annotations: Annotation[],
	imageRect: { x: number; y: number; width: number; height: number },
) => {
	for (const ann of annotations) {
		if (ann.type !== "mask") continue;

		const rectLeft = imageRect.x;
		const rectTop = imageRect.y;
		const rectRight = imageRect.x + imageRect.width;
		const rectBottom = imageRect.y + imageRect.height;

		const startX = Math.max(rectLeft, Math.min(ann.x, ann.x + ann.width));
		const startY = Math.max(rectTop, Math.min(ann.y, ann.y + ann.height));
		const endX = Math.min(rectRight, Math.max(ann.x, ann.x + ann.width));
		const endY = Math.min(rectBottom, Math.max(ann.y, ann.y + ann.height));

		const regionWidth = endX - startX;
		const regionHeight = endY - startY;
		if (regionWidth <= 0 || regionHeight <= 0) continue;

		const level = Math.max(1, ann.maskLevel ?? 16);
		const type = ann.maskType ?? "blur";

		if (type === "pixelate") {
			const blockSize = Math.max(2, Math.round(level));
			const temp = document.createElement("canvas");
			temp.width = Math.max(1, Math.floor(regionWidth / blockSize));
			temp.height = Math.max(1, Math.floor(regionHeight / blockSize));
			const tempCtx = temp.getContext("2d");
			if (!tempCtx) continue;
			tempCtx.imageSmoothingEnabled = false;
			tempCtx.drawImage(
				source,
				startX,
				startY,
				regionWidth,
				regionHeight,
				0,
				0,
				temp.width,
				temp.height,
			);
			const previousSmoothing = ctx.imageSmoothingEnabled;
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(
				temp,
				0,
				0,
				temp.width,
				temp.height,
				startX,
				startY,
				regionWidth,
				regionHeight,
			);
			ctx.imageSmoothingEnabled = previousSmoothing;
			continue;
		}

		blurRegion(ctx, source, startX, startY, regionWidth, regionHeight, level);
	}
	ctx.filter = "none";
};

const scaleAnnotations = (
	annotations: Annotation[],
	scaleX: number,
	scaleY: number,
) => {
	const scalar = (scaleX + scaleY) / 2;

	return annotations.map((ann) => ({
		...ann,
		x: ann.x * scaleX,
		y: ann.y * scaleY,
		width: ann.width * scaleX,
		height: ann.height * scaleY,
		strokeWidth: ann.strokeWidth * scalar,
		maskLevel: ann.maskLevel == null ? ann.maskLevel : ann.maskLevel * scalar,
	}));
};

export function renderScreenshotExportCanvas({
	renderedBitmap,
	project,
	annotations,
	frame,
	previewCanvas,
	previewMaskCanvas,
	canReusePreviewCanvases,
}: {
	renderedBitmap: ImageBitmap;
	project: ProjectConfiguration;
	annotations: Annotation[];
	frame?: { width: number; height: number } | null;
	previewCanvas?: HTMLCanvasElement | null;
	previewMaskCanvas?: HTMLCanvasElement | null;
	canReusePreviewCanvases?: boolean;
}) {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not get canvas context");

	canvas.width = renderedBitmap.width;
	canvas.height = renderedBitmap.height;
	const scaleX = frame ? canvas.width / frame.width : 1;
	const scaleY = frame ? canvas.height / frame.height : 1;
	const scaledAnnotations = scaleAnnotations(annotations, scaleX, scaleY);

	if (canReusePreviewCanvases && previewCanvas && previewMaskCanvas) {
		ctx.drawImage(previewCanvas, 0, 0);
		ctx.drawImage(previewMaskCanvas, 0, 0);
	} else {
		ctx.drawImage(renderedBitmap, 0, 0);

		const sourceCanvas = document.createElement("canvas");
		sourceCanvas.width = canvas.width;
		sourceCanvas.height = canvas.height;
		const sourceCtx = sourceCanvas.getContext("2d");
		if (!sourceCtx) throw new Error("Could not get source canvas context");
		sourceCtx.drawImage(canvas, 0, 0);

		applyMaskAnnotations(ctx, sourceCanvas, scaledAnnotations, {
			x: 0,
			y: 0,
			width: canvas.width,
			height: canvas.height,
		});
	}

	const imageRect = {
		x: 0,
		y: 0,
		width: canvas.width,
		height: canvas.height,
	};

	drawAnnotations(ctx, scaledAnnotations);

	let minX = imageRect.x;
	let minY = imageRect.y;
	let maxX = imageRect.x + imageRect.width;
	let maxY = imageRect.y + imageRect.height;

	for (const ann of scaledAnnotations) {
		if (ann.type === "mask") continue;
		const left = Math.min(ann.x, ann.x + ann.width);
		const right = Math.max(ann.x, ann.x + ann.width);
		const top = Math.min(ann.y, ann.y + ann.height);
		const bottom = Math.max(ann.y, ann.y + ann.height);
		minX = Math.min(minX, left);
		maxX = Math.max(maxX, right);
		minY = Math.min(minY, top);
		maxY = Math.max(maxY, bottom);
	}

	const exportWidth = Math.max(1, Math.round(maxX - minX));
	const exportHeight = Math.max(1, Math.round(maxY - minY));
	const outputCanvas = document.createElement("canvas");
	outputCanvas.width = exportWidth;
	outputCanvas.height = exportHeight;
	const outputCtx = outputCanvas.getContext("2d");
	if (!outputCtx) throw new Error("Could not get output canvas context");
	if (!hasNoVisibleBackground(project.background.source)) {
		outputCtx.fillStyle = "white";
		outputCtx.fillRect(0, 0, exportWidth, exportHeight);
	}
	outputCtx.drawImage(canvas, -minX, -minY);

	return outputCanvas;
}

export const canvasToBlob = (
	canvas: HTMLCanvasElement,
	type: string,
	quality?: number,
) =>
	new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error("Failed to create blob"));
			},
			type,
			quality,
		),
	);

export const canvasNeedsTransparency = (
	canvas: HTMLCanvasElement,
	project: ProjectConfiguration,
) => {
	if (!hasNoVisibleBackground(project.background.source)) return false;

	const ctx = canvas.getContext("2d");
	if (!ctx) return true;

	const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] !== 255) return true;
	}

	return false;
};
