import { describe, it, expect } from 'vitest';
import { buildPdfFromJpegs } from './jpeg-pdf';
import { countPdfPagesServer } from './pdf-page-count-server';

// Smallest valid-looking JPEG bytes: SOI + EOI. The writer embeds bytes as-is,
// so the structure checks below do not need a real image.
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

describe('buildPdfFromJpegs', () => {
  it('writes a PDF with one page per JPEG', () => {
    const pdf = buildPdfFromJpegs([
      { bytes: FAKE_JPEG, width: 1200, height: 1700 },
      { bytes: FAKE_JPEG, width: 800, height: 600 },
    ]);
    const text = latin1(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 1200 1700]');
    expect(text).toContain('/MediaBox [0 0 800 600]');
    // The AI route guard counts pages this way: the page count must survive.
    expect(countPdfPagesServer(Buffer.from(pdf).toString('base64'))).toBe(2);
  });

  it('points every xref entry at its object', () => {
    const pdf = buildPdfFromJpegs([{ bytes: FAKE_JPEG, width: 10, height: 20 }]);
    const text = latin1(pdf);
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).match(/^(\d{10}) 00000 n $/gm)!;
    expect(entries).toHaveLength(5); // catalog, pages, page, image, content
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('embeds the JPEG bytes unchanged with the right length', () => {
    const pdf = buildPdfFromJpegs([{ bytes: FAKE_JPEG, width: 10, height: 20 }]);
    const text = latin1(pdf);
    expect(text).toContain(`/Filter /DCTDecode /Length ${FAKE_JPEG.length}`);
    expect(text).toContain(latin1(FAKE_JPEG));
  });

  it('refuses an empty page list', () => {
    expect(() => buildPdfFromJpegs([])).toThrow();
  });
});
