export type ExifData = {
  aperture?: string;
  shutter?: string;
  iso?: string;
  focal?: string;
  camera?: string;
  lens?: string;
  date?: string;
  debug?: Record<string, string>;
  unavailable?: boolean;
};

type Endian = boolean;
type ParsedEntry = { type: number; count: number; valueOffset: number };

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD_POINTER = 0x8769;

const EXIF_TAG_FNUMBER = 0x829d;
const EXIF_TAG_EXPOSURE_TIME = 0x829a;
const EXIF_TAG_SHUTTER_SPEED_VALUE = 0x9201;
const EXIF_TAG_APERTURE_VALUE = 0x9202;
const EXIF_TAG_ISO = 0x8827;
const EXIF_TAG_PHOTOGRAPHIC_SENSITIVITY = 0x8833;
const EXIF_TAG_FOCAL_LENGTH = 0x920a;
const EXIF_TAG_LENS_SPECIFICATION = 0xa432;
const EXIF_TAG_LENS_MODEL = 0xa434;
const EXIF_TAG_DATE_TIME_ORIGINAL = 0x9003;

function readAscii(view: DataView, offset: number, count: number): string | undefined {
  const chars: string[] = [];
  for (let i = 0; i < count && offset + i < view.byteLength; i += 1) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    chars.push(String.fromCharCode(code));
  }
  const trimmed = chars.join('').trim();
  return trimmed.length ? trimmed : undefined;
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
  if (offset + 8 > view.byteLength) return undefined;
  const numerator = view.getUint32(offset, little);
  const denominator = view.getUint32(offset + 4, little);
  if (denominator === 0) return undefined;
  return numerator / denominator;
}

function readSignedRational(view: DataView, offset: number, little: Endian): number | undefined {
  if (offset + 8 > view.byteLength) return undefined;
  const numerator = view.getInt32(offset, little);
  const denominator = view.getInt32(offset + 4, little);
  if (denominator === 0) return undefined;
  return numerator / denominator;
}

function formatShutter(seconds?: number): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  if (seconds >= 1) return `${seconds.toFixed(1).replace(/\.0$/, '')}s`;
  const inv = Math.round(1 / seconds);
  return inv > 0 ? `1/${inv}` : undefined;
}

function formatAperture(value?: number): string | undefined {
  if (!value || value <= 0) return undefined;
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatFocal(value?: number): string | undefined {
  if (!value || value <= 0) return undefined;
  return `${Math.round(value)}`;
}

function parseIFD(view: DataView, tiffOffset: number, ifdOffset: number, little: Endian): Map<number, ParsedEntry> {
  const entries = new Map<number, ParsedEntry>();
  if (ifdOffset + 2 > view.byteLength) return entries;

  const count = view.getUint16(ifdOffset, little);
  for (let i = 0; i < count; i += 1) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) continue;
    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    const itemCount = view.getUint32(entryOffset + 4, little);
    const rawOffset = view.getUint32(entryOffset + 8, little);
    const bytes = typeSize(type) * itemCount;
    const valueOffset = bytes <= 4 ? entryOffset + 8 : tiffOffset + rawOffset;
    entries.set(tag, { type, count: itemCount, valueOffset });
  }

  return entries;
}

function readEntryValue(view: DataView, entry: ParsedEntry | undefined, little: Endian): string | number | number[] | undefined {
  if (!entry || entry.valueOffset >= view.byteLength) return undefined;

  const { type, count, valueOffset } = entry;

  if (type === 2) return readAscii(view, valueOffset, count);

  if (type === 3) {
    if (count === 1) {
      if (valueOffset + 2 > view.byteLength) return undefined;
      return view.getUint16(valueOffset, little);
    }
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const pos = valueOffset + i * 2;
      if (pos + 2 > view.byteLength) break;
      values.push(view.getUint16(pos, little));
    }
    return values;
  }

  if (type === 4) {
    if (valueOffset + 4 > view.byteLength) return undefined;
    return view.getUint32(valueOffset, little);
  }

  if (type === 5) {
    if (count === 1) return readRational(view, valueOffset, little);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const pos = valueOffset + i * 8;
      const value = readRational(view, pos, little);
      if (value !== undefined) values.push(value);
    }
    return values.length ? values : undefined;
  }

  if (type === 10) {
    if (count === 1) return readSignedRational(view, valueOffset, little);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const pos = valueOffset + i * 8;
      const value = readSignedRational(view, pos, little);
      if (value !== undefined) values.push(value);
    }
    return values.length ? values : undefined;
  }

  return undefined;
}

function toNumber(value: string | number | number[] | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0];
  return undefined;
}

function toString(value: string | number | number[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

function apertureFromApex(av?: number): number | undefined {
  if (!av || !Number.isFinite(av)) return undefined;
  return 2 ** (av / 2);
}

function shutterFromApex(tv?: number): number | undefined {
  if (!tv || !Number.isFinite(tv)) return undefined;
  return 1 / 2 ** tv;
}

function lensFromSpecification(spec: string | number | number[] | undefined): string | undefined {
  if (!Array.isArray(spec) || spec.length < 2) return undefined;
  const [minFocal, maxFocal, minAperture, maxAperture] = spec;
  const focal = minFocal === maxFocal ? `${Math.round(minFocal)}mm` : `${Math.round(minFocal)}-${Math.round(maxFocal)}mm`;
  if (typeof minAperture === 'number' && typeof maxAperture === 'number') {
    const aperture = minAperture === maxAperture ? `f/${formatAperture(minAperture)}` : `f/${formatAperture(minAperture)}-${formatAperture(maxAperture)}`;
    return `${focal} ${aperture}`;
  }
  return focal;
}

function formatDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/^([0-9]{4}):([0-9]{2}):([0-9]{2})/, '$1-$2-$3');
}

export async function extractExifData(file: File): Promise<ExifData> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return { unavailable: true };

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      if (marker === 0xffe1) {
        const exifStart = offset + 2;
        if (exifStart + 6 >= view.byteLength || view.getUint32(exifStart, false) !== 0x45786966) return { unavailable: true };

        const tiffOffset = exifStart + 6;
        const little = view.getUint16(tiffOffset, false) === 0x4949;
        const firstIfdOffset = view.getUint32(tiffOffset + 4, little);

        const ifd0 = parseIFD(view, tiffOffset, tiffOffset + firstIfdOffset, little);
        const make = toString(readEntryValue(view, ifd0.get(TAG_MAKE), little));
        const model = toString(readEntryValue(view, ifd0.get(TAG_MODEL), little));

        const exifPtr = toNumber(readEntryValue(view, ifd0.get(TAG_EXIF_IFD_POINTER), little));
        const exifIfd = exifPtr ? parseIFD(view, tiffOffset, tiffOffset + exifPtr, little) : new Map<number, ParsedEntry>();

        const fNumberRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_FNUMBER), little);
        const apertureValueRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_APERTURE_VALUE), little);
        const exposureTimeRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_EXPOSURE_TIME), little);
        const shutterSpeedRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_SHUTTER_SPEED_VALUE), little);
        const isoRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_ISO), little);
        const photoSensitivityRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_PHOTOGRAPHIC_SENSITIVITY), little);
        const focalRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_FOCAL_LENGTH), little);
        const lensModelRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_LENS_MODEL), little);
        const lensSpecRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_LENS_SPECIFICATION), little);
        const dateRaw = readEntryValue(view, exifIfd.get(EXIF_TAG_DATE_TIME_ORIGINAL), little);

        const aperture = formatAperture(toNumber(fNumberRaw) ?? apertureFromApex(toNumber(apertureValueRaw)));
        const shutter = formatShutter(toNumber(exposureTimeRaw) ?? shutterFromApex(toNumber(shutterSpeedRaw)));
        const isoValue = toNumber(isoRaw) ?? toNumber(photoSensitivityRaw);

        const lens = toString(lensModelRaw) ?? lensFromSpecification(lensSpecRaw);
        const camera = model ?? make;

        const debug: Record<string, string> = {
          Make: make ?? '—',
          Model: model ?? '—',
          FNumber: `${toNumber(fNumberRaw) ?? '—'}`,
          ApertureValue: `${toNumber(apertureValueRaw) ?? '—'}`,
          ExposureTime: `${toNumber(exposureTimeRaw) ?? '—'}`,
          ShutterSpeedValue: `${toNumber(shutterSpeedRaw) ?? '—'}`,
          ISOSpeedRatings: `${toNumber(isoRaw) ?? '—'}`,
          PhotographicSensitivity: `${toNumber(photoSensitivityRaw) ?? '—'}`,
          FocalLength: `${toNumber(focalRaw) ?? '—'}`,
          LensModel: toString(lensModelRaw) ?? '—',
          LensSpecification: Array.isArray(lensSpecRaw) ? lensSpecRaw.join(', ') : '—',
          DateTimeOriginal: toString(dateRaw) ?? '—'
        };

        return {
          aperture,
          shutter,
          iso: isoValue ? `${Math.round(isoValue)}` : undefined,
          focal: formatFocal(toNumber(focalRaw)),
          camera,
          lens,
          date: formatDate(toString(dateRaw)),
          debug
        };
      }

      if ((marker & 0xff00) !== 0xff00) break;
      if (offset + 2 > view.byteLength) break;
      const size = view.getUint16(offset, false);
      offset += size;
    }

    return { unavailable: true };
  } catch {
    return { unavailable: true };
  }
}

export function renderExifLine(data: ExifData, template: string): string {
  return template
    .replaceAll('{aperture}', data.aperture ?? '—')
    .replaceAll('{shutter}', data.shutter ?? '—')
    .replaceAll('{iso}', data.iso ?? '—')
    .replaceAll('{focal}', data.focal ?? '—')
    .replaceAll('{camera}', data.camera ?? '—')
    .replaceAll('{lens}', data.lens ?? '—')
    .replaceAll('{date}', data.date ?? '—');
}
