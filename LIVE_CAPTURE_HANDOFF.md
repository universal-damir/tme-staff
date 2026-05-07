# Handoff: Live Camera Capture with Framing Guide

## Goal
Add a "Take photo" path to the document upload flow on the staff onboarding form. The current path opens the OS file picker, then runs a manual-corner scanner modal on the result. The new path opens the camera **inside the web app** with a rectangular framing guide drawn on top of the live video, lets the user align the document inside that rectangle, and on tap-capture crops directly to the rectangle bounds — skipping the manual corner-drag step entirely. The current path stays as a fallback for users uploading pre-saved files.

## Stack & deployment
- Next.js 15.5.9 (App Router) + React 19, TypeScript, Tailwind v4
- Deployed to Netlify (HTTPS in place — `getUserMedia()` works)
- Target: iOS Safari (iPhone 13+) on 4G/5G in MENA, plus desktop
- Repo root: `/Users/damir/tme-staff`
- Current main: scanner + lightbox + 8-handle warp already shipped

## Where to plug in

The form lives in `src/components/EmployeeForm.tsx`. Document uploads flow through two reusable components:

- `src/components/UploadSlot.tsx` — used for passport pages, EID front/back, Pakistan ID front/back, previous UAE visa, additional passport page, visa supporting docs. Accepts both images and PDFs.
- `src/components/PhotoUpload.tsx` — used only for the ID Photo step (studio passport photo).

Both currently render a "click to upload" target that opens a hidden `<input type="file">`. Image picks then route through `src/components/DocumentScanner.tsx` via the `useScannerIntercept` hook (also exported from that file). PDFs bypass the scanner. Existing AI validation + extraction APIs run on whatever file the scanner returns (or the original file for PDFs).

## What to build (Tier 1)

### A new component: `LiveCapture.tsx`
- Opens a full-screen modal styled to match the existing scanner shell: `TME_COLORS.background` (`#f5f5f5`) backdrop, header with X/cancel, primary-blue capture button at the bottom. Reuse safe-area inset padding (top + bottom).
- Requests camera via `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })`. Pin to the rear camera; never the front (selfie cam).
- Renders the live `<video>` stream sized to fit the viewport.
- Draws a translucent rectangular guide on top, parameterized by an `aspectRatio` prop. The rectangle should be horizontally + vertically centered, occupy ~85% of the smaller viewport dimension, and have:
  - Solid amber border (`#FFB300`)
  - Optional grid corners (mock up like iOS Notes scanner)
  - Outside the rectangle: a 50% black overlay so users see "this is where the document goes"
- Bottom controls: a circular capture button (white with blue inner ring), an X to cancel, and a smaller "Choose from files" link as fallback (opens file picker if camera permission denied or not desired).
- On capture: draw the current video frame to a hidden canvas at full video resolution, crop to the rectangle's bounds (in image coords, not screen coords — account for the video's `videoWidth`/`videoHeight` vs the displayed size), encode to JPEG @ 0.92 quality, return as a `File`.
- Handle permission denied / no camera: surface a clear message and fall back to the file picker via the existing flow.
- Handle multiple cameras / orientation change: re-request stream on `orientationchange` if it makes the framing wrong.
- Stop the video stream on unmount, cancel, or capture (call `track.stop()` on every track to free the camera).

### Aspect ratios to support per document type
- Passport spread (cover, inside pages, additional page): **1.4:1 horizontal**
- Emirates ID (front, back): **1.586:1 horizontal** (ID-1 / credit card)
- Pakistan ID (front, back): **1.586:1 horizontal**
- Previous UAE visa: **0.71:1 vertical** (A6-ish, passport-page proportions)
- Visa supporting document (employment visa, etc.): **0.71:1 vertical**

Pass aspect via prop: `aspectRatio: number` (width / height). The component itself doesn't need to know which doc it is.

### Wiring into existing slots
- In `EmployeeForm.tsx`, each `UploadSlot` and `PhotoUpload` should expose a new "Take photo" button alongside the existing "Upload" button. Tapping "Take photo" opens `LiveCapture` with the appropriate aspect ratio. On confirm, the captured `File` flows into the *exact same* `onUpload` handler that the file picker already uses (the named handlers in `EmployeeForm.tsx`: `handleCoverUpload`, `handleInsideUpload`, `handleEidFrontUpload`, etc.).
- **Important**: skip the existing scanner modal for live-captured images. The framing guide is the corner placement. Add a new prop or branch to bypass `useScannerIntercept` for these.
- File picker path stays unchanged. Image files from the picker still go through the existing manual-corner scanner.

### File output requirements
- Format: JPEG @ 0.92 quality
- Long side capped at 2400 px (downscale if camera resolution exceeds this)
- Filename: `${docType}-captured-${Date.now()}.jpg`
- MIME type set correctly (`image/jpeg`)

## Non-goals (do NOT implement)
- **Auto-snap when document detected.** That requires per-frame edge detection, which means OpenCV.js or similar — an 8 MB WASM dependency we explicitly removed. Manual capture button only.
- **Live perspective correction.** The framing guide is the correction. If the user tilts the phone, the resulting image will be slightly skewed; that's acceptable.
- **Replacing the existing manual-corner scanner.** It stays for file-picker uploads of pre-saved images and as a fallback if a user wants fine adjustment after live capture (could be added later, not now).
- **Front-facing camera (selfie) capture.** Pin `facingMode: 'environment'`. The ID Photo step has a separate "self-taken photos will be rejected" rule already.
- **OpenCV.js, jscanify, TensorFlow.js, ONNX Runtime, or any WASM dependency.** Pure JS / Canvas API only.

## Constraints
- iOS Safari sometimes glitches `getUserMedia` in PWA / Add-to-Home-Screen mode. Detect and fall back to file picker if `getUserMedia` rejects.
- Don't autoplay audio. `audio: false` on the constraints.
- The `<video>` element needs `playsInline` and `muted` attributes set or iOS won't render the stream inline.
- Stream must be torn down on every exit path or the camera LED stays on.
- No new npm dependencies needed — vanilla `getUserMedia` + Canvas API only.

## Acceptance criteria
1. On iPhone 13 in Safari over 5G, tapping "Take photo" on the passport-cover slot opens the live camera within ~500 ms (after permission grant).
2. The rectangle guide is sized for passport-spread aspect (1.4:1) and centered.
3. Tapping capture produces a JPEG that goes through the existing `handleCoverUpload`, which already validates with Claude and uploads to Supabase. Same downstream behaviour as a file-picker upload.
4. Cancelling, capturing, or navigating away stops the camera (LED off).
5. Permission denial shows a clear inline message and a "Use file picker instead" button that opens the existing input.
6. Works on the 8 doc slots: passport cover, passport inside pages, passport additional page, EID front, EID back, Pakistan ID front, Pakistan ID back, previous UAE visa. Plus the ID Photo slot. Each gets the right aspect ratio.
7. PDFs and existing-file uploads bypass the camera entirely and use the current file-picker flow.

## Open question for the implementing agent
The form already has logic to suppress the `DocumentScanner` modal for non-image files. For live-captured images, you can choose to (a) skip the scanner entirely (recommended — the framing guide IS the scanner), or (b) still show it but with corners pre-placed at the rectangle bounds, in case the user wants fine adjustment. Document which you chose and why.

## Quick test path
1. New onboarding submission link, navigate to passport-cover step on iPhone Safari
2. Tap "Take photo"
3. Grant camera permission
4. Frame a passport spread inside the rectangle, tap capture
5. Should see the existing AI validation run on the captured image
6. Tap remove, tap "Upload" instead → existing file-picker flow with manual scanner
