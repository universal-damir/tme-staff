'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle,
  Download,
  FileText,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import { requestJson, failureMessage, type RequestFailure } from '@/lib/request-outcome';
import { reportClientFailure } from '@/lib/client-error-log';
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
  vatFilesChangeNotice,
  vatFilesSendResult,
  type VatFilesChangeInfo,
  type VatFilesPageConflict,
  type VatFilesReceivedFile,
} from '@/lib/vat-files';
import {
  isVatCustomsLineComplete,
  type VatCustomsAnswers,
  type VatCustomsDocKind,
  type VatCustomsLineAnswer,
  type VatCustomsPageLine,
  type VatCustomsNote,
  type VatCustomsReplyMeta,
  type VatFilesCodeAddress,
  type VatFilesPagePayload,
  vatFilesNamedEmail,
} from '@/types/vat-files';
import {
  customsAnswerContentKey,
  customsLineSavedAs,
  customsLinesToSave,
  customsPageHasUnsent,
  customsPageSavedKeys,
  customsUnsentLineIds,
  demoNotes,
  demoReplyMeta,
  formatDubaiDateTime,
  initialPageAnswers,
  mergeLineAnswer,
  reconcileAfterReload,
  refusedReplyTexts,
  sentRepliesByLine,
  shownReplyMeta,
  withSavedReplyMeta,
} from '@/lib/vat-customs';
import { DEMO_CODE_ADDRESSES, DEMO_REPLY_BY, demoExtras, demoPayload, isDemoCodeToken, isDemoToken } from './demo';
import CodeGate from './CodeGate';
import CustomsTable, { SaveStatus, type LineConflictNote, type LineFileCounts, type SaveState } from './CustomsTable';

/**
 * 'code' = round 4 B: "Who are you?" + email code before the page.
 * 'closed' (11.10) = the same page read-only: what the client sent, no
 * inputs, no upload, no Send (every write route refuses a closed row too).
 */
type PageState = 'loading' | 'code' | 'form' | 'sent' | 'closed' | 'not_found' | 'expired' | 'error';

/** Round 4 B: the API asks for the email code; its body carries the masked addresses. */
function codeGateFrom(outcome: RequestFailure): VatFilesCodeAddress[] | null {
  if (outcome.code !== 'email_code_required') return null;
  const raw = outcome.body?.addresses;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is VatFilesCodeAddress => !!a && typeof a.id === 'string' && typeof a.masked === 'string')
    .slice(0, 50);
}

type ItemStatus = 'queued' | 'uploading' | 'done' | 'failed';

interface PendingItem {
  id: number;
  file: File;
  status: ItemStatus;
  /** Storage path once uploaded. */
  path?: string;
  error?: string;
  /** Round 3: added on a row of the customs table. */
  lineId?: number;
  docKind?: VatCustomsDocKind;
}

const MAX_MB = Math.round(VAT_FILES_MAX_BYTES / (1024 * 1024));
const FORM = 'vat-files';
/** Autosave runs this long after the last change. */
const AUTOSAVE_DELAY_MS = 1500;
/**
 * With the customs table a client may add a BOE + invoice per import, so the
 * page takes more files at once and sends them in rounds of
 * VAT_FILES_MAX_PER_ROUND (the server's limit per Send).
 */
const TABLE_MAX_PENDING = VAT_FILES_MAX_PER_ROUND * 4;

const DOC_KIND_LABEL: Record<VatCustomsDocKind, string> = { boe: 'BOE', invoice: 'Invoice', other: 'Other file' };

/** Round 5: a line as the page sends it, with the stored `updatedAt` it was loaded with (null = none). */
type SaveLine = VatCustomsLineAnswer & { baseUpdatedAt?: string | null };

/** What one autosave / Send carries for a line: no timestamp, no empty reply; `base` = round 5 conflict check. */
function answerForSave(a: VatCustomsLineAnswer | undefined, base?: string | null): SaveLine {
  const out: SaveLine = { parts: a?.parts ?? [] };
  if (base !== undefined) out.baseUpdatedAt = base;
  const replies: Record<string, string> = {};
  for (const [qid, text] of Object.entries(a?.replies ?? {})) {
    if (typeof text === 'string' && text.trim()) replies[qid] = text;
  }
  if (Object.keys(replies).length > 0) out.replies = replies;
  // Round 5 item 8: every note the page holds (id + text only; empty = a draft to remove).
  // Always sent, so a removed draft goes away; the server keeps sent notes as they are.
  const notes: Record<string, Array<{ id: string; text: string }>> = {};
  for (const [qid, list] of Object.entries(a?.notes ?? {})) {
    const items = (list ?? []).filter((n) => typeof n?.text === 'string' && n.text.trim()).map((n) => ({ id: n.id, text: n.text }));
    if (items.length > 0) notes[qid] = items;
  }
  out.notes = notes;
  return out;
}

/** S2: TME replaced the list while the page was open. */
const LIST_UPDATED_NOTE = 'The list of imports was updated by TME. Your answers for the remaining imports are kept.';
const QUESTIONS_UPDATED_NOTE = 'TME has updated its questions on your imports. Please check your replies.';
/** Round 5: a reply already sent cannot be changed any more. */
const LOCKED_NOTE = 'This reply was already sent to TME, so it can no longer be changed. Need to add something? Add a note under the reply.';
/** Round 5: how often the page asks "did someone else change the table?" while visible. */
const CHANGE_CHECK_MS = 60_000;
/** ...and not more often than this (focus + tab switch). */
const CHANGE_CHECK_MIN_GAP_MS = 10_000;

/** A copy of `map` without `key`. */
function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/** Round 5: the "who" of a conflict note. */
function conflictWho(c: Pick<VatFilesPageConflict, 'by' | 'byName'>): string {
  return c.byName || c.by || 'Someone else';
}

// Shell and Header live at module scope: defined inside the page they would
// remount on every keystroke and the comment box would lose focus.

/** The small centred card for loading, errors, closed and "thank you". */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 bg-[#F6F7F9]">
      <div className="w-full max-w-2xl bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(16,24,40,0.05)] p-5 sm:p-8">
        {children}
      </div>
    </div>
  );
}

function TitleBlock({
  data,
  large = false,
  onNotYou,
}: {
  data: VatFilesPagePayload | null;
  large?: boolean;
  /** Round 4 B: shown with the confirmed address ("Not you?"). */
  onNotYou?: () => void;
}) {
  // The client knows its own name; the TME client code means nothing to them.
  const company = data?.companyName ?? '';
  const period = clientPeriodLabel(data?.periodLabel);
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: TME_COLORS.secondary }}>
        TME Services
      </div>
      <h1 className={`${large ? 'text-2xl' : 'text-lg sm:text-xl'} font-semibold tracking-tight leading-tight`} style={{ color: TME_COLORS.primary }}>
        VAT filing{period ? ` ${period}` : ''}
      </h1>
      {company && <p className="text-[13px] text-gray-500 break-words leading-snug">{company}</p>}
      {data?.viewerEmail && (
        <p className="text-[11px] text-gray-500 leading-snug mt-0.5 break-all">
          Confirmed as {vatFilesNamedEmail(data.viewerEmail, data.peopleNames)}
          {onNotYou && (
            <>
              {' · '}
              <button type="button" onClick={onNotYou} className={`font-medium underline-offset-2 hover:underline rounded ${FOCUS}`} style={{ color: TME_COLORS.primary }}>
                Not you?
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Header({ data }: { data: VatFilesPagePayload | null }) {
  return (
    <div className="mb-6">
      <TitleBlock data={data} large />
    </div>
  );
}

/** "2 of 4 answered" as a ring. */
function ProgressRing({ value, total }: { value: number; total: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const p = total > 0 ? value / total : 0;
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90 shrink-0" aria-hidden>
      <circle cx="16" cy="16" r={r} fill="none" stroke="#E5E7EB" strokeWidth="3.5" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke={value === total && total > 0 ? TME_COLORS.success : TME_COLORS.primary}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
    </svg>
  );
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#243F7B]/50';
const CARD = 'rounded-xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)]';

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

function FileList({ files, withDate = false }: { files: VatFilesReceivedFile[]; withDate?: boolean }) {
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
      {files.map((f, i) => {
        const when = withDate ? formatDubaiDateTime(f.uploadedAt) : '';
        return (
          <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2">
            <FileText className="w-4 h-4 shrink-0 text-gray-400" aria-hidden />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] text-gray-800 truncate" title={f.name}>
                {f.name}
              </span>
              {when && <span className="block sm:hidden text-[11px] text-gray-500 tabular-nums">Sent {when}</span>}
            </span>
            {when && <span className="hidden sm:inline text-xs text-gray-500 shrink-0 tabular-nums">Sent {when}</span>}
            <span className="text-xs text-gray-500 shrink-0 tabular-nums">{formatBytes(f.size)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The grey notice on top of a closed request. */
function ClosedNotice() {
  return (
    <div className={`${CARD} px-4 py-3 flex items-start gap-3 bg-gray-50`} role="status">
      <span className="w-8 h-8 shrink-0 rounded-full bg-gray-200/70 flex items-center justify-center" aria-hidden>
        <Lock className="w-4 h-4 text-gray-600" />
      </span>
      <div className="min-w-0 text-[13px] leading-snug">
        <p className="font-semibold text-gray-900">This request is closed. You can still see what you sent.</p>
        <p className="text-gray-600 mt-0.5">If you need to send us something else for this VAT filing, please reply to our email.</p>
      </div>
    </div>
  );
}

/** One plain sentence for a failed upload. */
/** Round 5: "Benedikt Klingler changed the table at 17:10." + Reload (never reloads by itself). */
function ChangeBanner({ text, closed, onReload }: { text: string; closed: boolean; onReload: () => void }) {
  return (
    <div
      className="rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-white shadow-[0_4px_14px_rgba(36,63,123,0.25)]"
      style={{ backgroundColor: TME_COLORS.primary }}
      role="status"
      aria-live="polite"
    >
      <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
      <p className="flex-1 min-w-[12rem] leading-snug">
        <span className="font-semibold">{text}</span>{' '}
        <span className="text-white/85">
          {closed ? 'Reload to see what TME has.' : 'Reload to see the latest version. What you typed is kept.'}
        </span>
      </p>
      <button
        type="button"
        onClick={onReload}
        className={`shrink-0 h-8 px-3.5 rounded-lg bg-white text-[13px] font-semibold transition-colors hover:bg-white/90 ${FOCUS}`}
        style={{ color: TME_COLORS.primary }}
      >
        Reload
      </button>
    </div>
  );
}

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


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function VatFilesPage() {
  const params = useParams();
  const token = String(params?.token ?? '');
  const demo = isDemoToken(token);

  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<VatFilesPagePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Round 4 B: the masked addresses for "Who are you?"; a new load after the code.
  const [gate, setGate] = useState<VatFilesCodeAddress[]>([]);
  const [loadKey, setLoadKey] = useState(0);
  const demoCodeOk = useRef(false);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentFiles, setSentFiles] = useState<VatFilesReceivedFile[]>([]);
  const [sentAnswers, setSentAnswers] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const busy = useRef(false);
  /** The sticky header's height: the table header sticks right under it. */
  const barRef = useRef<HTMLElement>(null);
  const [barH, setBarH] = useState(0);

  // ---------- Customs table state ----------
  // `answers` drives the table; `answersRef` is the same map for the save
  // code (no stale closures). `dirty` = line ids changed since the last
  // successful save: a failed save puts its ids back, so nothing typed is lost.
  const [lines, setLines] = useState<VatCustomsPageLine[]>([]);
  const [answers, setAnswers] = useState<VatCustomsAnswers>({});
  const answersRef = useRef<VatCustomsAnswers>({});
  const dirty = useRef<Set<string>>(new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  // 11.10: "anything to send?" compares CONTENT, never "touched": `savedKeys`
  // = per line the content key of what the server holds (customsPageSavedKeys),
  // `serverUnsent` = the stored lines that differ from what the last Send
  // carried (customsUnsentLineIds; from the payload and every save answer).
  const [savedKeys, setSavedKeysState] = useState<Record<string, string>>({});
  const savedKeysRef = useRef<Record<string, string>>({});
  const [serverUnsent, setServerUnsent] = useState<string[]>([]);
  /** Demo only (no server): the content keys of the last "Send" (undefined = not sent). */
  const demoSentKeys = useRef<Record<string, string>>({});
  /** A calm note above the table (the list or the questions changed). */
  const [notice, setNotice] = useState<string | null>(null);
  const lineInputRef = useRef<HTMLInputElement>(null);
  const lineTarget = useRef<{ lineId: number; docKind: VatCustomsDocKind } | null>(null);
  const hasTable = lines.length > 0;
  const linesRef = useRef<VatCustomsPageLine[]>([]);
  linesRef.current = lines;
  /** The answers differ in content from what was last sent (see savedKeys / serverUnsent). */
  const unsent = useMemo(
    () => hasTable && customsPageHasUnsent({ lines, answers, savedKeys, serverUnsent }),
    [hasTable, lines, answers, savedKeys, serverUnsent]
  );
  const setSavedKeys = useCallback((next: Record<string, string>) => {
    savedKeysRef.current = next;
    setSavedKeysState(next);
  }, []);
  /** 11.10: what the server holds and what of it is not sent yet, from a fresh payload. */
  const takeStored = useCallback(
    (payload: VatFilesPagePayload) => {
      setSavedKeys(customsPageSavedKeys(payload.customsLines ?? [], payload.customsAnswers ?? {}));
      setServerUnsent(customsUnsentLineIds(payload.customsAnswers ?? {}, payload.customsAnswersSentAt ?? null));
    },
    [setSavedKeys]
  );

  // ---------- Round 5: two people on one page ----------
  // `baseAt` = per line, the stored updatedAt this page loaded / last saved
  // (sent with every save: the server refuses a line someone else changed).
  // `knownVersion` = the fingerprint of what the page shows; `ownVersions` =
  // the ones its own saves produced (never a "changed by" note);
  // `knownClientAt` = the last client change the page knows (server time).
  const baseAt = useRef<Record<string, string | null>>({});
  const knownVersion = useRef<string | null>(null);
  const knownClientAt = useRef<string | null>(null);
  const ownVersions = useRef<string[]>([]);
  /** Counts finished saves / Sends: a check that overlapped one is ignored. */
  const writeCount = useRef(0);
  const sendingRef = useRef(false);
  const [changeNote, setChangeNote] = useState<{ text: string; closed: boolean } | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, LineConflictNote>>({});
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;
  /** Round 5 review: text typed into replies already sent (refused), per line then question; kept until dismissed. */
  const [lockedNotes, setLockedNotes] = useState<Record<string, Record<string, string>>>({});
  /**
   * Round 5 review: lines of a save whose answer never came back (offline,
   * timeout, 5xx), with what it carried. It may have been stored: before the
   * next save the page reads the stored stamps (customsLineSavedAs), so it
   * does not conflict with its own lost save.
   */
  const lostSave = useRef<Record<string, SaveLine>>({});
  const maxPending = useRef<number>(VAT_FILES_MAX_PER_ROUND);
  maxPending.current = hasTable ? TABLE_MAX_PENDING : VAT_FILES_MAX_PER_ROUND;

  const setAllAnswers = useCallback((next: VatCustomsAnswers) => {
    answersRef.current = next;
    setAnswers(next);
  }, []);

  /** Round 5: take the stamps of a fresh payload; lines in `keep` (typed, not saved) keep the base they were typed on. */
  const takeSync = useCallback((payload: VatFilesPagePayload, keep: Iterable<string> = []) => {
    const keepSet = new Set(keep);
    const next: Record<string, string | null> = {};
    for (const l of payload.customsLines ?? []) {
      const id = String(l.id);
      next[id] =
        keepSet.has(id) && id in baseAt.current ? baseAt.current[id] : payload.customsAnswers?.[id]?.updatedAt ?? null;
    }
    baseAt.current = next;
    if (payload.version) knownVersion.current = payload.version;
    if (payload.clientChangedAt !== undefined) knownClientAt.current = payload.clientChangedAt ?? null;
  }, []);

  /** Round 5: an own save / Send produced this version (it never shows the "changed by" note). */
  const noteOwnVersion = useCallback((version: string | undefined, clientAt?: string | null) => {
    writeCount.current += 1;
    if (!version) return;
    knownVersion.current = version;
    ownVersions.current = [...ownVersions.current.slice(-19), version];
    if (clientAt !== undefined) knownClientAt.current = clientAt ?? null;
  }, []);

  /**
   * Round 5: lines the server refused because someone else saved them since
   * this page loaded them. The line now shows their version; a note keeps
   * what this person had typed ("Use mine" puts it back on top).
   */
  const applyConflicts = useCallback(
    (found: Record<string, VatFilesPageConflict> | undefined, typed: VatCustomsAnswers) => {
      const ids = Object.keys(found ?? {});
      if (!found || ids.length === 0) return;
      const nextAnswers: VatCustomsAnswers = { ...answersRef.current };
      const notes: Record<string, LineConflictNote> = {};
      for (const id of ids) {
        const c = found[id];
        const line = linesRef.current.find((l) => String(l.id) === id);
        if (!line) continue;
        nextAnswers[id] = mergeLineAnswer(line, c.answer);
        baseAt.current[id] = c.answer.updatedAt ?? c.at ?? null;
        dirty.current.delete(id);
        notes[id] = { mine: typed[id] ?? { parts: [] }, who: conflictWho(c), at: c.at };
      }
      setData((d) => (d ? { ...d, customsAnswers: { ...(d.customsAnswers ?? {}), ...Object.fromEntries(ids.map((id) => [id, found[id].answer])) } } : d));
      setAllAnswers(nextAnswers);
      // 11.10: their version is what the server holds for these lines.
      const keys = { ...savedKeysRef.current };
      for (const id of Object.keys(notes)) keys[id] = customsAnswerContentKey(nextAnswers[id]);
      setSavedKeys(keys);
      setConflicts((prev) => ({ ...prev, ...notes }));
    },
    [setAllAnswers, setSavedKeys]
  );

  /** Round 5 review: keep what this person typed into replies the server refused as already sent. */
  const keepRefusedReplies = useCallback(
    (ids: readonly string[], typed: Record<string, SaveLine | VatCustomsLineAnswer | undefined>, payload: VatFilesPagePayload) => {
      const found = refusedReplyTexts(ids, typed, payload.customsAnswers, payload.customsAnswersSentAt);
      if (Object.keys(found).length === 0) return;
      setLockedNotes((prev) => {
        const next = { ...prev };
        for (const [id, texts] of Object.entries(found)) next[id] = { ...(next[id] ?? {}), ...texts };
        return next;
      });
    },
    []
  );

  /**
   * TME closed the request while the page was open (a save, upload or Send
   * answered 'closed'): drop what was not sent and load again, so the
   * read-only view shows what TME really holds, not what was typed.
   */
  const reloadClosed = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    dirty.current.clear();
    setItems([]);
    setState('loading');
    setLoadKey((k) => k + 1);
  }, []);

  /** Round 4 B: an API call answered "email code required" (proof missing or ran out): show "Who are you?". */
  const askForCodeIfNeeded = useCallback((outcome: RequestFailure): boolean => {
    const addresses = codeGateFrom(outcome);
    if (!addresses) return false;
    setGate(addresses);
    setState('code');
    return true;
  }, []);

  // ---------- Load ----------
  const fetchPayload = useCallback(async (log: boolean = true): Promise<
    { ok: true; payload: VatFilesPagePayload } | { ok: false; outcome: RequestFailure }
  > => {
    // The first load logs by itself: "Who are you?" (401 email_code_required) is not a failure.
    const outcome = await requestJson<VatFilesPagePayload>(
      `/api/vat-files/${token}`,
      { cache: 'no-store' },
      log ? { form: FORM, action: 'load', ref: token } : undefined
    );
    return outcome.ok ? { ok: true, payload: outcome.data } : { ok: false, outcome };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let payload: VatFilesPagePayload;
      if (demo) {
        if (isDemoCodeToken(token) && !demoCodeOk.current) {
          setGate(DEMO_CODE_ADDRESSES);
          return setState('code');
        }
        payload = demoPayload(token);
        const extras = demoExtras(token);
        setConflicts(extras?.conflicts ?? {});
        setLockedNotes(extras?.lockedNotes ?? {});
        setChangeNote(extras?.changeNote ? { text: extras.changeNote, closed: false } : null);
      } else {
        const got = await fetchPayload(false);
        if (cancelled) return;
        if (!got.ok) {
          const outcome = got.outcome;
          const addresses = codeGateFrom(outcome);
          if (addresses) {
            setGate(addresses);
            return setState('code');
          }
          reportClientFailure({ form: FORM, action: 'load', ref: token }, outcome);
          if (outcome.code === 'expired') return setState('expired');
          if (outcome.status === 404) return setState('not_found');
          if (outcome.code === 'closed') return setState('closed');
          setLoadError(failureMessage(outcome));
          return setState('error');
        }
        payload = got.payload;
      }
      const customsLines = payload.customsLines ?? [];
      setData(payload);
      setLines(customsLines);
      setAllAnswers(initialPageAnswers(customsLines, payload.customsAnswers ?? {}));
      takeStored(payload);
      if (demo) {
        // Demo: the loaded answers count as sent, except the lines the stamps call unsent.
        const notSent = new Set(customsUnsentLineIds(payload.customsAnswers ?? {}, payload.customsAnswersSentAt ?? null));
        demoSentKeys.current = Object.fromEntries(
          Object.entries(customsPageSavedKeys(customsLines, payload.customsAnswers ?? {})).filter(([id]) => !notSent.has(id))
        );
      }
      takeSync(payload);
      if (!demo) {
        setConflicts({});
        setChangeNote(null);
        setLockedNotes({});
      }
      setState(payload.expired ? 'expired' : payload.status === 'closed' ? 'closed' : 'form');
    })();
    return () => {
      cancelled = true;
    };
  }, [token, demo, fetchPayload, setAllAnswers, takeSync, takeStored, loadKey]);

  /**
   * TME changed the lines while the client was typing (S2: a "replace" upload
   * gives new line ids; S4: a question was closed). Load the lines again; the
   * typed answers of lines that still exist stay exactly as typed and are
   * saved again; lines that are gone are dropped; a reply to a question that
   * is no longer open is dropped, never moved to another question. True when
   * it worked.
   */
  const reloadLines = useCallback(async (
    reason: 'list' | 'questions' | 'locked' | 'sync' = 'list',
    /** Round 5 review: lines the server refused as already sent, with what this page tried to save (kept as a note). */
    refused?: { ids: string[]; typed: Record<string, SaveLine> }
  ): Promise<boolean> => {
    if (demo) return true;
    const got = await fetchPayload();
    if (!got.ok) {
      askForCodeIfNeeded(got.outcome);
      return false;
    }
    if (refused) keepRefusedReplies(refused.ids, refused.typed, got.payload);
    // Round 5: TME closed the request meanwhile: the read-only view.
    if (got.payload.status === 'closed' || got.payload.expired) {
      reloadClosed();
      return false;
    }
    const fresh = got.payload.customsLines ?? [];
    const r = reconcileAfterReload(answersRef.current, dirty.current, fresh, got.payload.customsAnswers ?? {});
    setLines(fresh);
    setData((d) =>
      d
        ? {
            ...d,
            customsLines: fresh,
            customsAnswers: got.payload.customsAnswers,
            customsAnswersSentAt: got.payload.customsAnswersSentAt,
            files: got.payload.files,
            lineFiles: got.payload.lineFiles,
            viewerEmail: got.payload.viewerEmail,
            peopleNames: got.payload.peopleNames,
            version: got.payload.version,
            clientChangedAt: got.payload.clientChangedAt,
          }
        : d
    );
    setAllAnswers(r.answers);
    dirty.current = new Set(r.dirty);
    takeSync(got.payload, r.dirty);
    // 11.10: lines still typed (not saved) differ from these keys by content, so they still count.
    takeStored(got.payload);
    // Notes of lines that are gone or that the other person's version now shows anyway stay until answered.
    setConflicts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => fresh.some((l) => String(l.id) === id))));
    if (r.listChanged) setNotice(LIST_UPDATED_NOTE);
    else if (reason === 'locked') setNotice(LOCKED_NOTE);
    else if (r.repliesDropped || reason === 'questions') setNotice(QUESTIONS_UPDATED_NOTE);
    // Refused-text notes of lines that are gone go too.
    setLockedNotes((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => fresh.some((l) => String(l.id) === id))));
    return true;
  }, [demo, fetchPayload, setAllAnswers, askForCodeIfNeeded, reloadClosed, takeSync, takeStored, keepRefusedReplies]);

  /**
   * Round 5 review: an earlier save / Send got no answer (lostSave) and may be
   * stored. Read the stored answers; a line holding exactly what that save
   * carried takes the stored stamp as its base (customsLineSavedAs), so the
   * next save does not conflict with this page's own lost save. A line with
   * other content keeps its old base (a real conflict stays a conflict).
   */
  const refreshLostBases = useCallback(async () => {
    if (demo || Object.keys(lostSave.current).length === 0) return;
    const got = await fetchPayload(false);
    if (!got.ok) return;
    for (const [id, sent] of Object.entries(lostSave.current)) {
      const line = (got.payload.customsLines ?? []).find((l) => String(l.id) === id);
      const stored = got.payload.customsAnswers?.[id];
      if (line && stored && customsLineSavedAs(line, sent, stored)) baseAt.current[id] = stored.updatedAt ?? null;
    }
    lostSave.current = {};
  }, [demo, fetchPayload]);

  // ---------- Autosave ----------
  const saveNowRef = useRef<() => Promise<boolean>>(async () => true);

  const scheduleSave = useCallback((delay: number = AUTOSAVE_DELAY_MS) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saveNowRef.current();
    }, delay);
  }, []);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // One save at a time: a later change waits for the running one.
    while (inflight.current) await inflight.current;
    if (dirty.current.size === 0) return true;

    // 11.10: only lines whose content differs from what the server holds (a
    // box opened and closed, typed and deleted back: nothing to write). A line
    // of a save that got no answer is saved anyway (it may hold something else).
    const ids = customsLinesToSave(dirty.current, answersRef.current, savedKeysRef.current, new Set(Object.keys(lostSave.current)));
    dirty.current.clear();
    if (ids.length === 0) return true;
    const body: Record<string, SaveLine> = {};
    for (const id of ids) body[id] = answerForSave(answersRef.current[id], baseAt.current[id] ?? null);
    /** The content key of each line as this save carries it (what the server holds once it is taken). */
    const bodyKeys: Record<string, string> = {};
    for (const id of ids) bodyKeys[id] = customsAnswerContentKey(answersRef.current[id]);
    const seen = { version: knownVersion.current, clientAt: knownClientAt.current };
    setSave({ status: 'saving' });

    const run = (async (): Promise<boolean> => {
      if (demo) {
        await sleep(400);
        const now = new Date().toISOString();
        // Round 4 C: the line under each reply, as the server would write it.
        setData((d) =>
          d
            ? {
                ...d,
                customsAnswers: withSavedReplyMeta(
                  d.customsAnswers ?? {},
                  body,
                  demoReplyMeta(d.customsAnswers ?? {}, body, now, d.viewerEmail ?? DEMO_REPLY_BY),
                  demoNotes(d.customsAnswers ?? {}, body, linesRef.current, now, d.viewerEmail ?? DEMO_REPLY_BY, d.customsAnswersSentAt ?? null)
                ),
              }
            : d
        );
        setSave({ status: 'saved', at: now });
        // Demo: what is "stored" now, and which lines differ from the last "Send".
        setSavedKeys({ ...savedKeysRef.current, ...bodyKeys });
        setServerUnsent((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (bodyKeys[id] !== demoSentKeys.current[id]) next.add(id);
            else next.delete(id);
          }
          return [...next];
        });
        return true;
      }
      // Round 5 review: an earlier save got no answer: take the stamps of what it stored.
      if (Object.keys(lostSave.current).length > 0) {
        await refreshLostBases();
        for (const id of ids) if (body[id]) body[id].baseUpdatedAt = baseAt.current[id] ?? null;
      }
      const outcome = await requestJson<{
        savedAt: string | null;
        updated: Record<string, string>;
        staleReplies?: string[];
        replyMeta?: Record<string, Record<string, VatCustomsReplyMeta>>;
        notes?: Record<string, Record<string, VatCustomsNote[]>>;
        lockedReplies?: string[];
        conflicts?: Record<string, VatFilesPageConflict>;
        bases?: Record<string, string | null>;
        version?: string;
        clientChangedAt?: string | null;
        otherChange?: VatFilesChangeInfo;
        unsentLines?: string[];
      }>(
        `/api/vat-files/${token}/answers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(seen.version ? { answers: body, seen } : { answers: body }),
        },
        { form: FORM, action: 'autosave', ref: token }
      );
      if (outcome.ok) {
        const res = outcome.data;
        setSave({ status: 'saved', at: res.savedAt ?? new Date().toISOString() });
        // Round 5: the stamps of this save (the next save of these lines builds on them).
        for (const [id, at] of Object.entries(res.bases ?? {})) baseAt.current[id] = at;
        noteOwnVersion(res.version, res.clientChangedAt);
        // 11.10: the server holds these lines as carried (refused ones: applyConflicts / the reload below set them).
        const refused = new Set([...Object.keys(res.conflicts ?? {}), ...(res.lockedReplies ?? [])]);
        const keys = { ...savedKeysRef.current };
        for (const id of ids) if (!refused.has(id)) keys[id] = bodyKeys[id];
        setSavedKeys(keys);
        if (Array.isArray(res.unsentLines)) setServerUnsent(res.unsentLines);
        // Round 4 C: "Sent by ... on ..." under each reply of the saved lines (refused lines left out).
        const meta = res.replyMeta;
        if (meta && Object.keys(meta).length > 0) {
          // Round 5 item 8: and the stored notes of those lines ("Saved by ... Not sent yet.").
          setData((d) => (d ? { ...d, customsAnswers: withSavedReplyMeta(d.customsAnswers ?? {}, body, meta, res.notes) } : d));
        }
        // Round 5: someone else saved a line this page changed too: show theirs + a note.
        applyConflicts(res.conflicts, { ...body, ...answersRef.current });
        // Round 5: someone else (or TME) changed the table since this page looked.
        if (res.otherChange) {
          const text = vatFilesChangeNotice({ knownVersion: seen.version, pageStatus: 'open', change: res.otherChange });
          if (text) setChangeNote({ text, closed: res.otherChange.status === 'closed' });
        }
        // A reply went to a question TME has closed meanwhile, or changed a
        // reply that was already sent: not stored; show the lines as stored.
        if ((res.lockedReplies?.length ?? 0) > 0) await reloadLines('locked', { ids: res.lockedReplies ?? [], typed: body });
        else if ((res.staleReplies?.length ?? 0) > 0) await reloadLines('questions');
        return true;
      }
      // Not saved: the lines stay marked, the text stays on the page.
      ids.forEach((id) => dirty.current.add(id));
      // The proof ran out: after the code the page saves again (the typed answers stay).
      if (askForCodeIfNeeded(outcome)) {
        setSave({ status: 'idle' });
        return false;
      }
      if (outcome.code === 'closed') {
        reloadClosed();
        return false;
      }
      if (outcome.code === 'expired') {
        setState('expired');
        return false;
      }
      if (outcome.status === 404) {
        setState('not_found');
        return false;
      }
      // TME changed the list (or, from an older server, a question): load the
      // lines again, keep what was typed for the lines that still exist, save again.
      if ((outcome.code === 'unknown_line' || outcome.code === 'question_changed') && (await reloadLines())) {
        setSave({ status: 'idle' });
        if (dirty.current.size > 0) scheduleSave(200);
        return false;
      }
      // No answer (offline, timeout, 5xx): the save may have landed anyway.
      if (outcome.kind === 'offline' || outcome.kind === 'timeout' || outcome.kind === 'server_error') {
        for (const id of ids) lostSave.current[id] = body[id];
      }
      setSave({
        status: 'error',
        message:
          outcome.kind === 'offline'
            ? 'Not saved: your internet connection dropped. Your answers are still here.'
            : 'Not saved yet. Your answers are still here.',
      });
      return false;
    })();
    inflight.current = run;
    try {
      const ok = await run;
      if (ok && dirty.current.size > 0) scheduleSave();
      return ok;
    } finally {
      inflight.current = null;
    }
  }, [demo, token, refreshLostBases, reloadLines, scheduleSave, askForCodeIfNeeded, reloadClosed, noteOwnVersion, applyConflicts, setSavedKeys]);
  saveNowRef.current = saveNow;

  const onLineChange = useCallback(
    (lineId: string, next: VatCustomsLineAnswer) => {
      setAllAnswers({ ...answersRef.current, [lineId]: next });
      dirty.current.add(lineId);
      scheduleSave();
      // Round 5: typing on a line with a conflict note = the person decided.
      if (conflictsRef.current[lineId]) setConflicts((prev) => withoutKey(prev, lineId));
    },
    [scheduleSave, setAllAnswers]
  );

  /** Round 5, the conflict note: put what this person had typed back on top of the other version (saved as usual). */
  const onUseMine = useCallback(
    (lineId: string) => {
      const note = conflictsRef.current[lineId];
      if (!note) return;
      setAllAnswers({ ...answersRef.current, [lineId]: { ...note.mine } });
      dirty.current.add(lineId);
      scheduleSave(200);
      setConflicts((prev) => withoutKey(prev, lineId));
    },
    [scheduleSave, setAllAnswers]
  );
  const onKeepTheirs = useCallback((lineId: string) => {
    setConflicts((prev) => withoutKey(prev, lineId));
  }, []);
  const onDismissLocked = useCallback((lineId: string) => {
    setLockedNotes((prev) => withoutKey(prev, lineId));
  }, []);

  const onFill = useCallback(
    (next: VatCustomsAnswers, changed: string[]) => {
      setAllAnswers(next);
      changed.forEach((id) => dirty.current.add(id));
      scheduleSave(300);
    },
    [scheduleSave, setAllAnswers]
  );

  const retrySave = useCallback(() => {
    void saveNowRef.current();
  }, []);

  // Leaving with unsaved answers: save when the tab is hidden (phones switch
  // apps), and ask before closing while a save is still open.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && dirty.current.size > 0) void saveNowRef.current();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size > 0 || inflight.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  // ---------- Add files ----------
  const addFiles = useCallback(
    (list: FileList | File[] | null, target?: { lineId: number; docKind: VatCustomsDocKind } | null) => {
      if (!list) return;
      const incoming = Array.from(list);
      if (incoming.length === 0) return;
      setSendError(null);
      const max = maxPending.current;
      setItems((prev) => {
        const room = max - prev.filter((i) => i.status !== 'failed').length;
        const added: PendingItem[] = incoming.map((file, idx) => {
          const base: PendingItem = { id: nextId.current++, file, status: 'queued' };
          if (target) {
            base.lineId = target.lineId;
            base.docKind = target.docKind;
          }
          if (idx >= room) {
            return {
              ...base,
              status: 'failed' as const,
              error: `You can send up to ${max} files at a time. Please send these first, then use "Send more files".`,
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
          return base;
        });
        return [...prev, ...added];
      });
      if (inputRef.current) inputRef.current.value = '';
      if (lineInputRef.current) lineInputRef.current.value = '';
    },
    []
  );

  const onAddLineFile = useCallback((lineId: number, docKind: VatCustomsDocKind) => {
    lineTarget.current = { lineId, docKind };
    lineInputRef.current?.click();
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
        await sleep(500);
        patch = { status: 'done', path: `demo/${next.id}` };
      } else {
        const fields: Record<string, string> = { filename: next.file.name };
        if (next.lineId && next.docKind) {
          fields.lineId = String(next.lineId);
          fields.docKind = next.docKind;
        }
        const outcome = await uploadFileToRoute<{ path: string; name: string; size: number }>(
          `/api/vat-files/${token}/upload`,
          fields,
          next.file,
          { form: FORM, action: 'upload', ref: token },
          VAT_FILES_MAX_BYTES
        );
        if (outcome.ok) {
          patch = { status: 'done', path: outcome.data.path };
        } else if (outcome.code === 'closed') {
          busy.current = false;
          reloadClosed();
          return;
        } else if (outcome.code === 'unknown_line') {
          patch = { status: 'failed', error: 'This import is no longer on the list. Please add the file without a row.' };
        } else if (askForCodeIfNeeded(outcome)) {
          patch = { status: 'failed', error: 'Not uploaded: please confirm your email, then add this file again.' };
        } else {
          patch = { status: 'failed', error: uploadErrorText(next.file.name, outcome) };
        }
      }
      busy.current = false;
      setItems((prev) => prev.map((i) => (i.id === next.id ? { ...i, ...patch } : i)));
    })();
  }, [items, demo, token, askForCodeIfNeeded, reloadClosed]);

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

  // Round 4 C: who sent each reply and when, per line (from the server's copy
  // of the answers); hidden for a reply while its typed text is not saved yet.
  const savedAnswers = data?.customsAnswers;
  const replyMetaByLine = useMemo(() => shownReplyMeta(savedAnswers, answers), [savedAnswers, answers]);
  // Round 5: replies already sent: read-only text on the page.
  const sentAtStamp = data?.customsAnswersSentAt ?? null;
  const sentReplies = useMemo(() => sentRepliesByLine(savedAnswers, sentAtStamp), [savedAnswers, sentAtStamp]);

  // Per-line ticks: TME already has it, sent through this link, or uploaded and waiting for Send.
  const lineFiles = data?.lineFiles;
  const fileCounts = useMemo(() => {
    const out: Record<string, LineFileCounts> = {};
    const get = (id: number | string) =>
      (out[String(id)] ??= { boe: 0, invoice: 0, other: 0, names: { boe: [], invoice: [], other: [] } });
    for (const l of lines) {
      const c = get(l.id);
      if (l.hasBoe) c.boe = 2;
      if (l.hasInvoice) c.invoice = 2;
    }
    for (const f of lineFiles ?? []) {
      const c = get(f.lineId);
      c.names?.[f.docKind].push(f.name);
      if (f.docKind === 'other') c.other += 1;
      else c[f.docKind] = 2;
    }
    for (const i of items) {
      if (!i.lineId || !i.docKind || i.status === 'failed') continue;
      const c = get(i.lineId);
      if (i.status === 'done') c.names?.[i.docKind].push(`${i.file.name} (press Send)`);
      if (i.docKind === 'other') c.other += 1;
      else if (i.status === 'done') c[i.docKind] = 2;
      else if (c[i.docKind] === 0) c[i.docKind] = 1;
    }
    return out;
  }, [lines, lineFiles, items]);

  const lineNoById = useMemo(() => new Map(lines.map((l) => [l.id, l.lineNo])), [lines]);
  const answeredCount = useMemo(
    () => lines.filter((l) => isVatCustomsLineComplete(answers[String(l.id)])).length,
    [lines, answers]
  );

  const done = items.filter((i) => i.status === 'done');
  const uploading = items.some((i) => i.status === 'queued' || i.status === 'uploading');
  const canSend = !uploading && !sending && (done.length > 0 || (hasTable && unsent));

  // ---------- Send ----------
  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSendError(null);
    setSending(true);
    sendingRef.current = true;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // A running autosave first, so it can never land after the Send.
    while (inflight.current) await inflight.current;

    // Round 5 review: an earlier save / Send got no answer: take the stamps of what it stored.
    await refreshLostBases();
    // The answers not autosaved yet travel with the Send.
    const answerIds = hasTable ? [...dirty.current] : [];
    dirty.current.clear();
    const answersBody: Record<string, SaveLine> = {};
    for (const id of answerIds) answersBody[id] = answerForSave(answersRef.current[id], demo ? undefined : baseAt.current[id] ?? null);
    const withAnswers = hasTable && unsent;

    const rounds: PendingItem[][] = [];
    for (let i = 0; i < done.length; i += VAT_FILES_MAX_PER_ROUND) rounds.push(done.slice(i, i + VAT_FILES_MAX_PER_ROUND));
    if (rounds.length === 0) rounds.push([]);

    if (demo) {
      await sleep(500);
      const now = new Date().toISOString();
      const sent = done.map((i) => ({ name: i.file.name, size: i.file.size, uploadedAt: now }));
      const newLineFiles = done
        .filter((i) => i.lineId && i.docKind)
        .map((i) => ({ lineId: i.lineId as number, docKind: i.docKind as VatCustomsDocKind, name: i.file.name, uploadedAt: now }));
      setData((d) =>
        d
          ? {
              ...d,
              files: [...d.files, ...sent],
              lineFiles: [...d.lineFiles, ...newLineFiles],
              // Like the server: the answers not autosaved yet are stored with the Send (round 5: then sent = read-only).
              customsAnswers: withSavedReplyMeta(
                d.customsAnswers ?? {},
                answersBody,
                demoReplyMeta(d.customsAnswers ?? {}, answersBody, now, d.viewerEmail ?? DEMO_REPLY_BY),
                demoNotes(d.customsAnswers ?? {}, answersBody, linesRef.current, now, d.viewerEmail ?? DEMO_REPLY_BY, d.customsAnswersSentAt ?? null)
              ),
              customsAnswersSentAt: withAnswers ? now : d.customsAnswersSentAt,
            }
          : d
      );
      setItems([]);
      setSentFiles(sent);
      setSentAnswers(withAnswers);
      // Demo: what the page shows now is what was sent.
      const nowKeys = Object.fromEntries(Object.entries(answersRef.current).map(([id, a]) => [id, customsAnswerContentKey(a)]));
      setSavedKeys(nowKeys);
      demoSentKeys.current = nowKeys;
      setServerUnsent([]);
      setSave((s) => (withAnswers ? { status: 'saved', at: now } : s));
      setSending(false);
      sendingRef.current = false;
      setState('sent');
      return;
    }

    const sentAll: VatFilesReceivedFile[] = [];
    const sentItemIds = new Set<number>();
    let lastPayload: VatFilesPagePayload | null = null;
    let sendConflicts: Record<string, VatFilesPageConflict> = {};
    const sendLocked: string[] = [];
    /** 11.10 review: what the server did with the answers (they travel with the first round). */
    let serverAnswersSent = false;
    for (let r = 0; r < rounds.length; r++) {
      const body: Record<string, unknown> = {
        files: rounds[r].map((i) => ({
          path: i.path as string,
          name: i.file.name,
          ...(i.lineId && i.docKind ? { lineId: i.lineId, docKind: i.docKind } : {}),
        })),
        comment,
      };
      if (r === 0 && hasTable) body.answers = answersBody;
      const outcome = await requestJson<
        VatFilesPagePayload & {
          sent: VatFilesReceivedFile[];
          answersSent?: boolean;
          staleReplies?: string[];
          lockedReplies?: string[];
          conflicts?: Record<string, VatFilesPageConflict>;
        }
      >(
        `/api/vat-files/${token}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        { form: FORM, action: 'send', ref: token }
      );
      if (!outcome.ok) {
        if (r === 0) answerIds.forEach((id) => dirty.current.add(id));
        // No answer (offline, timeout, 5xx): the answers may have been stored anyway (see lostSave).
        if (r === 0 && (outcome.kind === 'offline' || outcome.kind === 'timeout' || outcome.kind === 'server_error')) {
          for (const id of answerIds) lostSave.current[id] = answersBody[id];
        }
        // Rounds that went through stay sent.
        if (sentItemIds.size > 0) setItems((prev) => prev.filter((i) => !sentItemIds.has(i.id)));
        // Earlier rounds went through (the answers travel with the first): take what the server holds now.
        if (r > 0 && lastPayload) takeStored(lastPayload);
        setSending(false);
        sendingRef.current = false;
        writeCount.current += 1;
        if (askForCodeIfNeeded(outcome)) return;
        if (outcome.code === 'closed') return reloadClosed();
        if ((outcome.code === 'question_changed' || outcome.code === 'unknown_line') && (await reloadLines())) {
          if (dirty.current.size > 0) scheduleSave(200);
          setSendError('TME has just updated your imports. Please check your answers and press Send again.');
          return;
        }
        const partly = r > 0 ? `${sentAll.length} files were sent. ` : '';
        setSendError(
          partly +
            (outcome.code === 'upload_not_received'
              ? 'One of the files did not reach us. Please remove it, add it again and press Send.'
              : outcome.code === 'too_many_files'
                ? 'This link has reached the most files it can take. Please reply to our email instead.'
                : outcome.code === 'unknown_line'
                  ? 'One of the imports is no longer on the list. Please reload the page and try again.'
                  : `Could not send. ${failureMessage(outcome)}`)
        );
        return;
      }
      rounds[r].forEach((i) => sentItemIds.add(i.id));
      const {
        sent,
        answersSent,
        staleReplies: _staleReplies,
        lockedReplies,
        conflicts: refused,
        ...payload
      } = outcome.data;
      void _staleReplies;
      if (answersSent === true) serverAnswersSent = true;
      sentAll.push(...(sent ?? []));
      lastPayload = payload;
      if (refused) sendConflicts = { ...sendConflicts, ...refused };
      sendLocked.push(...(lockedReplies ?? []));
    }

    if (lastPayload) {
      setData(lastPayload);
      // Take the lines again (TME may have added or closed a question). The
      // answers are what was just sent; replies to closed questions drop out.
      const typed = answersRef.current;
      const fresh = lastPayload.customsLines ?? [];
      const r = reconcileAfterReload(answersRef.current, dirty.current, fresh, lastPayload.customsAnswers ?? {});
      setLines(fresh);
      linesRef.current = fresh;
      setAllAnswers(r.answers);
      dirty.current = new Set(r.dirty);
      takeSync(lastPayload, r.dirty);
      takeStored(lastPayload);
      noteOwnVersion(lastPayload.version, lastPayload.clientChangedAt);
      // Round 5: lines someone else changed at the same time: their version + a note.
      applyConflicts(sendConflicts, typed);
      if (sendLocked.length > 0) {
        setNotice(LOCKED_NOTE);
        keepRefusedReplies(sendLocked, answersBody, lastPayload);
      }
    }
    // Round 5 review: a refused line = the answers were NOT sent (the server
    // saved the other lines like an autosave). Stay on the table: the person
    // settles each conflict (Use mine / Keep theirs) and presses Send again.
    const conflictIds = Object.keys(sendConflicts);
    if (conflictIds.length > 0) {
      const nos = conflictIds
        .map((id) => linesRef.current.find((l) => String(l.id) === id)?.lineNo)
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b);
      const which = nos.length === 0 ? 'an import' : nos.length === 1 ? `import ${nos[0]}` : `imports ${nos.join(', ')}`;
      const filesSent =
        sentAll.length === 0 ? '' : sentAll.length === 1 ? 'Your file was sent. ' : `Your ${sentAll.length} files were sent. `;
      setItems((prev) => prev.filter((i) => !sentItemIds.has(i.id)));
      if (sentAll.length > 0) setComment('');
      setSendError(`${filesSent}Not sent yet: someone else changed ${which}. Choose Use mine or Keep theirs, then press Send again.`);
      setSending(false);
      sendingRef.current = false;
      return;
    }
    // 11.10 review: the confirmation says what the SERVER sent. Nothing went
    // out (e.g. only a locked reply changed, or the page's "unsent" was stale):
    // stay on the table; the lines are the stored ones again (taken above).
    const result = vatFilesSendResult({ answersSent: serverAnswersSent, filesSent: sentAll.length, locked: sendLocked.length > 0 });
    if (result.stay) {
      setItems((prev) => prev.filter((i) => !sentItemIds.has(i.id)));
      if (result.message) setSendError(result.message);
      setSending(false);
      sendingRef.current = false;
      return;
    }
    setItems([]);
    setSentFiles(sentAll);
    setSentAnswers(result.answersSent);
    setSending(false);
    sendingRef.current = false;
    setState('sent');
  }, [canSend, done, demo, token, comment, hasTable, unsent, reloadLines, scheduleSave, setAllAnswers, askForCodeIfNeeded, reloadClosed, takeSync, takeStored, setSavedKeys, noteOwnVersion, applyConflicts, keepRefusedReplies, refreshLostBases]);

  // ---------- Round 5: did someone else change the table? ----------
  // Every 60 s while the tab is visible, and when it gets the focus back. A
  // change shows a note with Reload; the page never reloads by itself.
  useEffect(() => {
    if (demo || state !== 'form') return;
    let stopped = false;
    let last = 0;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      if (Date.now() - last < CHANGE_CHECK_MIN_GAP_MS) return;
      if (inflight.current || sendingRef.current || !knownVersion.current) return;
      last = Date.now();
      const writes = writeCount.current;
      const since = knownClientAt.current;
      const outcome = await requestJson<VatFilesChangeInfo>(
        `/api/vat-files/${token}/version${since ? `?since=${encodeURIComponent(since)}` : ''}`,
        { cache: 'no-store' }
      );
      // Round 5 review: the link ran out while the page was open: say so (no silent stop).
      if (!stopped && !outcome.ok && outcome.code === 'expired') {
        setState('expired');
        return;
      }
      // A save of this page finished meanwhile: its version may not be known yet; ask again next time.
      if (stopped || !outcome.ok || writes !== writeCount.current || inflight.current || sendingRef.current) return;
      const text = vatFilesChangeNotice({
        knownVersion: knownVersion.current,
        ownVersions: ownVersions.current,
        pageStatus: 'open',
        change: outcome.data,
      });
      if (text) setChangeNote({ text, closed: outcome.data.status === 'closed' });
    };
    const timer = setInterval(() => void check(), CHANGE_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [demo, state, token]);

  /** Round 5, Reload on the note: save what was typed first (a line both changed comes back as a conflict note), then load. */
  const reloadForChange = useCallback(async () => {
    const closed = changeNote?.closed === true;
    setChangeNote(null);
    if (demo) return;
    if (closed) return reloadClosed();
    await saveNowRef.current();
    await reloadLines('sync');
  }, [changeNote, demo, reloadClosed, reloadLines]);

  // ---------- Round 4 B: email code ----------
  const onCodeConfirmed = useCallback(() => {
    if (demo) demoCodeOk.current = true;
    if (data && data.status === 'open') {
      // The proof ran out mid-way: back to the form, nothing typed is lost.
      setState('form');
      void reloadLines();
      if (dirty.current.size > 0) scheduleSave(200);
      return;
    }
    setState('loading');
    setLoadKey((k) => k + 1);
  }, [demo, data, reloadLines, scheduleSave]);

  const notYou = useCallback(async () => {
    if (!demo) await requestJson(`/api/vat-files/${token}/code`, { method: 'DELETE' });
    window.location.reload();
  }, [demo, token]);

  const sendMore = useCallback(() => {
    setItems([]);
    setComment('');
    setSendError(null);
    setSentFiles([]);
    setSentAnswers(false);
    setState('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ---------- States ----------
  if (state === 'code') {
    const period = clientPeriodLabel(data?.periodLabel);
    return (
      <CodeGate
        token={token}
        addresses={gate}
        demo={demo}
        title={data ? `VAT filing${period ? ` ${period}` : ''}` : null}
        onConfirmed={onCodeConfirmed}
      />
    );
  }

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

  if (state === 'expired') {
    return (
      <Shell>
        <Message
          icon={<XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />}
          title="This link has expired"
        >
          <p>
            Please use the link from our latest email, or reply to that email and we will send you a new
            one.
          </p>
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

  // A 'closed' answer without data (a row in an unknown state): the lock card only.
  if (state === 'closed' && !data) {
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

  const total = lines.length;
  const openCount = total - answeredCount;

  if (state === 'sent') {
    const title =
      sentAnswers && sentFiles.length > 0
        ? 'Thank you, we received your files and answers'
        : sentAnswers
          ? 'Thank you, we received your answers'
          : 'Thank you, we received your files';
    return (
      <Shell>
        <Header data={data} />
        <div className="flex flex-col items-center pt-4 pb-6 text-center">
          <CheckCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.success }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            {title}
          </h2>
          <p className="text-gray-600 max-w-md">
            Our VAT team will check them and contact you if anything is missing.
          </p>
          {hasTable && (
            <p className="text-gray-600 max-w-md mt-3 text-sm">
              You answered <strong>{answeredCount} of {total}</strong> {total === 1 ? 'import' : 'imports'}.
              {openCount > 0 && ' You can come back to this link any time to finish the rest.'}
            </p>
          )}
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
          {hasTable ? 'Back to your imports' : 'Send more files'}
        </button>
      </Shell>
    );
  }

  // ---------- Form (open) or read-only (closed) ----------
  const readOnly = state === 'closed';
  const deadline = formatDeadline(data?.deadline);
  const received = data?.files ?? [];
  const isCustoms = data?.kind === 'customs';
  const maxW = hasTable ? 'max-w-[1320px]' : 'max-w-3xl';

  let sendLabel: string;
  if (sending) sendLabel = 'Sending…';
  else if (uploading) sendLabel = 'Uploading…';
  else if (hasTable && done.length > 0 && unsent) sendLabel = `Send ${done.length} ${done.length === 1 ? 'file' : 'files'} and your answers`;
  else if (done.length > 0) sendLabel = `Send ${done.length} ${done.length === 1 ? 'file' : 'files'}`;
  else if (hasTable && unsent) sendLabel = 'Send your answers';
  else sendLabel = 'Send';

  const sendButton = (where: 'top' | 'bottom') => (
    <button
      type="button"
      onClick={handleSend}
      disabled={!canSend}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold text-white whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 ${FOCUS} ${
        where === 'top' ? 'h-9 px-3.5 text-[13px]' : 'h-10 px-5 text-sm w-full sm:w-auto'
      }`}
      style={{ backgroundColor: TME_COLORS.primary }}
    >
      {sending || uploading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-3.5 h-3.5" aria-hidden />}
      {sendLabel}
    </button>
  );

  const errorBanner = sendError && (
    <div className="text-[13px] rounded-lg px-3 py-2.5 flex items-start gap-2" style={{ backgroundColor: 'rgba(239,68,68,0.07)', color: TME_COLORS.error }} role="alert">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
      {sendError}
    </div>
  );

  const pendingOk = items.filter((i) => i.status !== 'failed');
  const pendingFailed = items.filter((i) => i.status === 'failed');

  return (
    <div className="min-h-screen bg-[#F6F7F9]" style={{ '--vat-top': `${barH}px` } as React.CSSProperties}>
      {/* Header: title left, summary card right (deadline, progress, saved, Send). Sticks on a laptop. */}
      <header ref={barRef} className="md:sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur-md">
        <div className={`mx-auto ${maxW} px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-3`}>
          <TitleBlock data={data} onNotYou={notYou} />
          <div className="w-full md:w-auto md:ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-white pl-3.5 pr-1.5 py-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            {deadline && (
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 shrink-0" style={{ color: TME_COLORS.secondary }} aria-hidden />
                <div className="leading-tight">
                  <p className="text-[11px] text-gray-500">{readOnly ? 'Deadline' : 'Please send by'}</p>
                  <p className="text-[13px] font-semibold tabular-nums text-gray-900">{deadline}</p>
                </div>
              </div>
            )}
            {hasTable && (
              <>
                <span className="hidden md:block w-px h-7 bg-gray-200" aria-hidden />
                <div className="hidden md:flex items-center gap-2">
                  <ProgressRing value={answeredCount} total={total} />
                  <div className="leading-tight">
                    <p className="text-[13px] font-semibold tabular-nums text-gray-900">
                      {answeredCount} of {total}
                    </p>
                    <p className="text-[11px] text-gray-500">answered</p>
                  </div>
                </div>
                {!readOnly && (
                  <>
                    <span className="hidden md:block w-px h-7 bg-gray-200" aria-hidden />
                    <div className="hidden md:block min-w-[88px]" aria-live="polite">
                      <SaveStatus save={save} onRetry={retrySave} compact />
                    </div>
                  </>
                )}
              </>
            )}
            <div className="ml-auto">
              {readOnly ? (
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-gray-100 text-[13px] font-semibold text-gray-600 whitespace-nowrap">
                  <Lock className="w-3.5 h-3.5" aria-hidden />
                  Closed
                </span>
              ) : (
                sendButton('top')
              )}
            </div>
          </div>
        </div>
        {/* Round 5: someone else changed the table (laptop: under the sticky header). */}
        <AnimatePresence initial={false}>
          {!readOnly && changeNote && (
            <motion.div
              key="change-note"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="hidden md:block overflow-hidden"
            >
              <div className={`mx-auto ${maxW} px-4 sm:px-6 pb-3`}>
                <ChangeBanner text={changeNote.text} closed={changeNote.closed} onReload={reloadForChange} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      {/* Phone: the same note at the bottom of the screen (the header does not stick there). */}
      <AnimatePresence>
        {!readOnly && changeNote && (
          <motion.div
            key="change-note-phone"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden fixed inset-x-3 bottom-3 z-40"
          >
            <ChangeBanner text={changeNote.text} closed={changeNote.closed} onReload={reloadForChange} />
          </motion.div>
        )}
      </AnimatePresence>

      <main className={`mx-auto ${maxW} px-4 sm:px-6 py-4 sm:py-5 space-y-4`}>
        {readOnly && <ClosedNotice />}
        {errorBanner}

        {/* What we need */}
        <section className={`${CARD} px-4 py-3.5`} aria-labelledby="vat-need-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 mb-2.5">
            <h2 id="vat-need-title" className="text-[13px] font-semibold" style={{ color: TME_COLORS.primary }}>
              {readOnly ? 'What we asked for' : 'What we need'}
            </h2>
            {!readOnly && (
              <p className="text-xs text-gray-500">
                {hasTable
                  ? 'A few details and the documents for each import in the FTA list below.'
                  : isCustoms
                    ? 'The documents for the imports on the FTA import list. Please upload them here and press Send.'
                    : 'The documents below. Please upload them here and press Send.'}{' '}
                Your files go only to the TME VAT team.
              </p>
            )}
          </div>
          {(data?.requestedItems.length ?? 0) > 0 && (
            <ol className={hasTable ? 'grid gap-y-2 md:flex md:gap-x-8' : 'space-y-1.5'}>
              {data?.requestedItems.map((item, i) => (
                <li
                  key={i}
                  className={`flex gap-2.5 text-[13px] text-gray-700 leading-snug ${hasTable ? 'md:flex-auto md:min-w-0' : ''}`}
                >
                  <span
                    className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums"
                    style={{ backgroundColor: 'rgba(36,63,123,0.08)', color: TME_COLORS.primary }}
                  >
                    {i + 1}
                  </span>
                  <span className="pt-px break-words min-w-0 whitespace-pre-line">{item}</span>
                </li>
              ))}
            </ol>
          )}

          {data?.hasCustomsList && !hasTable && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-2">
              {demo ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 px-3.5 rounded-lg text-[13px] font-semibold text-white items-center justify-center gap-2 opacity-60 cursor-not-allowed"
                  style={{ backgroundColor: TME_COLORS.primary }}
                  title="Demo: no file to download"
                >
                  <Download className="w-4 h-4" />
                  Download the FTA import list
                </button>
              ) : (
                <a
                  href={`/api/vat-files/${token}/customs-list`}
                  className={`inline-flex h-9 px-3.5 rounded-lg text-[13px] font-semibold text-white items-center justify-center gap-2 ${FOCUS}`}
                  style={{ backgroundColor: TME_COLORS.primary }}
                >
                  <Download className="w-4 h-4" />
                  Download the FTA import list
                </a>
              )}
              {!readOnly && (
                <p className="text-xs text-gray-500">Fill in the yellow columns and upload the list again together with your documents.</p>
              )}
            </div>
          )}

          {!readOnly && received.length > 0 && (
            <details className="mt-3 pt-3 border-t border-gray-100 group">
              <summary className={`text-[13px] font-medium cursor-pointer rounded inline-flex items-center gap-1.5 ${FOCUS}`} style={{ color: TME_COLORS.primary }}>
                <CheckCircle className="w-4 h-4" style={{ color: TME_COLORS.success }} aria-hidden />
                Already received: {received.length} {received.length === 1 ? 'file' : 'files'}
              </summary>
              <div className="mt-2.5">
                <FileList files={received} />
              </div>
            </details>
          )}
        </section>

        {hasTable && (
          <CustomsTable
            lines={lines}
            answers={answers}
            defaults={data?.customsDefaults ?? null}
            sentAt={data?.customsAnswersSentAt ?? null}
            fileCounts={fileCounts}
            save={save}
            disabled={sending}
            excelHref={demo ? null : `/api/vat-files/${token}/customs-list`}
            hasExcel={!!data?.hasCustomsList}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onChange={onLineChange}
            onFill={onFill}
            onAddFile={onAddLineFile}
            onRetrySave={retrySave}
            readOnly={readOnly}
            replyMeta={replyMetaByLine}
            peopleNames={data?.peopleNames}
            sentReplies={sentReplies}
            savedAnswers={data?.customsAnswers}
            conflicts={conflicts}
            onUseMine={onUseMine}
            onKeepTheirs={onKeepTheirs}
            lockedNotes={lockedNotes}
            onDismissLocked={onDismissLocked}
          />
        )}
        {!readOnly && (
          <input
            ref={lineInputRef}
            type="file"
            accept={VAT_FILES_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files, lineTarget.current);
              lineTarget.current = null;
            }}
          />
        )}

        {/* Closed: what was sent, names only (no downloads), and the comment. */}
        {readOnly && (
          <section className={`${CARD} p-4`} aria-labelledby="vat-sent-title">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 mb-2">
              <h2 id="vat-sent-title" className="text-[13px] font-semibold" style={{ color: TME_COLORS.primary }}>
                Files you sent
                {received.length > 0 && <span className="font-normal text-gray-500"> ({received.length})</span>}
              </h2>
              {data?.customsAnswersSentAt && (
                <p className="lg:hidden text-xs text-gray-500 tabular-nums">Answers last sent: {formatDubaiDateTime(data.customsAnswersSentAt)}</p>
              )}
            </div>
            {received.length > 0 ? (
              <FileList files={received} withDate />
            ) : (
              <p className="text-[13px] text-gray-500">No files were sent through this link.</p>
            )}
            {data?.clientComment && (
              <div className="mt-4">
                <p className="text-[13px] font-semibold mb-1.5" style={{ color: TME_COLORS.primary }}>
                  Your comment
                </p>
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 whitespace-pre-line break-words">
                  {data.clientComment}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Files, comment, Send */}
        {!readOnly && (
          <section className={`${CARD} p-4`} aria-labelledby="vat-files-title">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 mb-2">
              <h2 id="vat-files-title" className="text-[13px] font-semibold" style={{ color: TME_COLORS.primary }}>
                {hasTable ? 'Other files' : 'Your files'}
              </h2>
              {hasTable && (
                <p className="text-xs text-gray-500">
                  Anything that does not belong to one import, or several documents at once. Files you add on a row above are listed here too.
                </p>
              )}
            </div>
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
              className={`w-full border border-dashed rounded-lg transition-colors disabled:opacity-60 hover:bg-gray-50 ${FOCUS} ${
                hasTable
                  ? 'min-h-12 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-left'
                  : 'py-7 px-4 flex flex-col items-center justify-center gap-1.5'
              }`}
              style={{
                borderColor: dragging ? TME_COLORS.primary : '#D1D5DB',
                backgroundColor: dragging ? 'rgba(36,63,123,0.04)' : undefined,
              }}
            >
              <UploadCloud className={hasTable ? 'w-[18px] h-[18px] shrink-0' : 'w-6 h-6'} style={{ color: TME_COLORS.primary }} aria-hidden />
              <span className="text-[13px] text-gray-700 font-medium">
                Drop files or{' '}
                <span className="underline underline-offset-2" style={{ color: TME_COLORS.primary }}>
                  browse
                </span>
              </span>
              <span className={`text-xs text-gray-500 ${hasTable ? 'sm:ml-auto' : 'text-center'}`}>
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

            {pendingOk.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Files to send">
                {pendingOk.map((item) => (
                  <li
                    key={item.id}
                    className="inline-flex items-center gap-1.5 h-7 max-w-full pl-2 pr-0.5 rounded-full border border-gray-200 bg-gray-50 text-xs"
                  >
                    {item.status === 'done' ? (
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: TME_COLORS.success }} aria-hidden />
                    ) : (
                      <Loader2
                        className={`w-3.5 h-3.5 shrink-0 ${item.status === 'uploading' ? 'animate-spin' : ''}`}
                        style={{ color: TME_COLORS.primary }}
                        aria-hidden
                      />
                    )}
                    <span className="truncate min-w-0 max-w-[220px] text-gray-800" title={item.file.name}>
                      {item.file.name}
                    </span>
                    {item.lineId && item.docKind && (
                      <span className="shrink-0 rounded-full bg-white border border-gray-200 px-1.5 text-[11px] text-gray-600 whitespace-nowrap">
                        Import {lineNoById.get(item.lineId) ?? ''} · {DOC_KIND_LABEL[item.docKind]}
                      </span>
                    )}
                    <span className="shrink-0 text-gray-400 tabular-nums whitespace-nowrap">
                      {item.status === 'queued' ? 'Waiting…' : item.status === 'uploading' ? 'Uploading…' : formatBytes(item.file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item)}
                      disabled={item.status === 'uploading' || sending}
                      aria-label={`Remove ${item.file.name}`}
                      title="Remove this file"
                      className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent ${FOCUS}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pendingFailed.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {pendingFailed.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2 rounded-lg px-3 py-2 border text-xs"
                    style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.25)' }}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: TME_COLORS.error }} aria-hidden />
                    <span className="flex-1 min-w-0">
                      <span className="block text-gray-800 truncate">
                        {item.file.name}
                        {item.lineId && item.docKind && (
                          <span className="text-gray-500">
                            {' '}
                            · Import {lineNoById.get(item.lineId) ?? ''} · {DOC_KIND_LABEL[item.docKind]}
                          </span>
                        )}
                      </span>
                      <span className="block mt-0.5" style={{ color: TME_COLORS.error }}>
                        {item.error}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item)}
                      disabled={sending}
                      aria-label={`Remove ${item.file.name}`}
                      title="Remove this file"
                      className={`shrink-0 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 ${FOCUS}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <label htmlFor="vat-files-comment" className="block text-[13px] font-semibold mb-1.5" style={{ color: TME_COLORS.primary }}>
                Comment <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <textarea
                id="vat-files-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, VAT_FILES_MAX_COMMENT))}
                rows={2}
                placeholder={hasTable ? 'Anything we should know about these imports?' : 'Anything we should know about these files?'}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-base sm:text-[13px] text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus:border-[#243F7B] focus:ring-2 focus:ring-[#243F7B]/20"
              />
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
              {errorBanner}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0 text-[13px] text-gray-600 space-y-0.5">
                  {hasTable && openCount > 0 && (
                    <p>
                      {openCount} {openCount === 1 ? 'import still needs answers' : 'imports still need answers'}. You can send now and finish
                      later.
                    </p>
                  )}
                  {hasTable && !unsent && done.length === 0 && data?.customsAnswersSentAt && (
                    <p className="text-xs text-gray-500">
                      Your answers are already with TME. Any change you make is sent with the next Send. Replies to TME questions cannot be
                      changed after Send.
                    </p>
                  )}
                  {demo && <p className="text-xs text-gray-400">Demo page: nothing is saved.</p>}
                </div>
                {sendButton('bottom')}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
