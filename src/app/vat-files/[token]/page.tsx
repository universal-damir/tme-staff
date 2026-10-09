'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle,
  Download,
  FileText,
  Loader2,
  Lock,
  Plus,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import { requestJson, failureMessage, type RequestFailure } from '@/lib/request-outcome';
import { uploadFileToRoute } from '@/lib/upload-client';
import {
  VAT_FILES_ACCEPT,
  VAT_FILES_MAX_BYTES,
  VAT_FILES_MAX_COMMENT,
  VAT_FILES_MAX_PER_ROUND,
  formatBytes,
  formatDeadline,
  clientPeriodLabel,
  isAcceptedExtension,
  type VatFilesReceivedFile,
} from '@/lib/vat-files';
import type { VatFilesPagePayload } from '@/types/vat-files';
import { demoPayload, isDemoToken } from './demo';

type PageState = 'loading' | 'form' | 'sent' | 'closed' | 'not_found' | 'error';

type ItemStatus = 'queued' | 'uploading' | 'done' | 'failed';

interface PendingItem {
  id: number;
  file: File;
  status: ItemStatus;
  /** Storage path once uploaded. */
  path?: string;
  error?: string;
}

const MAX_MB = Math.round(VAT_FILES_MAX_BYTES / (1024 * 1024));
const FORM = 'vat-files';

// Shell and Header live at module scope: defined inside the page they would
// remount on every keystroke and the comment box would lose focus.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center px-4 py-6 sm:py-10">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-10">
        {children}
      </div>
    </div>
  );
}

function Header({ data }: { data: VatFilesPagePayload | null }) {
  const company = [data?.companyCode, data?.companyName].filter(Boolean).join(' ');
  const period = clientPeriodLabel(data?.periodLabel);
  return (
    <div className="mb-6">
      <div
        className="text-xs font-semibold tracking-wide uppercase mb-2"
        style={{ color: TME_COLORS.secondary }}
      >
        TME Services
      </div>
      <h1 className="text-2xl font-bold" style={{ color: TME_COLORS.primary }}>
        VAT filing{period ? ` ${period}` : ''}
      </h1>
      {company && <p className="text-gray-600 mt-1 break-words">{company}</p>}
    </div>
  );
}

function Message({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      {icon}
      <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
        {title}
      </h2>
      <div className="text-gray-600 max-w-md">{children}</div>
    </div>
  );
}

function FileList({ files }: { files: VatFilesReceivedFile[] }) {
  return (
    <ul className="space-y-2">
      {files.map((f, i) => (
        <li
          key={`${f.name}-${i}`}
          className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100"
        >
          <FileText className="w-5 h-5 shrink-0" style={{ color: TME_COLORS.primary }} />
          <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{f.name}</span>
          <span className="text-xs text-gray-500 shrink-0">{formatBytes(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One plain sentence for a failed upload. */
function uploadErrorText(fileName: string, outcome: RequestFailure): string {
  if (outcome.code === 'unsupported_file_type' || outcome.kind === 'wrong_file') {
    return 'We cannot accept this file type. Please send PDF, Excel, Word, CSV, image or email files.';
  }
  if (outcome.kind === 'too_large') {
    return `This file is larger than ${MAX_MB} MB. Please split it into smaller files.`;
  }
  if (outcome.code === 'too_many_files') {
    return 'This link has reached the most files it can take. Please reply to our email instead.';
  }
  return `Could not upload "${fileName}". ${failureMessage(outcome)}`;
}

export default function VatFilesPage() {
  const params = useParams();
  const token = String(params?.token ?? '');
  const demo = isDemoToken(token);

  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<VatFilesPagePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentFiles, setSentFiles] = useState<VatFilesReceivedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const busy = useRef(false);

  // ---------- Load ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let payload: VatFilesPagePayload;
      if (demo) {
        payload = demoPayload(token);
      } else {
        const outcome = await requestJson<VatFilesPagePayload>(
          `/api/vat-files/${token}`,
          { cache: 'no-store' },
          { form: FORM, action: 'load', ref: token }
        );
        if (cancelled) return;
        if (!outcome.ok) {
          if (outcome.status === 404 || outcome.code === 'expired') return setState('not_found');
          if (outcome.code === 'closed') return setState('closed');
          setLoadError(failureMessage(outcome));
          return setState('error');
        }
        payload = outcome.data;
      }
      setData(payload);
      setState(payload.expired ? 'not_found' : payload.status === 'closed' ? 'closed' : 'form');
    })();
    return () => {
      cancelled = true;
    };
  }, [token, demo]);

  // ---------- Add files ----------
  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setSendError(null);
    setItems((prev) => {
      const room = VAT_FILES_MAX_PER_ROUND - prev.filter((i) => i.status !== 'failed').length;
      const added: PendingItem[] = incoming.map((file, idx) => {
        const base = { id: nextId.current++, file };
        if (idx >= room) {
          return {
            ...base,
            status: 'failed' as const,
            error: `You can send up to ${VAT_FILES_MAX_PER_ROUND} files at a time. Please send these first, then use "Send more files".`,
          };
        }
        if (!isAcceptedExtension(file.name)) {
          return {
            ...base,
            status: 'failed' as const,
            error: 'We cannot accept this file type. Please send PDF, Excel, Word, CSV, image or email files.',
          };
        }
        if (file.size === 0) {
          return { ...base, status: 'failed' as const, error: 'This file is empty.' };
        }
        if (file.size > VAT_FILES_MAX_BYTES) {
          return {
            ...base,
            status: 'failed' as const,
            error: `This file is larger than ${MAX_MB} MB. Please split it into smaller files.`,
          };
        }
        return { ...base, status: 'queued' as const };
      });
      return [...prev, ...added];
    });
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  // ---------- Upload queue: one file at a time ----------
  useEffect(() => {
    if (busy.current) return;
    const next = items.find((i) => i.status === 'queued');
    if (!next) return;
    busy.current = true;
    setItems((prev) => prev.map((i) => (i.id === next.id ? { ...i, status: 'uploading' } : i)));

    (async () => {
      let patch: Partial<PendingItem>;
      if (demo) {
        await new Promise((r) => setTimeout(r, 500));
        patch = { status: 'done', path: `demo/${next.id}` };
      } else {
        const outcome = await uploadFileToRoute<{ path: string; name: string; size: number }>(
          `/api/vat-files/${token}/upload`,
          { filename: next.file.name },
          next.file,
          { form: FORM, action: 'upload', ref: token },
          VAT_FILES_MAX_BYTES
        );
        if (outcome.ok) {
          patch = { status: 'done', path: outcome.data.path };
        } else if (outcome.code === 'closed') {
          busy.current = false;
          setState('closed');
          return;
        } else {
          patch = { status: 'failed', error: uploadErrorText(next.file.name, outcome) };
        }
      }
      busy.current = false;
      setItems((prev) => prev.map((i) => (i.id === next.id ? { ...i, ...patch } : i)));
    })();
  }, [items, demo, token]);

  const removeItem = useCallback(
    (item: PendingItem) => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (!demo && item.status === 'done' && item.path) {
        // Best effort: the file was never sent, so the portal never sees it.
        void requestJson(
          `/api/vat-files/${token}/upload?path=${encodeURIComponent(item.path)}`,
          { method: 'DELETE' }
        );
      }
    },
    [demo, token]
  );

  const done = items.filter((i) => i.status === 'done');
  const uploading = items.some((i) => i.status === 'queued' || i.status === 'uploading');
  const canSend = done.length > 0 && !uploading && !sending;

  // ---------- Send ----------
  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSendError(null);
    setSending(true);
    const round = done.map((i) => ({ path: i.path as string, name: i.file.name }));

    if (demo) {
      await new Promise((r) => setTimeout(r, 500));
      const now = new Date().toISOString();
      const sent = done.map((i) => ({ name: i.file.name, size: i.file.size, uploadedAt: now }));
      setData((d) => (d ? { ...d, files: [...d.files, ...sent] } : d));
      setSentFiles(sent);
      setSending(false);
      setState('sent');
      return;
    }

    const outcome = await requestJson<VatFilesPagePayload & { sent: VatFilesReceivedFile[] }>(
      `/api/vat-files/${token}/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: round, comment }),
      },
      { form: FORM, action: 'send', ref: token }
    );
    setSending(false);
    if (!outcome.ok) {
      if (outcome.code === 'closed') return setState('closed');
      setSendError(
        outcome.code === 'upload_not_received'
          ? 'One of the files did not reach us. Please remove it, add it again and press Send.'
          : outcome.code === 'too_many_files'
            ? 'This link has reached the most files it can take. Please reply to our email instead.'
            : `Could not send. ${failureMessage(outcome)}`
      );
      return;
    }
    const { sent, ...payload } = outcome.data;
    setData(payload);
    setSentFiles(sent ?? []);
    setState('sent');
  }, [canSend, done, demo, token, comment]);

  const sendMore = useCallback(() => {
    setItems([]);
    setComment('');
    setSendError(null);
    setSentFiles([]);
    setState('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ---------- States ----------
  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-16 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: TME_COLORS.primary }} />
          Loading…
        </div>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <Message
          icon={<XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />}
          title="We could not open this page"
        >
          <p>{loadError}</p>
        </Message>
      </Shell>
    );
  }

  if (state === 'not_found') {
    return (
      <Shell>
        <Message
          icon={<XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />}
          title="This link isn’t valid"
        >
          <p>
            The link may be incorrect or no longer in use. Please use the link from our latest
            email, or reply to that email.
          </p>
        </Message>
      </Shell>
    );
  }

  if (state === 'closed') {
    return (
      <Shell>
        <Header data={data} />
        <Message
          icon={<Lock className="w-12 h-12 mb-4" style={{ color: TME_COLORS.secondary }} />}
          title="This request is closed"
        >
          <p>
            We no longer need files through this link. If you want to send us something for this
            VAT filing, please reply to our email instead.
          </p>
        </Message>
      </Shell>
    );
  }

  if (state === 'sent') {
    return (
      <Shell>
        <Header data={data} />
        <div className="flex flex-col items-center pt-4 pb-6 text-center">
          <CheckCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.success }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            Thank you, we received your files
          </h2>
          <p className="text-gray-600 max-w-md">
            Our VAT team will check them and contact you if anything is missing.
          </p>
        </div>
        {sentFiles.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>
              Received now ({sentFiles.length} {sentFiles.length === 1 ? 'file' : 'files'})
            </p>
            <FileList files={sentFiles} />
          </div>
        )}
        <button
          type="button"
          onClick={sendMore}
          className="w-full py-3 rounded-lg font-semibold border-2 transition-colors flex items-center justify-center gap-2"
          style={{ borderColor: TME_COLORS.primary, color: TME_COLORS.primary }}
        >
          <Plus className="w-4 h-4" />
          Send more files
        </button>
      </Shell>
    );
  }

  // ---------- Form ----------
  const deadline = formatDeadline(data?.deadline);
  const received = data?.files ?? [];
  const isCustoms = data?.kind === 'customs';

  return (
    <Shell>
      <Header data={data} />

      {deadline && (
        <div
          className="mb-6 rounded-xl p-3 flex items-center gap-3"
          style={{ backgroundColor: 'rgba(210,188,153,0.18)' }}
        >
          <CalendarClock className="w-5 h-5 shrink-0" style={{ color: TME_COLORS.primary }} />
          <p className="text-sm" style={{ color: TME_COLORS.primary }}>
            Please send your files by <strong>{deadline}</strong>.
          </p>
        </div>
      )}

      <p className="text-gray-600 mb-6 text-sm leading-relaxed">
        {isCustoms
          ? 'For your VAT filing we need the documents for your imports in this period. Please upload them here and press Send.'
          : 'For your VAT filing we need the documents below. Please upload them here and press Send.'}{' '}
        Your files go only to the TME VAT team.
      </p>

      {(data?.requestedItems.length ?? 0) > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>
            What we need
          </p>
          <ol className="space-y-2">
            {data?.requestedItems.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-700">
                <span
                  className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ backgroundColor: TME_COLORS.primary }}
                >
                  {i + 1}
                </span>
                <span className="pt-0.5 leading-relaxed break-words min-w-0 whitespace-pre-line">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {data?.hasCustomsList && (
        <div className="mb-6">
          {demo ? (
            <button
              type="button"
              disabled
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg font-semibold text-white flex items-center justify-center gap-2 opacity-60 cursor-not-allowed"
              style={{ backgroundColor: TME_COLORS.primary }}
              title="Demo: no file to download"
            >
              <Download className="w-4 h-4" />
              Download the FTA import list
            </button>
          ) : (
            <a
              href={`/api/vat-files/${token}/customs-list`}
              className="w-full sm:w-auto inline-flex px-4 py-2.5 rounded-lg font-semibold text-white items-center justify-center gap-2"
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              <Download className="w-4 h-4" />
              Download the FTA import list
            </a>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Fill in the yellow columns and upload the list again together with your documents.
          </p>
        </div>
      )}

      {received.length > 0 && (
        <details className="mb-6 rounded-lg border border-gray-100 p-3">
          <summary className="text-sm font-medium cursor-pointer" style={{ color: TME_COLORS.primary }}>
            Already received: {received.length} {received.length === 1 ? 'file' : 'files'}
          </summary>
          <div className="mt-3">
            <FileList files={received} />
          </div>
        </details>
      )}

      {/* Drop zone */}
      <div className="mb-6">
        <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>
          Your files
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          disabled={sending}
          className="w-full border-2 border-dashed rounded-xl py-8 px-4 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-60"
          style={{
            borderColor: dragging ? TME_COLORS.primary : TME_COLORS.border,
            backgroundColor: dragging ? 'rgba(36,63,123,0.04)' : undefined,
          }}
        >
          <UploadCloud className="w-7 h-7" style={{ color: TME_COLORS.primary }} />
          <span className="text-sm text-gray-700 font-medium">
            Drop files here or tap to choose
          </span>
          <span className="text-xs text-gray-500 text-center">
            PDF, Excel, Word, CSV, images or emails. Up to {MAX_MB} MB each.
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={VAT_FILES_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        {items.length > 0 && (
          <ul className="mt-4 space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="p-3 rounded-lg border"
                style={{
                  backgroundColor: item.status === 'failed' ? 'rgba(239,68,68,0.05)' : '#f9fafb',
                  borderColor: item.status === 'failed' ? 'rgba(239,68,68,0.3)' : '#f3f4f6',
                }}
              >
                <div className="flex items-center gap-3">
                  {item.status === 'uploading' || item.status === 'queued' ? (
                    <Loader2
                      className={`w-5 h-5 shrink-0 ${item.status === 'uploading' ? 'animate-spin' : ''}`}
                      style={{ color: TME_COLORS.primary }}
                    />
                  ) : item.status === 'done' ? (
                    <CheckCircle className="w-5 h-5 shrink-0" style={{ color: TME_COLORS.success }} />
                  ) : (
                    <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: TME_COLORS.error }} />
                  )}
                  <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{item.file.name}</span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {item.status === 'queued'
                      ? 'Waiting…'
                      : item.status === 'uploading'
                        ? 'Uploading…'
                        : formatBytes(item.file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    disabled={item.status === 'uploading' || sending}
                    aria-label={`Remove ${item.file.name}`}
                    title="Remove this file"
                    className="shrink-0 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {item.error && (
                  <p className="text-xs mt-2 ml-8" style={{ color: TME_COLORS.error }}>
                    {item.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-6">
        <label
          htmlFor="vat-files-comment"
          className="block text-sm font-medium mb-2"
          style={{ color: TME_COLORS.primary }}
        >
          Comment (optional)
        </label>
        <textarea
          id="vat-files-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, VAT_FILES_MAX_COMMENT))}
          rows={3}
          placeholder="Anything we should know about these files?"
          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 text-sm"
          onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
          onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
        />
      </div>

      {sendError && (
        <div
          className="mb-4 text-sm rounded-lg p-3"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: TME_COLORS.error }}
        >
          {sendError}
        </div>
      )}

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className="w-full py-3 rounded-lg font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{ backgroundColor: TME_COLORS.primary }}
      >
        {sending && <Loader2 className="w-4 h-4 animate-spin" />}
        {sending
          ? 'Sending…'
          : uploading
            ? 'Uploading…'
            : done.length > 0
              ? `Send ${done.length} ${done.length === 1 ? 'file' : 'files'}`
              : 'Send'}
      </button>
      {demo && (
        <p className="text-xs text-gray-400 text-center mt-3">Demo page: nothing is saved.</p>
      )}
    </Shell>
  );
}
