# Aperture Frame

Aperture Frame is an iPhone-first, client-side web app that adds gallery-style borders and exports photos at the highest reliable quality for iOS Safari.

## Highlights

- 100% on-device processing (no uploads, no auth, no database).
- Elegant border presets:
  - Classic (`#ffffff`)
  - Warm (`#f7f4ee`)
  - Noir (`#000000`)
- Border thickness (0–30% of short edge) and aspect padding presets:
  - Original
  - 4:5
  - 1:1
  - 9:16
- Optional crop mode (drag/pan in frame).
- Optional subtle paper texture and preview-only shadow.

## Pro export presets

- **Instagram Crisp (Recommended)**
  - JPEG quality 0.92
  - Max Safe
  - Strip metadata ON
- **Ultra JPEG (Fuji-safe)**
  - JPEG quality 0.98
  - Max Quality (Original) with auto fallback to Max Safe on iOS memory limits
  - Strip metadata ON
- **Lossless PNG (No downgrade)**
  - PNG export
  - Supports Safe/Original modes
  - Includes note that file size may be large

Manual controls are available under **Advanced** in the Export section.

## Watermark + EXIF line tools

- **Watermark section** (off by default)
  - Text watermark
  - Opacity (0–20%, default 8%)
  - Size, position (BR/BL/Center), and margin controls
  - Watermark is rendered into exports only when enabled
- **EXIF line section** (off by default)
  - Extracts aperture, shutter, ISO, focal length, camera make/model, and lens model when available
  - Templates:
    - `ƒ/{aperture} • {shutter} • ISO {iso}`
    - `{focal}mm • ƒ/{aperture} • {shutter} • ISO {iso}`
    - `{camera} • {lens}`
  - Font style (Clean/Mono), size, alignment, and bottom placement controls
  - Auto text color selected from border brightness
- GPS is never displayed.

## iOS-safe export behavior

Aperture Frame keeps exports reliable on iPhone Safari by:

- Checking safe canvas thresholds before rendering.
- Attempting original-resolution export when selected.
- Automatically retrying in **Max Safe** if memory/canvas limits are hit.
- Showing progress and disabling export/share buttons while processing.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Browser APIs (File, Blob, Canvas, Web Share API, createImageBitmap where available)

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Deploy to Netlify (iPhone-only workflow)

1. Push the repository to GitHub.
2. In Netlify: **Add new site → Import an existing project**.
3. Select the repo.
4. Build settings:
   - Build command: `npm run build`
   - Publish directory: `.next`
5. Deploy.
6. Open on iPhone Safari.

## Add to Home Screen (iPhone)

1. Open your deployed URL in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Launch Aperture Frame from your home screen.

## Privacy

**All processing happens on your device. Photos are not uploaded.**

By default, exports are generated via canvas and strip EXIF metadata (including GPS).
