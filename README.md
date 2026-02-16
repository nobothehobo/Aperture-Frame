# Aperture Frame

Aperture Frame is an iPhone-first, client-only web app for adding elegant classic borders to photos and exporting at the highest practical quality directly in Safari.

## Features

- **Entirely on-device processing** (no uploads, no auth, no database).
- **Classic border presets**
  - Classic (pure white)
  - Warm (`#f7f4ee`)
  - Noir (black)
- Border thickness slider (0%–30% of short edge).
- Aspect padding presets (no crop by default):
  - Original
  - 4:5
  - 1:1
  - 9:16
- Optional crop mode with drag/pan repositioning.
- Optional subtle paper texture on border.
- Optional preview-only shadow.
- Export:
  - JPEG (quality 0.7–1.0, default 0.92)
  - PNG
  - Max Quality (Original)
  - Max Safe (auto-safe resolution)
- iOS-safe export fallback:
  - Warns when Original likely exceeds Safari limits.
  - Auto-retries in Max Safe mode if Original fails.
- Web Share API integration with fallback instructions.
- EXIF orientation handling for correct visual output.
- Metadata stripping toggle (default ON).

## Tech stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Browser APIs: File, Blob, Canvas, Web Share API, createImageBitmap (when available)

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Netlify (iPhone-only workflow)

1. Push this repo to GitHub.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Select your GitHub repo.
4. Build settings:
   - Build command: `npm run build`
   - Publish directory: `.next`
5. Deploy.
6. Open the deployed URL on your iPhone Safari.

> Next.js support on Netlify is automatic for standard App Router projects.

## Add to Home Screen (iPhone)

1. Open your deployed URL in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Launch Aperture Frame from the home screen for app-like usage.

## Notes on iOS export limits and Max Safe mode

Mobile Safari can fail on very large canvases due to memory/texture limits. Aperture Frame addresses this by:

- Using conservative safe thresholds before export.
- Warning when Original is likely too large.
- Auto-falling back to **Max Safe** if Original export fails.
- Showing a clear message when fallback was required.

The app aims for original resolution first, then safely scales down only when necessary.

## Privacy

**All processing happens on your device. Photos are not uploaded.**

By default, exports are generated from a canvas pipeline, which strips EXIF metadata (including GPS).

## Netlify compatibility

- No backend runtime.
- No database.
- No auth.
- Fully client-side photo processing.
- Static-friendly architecture.
