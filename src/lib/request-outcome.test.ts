import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestJson, failureMessage, FAILURE_MESSAGES } from './request-outcome';
import { callAiCheck } from './ai-check-client';

vi.mock('./client-error-log', () => ({ reportClientFailure: vi.fn() }));
vi.mock('./ai-payload', () => ({
  prepareFileForAI: vi.fn(async (d: string) => d),
  FileTooLargeForCheckError: class extends Error {},
}));

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJson', () => {
  it('returns the JSON on success', async () => {
    mockFetch(async () => new Response(JSON.stringify({ path: 'a' }), { status: 200 }));
    const out = await requestJson('/x', { method: 'POST' });
    expect(out).toEqual({ ok: true, status: 200, data: { path: 'a' } });
  });

  it('names a dropped connection "offline"', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await requestJson('/x', { method: 'POST' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe('offline');
      expect(failureMessage(out)).toBe(FAILURE_MESSAGES.offline);
    }
  });

  it("names Netlify's non-JSON 413 page \"too_large\" (Jesper's case)", async () => {
    mockFetch(async () => new Response('<html>Payload Too Large</html>', { status: 413 }));
    const out = await requestJson('/x', { method: 'POST' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('too_large');
  });

  it.each([
    [429, 'busy'],
    [409, 'form_closed'],
    [410, 'form_closed'],
    [403, 'link_invalid'],
    [404, 'link_invalid'],
    [502, 'timeout'],
    [504, 'timeout'],
    [415, 'wrong_file'],
    [500, 'server_error'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    mockFetch(async () => new Response(JSON.stringify({ error: 'x' }), { status }));
    const out = await requestJson('/x', { method: 'POST' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe(kind);
  });

  it("shows the server's own sentence for a 422, never a raw code", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ error: 'This file has 3 pages. Please upload only a single page.' }), {
          status: 422,
        })
    );
    const out = await requestJson('/x', { method: 'POST' });
    if (out.ok) throw new Error('expected failure');
    expect(failureMessage(out)).toBe('This file has 3 pages. Please upload only a single page.');

    mockFetch(async () => new Response(JSON.stringify({ error: 'invalid_slot' }), { status: 400 }));
    const coded = await requestJson('/x', { method: 'POST' });
    if (coded.ok) throw new Error('expected failure');
    expect(failureMessage(coded)).toBe(FAILURE_MESSAGES.rejected);
  });

  it('treats an unreadable 200 as a server error, not a success', async () => {
    mockFetch(async () => new Response('<html>oops</html>', { status: 200 }));
    const out = await requestJson('/x', { method: 'POST' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('server_error');
  });
});

describe('callAiCheck', () => {
  it('never passes a check that could not run (200 + infra)', async () => {
    mockFetch(async () => new Response(JSON.stringify({ matches: false, infra: true }), { status: 200 }));
    const out = await callAiCheck('/api/validate-passport-page', {}, 'data:image/jpeg;base64,AA', {
      form: 'employee',
      action: 'check:test',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe('check_unavailable');
      expect(out.countsAsStrike).toBe(true);
    }
  });

  it('counts a refused large file as a strike so manual review is reachable', async () => {
    mockFetch(async () => new Response('Payload Too Large', { status: 413 }));
    const out = await callAiCheck('/api/validate-passport-page', {}, 'data:image/jpeg;base64,AA', {
      form: 'employee',
      action: 'check:test',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe('too_large_for_check');
      expect(out.countsAsStrike).toBe(true);
    }
  });

  it('does not count a closed form as a strike', async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: 'Submission expired' }), { status: 410 }));
    const out = await callAiCheck('/api/validate-passport-page', {}, 'data:image/jpeg;base64,AA', {
      form: 'employee',
      action: 'check:test',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe('form_closed');
      expect(out.countsAsStrike).toBe(false);
      expect(out.message).not.toContain('Submission expired');
    }
  });

  it('passes the answer through when the check ran', async () => {
    mockFetch(async () => new Response(JSON.stringify({ matches: true }), { status: 200 }));
    const out = await callAiCheck<{ matches: boolean }>('/api/x', {}, 'data:image/jpeg;base64,AA', {
      form: 'employee',
      action: 'check:test',
    });
    expect(out).toEqual({ ok: true, data: { matches: true } });
  });
});
