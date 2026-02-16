'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyOrientationTransform,
  AspectPreset,
  computeFrameLayout,
  computeSafeScale,
  getOrientedDimensions,
  parseExifOrientation
} from '@/lib/image';

type BorderPreset = 'classic' | 'warm' | 'noir';
type ExportFormat = 'jpeg' | 'png';
type ResolutionMode = 'original' | 'safe';

type LoadedImage = {
  drawable: CanvasImageSource;
  width: number;
  height: number;
  orientation: number;
  fileName: string;
  originalType: string;
};

const BORDER_PRESETS: Record<BorderPreset, { label: string; color: string }> = {
  classic: { label: 'Classic', color: '#ffffff' },
  warm: { label: 'Warm', color: '#f7f4ee' },
  noir: { label: 'Noir', color: '#000000' }
};

const ASPECTS: { label: string; value: AspectPreset }[] = [
  { label: 'Original', value: 'original' },
  { label: '4:5', value: '4:5' },
  { label: '1:1', value: '1:1' },
  { label: '9:16', value: '9:16' }
];

function isShareFileSupported(file: File): boolean {
  return !!navigator.canShare && navigator.canShare({ files: [file] });
}

export default function HomePage() {
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [preset, setPreset] = useState<BorderPreset>('classic');
  const [thickness, setThickness] = useState<number>(8);
  const [aspect, setAspect] = useState<AspectPreset>('original');
  const [cropMode, setCropMode] = useState(false);
  const [paperTexture, setPaperTexture] = useState(false);
  const [previewShadow, setPreviewShadow] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>('original');
  const [stripMetadata, setStripMetadata] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [isExporting, setIsExporting] = useState(false);
  const [sharedFile, setSharedFile] = useState<File | null>(null);

  const [warning, setWarning] = useState<string>('');

  const orientedSize = useMemo(() => {
    if (!image) return null;
    return getOrientedDimensions(image.width, image.height, image.orientation);
  }, [image]);

  const layout = useMemo(() => {
    if (!orientedSize) return null;
    return computeFrameLayout(orientedSize.width, orientedSize.height, thickness, aspect);
  }, [orientedSize, thickness, aspect]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [cropMode, aspect, thickness]);

  useEffect(() => {
    if (!layout || resolutionMode !== 'original') {
      setWarning('');
      return;
    }
    const safeScale = computeSafeScale(layout.canvasWidth, layout.canvasHeight);
    if (safeScale < 0.999) {
      setWarning('Original export may exceed iPhone Safari canvas limits. Consider using Max Safe mode.');
    } else {
      setWarning('');
    }
  }, [layout, resolutionMode]);

  useEffect(() => {
    if (!image || !layout || !previewRef.current) return;

    const canvas = previewRef.current;
    const maxPreviewEdge = 1200;
    const scale = Math.min(1, maxPreviewEdge / Math.max(layout.canvasWidth, layout.canvasHeight));
    const width = Math.max(1, Math.round(layout.canvasWidth * scale));
    const height = Math.max(1, Math.round(layout.canvasHeight * scale));

    canvas.width = width;
    canvas.height = height;
    drawFramedImage(canvas, image, {
      ...layout,
      canvasWidth: width,
      canvasHeight: height,
      contentX: layout.contentX * scale,
      contentY: layout.contentY * scale,
      contentWidth: layout.contentWidth * scale,
      contentHeight: layout.contentHeight * scale,
      borderPx: layout.borderPx * scale
    }, {
      borderColor: BORDER_PRESETS[preset].color,
      cropMode,
      pan,
      paperTexture,
      includeShadow: previewShadow
    });
  }, [image, layout, preset, pan, cropMode, paperTexture, previewShadow]);

  async function handleFileChange(file: File) {
    setStatusMessage('Decoding image…');
    setSharedFile(null);
    const buffer = await file.arrayBuffer();
    const orientation = parseExifOrientation(buffer);

    let drawable: CanvasImageSource;
    if ('createImageBitmap' in window) {
      try {
        drawable = await createImageBitmap(file);
      } catch {
        drawable = await loadImageElement(file);
      }
    } else {
      drawable = await loadImageElement(file);
    }

    const width = 'width' in drawable ? drawable.width : (drawable as HTMLImageElement).naturalWidth;
    const height = 'height' in drawable ? drawable.height : (drawable as HTMLImageElement).naturalHeight;

    setImage({
      drawable,
      width,
      height,
      orientation,
      fileName: file.name.replace(/\.[^.]+$/, ''),
      originalType: file.type
    });

    setStatusMessage('Image ready.');
  }

  async function renderExport(mode: ResolutionMode): Promise<File> {
    if (!image || !layout) throw new Error('No image loaded');

    setProgress(15);
    const safeScale = computeSafeScale(layout.canvasWidth, layout.canvasHeight);
    const appliedScale = mode === 'safe' ? safeScale : 1;

    if (mode === 'original' && safeScale < 0.999) {
      setStatusMessage('Original size may be too large for this device. Attempting anyway…');
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(layout.canvasWidth * appliedScale));
    canvas.height = Math.max(1, Math.floor(layout.canvasHeight * appliedScale));

    setProgress(35);
    drawFramedImage(canvas, image, {
      ...layout,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      contentX: layout.contentX * appliedScale,
      contentY: layout.contentY * appliedScale,
      contentWidth: layout.contentWidth * appliedScale,
      contentHeight: layout.contentHeight * appliedScale,
      borderPx: layout.borderPx * appliedScale
    }, {
      borderColor: BORDER_PRESETS[preset].color,
      cropMode,
      pan,
      paperTexture,
      includeShadow: false
    });

    setProgress(70);
    const mime = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, exportFormat === 'jpeg' ? quality : undefined);

    setProgress(100);
    const extension = exportFormat === 'png' ? 'png' : 'jpg';
    return new File([blob], `${image.fileName}-aperture-frame.${extension}`, { type: mime });
  }

  async function handleExport() {
    if (!image) return;
    setIsExporting(true);
    setProgress(5);
    setStatusMessage('Preparing export…');

    try {
      let exported: File;
      try {
        exported = await renderExport(resolutionMode);
      } catch (error) {
        if (resolutionMode === 'original') {
          setStatusMessage(
            'Your iPhone/browser hit a memory limit while exporting at original resolution. Exported at Max Safe size instead.'
          );
          exported = await renderExport('safe');
        } else {
          throw error;
        }
      }

      setSharedFile(exported);
      downloadFile(exported);
      if (!stripMetadata) {
        setStatusMessage('Export complete. Metadata preservation may vary by browser.');
      } else if (!statusMessage.includes('memory limit')) {
        setStatusMessage('Export complete. Metadata stripped by canvas export.');
      }
    } catch {
      setStatusMessage('Export failed. Try PNG or Max Safe mode.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setProgress(0), 900);
    }
  }

  async function handleShare() {
    if (!sharedFile) {
      setStatusMessage('Export first, then Share.');
      return;
    }

    if (navigator.share && isShareFileSupported(sharedFile)) {
      await navigator.share({
        files: [sharedFile],
        title: 'Aperture Frame Export'
      });
      return;
    }

    setStatusMessage('File sharing is not available here. Use Download and share from Photos/Files.');
    downloadFile(sharedFile);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-6">
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Aperture Frame</h1>
        <p className="mt-1 text-sm text-zinc-500">Classic borders for photos, optimized for iPhone exports.</p>
      </header>

      <section className="control-card p-3">
        <label className="mb-3 block cursor-pointer rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center text-sm font-medium text-zinc-600">
          Upload photo (JPG/PNG, HEIC if supported)
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void handleFileChange(file);
              }
            }}
          />
        </label>

        <div className={`overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 ${previewShadow ? 'shadow-2xl shadow-zinc-400/30' : ''}`}>
          {image ? (
            <canvas
              ref={previewRef}
              className="h-auto w-full touch-none"
              onPointerDown={() => cropMode && setDragging(true)}
              onPointerUp={() => setDragging(false)}
              onPointerLeave={() => setDragging(false)}
              onPointerMove={(event) => {
                if (!cropMode || !dragging) return;
                setPan((prev) => ({ x: prev.x + event.movementX, y: prev.y + event.movementY }));
              }}
            />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center text-sm text-zinc-500">Your framed preview appears here.</div>
          )}
        </div>
      </section>

      <section className="space-y-2 pb-4">
        <details open className="control-card p-4">
          <summary className="cursor-pointer text-base font-semibold">Border</summary>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(BORDER_PRESETS) as BorderPreset[]).map((value) => (
                <button
                  key={value}
                  className={`rounded-xl border px-3 py-2 text-sm ${preset === value ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white'}`}
                  onClick={() => setPreset(value)}
                >
                  {BORDER_PRESETS[value].label}
                </button>
              ))}
            </div>
            <label className="block text-sm">
              Border thickness: {thickness.toFixed(0)}%
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={thickness}
                onChange={(event) => setThickness(Number(event.target.value))}
                className="input-range mt-2"
              />
            </label>
            <Toggle label="Paper texture" checked={paperTexture} setChecked={setPaperTexture} />
            <Toggle label="Preview shadow only" checked={previewShadow} setChecked={setPreviewShadow} />
          </div>
        </details>

        <details className="control-card p-4">
          <summary className="cursor-pointer text-base font-semibold">Aspect</summary>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {ASPECTS.map((item) => (
                <button
                  key={item.value}
                  className={`rounded-xl border px-3 py-2 text-sm ${aspect === item.value ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white'}`}
                  onClick={() => setAspect(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Toggle label="Crop mode (drag preview to reposition)" checked={cropMode} setChecked={setCropMode} />
          </div>
        </details>

        <details className="control-card p-4" open>
          <summary className="cursor-pointer text-base font-semibold">Export</summary>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`rounded-xl border px-3 py-2 text-sm ${exportFormat === 'jpeg' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'}`}
                onClick={() => setExportFormat('jpeg')}
              >
                JPEG
              </button>
              <button
                className={`rounded-xl border px-3 py-2 text-sm ${exportFormat === 'png' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'}`}
                onClick={() => setExportFormat('png')}
              >
                PNG
              </button>
            </div>

            {exportFormat === 'jpeg' && (
              <label className="block text-sm">
                JPEG quality: {quality.toFixed(2)}
                <input
                  type="range"
                  min={0.7}
                  max={1}
                  step={0.01}
                  value={quality}
                  onChange={(event) => setQuality(Number(event.target.value))}
                  className="input-range mt-2"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                className={`rounded-xl border px-3 py-2 text-sm ${resolutionMode === 'original' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'}`}
                onClick={() => setResolutionMode('original')}
              >
                Max Quality (Original)
              </button>
              <button
                className={`rounded-xl border px-3 py-2 text-sm ${resolutionMode === 'safe' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'}`}
                onClick={() => setResolutionMode('safe')}
              >
                Max Safe
              </button>
            </div>

            <Toggle label="Strip metadata on export" checked={stripMetadata} setChecked={setStripMetadata} />

            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-xl bg-zinc-900 px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
                onClick={() => void handleExport()}
                disabled={!image || isExporting}
              >
                {isExporting ? 'Exporting…' : 'Download'}
              </button>
              <button
                className="rounded-xl border border-zinc-300 px-3 py-3 text-sm font-medium disabled:opacity-50"
                onClick={() => void handleShare()}
                disabled={!sharedFile || isExporting}
              >
                Share
              </button>
            </div>

            {progress > 0 && (
              <div>
                <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
                  <div className="h-full bg-zinc-900 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">{Math.round(progress)}%</p>
              </div>
            )}
          </div>
        </details>
      </section>

      {warning && <p className="text-sm text-amber-700">{warning}</p>}
      {statusMessage && <p className="text-sm text-zinc-600">{statusMessage}</p>}

      <a className="mt-auto self-center text-xs text-zinc-500 underline" href="#" onClick={(e) => e.preventDefault()}>
        About: All processing happens on your device. Photos are not uploaded.
      </a>
    </main>
  );
}

function Toggle({ label, checked, setChecked }: { label: string; checked: boolean; setChecked: (value: boolean) => void }) {
  return (
    <button
      className="flex w-full items-center justify-between rounded-xl border border-zinc-300 px-3 py-2 text-sm"
      onClick={() => setChecked(!checked)}
    >
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${checked ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  );
}

function drawFramedImage(
  canvas: HTMLCanvasElement,
  image: LoadedImage,
  layout: ReturnType<typeof computeFrameLayout>,
  options: {
    borderColor: string;
    cropMode: boolean;
    pan: { x: number; y: number };
    paperTexture: boolean;
    includeShadow: boolean;
  }
) {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('Canvas not available');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.borderColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (options.paperTexture) {
    ctx.save();
    ctx.globalAlpha = 0.045;
    const step = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 200));
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const shade = 235 + Math.floor(Math.random() * 20);
        ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        ctx.fillRect(x, y, step, step);
      }
    }
    ctx.clearRect(layout.contentX, layout.contentY, layout.contentWidth, layout.contentHeight);
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.contentY, layout.contentWidth, layout.contentHeight);
  ctx.clip();

  const oriented = getOrientedDimensions(image.width, image.height, image.orientation);

  if (options.cropMode) {
    const scale = Math.max(layout.contentWidth / oriented.width, layout.contentHeight / oriented.height);
    const drawWidth = oriented.width * scale;
    const drawHeight = oriented.height * scale;
    const drawX = layout.contentX + (layout.contentWidth - drawWidth) / 2 + options.pan.x;
    const drawY = layout.contentY + (layout.contentHeight - drawHeight) / 2 + options.pan.y;
    drawOriented(ctx, image, drawX, drawY, drawWidth, drawHeight);
  } else {
    drawOriented(ctx, image, layout.contentX, layout.contentY, layout.contentWidth, layout.contentHeight);
  }

  ctx.restore();
}

function drawOriented(
  ctx: CanvasRenderingContext2D,
  image: LoadedImage,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number
) {
  ctx.save();
  ctx.translate(x, y);
  if ([5, 6, 7, 8].includes(image.orientation)) {
    applyOrientationTransform(ctx, image.orientation, targetHeight, targetWidth);
    ctx.drawImage(image.drawable, 0, 0, image.width, image.height, 0, 0, targetHeight, targetWidth);
  } else {
    applyOrientationTransform(ctx, image.orientation, targetWidth, targetHeight);
    ctx.drawImage(image.drawable, 0, 0, image.width, image.height, 0, 0, targetWidth, targetHeight);
  }
  ctx.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to create export blob'));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadFile(file: File) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(file);
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
