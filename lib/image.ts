export type AspectPreset = 'original' | '4:5' | '1:1' | '9:16';

export const IOS_SAFE_PIXEL_LIMIT = 16_700_000;
export const IOS_SAFE_EDGE_LIMIT = 4096;

export function parseExifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffe1 && offset + 8 < view.byteLength) {
      const _length = view.getUint16(offset, false);
      offset += 2;
      if (view.getUint32(offset, false) !== 0x45786966) return 1;
      offset += 6;

      const little = view.getUint16(offset, false) === 0x4949;
      const firstIFDOffset = view.getUint32(offset + 4, little);
      let ifdOffset = offset + firstIFDOffset;
      const entries = view.getUint16(ifdOffset, little);
      ifdOffset += 2;

      for (let i = 0; i < entries; i += 1) {
        const entryOffset = ifdOffset + i * 12;
        const tag = view.getUint16(entryOffset, little);
        if (tag === 0x0112) {
          return view.getUint16(entryOffset + 8, little);
        }
      }
      return 1;
    }

    if ((marker & 0xff00) !== 0xff00) break;
    const size = view.getUint16(offset, false);
    offset += size;
  }

  return 1;
}

export function getOrientedDimensions(width: number, height: number, orientation: number): { width: number; height: number } {
  if ([5, 6, 7, 8].includes(orientation)) {
    return { width: height, height: width };
  }
  return { width, height };
}

function presetToRatio(preset: AspectPreset): number | null {
  switch (preset) {
    case '4:5':
      return 4 / 5;
    case '1:1':
      return 1;
    case '9:16':
      return 9 / 16;
    default:
      return null;
  }
}

export type FrameLayout = {
  canvasWidth: number;
  canvasHeight: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  borderPx: number;
};

export function computeFrameLayout(imageWidth: number, imageHeight: number, borderPercent: number, aspectPreset: AspectPreset): FrameLayout {
  const shortEdge = Math.min(imageWidth, imageHeight);
  const borderPx = (shortEdge * borderPercent) / 100;

  const contentWidth = imageWidth;
  const contentHeight = imageHeight;

  let canvasWidth = contentWidth + borderPx * 2;
  let canvasHeight = contentHeight + borderPx * 2;

  const targetRatio = presetToRatio(aspectPreset);
  if (targetRatio) {
    const currentRatio = canvasWidth / canvasHeight;
    if (currentRatio > targetRatio) {
      canvasHeight = canvasWidth / targetRatio;
    } else {
      canvasWidth = canvasHeight * targetRatio;
    }
  }

  const roundedWidth = Math.round(canvasWidth);
  const roundedHeight = Math.round(canvasHeight);

  return {
    canvasWidth: roundedWidth,
    canvasHeight: roundedHeight,
    contentX: Math.round((roundedWidth - contentWidth) / 2),
    contentY: Math.round((roundedHeight - contentHeight) / 2),
    contentWidth,
    contentHeight,
    borderPx
  };
}

export function computeSafeScale(width: number, height: number): number {
  const pixelScale = Math.min(1, Math.sqrt(IOS_SAFE_PIXEL_LIMIT / (width * height)));
  const edgeScale = Math.min(1, IOS_SAFE_EDGE_LIMIT / Math.max(width, height));
  return Math.min(pixelScale, edgeScale);
}

export function applyOrientationTransform(ctx: CanvasRenderingContext2D, orientation: number, width: number, height: number): void {
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }
}
