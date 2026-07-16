/**
 * Same-photo comparison API route (visa renewals / photo re-requests).
 *
 * POST /api/compare-photo
 * Body: { image: string, submissionId: string, token: string }
 * Returns: PhotoCompareResult
 *
 * The photo on file is NEVER accepted from the client — the server reads
 * `existing_documents.photo.path` from the submission row (which TME Portal
 * wrote at renewal creation) and downloads it from storage with the
 * service-role client. Trusting a client-supplied "old photo" would let the
 * caller compare against anything and defeat the check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { comparePhotos, type ComparePhotoInput, type PhotoCompareResult } from '@/lib/photo-compare';
import { guardAiRoute } from '@/lib/ai-route-guard';
import { getSupabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-server';

// Claude caps images at ~5MB; the photo on file is served as-is (no server-side
// re-compression), so skip the check rather than fail on an oversized original.
const MAX_EXISTING_PHOTO_BYTES = 4.5 * 1024 * 1024;

function detectMediaType(buf: Buffer): ComparePhotoInput['mediaType'] | null {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  return null;
}

function parseDataUrl(image: string): ComparePhotoInput {
  const data = image.replace(/^data:[^;]+;base64,/, '');
  let mediaType: ComparePhotoInput['mediaType'] = 'image/jpeg';
  if (image.startsWith('data:image/png')) mediaType = 'image/png';
  else if (image.startsWith('data:image/gif')) mediaType = 'image/gif';
  else if (image.startsWith('data:image/webp')) mediaType = 'image/webp';
  else if (image.startsWith('data:application/pdf')) mediaType = 'application/pdf';
  return { data, mediaType };
}

export async function POST(request: NextRequest): Promise<NextResponse<PhotoCompareResult>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      { samePhoto: false, confidence: 0, infra: true },
      { status: guard.status }
    );
  }

  try {
    const { image } = guard.body as { image?: unknown };

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { samePhoto: false, confidence: 0, infra: true },
        { status: 400 }
      );
    }

    // Nothing to compare against — legacy submissions carry only {sha256,
    // filename} in existing_documents.photo; the path is what makes the
    // visual comparison possible.
    const photoEntry = (guard.row.existing_documents ?? {})['photo'] as
      | { path?: string }
      | undefined;
    if (!photoEntry?.path || typeof photoEntry.path !== 'string') {
      return NextResponse.json({ samePhoto: false, confidence: 0, skipped: true });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return NextResponse.json(
        { samePhoto: false, confidence: 0, infra: true },
        { status: 503 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: blob, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(photoEntry.path);

    if (downloadError || !blob) {
      console.error('[Compare Photo] Could not download photo on file:', downloadError);
      return NextResponse.json({ samePhoto: false, confidence: 0, infra: true });
    }

    const existingBuf = Buffer.from(await blob.arrayBuffer());
    const existingMediaType = detectMediaType(existingBuf);
    if (!existingMediaType || existingBuf.length > MAX_EXISTING_PHOTO_BYTES) {
      // Unrecognized format or too large for the vision API — skip rather
      // than block; the SHA-256 fast path and portal sync backstop remain.
      console.warn(
        `[Compare Photo] Skipping: existing photo ${existingMediaType ?? 'unknown format'}, ${existingBuf.length} bytes`
      );
      return NextResponse.json({ samePhoto: false, confidence: 0, infra: true });
    }

    const result = await comparePhotos(
      { data: existingBuf.toString('base64'), mediaType: existingMediaType },
      parseDataUrl(image)
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Photo compare API error:', error);
    return NextResponse.json(
      { samePhoto: false, confidence: 0, infra: true },
      { status: 500 }
    );
  }
}
