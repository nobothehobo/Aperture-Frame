export type ExifData = {
  aperture?: string;
  shutter?: string;
  iso?: string;
  focal?: string;
  camera?: string;
  lens?: string;
};

type Endian = boolean;

const TAG_MODEL = 0x0110;
const TAG_MAKE = 0x010f;
const TAG_EXIF_IFD_POINTER = 0x8769;

const EXIF_TAG_FNUMBER = 0x829d;
const EXIF_TAG_EXPOSURE_TIME = 0x829a;
const EXIF_TAG_ISO = 0x8827;
const EXIF_TAG_FOCAL_LENGTH = 0x920a;
const EXIF_TAG_LENS_MODEL = 0xa434;

function readAscii(view: DataView, offset: number, count: number): string {
  const chars: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    chars.push(String.fromCharCode(code));
  }
  return chars.join('').trim();
}

function typeSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 7:
      return 1;
    case 3:
      return 2;
    case 4:
    case 9:
      return 4;
    case 5:
    case 10:
      return 8;
    default:
      return 0;
  }
}

function readRational(view: DataView, offset: number, little: Endian): number | undefined {
  const numerator = view.getUint32(offset, little);
  const denominator = view.getUint32(offset + 4, little);
  if (denominator === 0) return undefined;
  return numerator / denominator;
}

function formatShutter(value?: number): string | undefined {
  if (!value || value <= 0) return undefined;
  if (value >= 1) return `${value.toFixed(1).replace(/\.0$/, '')}s`;
  const inv = Math.round(1 / value);
  return `1/${inv}`;
}

function formatAperture(value?: number): string | undefined {
  if (!value || value <= 0) return undefined;
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatFocal(value?: number): string | undefined {
  if (!value || value <= 0) return undefined;
  return `${Math.round(value)}`;
}

function parseIFD(view: DataView, tiffOffset: number, ifdOffset: number, little: Endian): Map<number, { type: number; count: number; valueOffset: number }> {
  const entries = new Map<number, { type: number; count: number; valueOffset: number }>();
  if (ifdOffset + 2 > view.byteLength) return entries;

  const count = view.getUint16(ifdOffset, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) continue;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const itemCount = view.getUint32(entry + 4, little);
    const rawOffset = view.getUint32(entry + 8, little);
    const bytes = typeSize(type) * itemCount;
    const valueOffset = bytes <= 4 ? entry + 8 : tiffOffset + rawOffset;
    entries.set(tag, { type, count: itemCount, valueOffset });
  }

  return entries;
}

function readEntryValue(view: DataView, entry: { type: number; count: number; valueOffset: number } | undefined, little: Endian): string | number | undefined {
  if (!entry) return undefined;

  if (entry.type === 2) return readAscii(view, entry.valueOffset, entry.count);
  if (entry.type === 3) return view.getUint16(entry.valueOffset, little);
  if (entry.type === 4) return view.getUint32(entry.valueOffset, little);
  if (entry.type === 5) return readRational(view, entry.valueOffset, little);

  return undefined;
}

export function extractExifData(buffer: ArrayBuffer): ExifData {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return {};

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffe1) {
      const exifStart = offset + 2;
      if (exifStart + 6 >= view.byteLength || view.getUint32(exifStart, false) !== 0x45786966) return {};

      const tiffOffset = exifStart + 6;
      const little = view.getUint16(tiffOffset, false) === 0x4949;
      const firstIFDOffset = view.getUint32(tiffOffset + 4, little);
      const ifd0 = parseIFD(view, tiffOffset, tiffOffset + firstIFDOffset, little);

      const make = readEntryValue(view, ifd0.get(TAG_MAKE), little);
      const model = readEntryValue(view, ifd0.get(TAG_MODEL), little);

      const exifPtr = readEntryValue(view, ifd0.get(TAG_EXIF_IFD_POINTER), little);
      const exifIFD = typeof exifPtr === 'number' ? parseIFD(view, tiffOffset, tiffOffset + exifPtr, little) : new Map();

      const apertureRaw = readEntryValue(view, exifIFD.get(EXIF_TAG_FNUMBER), little);
      const shutterRaw = readEntryValue(view, exifIFD.get(EXIF_TAG_EXPOSURE_TIME), little);
      const isoRaw = readEntryValue(view, exifIFD.get(EXIF_TAG_ISO), little);
      const focalRaw = readEntryValue(view, exifIFD.get(EXIF_TAG_FOCAL_LENGTH), little);
      const lensRaw = readEntryValue(view, exifIFD.get(EXIF_TAG_LENS_MODEL), little);

      return {
        aperture: formatAperture(typeof apertureRaw === 'number' ? apertureRaw : undefined),
        shutter: formatShutter(typeof shutterRaw === 'number' ? shutterRaw : undefined),
        iso: typeof isoRaw === 'number' ? `${isoRaw}` : undefined,
        focal: formatFocal(typeof focalRaw === 'number' ? focalRaw : undefined),
        camera: [make, model].filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ') || undefined,
        lens: typeof lensRaw === 'string' && lensRaw.length > 0 ? lensRaw : undefined
      };
    }

    if ((marker & 0xff00) !== 0xff00) break;
    const size = view.getUint16(offset, false);
    offset += size;
    if (offset > view.byteLength) break;
  }

  return {};
}

export function renderExifLine(data: ExifData, template: string): string {
  return template
    .replaceAll('{aperture}', data.aperture ?? '—')
    .replaceAll('{shutter}', data.shutter ?? '—')
    .replaceAll('{iso}', data.iso ?? '—')
    .replaceAll('{focal}', data.focal ?? '—')
    .replaceAll('{camera}', data.camera ?? '—')
    .replaceAll('{lens}', data.lens ?? '—');
}
