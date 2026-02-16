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
import { ExifData, extractExifData, renderExifLine } from '@/lib/exif';

type BorderPreset = 'classic' | 'warm' | 'noir';
type ExportFormat = 'jpeg' | 'png';
type ResolutionMode = 'original' | 'safe';
type ExportPreset = 'instagram' | 'ultra' | 'png';
type WatermarkPosition = 'br' | 'bl' | 'center';
type ExifTemplate = 'full' | 'basic' | 'gear' | 'fuji';
type ExifFont = 'clean' | 'mono';
type ExifAlignment = 'left' | 'center' | 'right';
type ExifPosition = 'bottom-center' | 'bottom-right';

type LoadedImage = {
  drawable: CanvasImageSource;
  width: number;
  height: number;
  orientation: number;
  fileName: string;
  sourceFile: File;
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

const EXIF_TEMPLATES: Record<ExifTemplate, string> = {
  full: '{focal}mm • ƒ/{aperture} • {shutter} • ISO {iso}',
  basic: 'ƒ/{aperture} • {shutter} • ISO {iso}',
  gear: '{camera} • {lens}',
  fuji: '{lens} • f/{aperture} • {shutter} • ISO {iso}'
};

function isShareFileSupported(file: File): boolean {
  return !!navigator.canShare && navigator.canShare({ files: [file] });
}

function isLikelyJpeg(file: File): boolean {
  return file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(file.name);
}

function applyExportPreset(preset: ExportPreset): { exportFormat: ExportFormat; quality: number; resolutionMode: ResolutionMode; stripMetadata: boolean } {
  if (preset === 'ultra') {
    return { exportFormat: 'jpeg', quality: 0.99, resolutionMode: 'original', stripMetadata: true };
  }
  if (preset === 'png') {
    return { exportFormat: 'png', quality: 1, resolutionMode: 'safe', stripMetadata: true };
  }
  return { exportFormat: 'jpeg', quality: 0.92, resolutionMode: 'safe', stripMetadata: true };
}

export default function HomePage() {
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [exifData, setExifData] = useState<ExifData>({});

  const [preset, setPreset] = useState<BorderPreset>('classic');
  const [thickness, setThickness] = useState<number>(8);
  const [aspect, setAspect] = useState<AspectPreset>('original');
  const [cropMode, setCropMode] = useState(false);
  const [paperTexture, setPaperTexture] = useState(false);
  const [previewShadow, setPreviewShadow] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('© Aperture Frame');
  const [watermarkOpacity, setWatermarkOpacity] = useState(8);
  const [watermarkSize, setWatermarkSize] = useState(16);
  const [watermarkMargin, setWatermarkMargin] = useState(20);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>('br');

  const [exifEnabled, setExifEnabled] = useState(false);
  const [exifTemplate, setExifTemplate] = useState<ExifTemplate>('full');
  const [exifFont, setExifFont] = useState<ExifFont>('clean');
  const [exifSize, setExifSize] = useState(14);
  const [exifAlignment, setExifAlignment] = useState<ExifAlignment>('center');
  const [exifPosition, setExifPosition] = useState<ExifPosition>('bottom-center');
  const [showExifDebug, setShowExifDebug] = useState(false);

  const [exportPreset, setExportPreset] = useState<ExportPreset>('instagram');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>('safe');
  const [stripMetadata, setStripMetadata] = useState(true);

  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [sharedFile, setSharedFile] = useState<File | null>(null);

  const watermarkNeedsReencode = watermarkEnabled && resolutionMode === 'original' && exportFormat === 'jpeg' && !stripMetadata;

  const orientedSize = useMemo(() => {
    if (!image) return null;
    return getOrientedDimensions(image.width, image.height, image.orientation);
  }, [image]);

  const layout = useMemo(() => {
    if (!orientedSize) return null;
    return computeFrameLayout(orientedSize.width, orientedSize.height, thickness, aspect);
  }, [orientedSize, thickness, aspect]);

  const subtleTip = useMemo(() => {
    if (!layout || resolutionMode !== 'original') return '';
    const safeScale = computeSafeScale(layout.canvasWidth, layout.canvasHeight);
    return safeScale < 0.999 ? 'Tip: Original can hit iPhone memory limits on very large files. We auto-fallback to Max Safe if needed.' : '';
  }, [layout, resolutionMode]);

  useEffect(() => {
    const mapped = applyExportPreset(exportPreset);
    setExportFormat(mapped.exportFormat);
    setQuality(mapped.quality);
    setResolutionMode(mapped.resolutionMode);
    setStripMetadata(mapped.stripMetadata);
  }, [exportPreset]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [cropMode, aspect, thickness]);

  useEffect(() => {
    if (!image || !layout || !previewRef.current) return;

    const canvas = previewRef.current;
    const maxPreviewEdge = 1200;
    const scale = Math.min(1, maxPreviewEdge / Math.max(layout.canvasWidth, layout.canvasHeight));
    canvas.width = Math.max(1, Math.round(layout.canvasWidth * scale));
    canvas.height = Math.max(1, Math.round(layout.canvasHeight * scale));

    drawFramedImage(
      canvas,
      image,
      {
        ...layout,
        contentX: layout.contentX * scale,
        contentY: layout.contentY * scale,
        contentWidth: layout.contentWidth * scale,
        contentHeight: layout.contentHeight * scale
      },
      {
        borderColor: BORDER_PRESETS[preset].color,
        cropMode,
        pan,
        paperTexture,
        drawShadow: previewShadow,
        watermark: null,
        exifLine: null
      }
    );
  }, [image, layout, preset, pan, cropMode, paperTexture, previewShadow]);

  async function handleFileChange(file: File) {
    setStatusMessage('Decoding photo…');
    setSharedFile(null);

    const buffer = await file.arrayBuffer();
    const orientation = parseExifOrientation(buffer);
    const parsedExif = await extractExifData(file);
    setExifData(parsedExif);

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
      sourceFile: file
    });
    if (parsedExif.unavailable) {
      setStatusMessage('Ready. Metadata unavailable for this file in current browser.');
      return;
    }
    setStatusMessage('Ready. Fine-tune your frame and export.');
  }

  async function renderExport(mode: ResolutionMode): Promise<File> {
    if (!image || !layout) throw new Error('No image loaded');

    const canReuseOriginal =
      mode === 'original' &&
      exportFormat === 'jpeg' &&
      isLikelyJpeg(image.sourceFile) &&
      !stripMetadata &&
      thickness === 0 &&
      aspect === 'original' &&
      !paperTexture &&
      !cropMode &&
      pan.x === 0 &&
      pan.y === 0 &&
      !watermarkEnabled &&
      !exifEnabled;

    if (canReuseOriginal) {
      setProgress(100);
      return image.sourceFile;
    }

    setProgress(15);
    const safeScale = computeSafeScale(layout.canvasWidth, layout.canvasHeight);
    const appliedScale = mode === 'safe' ? safeScale : 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(layout.canvasWidth * appliedScale));
    canvas.height = Math.max(1, Math.floor(layout.canvasHeight * appliedScale));

    const exifLine = exifEnabled ? renderExifLine(exifData, EXIF_TEMPLATES[exifTemplate]) : null;

    setProgress(35);
    drawFramedImage(
      canvas,
      image,
      {
        ...layout,
        contentX: layout.contentX * appliedScale,
        contentY: layout.contentY * appliedScale,
        contentWidth: layout.contentWidth * appliedScale,
        contentHeight: layout.contentHeight * appliedScale
      },
      {
        borderColor: BORDER_PRESETS[preset].color,
        cropMode,
        pan,
        paperTexture,
        drawShadow: false,
        watermark: watermarkEnabled
          ? {
              text: watermarkText,
              opacity: watermarkOpacity / 100,
              size: watermarkSize * appliedScale,
              margin: watermarkMargin * appliedScale,
              position: watermarkPosition
            }
          : null,
        exifLine: exifLine
          ? {
              text: exifLine,
              size: exifSize * appliedScale,
              font: exifFont,
              position: exifPosition,
              alignment: exifAlignment,
              color: autoTextColor(BORDER_PRESETS[preset].color)
            }
          : null
      }
    );

    setProgress(72);
    const mime = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, exportFormat === 'jpeg' ? quality : undefined);
    const extension = exportFormat === 'png' ? 'png' : 'jpg';

    setProgress(100);
    return new File([blob], `${image.fileName}-aperture-frame.${extension}`, { type: mime });
  }

  async function handleExport() {
    if (!image) return;
    setIsExporting(true);
    setProgress(5);
    setStatusMessage('Preparing export…');

    try {
      let file: File;
      try {
        file = await renderExport(resolutionMode);
      } catch {
        if (resolutionMode === 'original') {
          setStatusMessage('Original export hit an iPhone/browser memory limit. Exported at Max Safe size instead.');
          file = await renderExport('safe');
        } else {
          throw new Error('safe export failed');
        }
      }

      setSharedFile(file);
      downloadFile(file);

      if (exportFormat === 'png') {
        setStatusMessage('PNG exported. Note: PNG files can be very large.');
      } else if (!stripMetadata) {
        setStatusMessage('Export complete. Metadata preservation may vary by browser.');
      } else if (!statusMessage.includes('memory limit')) {
        setStatusMessage('Export complete. Metadata stripped.');
      }
    } catch {
      setStatusMessage('Export failed. Try Max Safe or PNG.');
    } finally {
      setIsExporting(false);
      setTimeout(() => setProgress(0), 800);
    }
  }

  async function handleShare() {
    if (!sharedFile) {
      setStatusMessage('Export first, then Share.');
      return;
    }

    if (navigator.share && isShareFileSupported(sharedFile)) {
      await navigator.share({ files: [sharedFile], title: 'Aperture Frame export' });
      return;
    }

    setStatusMessage('Share is unavailable here. Downloaded file is ready in Files/Photos.');
    downloadFile(sharedFile);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col bg-zinc-50 px-4 pt-5 pb-32">
      <header className="mb-5 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-zinc-400">Mobile Darkroom</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900">Aperture Frame</h1>
        <p className="mt-1.5 text-sm text-zinc-500">Professional borders, polished typography, and iPhone-safe exports.</p>
      </header>

      <section className="control-card mb-4 p-3.5">
        <label className="mb-3 block cursor-pointer rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center text-sm font-medium text-zinc-600">
          Upload photo (JPG/PNG, HEIC if Safari supports it)
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileChange(file);
            }}
          />
        </label>

        <div className={`overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 ${previewShadow ? 'shadow-xl shadow-zinc-400/20' : ''}`}>
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
            <div className="flex aspect-[3/4] items-center justify-center text-sm text-zinc-500">Your polished preview appears here.</div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <details open className="control-card p-5">
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
            <label className="text-sm">
              Border thickness: {thickness}%
              <input type="range" min={0} max={30} step={1} value={thickness} onChange={(event) => setThickness(Number(event.target.value))} className="input-range mt-2" />
            </label>
            <Toggle label="Paper texture" checked={paperTexture} onToggle={() => setPaperTexture((v) => !v)} />
            <Toggle label="Preview shadow only" checked={previewShadow} onToggle={() => setPreviewShadow((v) => !v)} />
          </div>
        </details>

        <details className="control-card p-5">
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
            <Toggle label="Crop mode (drag to reposition)" checked={cropMode} onToggle={() => setCropMode((v) => !v)} />
          </div>
        </details>

        <details className="control-card p-5">
          <summary className="cursor-pointer text-base font-semibold">Watermark</summary>
          <div className="mt-3 space-y-3">
            <Toggle label="Enable watermark" checked={watermarkEnabled} onToggle={() => setWatermarkEnabled((v) => !v)} />
            {watermarkNeedsReencode && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Watermark requires re-encoding. Switch to Ultra JPEG or PNG.</p>
            )}
            {watermarkEnabled && (
              <>
                <label className="block text-sm">
                  Text watermark
                  <input className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" value={watermarkText} onChange={(event) => setWatermarkText(event.target.value)} />
                </label>
                <Range label={`Opacity: ${watermarkOpacity}%`} min={0} max={20} step={1} value={watermarkOpacity} onChange={setWatermarkOpacity} />
                <Range label={`Size: ${watermarkSize}px`} min={10} max={34} step={1} value={watermarkSize} onChange={setWatermarkSize} />
                <Range label={`Margin: ${watermarkMargin}px`} min={4} max={48} step={1} value={watermarkMargin} onChange={setWatermarkMargin} />
                <div className="grid grid-cols-3 gap-2">
                  <Choice label="BR" active={watermarkPosition === 'br'} onClick={() => setWatermarkPosition('br')} />
                  <Choice label="BL" active={watermarkPosition === 'bl'} onClick={() => setWatermarkPosition('bl')} />
                  <Choice label="Center" active={watermarkPosition === 'center'} onClick={() => setWatermarkPosition('center')} />
                </div>
              </>
            )}
          </div>
        </details>

        <details className="control-card p-5">
          <summary className="cursor-pointer text-base font-semibold">EXIF Caption</summary>
          <div className="mt-3 space-y-3">
            <Toggle label="Enable EXIF Caption" checked={exifEnabled} onToggle={() => setExifEnabled((v) => !v)} />
            {exifData.unavailable && <p className="rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-600">Metadata unavailable.</p>}
            {exifEnabled && (
              <>
                <p className="rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-500">Caption is rendered in the border below the photo by default.</p>
                <select className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm" value={exifTemplate} onChange={(event) => setExifTemplate(event.target.value as ExifTemplate)}>
                  <option value="full">{"{focal}mm • ƒ/{aperture} • {shutter} • ISO {iso}"}</option>
                  <option value="basic">{"ƒ/{aperture} • {shutter} • ISO {iso}"}</option>
                  <option value="gear">{"{camera} • {lens}"}</option>
                  <option value="fuji">{"XF 23mm f/1.4 • f/2 • 1/250 • ISO 400"}</option>
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <Choice label="Clean" active={exifFont === 'clean'} onClick={() => setExifFont('clean')} />
                  <Choice label="Mono" active={exifFont === 'mono'} onClick={() => setExifFont('mono')} />
                </div>
                <Range label={`Size: ${exifSize}px`} min={10} max={28} step={1} value={exifSize} onChange={setExifSize} />
                <div className="grid grid-cols-3 gap-2">
                  <Choice label="Left" active={exifAlignment === 'left'} onClick={() => setExifAlignment('left')} />
                  <Choice label="Center" active={exifAlignment === 'center'} onClick={() => setExifAlignment('center')} />
                  <Choice label="Right" active={exifAlignment === 'right'} onClick={() => setExifAlignment('right')} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Choice label="Bottom center" active={exifPosition === 'bottom-center'} onClick={() => setExifPosition('bottom-center')} />
                  <Choice label="Bottom right" active={exifPosition === 'bottom-right'} onClick={() => setExifPosition('bottom-right')} />
                </div>
              </>
            )}
          </div>
        </details>

        <details open className="control-card p-5">
          <summary className="cursor-pointer text-base font-semibold">Export</summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <Choice
                label="Instagram Crisp (Recommended)"
                active={exportPreset === 'instagram'}
                onClick={() => setExportPreset('instagram')}
                description="JPEG 0.92 • Max Safe • Strip metadata"
              />
              <Choice
                label="Ultra JPEG (Fuji-safe)"
                active={exportPreset === 'ultra'}
                onClick={() => setExportPreset('ultra')}
                description="JPEG 0.99 • Original with auto fallback"
              />
              <Choice
                label="Lossless PNG (No downgrade)"
                active={exportPreset === 'png'}
                onClick={() => setExportPreset('png')}
                description="PNG • supports Safe/Original • larger files"
              />
            </div>

            {subtleTip && <p className="rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-500">{subtleTip}</p>}

            <details className="rounded-xl border border-zinc-200 p-3">
              <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Choice label="JPEG" active={exportFormat === 'jpeg'} onClick={() => setExportFormat('jpeg')} />
                  <Choice label="PNG" active={exportFormat === 'png'} onClick={() => setExportFormat('png')} />
                </div>

                {exportFormat === 'jpeg' && <Range label={`JPEG quality: ${quality.toFixed(2)}`} min={0.7} max={1} step={0.01} value={quality} onChange={setQuality} />}

                <div className="grid grid-cols-2 gap-2">
                  <Choice label="Max Quality (Original)" active={resolutionMode === 'original'} onClick={() => setResolutionMode('original')} />
                  <Choice label="Max Safe" active={resolutionMode === 'safe'} onClick={() => setResolutionMode('safe')} />
                </div>

                <Toggle label="Strip metadata on export" checked={stripMetadata} onToggle={() => setStripMetadata((v) => !v)} />
                {!stripMetadata && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">For best JPEG preservation, if no visual changes are applied and Original is selected, export can reuse the source file.</p>
                )}
                <Toggle label="Debug EXIF values" checked={showExifDebug} onToggle={() => setShowExifDebug((v) => !v)} />
                {showExifDebug && (
                  <pre className="max-h-48 overflow-auto rounded-xl bg-zinc-950 px-3 py-2 text-[11px] leading-5 text-zinc-100">
                    {JSON.stringify(exifData.debug ?? { status: exifData.unavailable ? 'Metadata unavailable' : 'No EXIF tags found' }, null, 2)}
                  </pre>
                )}
              </div>
            </details>
          </div>
        </details>
      </section>

      {statusMessage && <p className="mt-3 text-sm text-zinc-600">{statusMessage}</p>}
      <a className="mt-4 self-center text-xs text-zinc-500 underline" href="#" onClick={(e) => e.preventDefault()}>
        About: All processing happens on your device. Photos are not uploaded.
      </a>

      <section className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 p-3 shadow-[0_-12px_30px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
          <select
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
            value={exportPreset}
            onChange={(event) => setExportPreset(event.target.value as ExportPreset)}
            disabled={isExporting}
          >
            <option value="instagram">Instagram Crisp (Recommended)</option>
            <option value="ultra">Ultra JPEG (Fuji-safe)</option>
            <option value="png">Lossless PNG (No downgrade)</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-xl bg-zinc-900 px-3 py-3 text-sm font-medium text-white disabled:opacity-50" onClick={() => void handleExport()} disabled={!image || isExporting}>
              {isExporting ? 'Exporting…' : 'Download'}
            </button>
            <button className="rounded-xl border border-zinc-300 px-3 py-3 text-sm font-medium disabled:opacity-50" onClick={() => void handleShare()} disabled={!sharedFile || isExporting}>
              Share
            </button>
          </div>
          {progress > 0 && (
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-200">
                <div className="h-full bg-zinc-900 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Toggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button className="flex w-full items-center justify-between rounded-xl border border-zinc-300 px-3 py-2 text-sm" onClick={onToggle}>
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${checked ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

function Choice({ label, active, onClick, description }: { label: string; active: boolean; onClick: () => void; description?: string }) {
  return (
    <button className={`rounded-xl border px-3 py-2 text-left text-sm ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700'}`} onClick={onClick}>
      <div>{label}</div>
      {description && <div className={`mt-0.5 text-xs ${active ? 'text-zinc-200' : 'text-zinc-500'}`}>{description}</div>}
    </button>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-sm">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} className="input-range mt-2" onChange={(event) => onChange(Number(event.target.value))} />
    </label>
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
    drawShadow: boolean;
    watermark: { text: string; opacity: number; size: number; margin: number; position: WatermarkPosition } | null;
    exifLine: { text: string; size: number; font: ExifFont; alignment: ExifAlignment; position: ExifPosition; color: string } | null;
  }
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (options.drawShadow) {
    ctx.shadowBlur = 16;
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
  }
  ctx.fillStyle = options.borderColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.shadowBlur = 0;

  if (options.paperTexture) {
    ctx.save();
    ctx.globalAlpha = 0.04;
    const step = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 180));
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const shade = 236 + Math.floor(Math.random() * 16);
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
    drawOriented(
      ctx,
      image,
      layout.contentX + (layout.contentWidth - drawWidth) / 2 + options.pan.x,
      layout.contentY + (layout.contentHeight - drawHeight) / 2 + options.pan.y,
      drawWidth,
      drawHeight
    );
  } else {
    drawOriented(ctx, image, layout.contentX, layout.contentY, layout.contentWidth, layout.contentHeight);
  }

  ctx.restore();

  if (options.exifLine) {
    drawBorderText(ctx, layout, options.exifLine.text, {
      position: options.exifLine.position === 'bottom-right' ? 'br' : 'center',
      margin: options.exifLine.size * 1.25,
      opacity: 0.8,
      size: options.exifLine.size,
      color: options.exifLine.color,
      fontFamily: options.exifLine.font === 'mono' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : '-apple-system, SF Pro Text, Inter, sans-serif',
      alignment: options.exifLine.alignment
    });
  }

  if (options.watermark?.text.trim()) {
    drawBorderText(ctx, layout, options.watermark.text, {
      position: options.watermark.position,
      margin: options.watermark.margin,
      opacity: options.watermark.opacity,
      size: options.watermark.size,
      color: autoTextColor(options.borderColor),
      fontFamily: '-apple-system, SF Pro Display, serif',
      alignment: options.watermark.position === 'bl' ? 'left' : options.watermark.position === 'br' ? 'right' : 'center'
    });
  }
}

function drawBorderText(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof computeFrameLayout>,
  text: string,
  options: { position: WatermarkPosition; margin: number; opacity: number; size: number; color: string; fontFamily: string; alignment: ExifAlignment }
) {
  const bottomSpace = ctx.canvas.height - (layout.contentY + layout.contentHeight);
  const topSpace = layout.contentY;
  const baseY = bottomSpace >= options.size + options.margin ? ctx.canvas.height - options.margin : Math.max(options.size + options.margin, topSpace - options.margin);

  let x = ctx.canvas.width / 2;
  if (options.position === 'bl') x = options.margin;
  if (options.position === 'br') x = ctx.canvas.width - options.margin;

  ctx.save();
  ctx.globalAlpha = options.opacity;
  ctx.fillStyle = options.color;
  ctx.font = `${Math.round(options.size)}px ${options.fontFamily}`;
  const effectiveAlign = options.position === 'center' ? 'center' : options.position === 'br' ? 'right' : options.position === 'bl' ? 'left' : options.alignment;
  ctx.textAlign = effectiveAlign as CanvasTextAlign;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, baseY);
  ctx.restore();
}

function drawOriented(ctx: CanvasRenderingContext2D, image: LoadedImage, x: number, y: number, targetWidth: number, targetHeight: number) {
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

function autoTextColor(hex: string): string {
  const normalized = hex.replace('#', '');
  const raw = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 145 ? 'rgba(34,34,34,0.95)' : 'rgba(240,240,240,0.95)';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to generate file'));
        return;
      }
      resolve(blob);
    }, type, quality);
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
