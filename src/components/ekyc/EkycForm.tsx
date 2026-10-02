'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, Info, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import {
  EKYC_PREFILL_NOTICE,
  EKYC_PRIVACY_PARAGRAPHS,
  EKYC_PRIVACY_TITLE,
  EKYC_SUBMIT_WARNING,
  EKYC_SUBMITTED_NOTICE,
  getEkycValue,
  isEkycFieldVisible,
  isEkycLatinNameField,
  type EkycDocumentSlot,
  type EkycFieldDef,
  type EkycGroupDef,
  type EkycOption,
  type EkycPrefillData,
  type EkycText,
  type EkycValidationError,
  type IndividualKycData,
  INDIVIDUAL_FIELD_CAPTIONS,
  emptyLicenseBlock,
  emptyShareholder,
  emptyUbo,
} from '@/types/ekyc';
import {
  EKYC_MAX_UPLOAD_BYTES,
  applyEkycLatinNames,
  buildInitialEkycData,
  clearHiddenFields,
  ekycErrorLabel,
  ekycRowHeading,
  ekycSchemaFor,
  setEkycValue,
  validateEkycData,
  type EkycFormData,
} from '@/lib/ekyc-form';
import {
  EKYC_GROUP_ROWS,
  ekycErrorsForStep,
  ekycFirstIncompleteStep,
  ekycSortErrors,
  ekycStepIndexOfPath,
  ekycStepsFor,
  type EkycStepDef,
} from '@/lib/ekyc-steps';
import type { EkycClientDocuments, EkycClientPayload } from '@/lib/ekyc-token';
import { shrinkImageToBudget } from '@/lib/supabase';
import { Bi, BiIntro, BiLabel, BiNotice, BiTitle, hasGermanLine, useEkycBilingual } from './Bi';
import { EkycField, ekycFieldIsWide, FieldHint } from './EkycField';
import { ekycCountryIso } from './EkycInputs';
import { EkycDocuments, type EkycUploadResult } from './EkycDocuments';
import { EkycReview } from './EkycReview';
import {
  EkycHeader,
  EkycMobileStepBar,
  EkycStepList,
  EkycStepNav,
  type SaveState,
  type StepEntry,
  type StepStatus,
} from './EkycChrome';
import { EKYC_UI } from './texts';

const AUTOSAVE_DEBOUNCE_MS = 2000;
const AUTOSAVE_RETRY_BASE_MS = 4000;
const AUTOSAVE_RETRY_MAX_MS = 60_000;

/** The view before step 1 (what you need, how long it takes). */
const START = -1;

export type EkycClosedReason = 'expired' | 'cancelled' | 'submitted';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows differ per group
type AnyGroup = EkycGroupDef<EkycFormData, any>;
type AnyField = EkycFieldDef<EkycFormData, EkycFormData>;

const EMPTY_ROW: Record<string, () => object> = {
  licenses: emptyLicenseBlock,
  shareholders: emptyShareholder,
  ubos: emptyUbo,
};

function errorsByField(list: EkycValidationError[]): Record<string, EkycText> {
  const out: Record<string, EkycText> = {};
  for (const e of list) if (!out[e.fieldId]) out[e.fieldId] = e.message;
  return out;
}

/** Validator input for the uploads: a slot counts once a file is on record. */
function documentsForValidation(documents: EkycClientDocuments): Partial<Record<EkycDocumentSlot, { path: string }>> {
  const out: Partial<Record<EkycDocumentSlot, { path: string }>> = {};
  for (const [slot, doc] of Object.entries(documents)) {
    if (doc) out[slot as EkycDocumentSlot] = { path: slot };
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Pre-fill marks that still hold: a field keeps its tag only while its value
 * is still the pre-filled one. On a first visit that is every pre-filled
 * field; on a return visit a field the client changed, or a row that moved
 * (one removed above it), loses the tag. `baseline` is the form as the
 * pre-fill alone builds it (same sanitizing as the answers).
 */
function initialPrefillMarks(
  prefill: EkycPrefillData | null,
  data: EkycFormData,
  baseline: EkycFormData,
  groups: readonly AnyGroup[]
) {
  const ids = (prefill?.prefilledFieldIds ?? []).filter((id) => sameValue(getEkycValue(data, id), getEkycValue(baseline, id)));
  const marked = new Set(ids);
  const top = new Set(ids);
  const rows: Record<string, string[][]> = {};
  for (const group of groups) {
    const list = getEkycValue(data, group.id);
    const count = Array.isArray(list) ? list.length : 0;
    rows[group.id] = Array.from({ length: count }, (_, i) =>
      group.fields.map((f) => f.id).filter((f) => marked.has(`${group.id}.${i}.${f}`))
    );
  }
  return { top, rows };
}

/**
 * Body of the leave-page save. A drawn signature is most of the payload and
 * keepalive bodies are capped (~64 KB), so an unchanged signature stays out:
 * `keepSignature` tells the server to keep the one on record.
 */
export function keepaliveBody(formData: EkycFormData, savedSignature: string): { formData: unknown; keepSignature?: true } {
  const declaration = formData.declaration;
  const signature = declaration?.signature ?? '';
  if (!declaration || !signature || signature !== savedSignature) return { formData };
  const { signature: _omit, ...rest } = declaration;
  void _omit;
  return { formData: { ...formData, declaration: rest }, keepSignature: true };
}

/** Id of the element to scroll to for an error path. */
function anchorIdFor(path: string): string {
  return `ekyc-${path.replace(/\./g, '-')}-field`;
}

function scrollToAnchor(path: string) {
  const el = document.getElementById(anchorIdFor(path));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // The field's own input first (id 'ekyc-<path>'): the NUMBER of a phone and
  // the AMOUNT of a money field, not the country / currency picker before it;
  // the first box of a list.
  const own = document.getElementById(`ekyc-${path.replace(/\./g, '-')}`);
  if (own && el.contains(own) && own.matches('input:not([type="file"]):not([type="hidden"]), textarea')) {
    own.focus({ preventScroll: true });
    return;
  }
  // An upload's file input is hidden: its visible button takes the focus.
  const focusable = el.querySelector<HTMLElement>(
    'input:not([type="file"]):not([type="hidden"]), textarea, select, button, [tabindex="0"]'
  );
  focusable?.focus({ preventScroll: true });
}

function Notice({ text, tone, compact = false }: { text: EkycText; tone: 'warn' | 'info' | 'success'; compact?: boolean }) {
  const styles = {
    warn: { bg: '#fffbeb', border: '#f59e0b', color: '#92400e', Icon: AlertCircle },
    info: { bg: 'rgba(36,63,123,0.05)', border: TME_COLORS.primary, color: TME_COLORS.primary, Icon: Info },
    success: { bg: '#f0fdf4', border: TME_COLORS.success, color: '#166534', Icon: CheckCircle },
  }[tone];
  const { Icon } = styles;
  return (
    <div
      className={`flex gap-3 rounded-xl border-l-4 text-sm ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
      style={{ backgroundColor: styles.bg, borderColor: styles.border, color: styles.color }}
    >
      <Icon className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} shrink-0 mt-0.5`} />
      <BiNotice text={text} className="min-w-0" />
    </div>
  );
}

/** Error summary at the top of a step / of Check your answers: names each problem, links to it. */
function ErrorSummary({
  title,
  items,
  onPick,
  summaryRef,
}: {
  title: EkycText;
  items: { id: string; label: EkycText; message: EkycText }[];
  onPick: (path: string) => void;
  summaryRef?: React.Ref<HTMLDivElement>;
}) {
  const bilingual = useEkycBilingual();
  if (items.length === 0) return null;
  return (
    <div ref={summaryRef} tabIndex={-1} className="rounded-xl border-2 border-red-200 bg-red-50 p-4 outline-none" role="alert">
      <div className="mb-2 text-sm font-semibold text-red-700">
        <Bi text={title} deClassName="!text-red-600" />
      </div>
      <ul className="space-y-1.5 text-sm text-red-700">
        {items.map((m) => {
          const en = `${m.label.en}: ${m.message.en}`;
          const de = `${m.label.de || m.label.en}: ${m.message.de || m.message.en}`;
          return (
            <li key={m.id}>
              <button type="button" className="text-left underline underline-offset-2 hover:no-underline" onClick={() => onPick(m.id)}>
                <span className="block">{en}</span>
                {bilingual && hasGermanLine({ en, de }) && (
                  <span lang="de" className="block text-xs text-red-500">
                    {de}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "Submit the form?": a modal dialog. Cancel has the focus on open, Escape
 * closes, Tab stays inside; the caller puts the focus back on Submit.
 */
function ConfirmDialog({
  submitting,
  uploading,
  onCancel,
  onConfirm,
}: {
  submitting: boolean;
  uploading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = 'ekyc-confirm-title';

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // On the document, so Escape and Tab work even after a click on the backdrop.
  const latest = useRef({ submitting, onCancel });
  useEffect(() => {
    latest.current = { submitting, onCancel };
  });
  useEffect(() => {
    const trapTab = (e: KeyboardEvent) => {
      const box = boxRef.current;
      const focusables = Array.from(
        box?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])') ?? []
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = !!box && box.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!latest.current.submitting) latest.current.onCancel();
        return;
      }
      if (e.key === 'Tab') trapTab(e);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h3 id={titleId} className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
          <Bi text={EKYC_UI.confirmTitle} />
        </h3>
        <div className="mt-3">
          <Notice text={EKYC_SUBMIT_WARNING} tone="info" />
        </div>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="min-h-[44px] rounded-lg border-2 border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <Bi text={EKYC_UI.cancel} variant="inline" className="items-center" />
          </button>
          <button
            type="button"
            disabled={submitting || uploading}
            onClick={onConfirm}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: TME_COLORS.primary }}
          >
            {submitting && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
            <Bi text={submitting ? EKYC_UI.submitting : EKYC_UI.confirmSubmit} variant="inline" className="items-center" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 ${className}`}>{children}</div>;
}

export interface EkycFormProps {
  token: string;
  payload: EkycClientPayload;
  readOnly: boolean;
  onSubmitted: (data: EkycFormData, documents: EkycClientDocuments) => void;
  onClosed: (reason: EkycClosedReason) => void;
}

export function EkycForm({ token, payload, readOnly, onSubmitted, onClosed }: EkycFormProps) {
  const type = payload.type;
  const schema = useMemo(() => ekycSchemaFor(type), [type]);
  const steps = useMemo(() => ekycStepsFor(type), [type]);
  const checkIndex = steps.length;
  const fieldsById = useMemo(() => new Map(schema.fields.map((f) => [f.id, f as AnyField])), [schema]);
  const groupsById = useMemo(() => new Map(schema.groups.map((g) => [g.id, g as AnyGroup])), [schema]);

  // R6: an individual form is never pre-filled, whatever the row says.
  const prefill = type === 'corporate' ? payload.prefill : null;
  const showPrefillNotice = type === 'corporate' && (prefill?.prefilledFieldIds?.length ?? 0) > 0;

  const [data, setData] = useState<EkycFormData>(() => buildInitialEkycData(type, prefill, payload.formData));
  const [documents, setDocuments] = useState<EkycClientDocuments>(payload.documents ?? {});
  // Pre-fill tags: only where the value is still the pre-filled one (a return visit may have changed it).
  const [initialMarks] = useState(() =>
    initialPrefillMarks(
      prefill,
      buildInitialEkycData(type, prefill, payload.formData),
      buildInitialEkycData(type, prefill, null),
      schema.groups as readonly AnyGroup[]
    )
  );
  const prefilledTop = initialMarks.top;
  const [rowMarks, setRowMarks] = useState<Record<string, string[][]>>(initialMarks.rows);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<EkycValidationError[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<EkycText | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [busySlots, setBusySlots] = useState<Partial<Record<EkycDocumentSlot, boolean>>>({});
  const uploading = Object.values(busySlots).some(Boolean);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  // The contract's validator on the current answers (cheap: a schema walk).
  const validated = useMemo<EkycValidationError[]>(
    () => validateEkycData(type, data, documentsForValidation(documents)),
    [type, data, documents]
  );
  const liveErrors = serverErrors ?? validated;

  // ---------- Steps ----------
  // A first visit opens on the start page; a return visit on the first step
  // with something missing (or Check your answers when nothing is).
  const [initialStep] = useState(() =>
    payload.formData ? ekycFirstIncompleteStep(steps, validated) : START
  );
  const [current, setCurrent] = useState<number>(initialStep);
  const [visited, setVisited] = useState<Set<number>>(
    () => new Set(Array.from({ length: Math.max(0, Math.min(initialStep, steps.length)) }, (_, i) => i))
  );
  const [attemptedSteps, setAttemptedSteps] = useState<Set<number>>(() => new Set());

  const stepErrors = useCallback((index: number) => ekycErrorsForStep(steps, index, liveErrors), [steps, liveErrors]);
  const errorsShownFor = useCallback(
    (index: number) => submitAttempted || serverErrors !== null || attemptedSteps.has(index),
    [submitAttempted, serverErrors, attemptedSteps]
  );

  const stepStatus = useCallback(
    (index: number): StepStatus => {
      const has = stepErrors(index).length > 0;
      if (has) return errorsShownFor(index) ? 'error' : 'todo';
      return visited.has(index) ? 'done' : 'todo';
    },
    [stepErrors, errorsShownFor, visited]
  );

  const entries: StepEntry[] = useMemo(
    () => [
      ...steps.map((s, i) => ({ title: s.title, status: stepStatus(i) })),
      { title: EKYC_UI.checkTitle, status: 'todo' as StepStatus },
    ],
    [steps, stepStatus]
  );

  // Errors shown under the fields: the current step's, once tried (or after Submit).
  const shownErrors = useMemo(() => {
    if (current < 0 || current >= checkIndex) return {};
    return errorsShownFor(current) ? errorsByField(stepErrors(current)) : {};
  }, [current, checkIndex, errorsShownFor, stepErrors]);

  // ---------- Draft save (autosave + Save draft button) ----------
  const latest = useRef(data);
  latest.current = data;
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const seq = useRef(0);
  const retryDelay = useRef(AUTOSAVE_RETRY_BASE_MS);
  const closed = useRef(readOnly);
  // The signature on record after the last good save. The leave-page save
  // leaves an unchanged signature out (keepalive bodies are capped at ~64 KB);
  // the server keeps the stored one.
  const savedSignature = useRef<string>(
    String(getEkycValue(buildInitialEkycData(type, prefill, payload.formData), 'declaration.signature') ?? '')
  );
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  const handleClosedStatus = useCallback(
    async (res: Response): Promise<boolean> => {
      if (res.status !== 409 && res.status !== 410) return false;
      if (closed.current) return true;
      closed.current = true;
      dirty.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (res.status === 409) {
        onClosed('submitted');
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        onClosed(body.error === 'cancelled' ? 'cancelled' : 'expired');
      }
      return true;
    },
    [onClosed]
  );

  const scheduleSaveIn = useCallback((delay: number) => {
    if (closed.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNowRef.current(), delay);
  }, []);

  const saveNow = useCallback(async () => {
    if (closed.current || !dirty.current || inFlight.current) return;
    dirty.current = false;
    inFlight.current = true;
    const mySeq = ++seq.current;
    let retryScheduled = false;
    setSaveState('saving');
    const sent = latest.current;
    try {
      const res = await fetch(`/api/kyc/${token}/autosave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formData: sent }),
      });
      if (await handleClosedStatus(res)) return;
      if (res.ok) {
        savedSignature.current = String(getEkycValue(sent, 'declaration.signature') ?? '');
        retryDelay.current = AUTOSAVE_RETRY_BASE_MS;
        if (mySeq === seq.current) setSaveState(dirty.current ? 'idle' : 'saved');
        return;
      }
      dirty.current = true;
      if (res.status === 413) {
        setSaveState('too_large');
        return;
      }
      setSaveState('error');
      scheduleSaveIn(retryDelay.current);
      retryScheduled = true;
      retryDelay.current = Math.min(retryDelay.current * 2, AUTOSAVE_RETRY_MAX_MS);
    } catch {
      dirty.current = true;
      setSaveState('error');
      scheduleSaveIn(retryDelay.current);
      retryScheduled = true;
      retryDelay.current = Math.min(retryDelay.current * 2, AUTOSAVE_RETRY_MAX_MS);
    } finally {
      inFlight.current = false;
      if (dirty.current && !closed.current && !retryScheduled) scheduleSaveIn(AUTOSAVE_DEBOUNCE_MS);
    }
  }, [token, handleClosedStatus, scheduleSaveIn]);
  saveNowRef.current = saveNow;

  const scheduleSave = useCallback(() => {
    if (closed.current) return;
    dirty.current = true;
    setSaveState((prev) => (prev === 'error' || prev === 'too_large' ? prev : 'idle'));
    scheduleSaveIn(AUTOSAVE_DEBOUNCE_MS);
  }, [scheduleSaveIn]);

  const saveDraftClick = useCallback(() => {
    if (closed.current) return;
    if (timer.current) clearTimeout(timer.current);
    dirty.current = true;
    void saveNow();
  }, [saveNow]);

  /** Save pending edits now (on every step change). */
  const flushSave = useCallback(() => {
    if (closed.current || !dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    void saveNow();
  }, [saveNow]);

  // Leaving the page must not drop the last edits.
  useEffect(() => {
    if (readOnly) return;
    const flush = () => {
      if (closed.current || !dirty.current) return;
      try {
        void fetch(`/api/kyc/${token}/autosave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(keepaliveBody(latest.current, savedSignature.current)),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // keepalive bodies are capped (~64 KB); the debounced save still runs.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, readOnly]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // ---------- Updates ----------
  const update = useCallback(
    (path: string, value: unknown) => {
      if (closed.current) return;
      // A hidden field clears its value (a "No" drops the follow-up answers).
      // Person names stay Latin (D8), also when a change makes the rule apply
      // (a shareholder switched to an individual).
      setData((prev) => applyEkycLatinNames(schema, clearHiddenFields(schema, setEkycValue(prev, path, value))));
      setServerErrors(null);
      scheduleSave();
    },
    [schema, scheduleSave]
  );

  const addRow = useCallback(
    (group: AnyGroup) => {
      setData((prev) => {
        const rows = (getEkycValue(prev, group.id) as unknown[]) ?? [];
        if (group.max !== undefined && rows.length >= group.max) return prev;
        return setEkycValue(prev, group.id, [...rows, EMPTY_ROW[group.id]()]);
      });
      setRowMarks((prev) => ({ ...prev, [group.id]: [...(prev[group.id] ?? []), []] }));
      setServerErrors(null);
      scheduleSave();
    },
    [scheduleSave]
  );

  const removeRow = useCallback(
    (group: AnyGroup, index: number) => {
      setData((prev) => {
        const rows = (getEkycValue(prev, group.id) as unknown[]) ?? [];
        if (rows.length <= group.min) return prev;
        return setEkycValue(prev, group.id, rows.filter((_, i) => i !== index));
      });
      setRowMarks((prev) => ({ ...prev, [group.id]: (prev[group.id] ?? []).filter((_, i) => i !== index) }));
      setServerErrors(null);
      scheduleSave();
    },
    [scheduleSave]
  );

  // ---------- Uploads ----------
  const handleUpload = useCallback(
    async (slot: EkycDocumentSlot, picked: File): Promise<EkycUploadResult> => {
      setBusySlots((prev) => ({ ...prev, [slot]: true }));
      try {
        // A large photo is shrunk in the browser first (Netlify cuts bodies at ~6 MB).
        const file = await shrinkImageToBudget(picked);
        if (file.size > EKYC_MAX_UPLOAD_BYTES) return { ok: false, message: EKYC_UI.tooBig };
        const form = new FormData();
        form.append('slot', slot);
        form.append('file', file);
        const res = await fetch(`/api/kyc/${token}/upload`, { method: 'POST', body: form });
        if (await handleClosedStatus(res)) return { ok: false, closedStatus: res.status, message: EKYC_UI.uploadFailed };
        if (res.status === 415) return { ok: false, message: EKYC_UI.wrongType };
        if (res.status === 413) return { ok: false, message: EKYC_UI.tooBig };
        if (!res.ok) return { ok: false, message: EKYC_UI.uploadFailed };
        const body = (await res.json()) as { document?: EkycClientDocuments[EkycDocumentSlot] };
        if (!body.document) return { ok: false, message: EKYC_UI.uploadFailed };
        const doc = body.document;
        setDocuments((prev) => ({ ...prev, [slot]: doc }));
        setServerErrors(null);
        return { ok: true, document: doc };
      } catch {
        return { ok: false, message: EKYC_UI.uploadFailed };
      } finally {
        setBusySlots((prev) => ({ ...prev, [slot]: false }));
      }
    },
    [token, handleClosedStatus]
  );

  // ---------- Navigation ----------
  const pendingAnchor = useRef<string | null>(null);
  // Bumped on every Continue / Submit with problems: each press brings the summary into view again.
  const [summaryFocusTick, setSummaryFocusTick] = useState(0);
  const focusSummary = useCallback(() => setSummaryFocusTick((n) => n + 1), []);

  const currentRef = useRef(current);
  currentRef.current = current;

  const goTo = useCallback(
    (index: number, anchor?: string) => {
      flushSave();
      const prev = currentRef.current;
      // Leaving a step counts as having seen it.
      if (prev >= 0 && prev < steps.length && prev !== index) {
        setVisited((v) => (v.has(prev) ? v : new Set(v).add(prev)));
      }
      pendingAnchor.current = anchor ?? null;
      setCurrent(index);
    },
    [flushSave, steps.length]
  );

  // After a step change: to the top (or to the field asked for), focus the heading.
  useEffect(() => {
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (anchor) {
      setTimeout(() => scrollToAnchor(anchor), 60);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0 });
      } catch {
        // jsdom
      }
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [current]);

  useEffect(() => {
    if (summaryFocusTick === 0) return;
    summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    summaryRef.current?.focus({ preventScroll: true });
  }, [summaryFocusTick]);

  const continueFrom = (index: number) => {
    setAttemptedSteps((prev) => (prev.has(index) ? prev : new Set(prev).add(index)));
    if (stepErrors(index).length > 0) {
      focusSummary();
      return;
    }
    goTo(index + 1);
  };

  const pickError = (path: string) => {
    const index = ekycStepIndexOfPath(steps, path);
    if (index >= 0 && index !== current) {
      setAttemptedSteps((prev) => new Set(prev).add(index));
      goTo(index, path);
      return;
    }
    scrollToAnchor(path);
  };

  // ---------- Submit ----------
  const handleSubmitClick = () => {
    if (uploading) return;
    setSubmitAttempted(true);
    setServerErrors(null);
    setSubmitError(null);
    if (validated.length > 0) {
      focusSummary();
      return;
    }
    setConfirmOpen(true);
  };

  /** Close the confirm dialog; the focus goes back to Submit. */
  const closeConfirm = () => {
    setConfirmOpen(false);
    submitButtonRef.current?.focus();
  };

  const confirmSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    // Stop the draft save: the submit carries the full answers.
    closed.current = true;
    if (timer.current) clearTimeout(timer.current);
    try {
      const res = await fetch(`/api/kyc/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formData: data }),
      });
      if (res.ok) {
        setConfirmOpen(false);
        onSubmitted(data, documents);
        return;
      }
      if (res.status === 409) {
        const body = (await res.clone().json().catch(() => ({}))) as { error?: string };
        if (body.error === 'changed') {
          // Another write landed in between (an upload or a draft save). Nothing
          // is lost: keep the answers, save them as a draft, ask to try again.
          closed.current = false;
          closeConfirm();
          setSubmitError(EKYC_UI.submitChanged);
          dirty.current = true;
          scheduleSaveIn(AUTOSAVE_DEBOUNCE_MS);
          return;
        }
      }
      if (res.status === 409 || res.status === 410) {
        closed.current = false;
        await handleClosedStatus(res);
        return;
      }
      closed.current = false;
      setConfirmOpen(false);
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as { errors?: EkycValidationError[] };
        if (Array.isArray(body.errors) && body.errors.length > 0) {
          setServerErrors(body.errors);
          focusSummary();
          return;
        }
      }
      closeConfirm();
      setSubmitError(EKYC_UI.submitFailed);
    } catch {
      closed.current = false;
      closeConfirm();
      setSubmitError(EKYC_UI.submitFailed);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Field rendering ----------
  /**
   * One row of fields. Two or three side by side on a wide screen: each field
   * is a two-row subgrid (label + hint, then the input), so the inputs line
   * up whatever the label and hint heights. A field alone takes the full
   * width when it is wide (long label, long hint, text area, lists),
   * otherwise one column.
   * A "Pre-filled" tag sits in a fixed slot under the input; when one field
   * of the row has a tag, every field of the row keeps that slot, so the
   * tags, errors and the next row line up.
   */
  const renderRow = (
    key: string,
    cells: {
      field: AnyField;
      options?: readonly EkycOption[];
      prefilled: boolean;
      render: (layout: 'stack' | 'cell', className: string, tagSlot: boolean) => React.ReactNode;
    }[]
  ) => {
    if (cells.length === 0) return null;
    const tagSlot = cells.some((c) => c.prefilled);
    if (cells.length === 1) {
      const { field, options, render } = cells[0];
      const wide = ekycFieldIsWide(field, options) || field.label.en.length > 60 || (field.hint?.en.length ?? 0) > 120;
      return (
        <div key={key} className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {render('stack', wide ? 'md:col-span-2' : '', tagSlot)}
        </div>
      );
    }
    const cols = cells.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';
    return (
      <div key={key} className={`grid grid-cols-1 gap-x-6 gap-y-1.5 ${cols}`}>
        {cells.map((c, i) => c.render('cell', i < cells.length - 1 ? 'max-md:mb-5' : '', tagSlot))}
      </div>
    );
  };

  /** A home number starts on the home country (when chosen); every other number on the UAE. */
  const phoneCountryFor = (fieldId: string) =>
    fieldId === 'homePhone' ? (ekycCountryIso(String(getEkycValue(data, 'homeAddress.country') ?? '')) ?? 'AE') : 'AE';

  const renderTopField = (field: AnyField, layout: 'stack' | 'row' | 'cell' = 'stack', className = '', tagSlot = false) => (
    <EkycField
      key={field.id}
      field={field}
      path={field.id}
      value={getEkycValue(data, field.id)}
      options={field.optionsFor ? field.optionsFor(data, data) : undefined}
      onChange={(v) => update(field.id, v)}
      error={shownErrors[field.id]}
      prefilled={prefilledTop.has(field.id)}
      readOnly={readOnly}
      latinName={isEkycLatinNameField(field, data, data)}
      layout={layout}
      className={className}
      tagSlot={tagSlot}
      phoneCountry={field.kind === 'phone' ? phoneCountryFor(field.id) : undefined}
    />
  );

  const renderGroup = (group: AnyGroup) => {
    const rows = (getEkycValue(data, group.id) as Record<string, unknown>[]) ?? [];
    const canAdd = !readOnly && (group.max === undefined || rows.length < group.max);
    const canRemove = !readOnly && rows.length > group.min;
    const marks = rowMarks[group.id] ?? [];
    const fieldById = new Map(group.fields.map((f) => [f.id, f]));
    const layoutRows = EKYC_GROUP_ROWS[group.id] ?? group.fields.map((f) => [f.id]);
    return (
      <div key={group.id} id={anchorIdFor(group.id)} className="scroll-mt-32">
        {group.hint && <FieldHint text={group.hint} />}
        <div className="mt-4 space-y-4">
          {rows.map((row, index) => (
            <div key={index} className="rounded-xl border border-gray-200 bg-gray-50/40 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3>
                  <BiLabel text={ekycRowHeading(group.rowLabel, index + 1)} />
                </h3>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => removeRow(group, index)}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                    <Bi text={EKYC_UI.remove} variant="inline" />
                  </button>
                )}
              </div>
              <div className="space-y-5">
                {layoutRows.map((ids, r) =>
                  renderRow(
                    `${index}-${r}`,
                    ids
                      .map((id) => fieldById.get(id))
                      .filter((field): field is NonNullable<typeof field> => !!field && isEkycFieldVisible(field, data, row))
                      .map((field) => {
                        const path = `${group.id}.${index}.${field.id}`;
                        const options = field.optionsFor ? field.optionsFor(data, row) : undefined;
                        const prefilled = (marks[index] ?? []).includes(field.id);
                        return {
                          field: field as AnyField,
                          options,
                          prefilled,
                          render: (layout: 'stack' | 'cell', className: string, tagSlot: boolean) => (
                            <EkycField
                              key={field.id}
                              field={field}
                              path={path}
                              value={getEkycValue(row, field.id)}
                              options={options}
                              onChange={(v) => update(path, v)}
                              error={shownErrors[path]}
                              prefilled={prefilled}
                              readOnly={readOnly}
                              latinName={isEkycLatinNameField(field, data, row)}
                              layout={layout}
                              className={className}
                              tagSlot={tagSlot}
                            />
                          ),
                        };
                      })
                  )
                )}
              </div>
            </div>
          ))}
        </div>
        {shownErrors[group.id] && (
          <div className="mt-2 text-sm text-red-600">
            <Bi text={shownErrors[group.id]} deClassName="!text-red-500" />
          </div>
        )}
        {canAdd && (
          <button
            type="button"
            onClick={() => addRow(group)}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-dashed px-4 text-sm font-medium transition-colors hover:bg-gray-50"
            style={{ borderColor: TME_COLORS.primary, color: TME_COLORS.primary }}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <Bi text={group.addLabel} variant="inline" />
          </button>
        )}
      </div>
    );
  };

  /**
   * A step's rows as blocks: Yes / No questions in a row run become one
   * compact list (question left, answer right); a group renders its entries;
   * every other row is a row of fields (see renderRow).
   */
  const renderItems = (step: EkycStepDef) => {
    type Block = { kind: 'list'; nodes: React.ReactNode[] } | { kind: 'node'; node: React.ReactNode };
    const blocks: Block[] = [];
    const pushList = (node: React.ReactNode) => {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'list') last.nodes.push(node);
      else blocks.push({ kind: 'list', nodes: [node] });
    };
    step.rows.forEach((ids, r) => {
      if (ids.length === 1) {
        const group = groupsById.get(ids[0]);
        if (group) {
          blocks.push({ kind: 'node', node: renderGroup(group) });
          return;
        }
      }
      const fields = ids
        .map((id) => fieldsById.get(id))
        .filter((field): field is AnyField => !!field && isEkycFieldVisible(field, data, data));
      if (fields.length === 0) return;
      if (fields.length === 1 && fields[0].kind === 'yesno') {
        pushList(renderTopField(fields[0], 'row'));
        return;
      }
      const caption = type === 'individual' ? INDIVIDUAL_FIELD_CAPTIONS[fields[0].id] : undefined;
      if (caption) {
        blocks.push({
          kind: 'node',
          node: (
            <h3 key={`${fields[0].id}-caption`} className="-mb-2 pt-1">
              <BiLabel text={caption} size="sm" />
            </h3>
          ),
        });
      }
      blocks.push({
        kind: 'node',
        node: renderRow(
          `row-${r}`,
          fields.map((field) => ({
            field,
            options: field.optionsFor ? field.optionsFor(data, data) : undefined,
            prefilled: prefilledTop.has(field.id),
            render: (layout: 'stack' | 'cell', className: string, tagSlot: boolean) =>
              renderTopField(field, layout, className, tagSlot),
          }))
        ),
      });
    });
    return blocks.map((block, i) => {
      if (block.kind === 'node') return <React.Fragment key={`n-${i}`}>{block.node}</React.Fragment>;
      return (
        <div key={`l-${i}`} className="divide-y divide-gray-100 rounded-xl border border-gray-200 px-4">
          {block.nodes}
        </div>
      );
    });
  };

  const stepHasPrefill = (step: EkycStepDef) =>
    step.items.some((id) => prefilledTop.has(id) || (rowMarks[id] ?? []).some((r) => r.length > 0));

  // ---------- Views ----------
  const header = (withSteps: boolean) => (
    <EkycHeader
      displayName={payload.displayName}
      saveState={saveState}
      onSave={saveDraftClick}
      onRetry={saveDraftClick}
      showSave={!readOnly}
      saveDisabled={saveState === 'saving'}
    >
      {withSteps && <EkycMobileStepBar entries={entries} current={current} onSelect={(i) => goTo(i)} />}
    </EkycHeader>
  );

  const confirmDialog = confirmOpen && (
    <ConfirmDialog
      submitting={submitting}
      uploading={uploading}
      onCancel={closeConfirm}
      onConfirm={() => void confirmSubmit()}
    />
  );

  const errorPaths = useMemo(() => new Set(liveErrors.map((e) => e.fieldId)), [liveErrors]);
  const groupErrors = useMemo(() => {
    const out: Record<string, EkycText> = {};
    for (const e of liveErrors) if (groupsById.has(e.fieldId) && !out[e.fieldId]) out[e.fieldId] = e.message;
    return out;
  }, [liveErrors, groupsById]);
  // Required answers still empty show as "Missing" from the start; nothing to hide on a check page.
  const review = (editable: boolean) => (
    <EkycReview
      steps={steps}
      data={data}
      fieldsById={fieldsById as Map<string, AnyField>}
      groupsById={groupsById}
      documents={documents}
      errorPaths={editable ? errorPaths : new Set()}
      groupErrors={editable ? groupErrors : undefined}
      stepHasErrors={(i) => editable && errorsShownFor(i) && stepErrors(i).length > 0}
      onChange={editable ? (i) => goTo(i) : undefined}
    />
  );

  // After submit: confirmation and a read-only view of the answers.
  if (readOnly) {
    return (
      <div>
        {header(false)}
        <main className="mx-auto max-w-[960px] px-4 py-6 sm:px-6 sm:py-10">
          <Card className="mb-6">
            <div className="flex flex-col items-center py-4 text-center">
              <CheckCircle className="mb-3 h-12 w-12" style={{ color: TME_COLORS.success }} />
              <h1 className="text-xl font-semibold sm:text-2xl" style={{ color: TME_COLORS.primary }}>
                <BiTitle text={EKYC_UI.receivedTitle} />
              </h1>
              <Bi text={EKYC_SUBMITTED_NOTICE} paragraphs className="mt-3 max-w-xl text-sm text-gray-600" />
              <Bi text={EKYC_UI.receivedNext} paragraphs className="mt-2 max-w-xl text-sm text-gray-600" />
            </div>
          </Card>
          <h2 className="mb-3 text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
            <Bi text={EKYC_UI.yourAnswers} />
          </h2>
          {review(false)}
        </main>
      </div>
    );
  }

  // Start page: what the service is, what you need, how long it takes.
  if (current === START) {
    const needs =
      type === 'corporate'
        ? [EKYC_UI.startNeedLicense, EKYC_UI.startNeedOwners, EKYC_UI.startNeedCapital, EKYC_UI.startNeedContact]
        : [EKYC_UI.startNeedPassport, EKYC_UI.startNeedEid, EKYC_UI.startNeedAddress, EKYC_UI.startNeedPhoto, EKYC_UI.startNeedIncome];
    return (
      <div>
        {header(false)}
        <main className="mx-auto max-w-[760px] px-4 py-6 sm:px-6 sm:py-10">
          <Card className="sm:p-8">
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none sm:text-3xl" style={{ color: TME_COLORS.primary }}>
              <BiTitle text={schema.title} />
            </h1>
            {payload.displayName && <p className="mt-2 text-base font-semibold text-gray-800">{payload.displayName}</p>}
            <BiIntro
              text={type === 'corporate' ? EKYC_UI.startIntroCorporate : EKYC_UI.startIntroIndividual}
              paragraphs
              className="mt-4"
            />
            <h2 className="mt-6 text-base font-semibold" style={{ color: TME_COLORS.primary }}>
              <Bi text={EKYC_UI.startNeedTitle} />
            </h2>
            <ul className="mt-2 space-y-2">
              {needs.map((n, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-gray-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TME_COLORS.secondary }} />
                  <Bi text={n} />
                </li>
              ))}
            </ul>
            <div className="mt-6 space-y-2 text-sm text-gray-700">
              <div className="flex gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TME_COLORS.primary }} />
                <Bi text={EKYC_UI.startTime} />
              </div>
              <div className="flex gap-2.5">
                <Save className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TME_COLORS.primary }} />
                <Bi text={EKYC_UI.startSaved} />
              </div>
            </div>
            {showPrefillNotice && (
              <div className="mt-6">
                <Notice text={EKYC_PREFILL_NOTICE} tone="warn" />
              </div>
            )}
            <button
              type="button"
              onClick={() => goTo(0)}
              className="mt-8 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg px-8 text-base font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              <Bi text={EKYC_UI.startButton} variant="inline" className="items-center" />
            </button>
          </Card>
        </main>
      </div>
    );
  }

  const step = current < checkIndex ? steps[current] : null;
  const currentErrors = step && errorsShownFor(current) ? stepErrors(current) : [];
  const summaryItems = (list: EkycValidationError[]) =>
    ekycSortErrors(steps, list).map((e) => ({ id: e.fieldId, label: ekycErrorLabel(type, e.fieldId), message: e.message }));

  return (
    <div>
      {header(true)}
      <div className="mx-auto max-w-[1216px] px-4 pb-28 pt-5 sm:px-6 lg:flex lg:gap-6 lg:pb-12 lg:pt-8 xl:gap-8">
        <aside className="hidden w-52 shrink-0 lg:block xl:w-56">
          <div className="sticky top-24">
            <div className="mb-2 px-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <Bi text={EKYC_UI.steps} variant="inline" />
            </div>
            <EkycStepList entries={entries} current={current} onSelect={(i) => goTo(i)} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {step ? (
            <Card className="lg:p-8">
              <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none sm:text-2xl" style={{ color: TME_COLORS.primary }}>
                <BiTitle text={step.title} />
              </h1>
              {step.intro && <BiIntro text={step.intro} className="mt-2" />}
              {step.details && step.details.length > 0 && (
                <details className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  <summary className="cursor-pointer select-none font-medium" style={{ color: TME_COLORS.primary }}>
                    <Bi text={EKYC_UI.moreInfo} variant="inline" />
                  </summary>
                  <div className="mt-2 space-y-2 text-xs leading-relaxed">
                    {step.details.map((d, i) => (
                      <Bi key={i} text={d} paragraphs />
                    ))}
                  </div>
                </details>
              )}

              <div className="mt-5 space-y-4">
                <ErrorSummary
                  title={EKYC_UI.stepErrorTitle}
                  items={summaryItems(currentErrors)}
                  onPick={pickError}
                  summaryRef={summaryRef}
                />
                {stepHasPrefill(step) && <Notice text={EKYC_UI.stepPrefillLine} tone="warn" compact />}
              </div>

              <div className="mt-6 space-y-6">
                {step.privacy && (
                  <section className="rounded-xl bg-gray-50 p-4 sm:p-5">
                    <h2 className="mb-2 text-sm font-semibold" style={{ color: TME_COLORS.primary }}>
                      <Bi text={EKYC_PRIVACY_TITLE} />
                    </h2>
                    <div className="space-y-2 text-xs leading-relaxed text-gray-600 sm:text-sm">
                      {EKYC_PRIVACY_PARAGRAPHS.map((p, i) => (
                        <Bi key={i} text={p} paragraphs />
                      ))}
                    </div>
                  </section>
                )}
                {step.lead && (
                  <div className="rounded-xl border-l-4 px-4 py-3 text-sm text-gray-800" style={{ borderColor: TME_COLORS.primary, backgroundColor: 'rgba(36,63,123,0.04)' }}>
                    <Bi text={step.lead} paragraphs />
                  </div>
                )}
                {step.documents && (
                  <EkycDocuments
                    token={token}
                    data={data as IndividualKycData}
                    documents={documents}
                    errors={shownErrors}
                    readOnly={readOnly}
                    busySlots={busySlots}
                    onUpload={handleUpload}
                  />
                )}
                {renderItems(step)}
              </div>

              <EkycStepNav
                onBack={() => goTo(current - 1)}
                onNext={() => continueFrom(current)}
                nextLabel={current === checkIndex - 1 ? EKYC_UI.checkAnswersButton : EKYC_UI.continue}
              />
            </Card>
          ) : (
            <Card className="lg:p-8">
              <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none sm:text-2xl" style={{ color: TME_COLORS.primary }}>
                <BiTitle text={EKYC_UI.checkTitle} />
              </h1>
              <BiIntro text={EKYC_UI.checkIntro} className="mt-2" />
              <div className="mt-5 space-y-4">
                <ErrorSummary
                  title={EKYC_UI.missingTitle}
                  items={submitAttempted || serverErrors ? summaryItems(liveErrors) : []}
                  onPick={pickError}
                  summaryRef={summaryRef}
                />
                {showPrefillNotice && <Notice text={EKYC_PREFILL_NOTICE} tone="warn" />}
              </div>
              <div className="mt-6">{review(true)}</div>

              {submitError && (
                <div className="mt-5 text-sm text-red-600" role="alert">
                  <Bi text={submitError} />
                </div>
              )}
              {uploading && (
                <div id="ekyc-submit-wait" className="mt-4 text-sm text-gray-500">
                  <Bi text={EKYC_UI.waitForUpload} />
                </div>
              )}
              <EkycStepNav
                onBack={() => goTo(checkIndex - 1)}
                onNext={handleSubmitClick}
                nextRef={submitButtonRef}
                nextLabel={EKYC_UI.submit}
                nextDisabled={submitting || uploading}
                nextBusy={uploading}
              />
            </Card>
          )}
        </main>
      </div>
      {confirmDialog}
    </div>
  );
}
