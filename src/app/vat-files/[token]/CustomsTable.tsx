'use client';

// Round 3: the customs table on the VAT filing upload page ("Your imports").
// One row (laptop) or card (phone) per import line the portal wrote; the
// client answers four questions per import (Purpose, Paid / FOC, Incoterms,
// Delivery place on the invoice), may split an import by supplier invoice,
// adds the BOE and invoices per row, and replies to each of TME's open
// questions on a row. The page owns the state and the autosave; this file
// only draws and reports changes.
//
// Speed: 30-80 rows is normal, up to ~300 possible. Every row is a memo
// component that gets only its own answer object and plain values, and the
// callbacks are stable, so typing in one row re-renders that row only.
//
// Look (11.10, readability pass 22.10): every answer is the same bordered box
// (amber border = required and still empty), one Status chip per row ("Done" /
// "N to answer"), Upload buttons / "uploaded" chips for the documents, a "..."
// menu per row.
//
// Read-only (11.10, a closed request): the same table with the answers as
// plain text, the replies as text, document pills that only show what came
// in, no menus, no split / remove, no "Copy to empty rows". Nothing can
// call onChange / onFill / onAddFile.

import React, { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  CopyCheck,
  Download,
  History,
  Info,
  Loader2,
  MessageCircleQuestion,
  Lock,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Scissors,
  Upload,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { AutoGrowText, Button, ButtonLink, GrainGradient, StatusChip } from '@/components/ui';
import ChoiceSelect, { type ChoiceOption } from './ChoiceSelect';
import {
  copyableAnswer,
  describeLineAnswer,
  fillEmptyLines,
  filterCustomsLineIds,
  formatAmount,
  formatDubaiDateTime,
  formatDubaiTime,
  formatPageDate,
  filledByLine,
  isFillableLine,
  isRefusedNoteKey,
  newCustomsNoteId,
  questionAskedLine,
  replyStatusLine,
  shownCustomsNotes,
  type CustomsLineFilter,
} from '@/lib/vat-customs';
import {
  VAT_CUSTOMS_DELIVERY_OPTIONS,
  VAT_CUSTOMS_INCOTERM_OPTIONS,
  VAT_CUSTOMS_MAX_NOTES_PER_QUESTION,
  VAT_CUSTOMS_MAX_PARTS,
  VAT_CUSTOMS_MAX_TEXT_CHARS,
  VAT_CUSTOMS_PAYMENT_OPTIONS,
  VAT_CUSTOMS_PURPOSE_OPTIONS,
  isVatCustomsLineComplete,
  isVatCustomsPartComplete,
  isVatCustomsReplySent,
  vatCustomsOptionLabel,
  type VatCustomsAnswerPart,
  type VatCustomsAnswers,
  type VatCustomsDefaults,
  type VatCustomsDocKind,
  type VatCustomsLineAnswer,
  type VatCustomsNote,
  type VatCustomsPageLine,
  type VatCustomsReplyMeta,
} from '@/types/vat-files';

// ------------------------------------------------------------------
// Types shared with the page
// ------------------------------------------------------------------

/**
 * Per line and kind: 0 = nothing, 1 = uploading, 2 = received (sent, at TME,
 * or uploaded and waiting for Send). `names` = the file names we know of
 * (for the tooltip); a file TME already holds has no name here.
 */
export type LineFileCounts = {
  boe: 0 | 1 | 2;
  invoice: 0 | 1 | 2;
  other: number;
  names?: { boe: string[]; invoice: string[]; other: string[] };
};

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: string }
  | { status: 'error'; message: string };

/**
 * Round 5: a line the server refused because someone else saved it after this
 * page loaded it. The line shows their version; `mine` = what this person had
 * typed ("Use mine" puts it back). `who` = name, address or "Someone else".
 */
export interface LineConflictNote {
  mine: VatCustomsLineAnswer;
  who: string;
  at: string | null;
}

type OnLineChange = (lineId: string, next: VatCustomsLineAnswer) => void;
/** Round 5 item 8: type into a note under a sent reply (a new id = a new note); `text` null = remove the draft. */
type OnNote = (questionId: number, noteId: string, text: string | null) => void;
type OnAddFile = (lineId: number, kind: VatCustomsDocKind) => void;
type LineQuestion = NonNullable<VatCustomsPageLine['questions']>[number];
/** Round 4 C: who / when per reply of one line, keyed by question id. */
type LineReplyMeta = Record<string, VatCustomsReplyMeta> | undefined;

const NO_FILES: LineFileCounts = { boe: 0, invoice: 0, other: 0 };
const NO_QUESTIONS: LineQuestion[] = [];

/** The questions block shows: open questions, or (read-only) a reply to an earlier one. */
function questionsOrReplies(line: VatCustomsPageLine, answer: VatCustomsLineAnswer | undefined, readOnly: boolean): boolean {
  const questions = line.questions ?? NO_QUESTIONS;
  return questions.length > 0 || (readOnly && earlierReplies(questions, answer?.replies).length > 0);
}

/** Read-only: replies whose question is no longer open (TME closed it); shown without the question. [question id, text]. */
function earlierReplies(questions: LineQuestion[], replies: Record<string, string> | undefined): Array<[string, string]> {
  const open = new Set(questions.map((q) => String(q.id)));
  return Object.entries(replies ?? {})
    .filter(([id, text]) => !open.has(id) && typeof text === 'string' && text.trim() !== '')
    .map(([id, text]) => [id, text.trim()]);
}

/** Round 4 D: { email: name } of the people the page names (VatFilesPagePayload.peopleNames). */
const PeopleNamesContext = createContext<Record<string, string> | undefined>(undefined);

/** Round 5: the row's last Send (the time a sent reply without its own stamp shows). */
const SentAtContext = createContext<string | null>(null);

/**
 * The line under a reply. Round 5: sent = "Sent by Name (x) on dd.mm.yyyy
 * hh:mm" (read-only); not sent yet = "Saved by ... on .... Not sent yet."
 */
function ReplyWho({ meta, sent, className = '' }: { meta: VatCustomsReplyMeta | undefined; sent: boolean; className?: string }) {
  const names = useContext(PeopleNamesContext);
  const sentAt = useContext(SentAtContext);
  const text = replyStatusLine(meta, names, sent, sentAt);
  if (!text) return null;
  return <span className={`block text-sm leading-snug text-gray-600 break-words ${className}`}>{text}</span>;
}

/** Round 5: a reply that went out with a Send: plain text, who sent it; round 5 item 8: the notes under it (children). */
function SentReply({
  text,
  meta,
  className = '',
  children,
}: {
  text: string;
  meta: VatCustomsReplyMeta | undefined;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="rounded-[10px] bg-white border border-gray-200 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-600 mb-0.5">
          <Lock className="w-3.5 h-3.5" aria-hidden />
          Your reply
        </span>
        <p className="text-[15px] leading-snug break-words whitespace-pre-line text-gray-900">{text}</p>
        <ReplyWho meta={meta} sent className="mt-1" />
      </div>
      {children}
    </div>
  );
}

/** Round 5 item 8: a note as text (sent, or any note on a closed request). */
function NoteText({ text, meta, sent, locked }: { text: string; meta: VatCustomsReplyMeta | undefined; sent: boolean; locked: boolean }) {
  return (
    <div className="rounded-[10px] bg-white border border-gray-200 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-600 mb-0.5">
        {locked && <Lock className="w-3.5 h-3.5" aria-hidden />}
        Your note
      </span>
      <p className="text-[15px] leading-snug break-words whitespace-pre-line text-gray-900">{text}</p>
      <ReplyWho meta={meta} sent={sent} className="mt-1" />
    </div>
  );
}

/**
 * Round 5 item 8: the notes under a SENT reply and "Add a note". A sent note
 * is text; a note not sent yet is a small box (autosaved like a reply,
 * "Saved by ... Not sent yet.", sent with the next Send; empty = removed).
 */
function ReplyNotes({
  questionId,
  typed,
  saved,
  savedUpdatedAt,
  onNote,
  disabled,
  idPrefix,
  ctx,
}: {
  questionId: number;
  typed: VatCustomsNote[] | undefined;
  saved: VatCustomsNote[] | undefined;
  savedUpdatedAt: string | undefined;
  onNote: OnNote;
  disabled: boolean;
  idPrefix: string;
  ctx: string;
}) {
  const sentAt = useContext(SentAtContext);
  // A note box opened with "Add a note" that has no text yet (not in the answer until typed in).
  const [adding, setAdding] = useState<string | null>(null);
  const shown = shownCustomsNotes(typed, saved, savedUpdatedAt, sentAt);
  const pending = adding !== null && !shown.some((n) => n.id === adding) ? adding : null;
  const count = shown.length + (pending ? 1 : 0);
  const emptyOpen = pending !== null || shown.some((n) => !n.sent && !n.text.trim());
  const canAdd = count < VAT_CUSTOMS_MAX_NOTES_PER_QUESTION;
  const box = (noteId: string, value: string, meta: VatCustomsReplyMeta | undefined, autoFocus: boolean) => {
    const id = `${idPrefix}-q${questionId}-note-${noteId}`;
    return (
      <div key={noteId}>
        <div className="flex items-start gap-1.5">
          <label htmlFor={id} className="sr-only">
            Your note to TME on {ctx}
          </label>
          <textarea
            id={id}
            value={value}
            disabled={disabled}
            autoFocus={autoFocus}
            maxLength={VAT_CUSTOMS_MAX_TEXT_CHARS}
            onChange={(e) => onNote(questionId, noteId, e.target.value)}
            rows={2}
            placeholder="Your note"
            className="w-full min-h-[46px] rounded-[10px] border-2 border-gray-200 bg-white px-3.5 py-2.5 text-base leading-snug text-gray-900 placeholder:text-gray-500 resize-y transition-colors focus:outline-none focus:border-tme-blue disabled:bg-gray-50"
          />
          <button
            type="button"
            onClick={() => {
              if (noteId === adding) setAdding(null);
              onNote(questionId, noteId, null);
            }}
            disabled={disabled}
            aria-label={`Remove this note, ${ctx}`}
            className="shrink-0 inline-flex items-center justify-center size-11 rounded-[10px] tme-btn-danger-ghost transition-colors disabled:opacity-50 tme-btn-focus"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
        {value.trim() && meta ? <ReplyWho meta={meta} sent={false} className="mt-1" /> : null}
      </div>
    );
  };
  // One list (the new box included), so the box keeps its focus when its first letter makes it a note.
  const items = pending ? [...shown, { id: pending, text: '', sent: false, meta: undefined }] : shown;
  return (
    <div className="mt-1.5 space-y-1.5">
      {items.map((n) =>
        n.sent ? <NoteText key={n.id} text={n.text} meta={n.meta} sent locked /> : box(n.id, n.text, n.meta, n.id === adding)
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm leading-snug text-gray-600">{canAdd ? 'Sent. Need to add something? Add a note.' : 'Sent.'}</p>
        {canAdd && !emptyOpen && (
          <Button tone="ghost" onClick={() => setAdding(newCustomsNoteId())} disabled={disabled} aria-label={`Add a note, ${ctx}`}>
            <Plus className="w-4 h-4" aria-hidden />
            Add a note
          </Button>
        )}
      </div>
    </div>
  );
}

/** Round 5 item 8, read-only: the stored notes of one question as text. */
function ReadOnlyNotes({ notes, savedUpdatedAt }: { notes: VatCustomsNote[] | undefined; savedUpdatedAt: string | undefined }) {
  const sentAt = useContext(SentAtContext);
  if (!notes || notes.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {notes.map((n) => (
        <NoteText
          key={n.id}
          text={n.text}
          meta={n}
          sent={!!sentAt && isVatCustomsReplySent(n, savedUpdatedAt, sentAt)}
          locked={false}
        />
      ))}
    </div>
  );
}

/** Round 5: "Benedikt Klingler changed this import at 17:10." + what this person had typed + Use mine / Keep theirs. */
function ConflictNote({
  note,
  lineId,
  onUseMine,
  onKeepTheirs,
  disabled,
}: {
  note: LineConflictNote;
  lineId: string;
  onUseMine?: (lineId: string) => void;
  onKeepTheirs?: (lineId: string) => void;
  disabled: boolean;
}) {
  const time = formatDubaiTime(note.at);
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-3 text-[15px]"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-900 leading-snug">
            {note.who} changed this import{time ? ` at ${time}` : ''}. You see their version now.
          </p>
          <p className="mt-0.5 text-gray-700 leading-snug break-words">
            Your text: <span className="text-gray-900">{describeLineAnswer(note.mine)}</span>
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row">
            <Button tone="plain" onClick={() => onKeepTheirs?.(lineId)} disabled={disabled}>
              Keep their version
            </Button>
            <Button tone="primary" onClick={() => onUseMine?.(lineId)} disabled={disabled}>
              Use my version
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Round 5 review: the person typed a change to a reply that was already
 * sent; the server kept the sent text. What they typed stays here (Copy),
 * until they dismiss it. `texts` = question id (a note: refusedNoteKey) -> the refused text.
 */
function LockedReplyNote({
  texts,
  lineId,
  onDismiss,
}: {
  texts: Record<string, string>;
  lineId: string;
  onDismiss?: (lineId: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (qid: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(qid);
      setTimeout(() => setCopied((c) => (c === qid ? null : c)), 2000);
    } catch {
      // No clipboard (old browser / not allowed): the text stays on screen to select by hand.
    }
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-3 text-[15px]"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          {Object.entries(texts).map(([qid, text]) => (
            <div key={qid}>
              <p className="font-semibold text-amber-900 leading-snug">
                {isRefusedNoteKey(qid) ? 'This note was already sent.' : 'This reply was already sent.'} Your text was not saved:
              </p>
              <p className="mt-0.5 text-gray-900 leading-snug break-words whitespace-pre-line select-text">{text}</p>
              <Button tone="plain" onClick={() => void copy(qid, text)} className="mt-2">
                {copied === qid ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
                {copied === qid ? 'Copied' : 'Copy my text'}
              </Button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onDismiss?.(lineId)}
          aria-label="Close this note"
          className="shrink-0 -mr-2 -mt-2 inline-flex items-center justify-center size-11 rounded-[10px] text-gray-600 hover:text-gray-900 hover:bg-amber-100 tme-btn-focus"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>
    </motion.div>
  );
}

/** Round 4 C: "Filled in by Anshad Muhammed, TME Services, on 08.10.2026" when the shown answer is TME's. */
function FilledByNote({ answer, readOnly, compact = false }: { answer: VatCustomsLineAnswer | undefined; readOnly: boolean; compact?: boolean }) {
  const text = filledByLine(answer);
  if (!text) return null;
  if (compact) {
    return (
      <p className="text-[13px] leading-snug text-gray-600 break-words">
        {text}.{readOnly ? '' : ' You can change it.'}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-sm leading-snug text-gray-600">
      <Pencil className="w-3.5 h-3.5 shrink-0 text-gray-500" aria-hidden />
      <span className="break-words">
        {text}.{readOnly ? '' : ' You can change it.'}
      </span>
    </p>
  );
}

/** The help line for the delivery place (U1: the RME "Oman / Italy / Kuwait" confusion). */
export const DELIVERY_HELP =
  'Delivery place on the invoice: the place written next to the Incoterm on the supplier invoice, e.g. "CIP Dubai Airport". Not where the goods went later.';

const EXCEL_HELP =
  'Prefer Excel? Download the list, fill in the yellow columns and upload it below. You do not need to do both.';


// ------------------------------------------------------------------
// Small hooks / helpers
// ------------------------------------------------------------------

/** True from 1280 px (Tailwind xl): the table. Below: cards (redesign 22.10, was 768). */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}

interface FieldDef {
  key: 'purpose' | 'payment' | 'incoterm' | 'delivery';
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  textKey: 'purposeOther' | 'paymentOther' | 'incotermOther' | 'deliveryPlace';
  /** The text box is required for this value. */
  needsText: (value: string | null | undefined) => boolean;
  /** The details field's label and placeholder for this value. */
  detail: (value: string | null | undefined) => { label: string; placeholder: string };
  /** The choice itself is optional for this part (e.g. delivery when no Incoterm is stated). */
  optional?: (part: VatCustomsAnswerPart) => boolean;
}

const EXPLAIN = { placeholder: 'A few words are enough' };

const FIELDS: FieldDef[] = [
  {
    key: 'purpose',
    label: 'Purpose',
    options: VAT_CUSTOMS_PURPOSE_OPTIONS,
    textKey: 'purposeOther',
    needsText: (v) => v === 'other',
    detail: () => ({ label: 'Purpose: please explain', ...EXPLAIN }),
  },
  {
    key: 'payment',
    label: 'Paid or free of charge (FOC)',
    options: VAT_CUSTOMS_PAYMENT_OPTIONS,
    textKey: 'paymentOther',
    needsText: (v) => v === 'other',
    detail: () => ({ label: 'Paid or free of charge: please explain', ...EXPLAIN }),
  },
  {
    key: 'incoterm',
    label: 'Delivery terms (Incoterms)',
    options: VAT_CUSTOMS_INCOTERM_OPTIONS,
    textKey: 'incotermOther',
    needsText: (v) => v === 'other',
    detail: () => ({ label: 'Delivery terms: please explain', placeholder: 'As written on the supplier invoice' }),
  },
  {
    key: 'delivery',
    label: 'Delivery place on the invoice',
    options: VAT_CUSTOMS_DELIVERY_OPTIONS,
    textKey: 'deliveryPlace',
    needsText: (v) => v === 'other',
    detail: () => ({ label: 'Other location: please specify', placeholder: 'As on the invoice, e.g. "CIP Sharjah Airport"' }),
    // No Incoterm on the invoice = no named place (isVatCustomsPartComplete agrees).
    optional: (part) => part.incoterm === 'not_stated',
  },
];

/** Short table labels where the full option label is too long for one line. */
const SHORT_LABELS: Record<string, Record<string, string>> = {
  delivery: { dubai_port_dz: 'Dubai port / airport / DZ', dubai_fz: 'Dubai Free Zone', dubai_mainland: 'Dubai Mainland' },
};

/**
 * The label shown in a select cell: the option label without its "(...)"
 * hint; an Incoterm shows as its code ("CIF"). The full label is in the
 * menu and in the cell's tooltip.
 */
function cellLabel(def: FieldDef, value: string, inTable: boolean): string {
  const full = vatCustomsOptionLabel(def.options, value);
  if (def.key === 'incoterm') {
    if (value === 'not_stated') return 'Not stated';
    if (value !== 'other') return value;
  }
  const short = inTable ? SHORT_LABELS[def.key]?.[value] : undefined;
  return short ?? full.replace(/\s*\([^)]*\)\s*$/, '');
}

/** The menu of a field: Incoterm code bold + its meaning; a "(...)" hint as a muted second line; Other with a pencil. */
const MENU_OPTIONS: Record<FieldDef['key'], ChoiceOption[]> = Object.fromEntries(
  FIELDS.map((def) => [
    def.key,
    def.options.map((o): ChoiceOption => {
      if (o.value === 'other') return { value: o.value, label: o.label, pencil: true };
      if (def.key === 'incoterm' && o.value !== 'not_stated') {
        const [code, ...rest] = o.label.split(' - ');
        return { value: o.value, label: code, sub: rest.join(' - '), strong: true };
      }
      const m = /^(.*?)\s*\((.*)\)$/.exec(o.label);
      if (m && def.key === 'delivery') {
        const sub = m[2].charAt(0).toUpperCase() + m[2].slice(1);
        return { value: o.value, label: m[1], sub, pencil: def.needsText(o.value) };
      }
      return { value: o.value, label: o.label };
    }),
  ])
) as Record<FieldDef['key'], ChoiceOption[]>;

/** The fields of a part whose answer needs a few words. */
function detailDefs(part: VatCustomsAnswerPart): FieldDef[] {
  return FIELDS.filter((f) => f.needsText(part[f.key]));
}

/** Answers still missing in a part (choices + required texts; + the invoice no. of a split part). */
function partGaps(part: VatCustomsAnswerPart, split: boolean): { missing: number; total: number } {
  let missing = 0;
  let total = 0;
  for (const f of FIELDS) {
    if (f.optional?.(part)) continue;
    total++;
    const v = part[f.key];
    if (!v || (f.needsText(v) && !(part[f.textKey] ?? '').trim())) missing++;
  }
  if (split) {
    total++;
    if (!(part.invoiceRef ?? '').trim()) missing++;
  }
  return { missing, total };
}

/**
 * The one status of an import (22.10): the required answers still missing
 * (all parts; the invoice no. of a split part). 0 = done. Documents are NOT
 * counted: "Done" must agree with the "x of y answered" count and the "Still
 * open" filter, and the Upload buttons already show what is missing.
 */
function lineStatus(answer: VatCustomsLineAnswer | undefined): { missing: number; text: string } {
  const parts = partsOf(answer);
  let missing = 0;
  if (!isVatCustomsLineComplete(answer)) {
    for (const p of parts) missing += partGaps(p, parts.length > 1).missing;
    missing = Math.max(1, missing);
  }
  return { missing, text: missing === 0 ? 'done' : `${missing} to answer` };
}

/** The Status cell / card chip: green "Done" or amber "N to answer" (a closed request: grey "Not complete"). */
function StatusBadge({ missing, readOnly, plain = false }: { missing: number; readOnly: boolean; plain?: boolean }) {
  if (plain) {
    // Laptop table: dot + text, no pill (22.10 round 2).
    const [dot, color, text] =
      missing === 0
        ? ['bg-green-600', 'text-green-700', 'Done']
        : readOnly
          ? ['bg-gray-400', 'text-gray-600', 'Not complete']
          : ['bg-amber-500', 'text-amber-800', `${missing} to answer`];
    return (
      <span className={`inline-flex items-center gap-[7px] text-[13px] font-medium whitespace-nowrap tabular-nums ${color}`}>
        <span className={`size-2 rounded-full shrink-0 ${dot}`} aria-hidden />
        {text}
      </span>
    );
  }
  if (missing === 0) {
    return (
      <StatusChip tone="green" icon={<Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />}>
        Done
      </StatusChip>
    );
  }
  if (readOnly) return <StatusChip tone="grey">Not complete</StatusChip>;
  return (
    <StatusChip tone="amber" className="tabular-nums">
      {missing} to answer
    </StatusChip>
  );
}

function partsOf(answer: VatCustomsLineAnswer | undefined): VatCustomsAnswerPart[] {
  const parts = answer?.parts ?? [];
  return parts.length > 0 ? parts : [{}];
}

/** "For sale / stock / trading, Paid, CIF, Dubai Free Zone (FZ)" */
function describePart(part: VatCustomsAnswerPart): string {
  const bits: string[] = [];
  for (const f of FIELDS) {
    const v = part[f.key];
    if (!v) continue;
    if (v === 'other') {
      const other = f.key === 'delivery' ? 'Other location' : 'Other';
      bits.push(part[f.textKey] ? `${other}: ${part[f.textKey]}` : other);
    } else if (f.key === 'incoterm' && v !== 'not_stated') bits.push(v);
    else bits.push(vatCustomsOptionLabel(f.options, v));
  }
  return bits.join(', ');
}

/** "import 3, BOE 1010135960026" (+ ", invoice 2" for a split part): the screen reader context of a field. */
function lineContext(line: Pick<VatCustomsPageLine, 'lineNo' | 'declarationNo'>, partIndex: number | null): string {
  const base = `import ${line.lineNo}, BOE ${line.declarationNo}`;
  return partIndex === null ? base : `${base}, invoice ${partIndex + 1}`;
}

// ------------------------------------------------------------------
// Tooltip + menu (fixed position: never cut off by the table's scroll box)
// ------------------------------------------------------------------

type TipPos = { x: number; y: number; above: boolean };

function useFloating(width: number) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<TipPos | null>(null);
  const show = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.top > 120;
    const half = width / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setPos({ x, y: above ? r.top - 6 : r.bottom + 6, above });
  }, [width]);
  const hide = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [pos, hide]);
  return { anchor, pos, show, hide };
}

function TipBubble({ id, pos, width, text }: { id: string; pos: TipPos | null; width: number; text: string }) {
  return (
    <span
      id={id}
      role="tooltip"
      className={
        pos
          ? 'fixed z-50 pointer-events-none rounded-lg bg-gray-900 px-3 py-2 text-sm font-normal leading-snug text-white shadow-lg whitespace-pre-line text-left normal-case tracking-normal'
          : 'sr-only'
      }
      style={pos ? { left: pos.x, top: pos.y, width, transform: `translate(-50%, ${pos.above ? '-100%' : '0'})` } : undefined}
    >
      {text}
    </span>
  );
}

/** A tooltip around any control: `children(describedById)`. Hover / keyboard focus. */
function Tip({ text, width = 240, children }: { text: string; width?: number; children: (describedBy: string) => React.ReactNode }) {
  const id = useId();
  const { anchor, pos, show, hide } = useFloating(width);
  return (
    <span ref={anchor} className="inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children(id)}
      <TipBubble id={id} pos={pos} width={width} text={text} />
    </span>
  );
}

/** A small (i) button with a tooltip; a tap opens it on phones. */
export function InfoTip({ text, label, width = 280 }: { text: string; label: string; width?: number }) {
  const id = useId();
  const { anchor, pos, show, hide } = useFloating(width);
  return (
    <span ref={anchor} className="inline-flex align-middle" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onFocus={show}
        onBlur={hide}
        onClick={() => (pos ? hide() : show())}
        className="inline-flex items-center justify-center size-11 -m-3 rounded-full text-gray-600 hover:text-tme-blue tme-btn-focus"
      >
        <Info className="w-[18px] h-[18px]" aria-hidden />
      </button>
      <TipBubble id={id} pos={pos} width={width} text={text} />
    </span>
  );
}

interface MenuItem {
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

function RowMenu({ label, items, disabled, compact = false }: { label: string; items: MenuItem[]; disabled: boolean; compact?: boolean }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback((focusButton = false) => {
    setPos(null);
    if (focusButton) btn.current?.focus();
  }, []);
  /** Place the menu under the button (above it near the bottom of the screen). */
  const place = useCallback((): boolean => {
    const r = btn.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return false;
    const h = menu.current?.offsetHeight ?? items.length * 64 + 12;
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
    return true;
  }, [items.length]);
  const open = () => {
    place();
  };
  const isOpen = !!pos;
  useEffect(() => {
    if (!isOpen) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    // Measure the real menu height once it is drawn.
    place();
  }, [isOpen, place]);
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const all = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        const next = all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
        next?.focus({ preventScroll: true });
        e.preventDefault();
      }
    };
    // The page scrolled: the menu follows its button (closes once it is off screen).
    const onScroll = () => {
      if (!place()) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [isOpen, close, place]);
  if (items.length === 0) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={label}
        disabled={disabled}
        onClick={() => (pos ? close() : open())}
        className={
          compact
            ? `inline-flex items-center justify-center size-8 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 tme-btn-focus ${pos ? 'bg-gray-100 text-gray-900' : ''}`
            : `inline-flex items-center justify-center size-11 rounded-[10px] text-tme-blue hover:bg-[#eef2fa] disabled:opacity-50 tme-btn-focus ${pos ? 'bg-[#eef2fa]' : ''}`
        }
      >
        <MoreHorizontal className={compact ? 'w-4 h-4' : 'w-5 h-5'} aria-hidden />
      </button>
      {pos && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className="fixed z-50 w-72 max-w-[calc(100vw-16px)] rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                it.onSelect();
              }}
              className={`flex w-full items-start gap-2.5 rounded-lg px-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${compact ? 'min-h-10 py-2' : 'min-h-11 py-2.5'}`}
            >
              <it.icon className={`${compact ? 'w-4 h-4' : 'w-[18px] h-[18px]'} mt-0.5 shrink-0 text-tme-blue`} />
              <span className="min-w-0">
                <span className={`block text-tme-blue ${compact ? 'text-sm font-medium' : 'text-[15px] font-semibold'}`}>{it.label}</span>
                {it.hint && <span className={`block text-gray-600 leading-snug ${compact ? 'text-[13px]' : 'text-sm'}`}>{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------
// One answer field (select cell + the text it may need)
// ------------------------------------------------------------------

const AnswerField = memo(function AnswerField({
  def,
  part,
  onPart,
  disabled,
  inTable,
  idPrefix,
  showLabel,
  context,
  onOpenDetails,
}: {
  def: FieldDef;
  part: VatCustomsAnswerPart;
  onPart: (patch: Partial<VatCustomsAnswerPart>) => void;
  /** Open this part's details strip (Other picked, or the pencil). */
  onOpenDetails?: () => void;
  disabled: boolean;
  /** Laptop table cell (one line, 36 px) or phone card field. */
  inTable: boolean;
  idPrefix: string;
  showLabel: boolean;
  /** "import 3, BOE 1010135960026": makes every field's name unique for screen readers. */
  context: string;
}) {
  const value = part[def.key] ?? '';
  const text = (part[def.textKey] ?? '').trim();
  const selectId = `${idPrefix}-${def.key}`;
  const neededId = `${selectId}-needed`;
  const optional = !!def.optional?.(part);
  const choiceMissing = !value && !optional;
  const hasDetail = !!value && def.needsText(value);
  const short = value ? cellLabel(def, value, inTable) : '';
  // The written words show in the cell only where they ARE the answer (Other purpose, Other location).
  // Paid / FOC and Incoterms are narrow: there the cell keeps "Other" + pencil (words in the tooltip).
  const inline = hasDetail && !!text && def.needsText(value) && (def.key === 'purpose' || def.key === 'delivery');
  const shown = inline ? `${short}: ${text}` : short;
  const full = value ? vatCustomsOptionLabel(def.options, value) : '';
  const title = hasDetail && text ? `${full.replace(/\s*\([^)]*\)\s*$/, '')}: ${text}` : full;

  /** Show the details strip and put the cursor in this answer's field. */
  const editDetails = () => {
    onOpenDetails?.();
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`${selectId}-text`)?.focus()));
  };
  const pickValue = (next: string | null) => {
    onPart({ [def.key]: next } as Partial<VatCustomsAnswerPart>);
    // The answer needs a few words: the details strip opens under the row; go there.
    if (next && def.needsText(next)) editDetails();
  };

  return (
    <div className="min-w-0">
      {showLabel && (
        <label htmlFor={selectId} className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-semibold leading-snug text-tme-blue mb-1.5">
          {def.label}
          {optional && <span className="font-normal text-gray-600">(optional)</span>}
          {def.key === 'delivery' && <InfoTip text={DELIVERY_HELP} label="What is the delivery place on the invoice?" />}
        </label>
      )}
      <div className={inTable ? 'relative inline-flex -ml-[9px] max-w-[calc(100%+9px)] align-middle' : 'relative'}>
        <ChoiceSelect
          id={selectId}
          value={value}
          options={MENU_OPTIONS[def.key]}
          onChange={pickValue}
          disabled={disabled}
          ariaLabel={`${def.label}, ${context}`}
          ariaDescribedBy={choiceMissing ? neededId : undefined}
          display={shown}
          displayTitle={title}
          reserveRight={hasDetail}
          needed={choiceMissing}
          placeholder={optional ? 'Optional' : inTable ? 'Choose' : 'Select'}
          size={inTable ? 'table' : 'card'}
          sheetTitle={def.label}
          sheetSubtitle={context.charAt(0).toUpperCase() + context.slice(1)}
        />
        {hasDetail && (
          <button
            type="button"
            onClick={editDetails}
            disabled={disabled}
            data-detail-owner={idPrefix}
            title={text ? 'Edit what you wrote' : 'Write the details'}
            aria-label={`${text ? 'Edit' : 'Write'}: ${def.detail(value).label}, ${context}`}
            className={`absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-lg text-gray-600 hover:text-tme-blue hover:bg-gray-100 disabled:opacity-50 tme-btn-focus ${
              inTable ? 'w-7 h-7 right-[28px]' : 'w-11 h-11 right-[36px]'
            }`}
          >
            <Pencil className={inTable ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden />
          </button>
        )}
      </div>
      {choiceMissing && (
        <span id={neededId} className="sr-only">
          needed
        </span>
      )}
    </div>
  );
});

/** Read-only: one answer as plain text (a closed request). */
function ReadOnlyAnswer({
  def,
  part,
  inTable,
  showLabel,
  context,
}: {
  def: FieldDef;
  part: VatCustomsAnswerPart;
  inTable: boolean;
  showLabel: boolean;
  context: string;
}) {
  const value = part[def.key] ?? '';
  const text = (part[def.textKey] ?? '').trim();
  const optional = !!def.optional?.(part);
  // Read-only (12.10 redesign 22.10): the full answer is written out (no tooltip-only text).
  const full = value ? vatCustomsOptionLabel(def.options, value) : '';
  // The words show next to the choice where they ARE the answer; the others are under the row.
  const inline = !!text && def.needsText(value) && (def.key === 'purpose' || def.key === 'delivery');
  const shown = inline ? `${full.replace(/\s*\([^)]*\)\s*$/, '')}: ${text}` : full;
  const empty = optional ? 'Not needed' : 'Not answered';
  return (
    <div className="min-w-0">
      {showLabel && <p className="text-[15px] font-semibold leading-snug text-tme-blue mb-1.5">{def.label}</p>}
      <p
        className={
          inTable
            ? `flex items-center min-h-8 py-1 text-sm leading-snug break-words ${value ? 'text-gray-900' : 'text-gray-500'}`
            : `flex items-center min-h-[46px] px-3.5 py-2 rounded-[10px] border-2 border-gray-100 bg-gray-50 text-base break-words ${value ? 'text-gray-900' : 'text-gray-600'}`
        }
      >
        <span className="sr-only">
          {def.label}, {context}:{' '}
        </span>
        <span className="min-w-0">{shown || empty}</span>
      </p>
    </div>
  );
}

/** Read-only: the words that do not show in the cell (Other for Paid / FOC or Incoterms, the original BOE). */
function readOnlyDetails(part: VatCustomsAnswerPart): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  for (const def of detailDefs(part)) {
    const value = part[def.key] ?? '';
    const text = (part[def.textKey] ?? '').trim();
    if (!text) continue;
    if (def.needsText(value) && (def.key === 'purpose' || def.key === 'delivery')) continue;
    out.push({ label: def.label, text });
  }
  return out;
}

function ReadOnlyDetails({ items }: { items: Array<{ label: string; text: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1.5 rounded-[10px] border border-gray-200 bg-gray-50/80 px-3.5 py-2.5 text-[15px]">
      {items.map((d) => (
        <p key={d.label} className="min-w-0 break-words">
          <span className="text-gray-600">{d.label}:</span> <span className="text-gray-900">{d.text}</span>
        </p>
      ))}
    </div>
  );
}

/** One auto-growing text field of the details strip. */
function DetailField({
  def,
  part,
  onPart,
  disabled,
  idPrefix,
  context,
}: {
  def: FieldDef;
  part: VatCustomsAnswerPart;
  onPart: (patch: Partial<VatCustomsAnswerPart>) => void;
  disabled: boolean;
  idPrefix: string;
  context: string;
}) {
  const value = part[def.key] ?? '';
  const text = part[def.textKey] ?? '';
  const required = def.needsText(value);
  const { label, placeholder } = def.detail(value);
  const textId = `${idPrefix}-${def.key}-text`;
  const missing = required && !text.trim();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grows with the text, and again when the strip gets narrower (a second field opened).
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  useEffect(fit, [text, fit]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  const near = text.length >= VAT_CUSTOMS_MAX_TEXT_CHARS - 100;
  // Tab goes back into the row: the next answer after this one (Shift+Tab: its own answer).
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Tab') return;
    const i = FIELDS.indexOf(def);
    const target = e.shiftKey ? FIELDS[i] : FIELDS[i + 1];
    const el = target ? document.getElementById(`${idPrefix}-${target.key}`) : null;
    if (el && !(el as HTMLButtonElement).disabled) {
      e.preventDefault();
      el.focus();
    }
  };
  return (
    <div className="flex-[1_1_320px] min-w-0 max-w-full">
      <div className="flex items-center gap-1.5 mb-1">
        <label htmlFor={textId} className="text-[15px] font-semibold leading-snug text-tme-blue">
          {label}
        </label>
        {missing && <span className="sr-only">needed</span>}
        {near && (
          <span className={`ml-auto text-[13px] tabular-nums ${text.length >= VAT_CUSTOMS_MAX_TEXT_CHARS ? 'text-amber-800' : 'text-gray-600'}`} aria-live="polite">
            {text.length} / {VAT_CUSTOMS_MAX_TEXT_CHARS}
          </span>
        )}
      </div>
      <textarea
        ref={ref}
        id={textId}
        rows={1}
        value={text}
        disabled={disabled}
        maxLength={VAT_CUSTOMS_MAX_TEXT_CHARS}
        onChange={(e) => onPart({ [def.textKey]: e.target.value.replace(/\n/g, ' ') } as Partial<VatCustomsAnswerPart>)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={`${label}, ${context}`}
        className={`block w-full min-h-[46px] resize-none overflow-hidden rounded-[10px] border-2 bg-white px-3.5 py-[9px] text-base leading-6 text-gray-900 placeholder:text-gray-500 transition-colors focus:outline-none focus:border-tme-blue disabled:bg-gray-50 ${
          missing ? 'border-amber-400 hover:border-amber-500' : 'border-gray-200 hover:border-gray-300'
        }`}
      />
    </div>
  );
}

/** True while a mouse / finger is pressed: a strip that closes waits for the click to land first. */
let pointerDown = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (pointerDown = true), true);
  document.addEventListener('pointerup', () => setTimeout(() => (pointerDown = false), 0), true);
}

/**
 * The details strip of a part: one field per answer that needs a few words
 * (Other, outside the UAE, the original BOE of a customer return). It stays
 * open while a needed text is empty or the client works in it; once the
 * words are there and the client moves on, it folds away (the cell shows
 * the words, the pencil opens it again).
 */
function DetailStrip({
  part,
  onPart,
  disabled,
  idPrefix,
  context,
  onLeave,
}: {
  part: VatCustomsAnswerPart;
  onPart: (patch: Partial<VatCustomsAnswerPart>) => void;
  disabled: boolean;
  idPrefix: string;
  context: string;
  onLeave: () => void;
}) {
  const defs = detailDefs(part);
  if (defs.length === 0) return null;
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    // A pencil of this same part keeps it open.
    const own = (el: EventTarget | null) => el instanceof Element && !!el.closest(`[data-detail-owner="${idPrefix}"]`);
    if (own(next)) return;
    if (pointerDown) {
      // Fold only after the click landed (the rows below must not move under the pointer).
      document.addEventListener('click', (ev) => !own(ev.target) && setTimeout(onLeave, 0), { once: true });
    } else onLeave();
  };
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-3 rounded-[10px] border border-gray-200 bg-gray-50/80 p-3.5" onBlur={onBlur}>
      {defs.map((def) => (
        <DetailField key={def.key} def={def} part={part} onPart={onPart} disabled={disabled} idPrefix={idPrefix} context={context} />
      ))}
    </div>
  );
}

/** Which parts of an import have their details strip open. */
function useOpenStrips() {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const show = useCallback((i: number) => setOpen((s) => (s.has(i) ? s : new Set(s).add(i))), []);
  const hide = useCallback(
    (i: number) =>
      setOpen((s) => {
        if (!s.has(i)) return s;
        const n = new Set(s);
        n.delete(i);
        return n;
      }),
    []
  );
  /** Open on request, and always while a needed text is still empty. */
  const shown = (part: VatCustomsAnswerPart, i: number) =>
    detailDefs(part).length > 0 && (open.has(i) || detailDefs(part).some((d) => d.needsText(part[d.key]) && !(part[d.textKey] ?? '').trim()));
  return { show, hide, shown };
}

// ------------------------------------------------------------------
// Line state helpers (pure, used by rows and cards)
// ------------------------------------------------------------------

/** Round 4 C: the client changed the answer: it is no longer the one TME filled in. */
function withoutFilledBy(answer: VatCustomsLineAnswer | undefined): Omit<VatCustomsLineAnswer, 'parts'> {
  const { filledBy: _f, ...rest } = answer ?? {};
  void _f;
  return rest;
}

function useLineActions(lineId: string, answer: VatCustomsLineAnswer | undefined, onChange: OnLineChange) {
  const parts = partsOf(answer);
  const setPart = useCallback(
    (index: number, patch: Partial<VatCustomsAnswerPart>) => {
      const next = partsOf(answer).map((p, i) => (i === index ? { ...p, ...patch } : p));
      onChange(lineId, { ...withoutFilledBy(answer), parts: next });
    },
    [answer, lineId, onChange]
  );
  const split = useCallback(() => {
    const current = partsOf(answer);
    if (current.length >= VAT_CUSTOMS_MAX_PARTS) return;
    const next = current.length === 1 ? [{ ...current[0], invoiceRef: current[0].invoiceRef ?? '' }, {}] : [...current, {}];
    onChange(lineId, { ...withoutFilledBy(answer), parts: next });
  }, [answer, lineId, onChange]);
  const removePart = useCallback(
    (index: number) => {
      const next = partsOf(answer).filter((_, i) => i !== index);
      onChange(lineId, { ...withoutFilledBy(answer), parts: next.length > 0 ? next : [{}] });
    },
    [answer, lineId, onChange]
  );
  /** A reply always belongs to ONE question (by id). */
  const setReply = useCallback(
    (questionId: number, reply: string) => {
      onChange(lineId, {
        ...(answer ?? {}),
        parts: answer?.parts ?? [],
        replies: { ...(answer?.replies ?? {}), [String(questionId)]: reply },
      });
    },
    [answer, lineId, onChange]
  );
  /** Round 5 item 8: a note under a sent reply (by its id; a new id appends it; null removes it). */
  const setNote = useCallback<OnNote>(
    (questionId, noteId, text) => {
      const qid = String(questionId);
      const list = answer?.notes?.[qid] ?? [];
      const nextList =
        text === null
          ? list.filter((n) => n.id !== noteId)
          : list.some((n) => n.id === noteId)
            ? list.map((n) => (n.id === noteId ? { ...n, text } : n))
            : [...list, { id: noteId, text }];
      const notes = { ...(answer?.notes ?? {}) };
      if (nextList.length > 0) notes[qid] = nextList;
      else delete notes[qid];
      onChange(lineId, { ...(answer ?? {}), parts: answer?.parts ?? [], notes });
    },
    [answer, lineId, onChange]
  );
  return { parts, setPart, split, removePart, setReply, setNote };
}

/** The "..." menu of an import: split, add an invoice part, add another file. */
function lineMenuItems(
  line: Pick<VatCustomsPageLine, 'id'>,
  partsCount: number,
  split: () => void,
  onAddFile: OnAddFile
): MenuItem[] {
  const items: MenuItem[] = [];
  if (partsCount < VAT_CUSTOMS_MAX_PARTS) {
    items.push(
      partsCount > 1
        ? { label: 'Add another invoice', hint: 'Answer this invoice on its own line.', icon: Plus, onSelect: split }
        : { label: 'Split by invoice', hint: 'One BOE, several supplier invoices? Answer per invoice.', icon: Scissors, onSelect: split }
    );
  }
  items.push({ label: 'Add another file', hint: 'Any other document for this import.', icon: Paperclip, onSelect: () => onAddFile(line.id, 'other') });
  return items;
}

// ------------------------------------------------------------------
// Pieces
// ------------------------------------------------------------------

/** The questions themselves show under the row / in the card; this chip only counts them. */
function QuestionBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <StatusChip tone="amber" icon={<MessageCircleQuestion className="w-3.5 h-3.5" aria-hidden />} className="tabular-nums">
      {count}
      <span className="sr-only">{count === 1 ? 'question' : 'questions'} from TME</span>
      <span aria-hidden>{count === 1 ? ' question' : ' questions'}</span>
    </StatusChip>
  );
}

function DocPill({
  kind,
  state,
  names,
  ctx,
  disabled,
  onAdd,
  readOnly = false,
  big = false,
}: {
  kind: 'boe' | 'invoice';
  state: 0 | 1 | 2;
  names: string;
  ctx: string;
  disabled: boolean;
  onAdd: () => void;
  readOnly?: boolean;
  /** Phone card: 44 px tap target. */
  big?: boolean;
}) {
  const label = kind === 'boe' ? 'BOE' : 'Invoice';
  const noun = kind === 'boe' ? 'BOE' : 'invoice';
  // The "uploaded" chip (StatusChip look); on a phone it is 44 px tall to tap.
  const chip = `inline-flex items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold leading-none whitespace-nowrap transition-colors ${
    big ? 'min-h-11 px-3.5 text-sm' : 'h-7'
  }`;
  const green = 'bg-green-50 border border-green-200 text-green-800';
  if (!big) {
    // Laptop table (22.10 round 2): plain text, no boxes. Uploaded = green check + "BOE";
    // missing = a "+ Add BOE" text link. 32 px hit area.
    // 24 px tall to keep the row compact; the ::before layer makes the hit area 32 px.
    const link =
      "relative inline-flex items-center gap-[5px] h-6 text-[13px] font-medium leading-none whitespace-nowrap rounded tme-btn-focus before:absolute before:-inset-y-1 before:-inset-x-1 before:content-['']";
    if (readOnly) {
      const got = state === 2;
      const tip = got ? (names ? `${label} received:\n${names}` : `${label} received by TME.`) : `No ${noun} received.`;
      return (
        <Tip text={tip}>
          {(describedBy) => (
            <span
              tabIndex={0}
              aria-describedby={describedBy}
              aria-label={got ? `${label} uploaded, ${ctx}` : `No ${noun}, ${ctx}`}
              className={`${link} ${got ? 'text-green-700' : 'text-gray-500'}`}
            >
              {got ? <Check className="w-3.5 h-3.5" strokeWidth={2.75} aria-hidden /> : <X className="w-3.5 h-3.5" aria-hidden />}
              {got ? label : `No ${noun}`}
            </span>
          )}
        </Tip>
      );
    }
    if (state === 1) {
      return (
        <span className={`${link} text-gray-600`}>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-tme-blue" aria-hidden />
          Uploading
        </span>
      );
    }
    if (state === 0) {
      return (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-label={`Upload ${noun}, ${ctx}`}
          className={`${link} text-tme-blue hover:underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline`}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
          Add {noun}
        </button>
      );
    }
    const upTip = names ? `${label} uploaded:\n${names}\nClick to add another.` : `${label} received by TME. Click to add another.`;
    return (
      <Tip text={upTip}>
        {(describedBy) => (
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-label={`${label} uploaded. Add another ${noun}, ${ctx}`}
            className={`${link} text-green-700 hover:underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Check className="w-3.5 h-3.5" strokeWidth={2.75} aria-hidden />
            {label}
          </button>
        )}
      </Tip>
    );
  }
  if (readOnly) {
    // Shows what came in; nothing to click (the tooltip lists the file names).
    const got = state === 2;
    const tip = got ? (names ? `${label} received:\n${names}` : `${label} received by TME.`) : `No ${noun} received.`;
    return (
      <Tip text={tip}>
        {(describedBy) => (
          <span
            tabIndex={0}
            aria-describedby={describedBy}
            aria-label={got ? `${label} uploaded, ${ctx}` : `No ${noun}, ${ctx}`}
            className={`${chip} tme-btn-focus ${got ? green : 'border border-gray-200 bg-gray-50 text-gray-600'}`}
          >
            {got ? <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden /> : <X className="w-3.5 h-3.5" aria-hidden />}
            {got ? `${label} uploaded` : `No ${noun}`}
          </span>
        )}
      </Tip>
    );
  }
  if (state === 1) {
    return (
      <span className={`${chip} border border-gray-200 bg-white text-gray-600`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-tme-blue" aria-hidden />
        Uploading {noun}
      </span>
    );
  }
  if (state === 0) {
    return (
      <Button
        tone="secondary"
        size={big ? 'md' : 'sm'}
        onClick={onAdd}
        disabled={disabled}
        aria-label={`Upload ${noun}, ${ctx}`}
        className={big ? 'whitespace-nowrap' : 'px-2.5 gap-1.5 whitespace-nowrap'}
      >
        <Upload className="w-4 h-4" aria-hidden />
        Upload {noun}
      </Button>
    );
  }
  const tip = names ? `${label} uploaded:\n${names}\nClick to add another.` : `${label} received by TME. Click to add another.`;
  return (
    <Tip text={tip}>
      {(describedBy) => (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-label={`${label} uploaded. Add another ${noun}, ${ctx}`}
          className={`${chip} ${green} hover:bg-green-100 tme-btn-focus disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />
          {label} uploaded
        </button>
      )}
    </Tip>
  );
}

function DocPills({
  line,
  boe,
  invoice,
  other,
  names,
  onAddFile,
  disabled,
  readOnly = false,
  big = false,
}: {
  line: Pick<VatCustomsPageLine, 'id' | 'lineNo' | 'declarationNo'>;
  boe: 0 | 1 | 2;
  invoice: 0 | 1 | 2;
  other: number;
  /** "boe|invoice|other" file names, each list joined with a new line. */
  names: { boe: string; invoice: string; other: string };
  onAddFile: OnAddFile;
  disabled: boolean;
  readOnly?: boolean;
  /** Phone card: bigger pills. */
  big?: boolean;
}) {
  const ctx = lineContext(line, null);
  const clip = big
    ? 'inline-flex items-center gap-1 rounded-full bg-gray-100 font-semibold tabular-nums text-gray-700 min-h-11 px-3.5 text-sm'
    : 'relative inline-flex items-center gap-1 h-6 rounded text-[13px] font-medium tabular-nums text-gray-600 hover:text-gray-900 before:absolute before:-inset-y-1 before:-inset-x-1 before:content-[\'\']';
  return (
    <div className={big ? 'flex flex-wrap items-center gap-2' : 'flex flex-wrap items-center gap-x-3 gap-y-1'}>
      <DocPill kind="boe" state={boe} names={names.boe} ctx={ctx} disabled={disabled} readOnly={readOnly} big={big} onAdd={() => onAddFile(line.id, 'boe')} />
      <DocPill kind="invoice" state={invoice} names={names.invoice} ctx={ctx} disabled={disabled} readOnly={readOnly} big={big} onAdd={() => onAddFile(line.id, 'invoice')} />
      {/* Other files: the "..." menu adds one; the clip shows once there are some. */}
      {other > 0 && readOnly && (
        <Tip text={`Other files:\n${names.other || `${other} received`}`}>
          {(describedBy) => (
            <span
              tabIndex={0}
              aria-describedby={describedBy}
              aria-label={`${other} other ${other === 1 ? 'file' : 'files'}, ${ctx}`}
              className={`${clip} tme-btn-focus`}
            >
              <Paperclip className="w-3.5 h-3.5" aria-hidden />
              {other}
            </span>
          )}
        </Tip>
      )}
      {other > 0 && !readOnly && (
        <Tip text={`Other files:\n${names.other || `${other} added`}\nClick to add another.`}>
          {(describedBy) => (
            <button
              type="button"
              onClick={() => onAddFile(line.id, 'other')}
              disabled={disabled}
              aria-describedby={describedBy}
              aria-label={`Add another file, ${ctx} (${other} added)`}
              className={`${clip} transition-colors ${big ? 'hover:bg-gray-200' : ''} disabled:opacity-50 tme-btn-focus`}
            >
              <Paperclip className="w-3.5 h-3.5" aria-hidden />
              {other}
            </button>
          )}
        </Tip>
      )}
    </div>
  );
}

/**
 * Round 4 C: "Anshad Muhammed, TME Services, asked on 11.10.2026 (1 of 2):"
 * (no name: "TME Services asked on ..."; nothing known: "TME Services asks:").
 */
function QuestionHead({ q, index, count, compact = false }: { q: LineQuestion; index: number; count: number; compact?: boolean }) {
  return (
    <>
      <span className={compact ? 'block text-[13px] font-semibold text-amber-800 mb-0.5' : 'block text-sm font-semibold text-tme-blue mb-0.5'}>
        {questionAskedLine(q)}
        {count > 1 ? ` (${index + 1} of ${count})` : ''}:
      </span>
    </>
  );
}

/** Every open TME question of a line, each with its own reply box. */
function QuestionBoxes({
  line,
  questions,
  replies,
  replyMeta,
  onReply,
  disabled,
  idPrefix,
  sideBySide,
  readOnly = false,
  sent,
  notes,
  savedAnswer,
  onNote,
}: {
  line: Pick<VatCustomsPageLine, 'lineNo' | 'declarationNo'>;
  questions: LineQuestion[];
  replies: Record<string, string> | undefined;
  /** Round 5 item 8: the notes on the page (typed), per question id. */
  notes?: Record<string, VatCustomsNote[]>;
  /** Round 5 item 8: the server's copy of this line (stored notes with who / when, and its updatedAt). */
  savedAnswer?: VatCustomsLineAnswer;
  onNote?: OnNote;
  /** Round 5: replies already sent (question id -> the sent text): read-only. */
  sent?: Record<string, string>;
  /** Round 4 C: who sent each reply and when. */
  replyMeta: LineReplyMeta;
  onReply: (questionId: number, text: string) => void;
  disabled: boolean;
  idPrefix: string;
  /** Laptop: question left, reply right. */
  sideBySide: boolean;
  /** A closed request: the reply as text, plus replies whose question TME has closed since. */
  readOnly?: boolean;
}) {
  const ctx = lineContext(line, null);
  if (readOnly) {
    const earlier = earlierReplies(questions, replies);
    const box = sideBySide
      ? 'rounded-lg bg-amber-50 px-3.5 py-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start'
      : 'rounded-[10px] border border-amber-200 bg-amber-50/60 p-3';
    const replyText = (text: string, meta: VatCustomsReplyMeta | undefined, qid: string) =>
      text ? (
        <div className={`rounded-[10px] bg-white border border-gray-200 px-3 py-2 ${sideBySide ? 'rounded-lg' : 'mt-2'}`}>
          <p className={`leading-snug break-words whitespace-pre-line text-gray-900 ${sideBySide ? 'text-sm' : 'text-[15px]'}`}>
            <span className="block text-[13px] font-medium text-gray-600 mb-0.5">Your reply</span>
            {text}
          </p>
          <ReplyWho meta={meta} sent={sent?.[qid] !== undefined} className="mt-1" />
          <ReadOnlyNotes notes={savedAnswer?.notes?.[qid]} savedUpdatedAt={savedAnswer?.updatedAt} />
        </div>
      ) : (
        <p className={`text-gray-600 ${sideBySide ? 'text-sm py-1.5' : 'text-[15px] mt-2'}`}>No reply sent.</p>
      );
    return (
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={q.id} className={box}>
            <div className="flex items-start gap-2 min-w-0">
              <MessageCircleQuestion className={`${sideBySide ? 'w-4 h-4' : 'w-[18px] h-[18px]'} shrink-0 mt-0.5 text-amber-700`} aria-hidden />
              <p className={`leading-snug break-words min-w-0 whitespace-pre-line text-gray-900 ${sideBySide ? 'text-sm' : 'text-[15px]'}`}>
                <QuestionHead q={q} index={i} count={questions.length} compact={sideBySide} />
                {q.text}
              </p>
            </div>
            {replyText((replies?.[String(q.id)] ?? '').trim(), replyMeta?.[String(q.id)], String(q.id))}
          </div>
        ))}
        {earlier.map(([qid, text]) => (
          <div key={`e${qid}`} className="rounded-[10px] border border-gray-200 bg-gray-50/80 px-3 py-2.5 text-[15px] leading-snug break-words whitespace-pre-line">
            <span className="block text-[13px] font-medium text-gray-600 mb-0.5">Your reply to an earlier TME question</span>
            <span className="text-gray-900">{text}</span>
            <ReplyWho meta={replyMeta?.[qid]} sent={sent?.[qid] !== undefined} className="mt-1" />
            <ReadOnlyNotes notes={savedAnswer?.notes?.[qid]} savedUpdatedAt={savedAnswer?.updatedAt} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {questions.map((q, i) => {
        const replyId = `${idPrefix}-q${q.id}-reply`;
        const textId = `${idPrefix}-q${q.id}-text`;
        return (
          <div
            key={q.id}
            className={
              sideBySide
                ? 'rounded-lg bg-amber-50 px-3.5 py-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-5 gap-y-1 items-start'
                : 'rounded-[10px] border border-amber-200 bg-amber-50/60 p-3'
            }
          >
            <div className="flex items-start gap-2 min-w-0">
              <MessageCircleQuestion className={`${sideBySide ? 'w-4 h-4' : 'w-[18px] h-[18px]'} shrink-0 mt-0.5 text-amber-700`} aria-hidden />
              <p id={textId} className={`leading-snug break-words min-w-0 whitespace-pre-line text-gray-900 ${sideBySide ? 'text-sm' : 'text-[15px]'}`}>
                <QuestionHead q={q} index={i} count={questions.length} compact={sideBySide} />
                {q.text}
              </p>
            </div>
            {sent?.[String(q.id)] !== undefined ? (
              <SentReply text={sent[String(q.id)]} meta={replyMeta?.[String(q.id)]} className={sideBySide ? '' : 'mt-2'}>
                {onNote ? (
                  <ReplyNotes
                    questionId={q.id}
                    typed={notes?.[String(q.id)]}
                    saved={savedAnswer?.notes?.[String(q.id)]}
                    savedUpdatedAt={savedAnswer?.updatedAt}
                    onNote={onNote}
                    disabled={disabled}
                    idPrefix={idPrefix}
                    ctx={ctx}
                  />
                ) : null}
              </SentReply>
            ) : (
            <>
            <label htmlFor={replyId} className="sr-only">
              Your reply to TME question {questions.length > 1 ? `${i + 1} ` : ''}on {ctx}
            </label>
            <textarea
              id={replyId}
              value={replies?.[String(q.id)] ?? ''}
              disabled={disabled}
              maxLength={VAT_CUSTOMS_MAX_TEXT_CHARS}
              onChange={(e) => onReply(q.id, e.target.value)}
              rows={sideBySide ? 1 : 3}
              placeholder="Your reply"
              aria-describedby={textId}
              className={
                sideBySide
                  ? 'w-full min-h-[38px] rounded-lg border border-gray-300 bg-white px-3 py-[8px] text-sm leading-snug text-gray-900 placeholder:text-gray-500 resize-y transition-colors hover:border-gray-400 focus:outline-none focus:border-tme-blue focus:ring-2 focus:ring-tme-blue/20 disabled:bg-gray-50'
                  : 'w-full min-h-[46px] rounded-[10px] border-2 border-gray-200 bg-white px-3.5 py-2.5 text-base leading-snug text-gray-900 placeholder:text-gray-500 resize-y transition-colors focus:outline-none focus:border-tme-blue disabled:bg-gray-50 mt-2'
              }
            />
            {(replies?.[String(q.id)] ?? '').trim() && replyMeta?.[String(q.id)] ? (
              <ReplyWho meta={replyMeta[String(q.id)]} sent={false} className={sideBySide ? 'col-start-2' : 'mt-1'} />
            ) : null}
            </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InvoiceRefInput({
  id,
  value,
  index,
  context,
  disabled,
  inTable,
  onChange,
}: {
  id: string;
  value: string;
  index: number;
  context: string;
  disabled: boolean;
  inTable: boolean;
  onChange: (s: string) => void;
}) {
  const missing = !value.trim();
  const border = missing ? 'border-amber-400 hover:border-amber-500' : 'border-gray-200 hover:border-gray-300';
  const shared = {
    id,
    value,
    disabled,
    maxLength: VAT_CUSTOMS_MAX_TEXT_CHARS,
    placeholder: `Invoice ${index + 1} no.`,
    'aria-label': `Invoice no., ${context}${missing ? ', needed' : ''}`,
  };
  return (
    <div className="flex-1 min-w-0">
      {inTable ? (
        // Dense laptop table: one 32px line, as the rest of the row.
        <input
          {...shared}
          type="text"
          onChange={(e) => onChange(e.target.value)}
          className={`w-full h-8 px-2.5 text-sm rounded-lg border bg-white text-gray-900 placeholder:text-gray-500 tabular-nums transition-colors focus:outline-none focus:border-tme-blue disabled:bg-gray-50 ${border}`}
        />
      ) : (
        // Cards: text never cut (Damir 22.10), a long number wraps to a second line.
        <AutoGrowText
          {...shared}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full min-h-[46px] rounded-[10px] border-2 bg-white px-3.5 py-[9px] text-base leading-6 text-gray-900 placeholder:text-gray-500 tabular-nums transition-colors focus:outline-none focus:border-tme-blue disabled:bg-gray-50 ${border}`}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Laptop: one <tbody> per import
// ------------------------------------------------------------------

// Columns: no. | BOE no. + date | Value | VAT | 4 answers | Documents | Status | menu.
// The table shows from 1280 px only (useIsWide) and fits there without a sideways
// scroll. Quiet fintech rows (22.10 round 2): the page uses the full screen width
// (up to 1800 px) and the extra width goes to the two long answer columns: Delivery
// place grows by steps, Purpose (the longest answers) takes all that is left.
// Documents get room for one line from 1400 px; below that the two links stack.
const COL_DEFS: Array<{ w: number | null; cls?: string }> = [
  { w: 32 }, // No.: as narrow as the number
  { w: 138 }, // BOE no. + date (13 digits, 14 px tabular)
  { w: 108 }, // Value (up to 999,999.99 on one line)
  { w: 92 }, // VAT
  { w: null }, // Purpose: what is left
  { w: 128 }, // Paid or free ("Will be paid")
  { w: 120 }, // Delivery terms ("Not stated")
  { w: 168, cls: 'w-[168px] min-[1400px]:w-[208px] min-[1600px]:w-[240px] min-[1800px]:w-[300px]' }, // Delivery place
  { w: 116, cls: 'w-[116px] min-[1400px]:w-[200px]' }, // Documents
  { w: 108 }, // Status ("4 to answer")
  { w: 40 }, // menu
];
const COLS = COL_DEFS.length;
/** Purpose gets at least this much at 1280 px. */
const ANSWER_MIN_W = 160;
const TABLE_MIN_W = COL_DEFS.reduce((a, c) => a + (c.w ?? ANSWER_MIN_W), 0);
const TD_BASE = 'py-2 align-middle group-hover/row:bg-[#FAFBFD] transition-colors';
const TD = `px-2.5 ${TD_BASE}`;
/** Answer cells: the quiet trigger pulls 9 px left, so its text lines up with the header. */
const ATD = `pl-3 pr-2 ${TD_BASE}`;
const SUB_BG = 'bg-gray-50/50';
const NUM = 'tabular-nums text-right whitespace-nowrap';
/** A plain text cell, centred on the 32 px answer line. */
const LINE = 'flex items-center min-h-8';
/** A quiet text button of the laptop table (toolbar, Add invoice, Download): blue text, wash on hover. */
const QUIET_BTN =
  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium text-tme-blue whitespace-nowrap transition-colors hover:bg-[#EEF2FA] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent tme-btn-focus';
/** Under-row notes / questions start where the BOE column starts. */
const UNDER_PAD = 'pl-[42px] pr-4';

interface LineProps {
  line: VatCustomsPageLine;
  answer: VatCustomsLineAnswer | undefined;
  /** Round 4 C: who sent each reply and when (from the server). */
  replyMeta: LineReplyMeta;
  boe: 0 | 1 | 2;
  invoice: 0 | 1 | 2;
  other: number;
  boeNames: string;
  invoiceNames: string;
  otherNames: string;
  onChange: OnLineChange;
  onAddFile: OnAddFile;
  disabled: boolean;
  /** A closed request: everything as text, no controls. */
  readOnly: boolean;
  /** Round 5: this line's replies already sent (question id -> text): read-only. */
  sentReplies?: Record<string, string>;
  /** Round 5 item 8: the server's copy of this line (stored notes, who / when). */
  savedAnswer?: VatCustomsLineAnswer;
  /** Round 5: someone else changed this line meanwhile. */
  conflict?: LineConflictNote;
  onUseMine?: (lineId: string) => void;
  onKeepTheirs?: (lineId: string) => void;
  /** Round 5 review: refused text of this line's sent replies (question id -> text). */
  lockedNote?: Record<string, string>;
  onDismissLocked?: (lineId: string) => void;
}

const LineRows = memo(function LineRows({
  line,
  answer,
  boe,
  invoice,
  other,
  boeNames,
  invoiceNames,
  otherNames,
  replyMeta,
  onChange,
  onAddFile,
  disabled,
  readOnly,
  sentReplies,
  savedAnswer,
  conflict,
  onUseMine,
  onKeepTheirs,
  lockedNote,
  onDismissLocked,
}: LineProps) {
  const key = String(line.id);
  const { parts, setPart, split, removePart, setReply, setNote } = useLineActions(key, answer, onChange);
  const status = lineStatus(answer);
  const isSplit = parts.length > 1;
  const idPrefix = `l${line.id}`;
  const questions = line.questions ?? NO_QUESTIONS;
  const ctx = lineContext(line, null);
  const names = useMemo(() => ({ boe: boeNames, invoice: invoiceNames, other: otherNames }), [boeNames, invoiceNames, otherNames]);
  const strips = useOpenStrips();
  const showQuestions = questionsOrReplies(line, answer, readOnly);
  const field = (def: FieldDef, part: VatCustomsAnswerPart, i: number, context: string) =>
    readOnly ? (
      <ReadOnlyAnswer def={def} part={part} inTable showLabel={false} context={context} />
    ) : (
      <AnswerField
        def={def}
        part={part}
        onPart={(patch) => setPart(i, patch)}
        onOpenDetails={() => strips.show(i)}
        disabled={disabled}
        inTable
        idPrefix={`${idPrefix}-p${i}`}
        showLabel={false}
        context={context}
      />
    );
  const strip = (part: VatCustomsAnswerPart, i: number, bg: string) => {
    if (readOnly) {
      const details = readOnlyDetails(part);
      return details.length > 0 ? (
        <tr>
          <td className={`${TD} ${bg} pt-0`} colSpan={4} />
          <td className={`${ATD} ${bg} pt-0 pb-3 pr-3`} colSpan={COLS - 4}>
            <ReadOnlyDetails items={details} />
          </td>
        </tr>
      ) : null;
    }
    return strips.shown(part, i) ? (
      <tr>
        <td className={`${TD} ${bg} pt-0`} colSpan={4} />
        <td className={`${ATD} ${bg} pt-0 pb-3 pr-3`} colSpan={COLS - 4}>
          <DetailStrip
            part={part}
            onPart={(patch) => setPart(i, patch)}
            disabled={disabled}
            idPrefix={`${idPrefix}-p${i}`}
            context={lineContext(line, isSplit ? i : null)}
            onLeave={() => strips.hide(i)}
          />
        </td>
      </tr>
    ) : null;
  };

  return (
    <tbody className="group/row [&>tr:last-child>td]:border-b [&>tr:last-child>td]:border-gray-100">
      <tr>
        <td className={`${TD_BASE} pl-2 pr-0.5 text-right`}>
          <div className={`${LINE} justify-end`}>
            <span className="text-[13px] tabular-nums text-gray-600" aria-hidden>
              {line.lineNo}
            </span>
            <span className="sr-only">Import {line.lineNo}</span>
          </div>
        </td>
        <td className={TD}>
          <div className="flex flex-col items-start justify-center min-h-8 leading-[1.3]">
            <span className="text-sm tabular-nums text-gray-900 whitespace-nowrap">{line.declarationNo}</span>
            <span className="flex items-center gap-2 text-[13px] text-gray-600 tabular-nums whitespace-nowrap">
              {formatPageDate(line.declarationDate)}
              {questions.length > 0 && (
                <span className="inline-flex items-center gap-1 font-medium text-amber-800">
                  <MessageCircleQuestion className="w-3.5 h-3.5" aria-hidden />
                  {questions.length}
                  <span className="sr-only">{questions.length === 1 ? 'question' : 'questions'} from TME</span>
                </span>
              )}
            </span>
          </div>
        </td>
        <td className={TD}>
          <div className={`${LINE} justify-end ${NUM} text-sm font-medium text-[#111827]`}>{formatAmount(line.totalValue)}</div>
        </td>
        <td className={TD}>
          <div className={`${LINE} justify-end ${NUM} text-sm text-gray-700`}>{formatAmount(line.totalVat)}</div>
        </td>
        {isSplit ? (
          <td className={TD} colSpan={4}>
            <div className="flex items-center gap-3 min-h-8 pl-0.5 text-[13px] text-gray-600">
              <Scissors className="w-4 h-4 text-gray-500" aria-hidden />
              <span>{readOnly ? `Split into ${parts.length} invoices, answered per invoice below.` : `Split into ${parts.length} invoices. Please answer per invoice below.`}</span>
              {!readOnly && parts.length < VAT_CUSTOMS_MAX_PARTS && (
                <button
                  type="button"
                  onClick={split}
                  disabled={disabled}
                  aria-label={`Add invoice, ${ctx}`}
                  className={`${QUIET_BTN} shrink-0`}
                >
                  <Plus className="w-4 h-4" aria-hidden />
                  Add invoice
                </button>
              )}
            </div>
          </td>
        ) : (
          FIELDS.map((def) => (
            <td key={def.key} className={ATD}>
              {field(def, parts[0], 0, ctx)}
            </td>
          ))
        )}
        <td className={TD}>
          <div className="flex items-center min-h-8">
            <DocPills line={line} boe={boe} invoice={invoice} other={other} names={names} onAddFile={onAddFile} disabled={disabled} readOnly={readOnly} />
          </div>
        </td>
        <td className={TD}>
          <div className={LINE}>
            <StatusBadge missing={status.missing} readOnly={readOnly} plain />
          </div>
        </td>
        <td className={`${TD_BASE} pl-0 pr-2 text-right`}>
          {!readOnly && (
            <div className="flex items-center justify-end min-h-8">
              <RowMenu label={`More actions, ${ctx}`} items={lineMenuItems(line, parts.length, split, onAddFile)} disabled={disabled} compact />
            </div>
          )}
        </td>
      </tr>
      {!isSplit && strip(parts[0], 0, '')}
      {isSplit &&
        parts.map((part, i) => (
          <React.Fragment key={i}>
            <tr>
              <td className={`${TD} ${SUB_BG}`} />
              <td className={`${TD} ${SUB_BG}`} colSpan={3}>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 select-none w-3 shrink-0" aria-hidden>
                    └
                  </span>
                  {readOnly ? (
                    <span className={`${LINE} min-w-0 text-sm tabular-nums ${part.invoiceRef?.trim() ? 'text-gray-900' : 'text-gray-600'}`}>
                      <span className="truncate">
                        {part.invoiceRef?.trim() ? `Invoice ${part.invoiceRef.trim()}` : `Invoice ${i + 1}: no number`}
                      </span>
                    </span>
                  ) : (
                    <>
                      <InvoiceRefInput
                        id={`${idPrefix}-p${i}-inv`}
                        value={part.invoiceRef ?? ''}
                        index={i}
                        context={lineContext(line, i)}
                        disabled={disabled}
                        inTable
                        onChange={(s) => setPart(i, { invoiceRef: s })}
                      />
                      <button
                        type="button"
                        onClick={() => removePart(i)}
                        disabled={disabled}
                        className="shrink-0 inline-flex items-center justify-center size-8 rounded-lg tme-btn-danger-ghost transition-colors disabled:opacity-50 tme-btn-focus"
                        aria-label={`Remove invoice ${i + 1}, ${ctx}`}
                      >
                        <X className="w-4 h-4" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              </td>
              {FIELDS.map((def) => (
                <td key={def.key} className={`${ATD} ${SUB_BG}`}>
                  {field(def, part, i, lineContext(line, i))}
                </td>
              ))}
              <td className={`${TD} ${SUB_BG}`} />
              <td className={`${TD} ${SUB_BG}`} colSpan={2}>
                {isVatCustomsPartComplete(part) && part.invoiceRef?.trim() ? (
                  <span className={LINE}>
                    <span className="inline-flex items-center gap-[7px] text-[13px] font-medium text-green-700 whitespace-nowrap">
                      <span className="size-2 rounded-full bg-green-600" aria-hidden />
                      Answered
                    </span>
                  </span>
                ) : null}
              </td>
            </tr>
            {strip(part, i, SUB_BG)}
          </React.Fragment>
        ))}
      {conflict && !readOnly && (
        <tr>
          <td className={`${TD_BASE} pt-0 pb-2.5 ${UNDER_PAD}`} colSpan={COLS}>
            <ConflictNote note={conflict} lineId={key} onUseMine={onUseMine} onKeepTheirs={onKeepTheirs} disabled={disabled} />
          </td>
        </tr>
      )}
      {lockedNote && !readOnly && (
        <tr>
          <td className={`${TD_BASE} pt-0 pb-2.5 ${UNDER_PAD}`} colSpan={COLS}>
            <LockedReplyNote texts={lockedNote} lineId={key} onDismiss={onDismissLocked} />
          </td>
        </tr>
      )}
      {filledByLine(answer) && (
        <tr>
          <td className={`${TD_BASE} pt-0 pb-2.5 ${UNDER_PAD}`} colSpan={COLS}>
            <FilledByNote answer={answer} readOnly={readOnly} compact />
          </td>
        </tr>
      )}
      {showQuestions && (
        <tr>
          <td className={`${TD_BASE} pt-0.5 pb-3 ${UNDER_PAD}`} colSpan={COLS}>
            <QuestionBoxes
              line={line}
              questions={questions}
              replies={answer?.replies}
              replyMeta={replyMeta}
              onReply={setReply}
              disabled={disabled}
              idPrefix={idPrefix}
              sideBySide
              readOnly={readOnly}
              sent={sentReplies}
              notes={answer?.notes}
              savedAnswer={savedAnswer}
              onNote={setNote}
            />
          </td>
        </tr>
      )}
    </tbody>
  );
});

// ------------------------------------------------------------------
// Phone: one card per import
// ------------------------------------------------------------------

const LineCard = memo(function LineCard({
  line,
  answer,
  boe,
  invoice,
  other,
  boeNames,
  invoiceNames,
  otherNames,
  replyMeta,
  onChange,
  onAddFile,
  disabled,
  readOnly,
  sentReplies,
  savedAnswer,
  conflict,
  onUseMine,
  onKeepTheirs,
  lockedNote,
  onDismissLocked,
}: LineProps) {
  const key = String(line.id);
  const { parts, setPart, split, removePart, setReply, setNote } = useLineActions(key, answer, onChange);
  const status = lineStatus(answer);
  const isSplit = parts.length > 1;
  const idPrefix = `c${line.id}`;
  const showQuestions = questionsOrReplies(line, answer, readOnly);
  const questions = line.questions ?? NO_QUESTIONS;
  const ctx = lineContext(line, null);
  const names = useMemo(() => ({ boe: boeNames, invoice: invoiceNames, other: otherNames }), [boeNames, invoiceNames, otherNames]);
  const [purpose, payment, incoterm, delivery] = FIELDS;

  const strips = useOpenStrips();
  const fieldsFor = (part: VatCustomsAnswerPart, i: number) => {
    const common = {
      part,
      onPart: (patch: Partial<VatCustomsAnswerPart>) => setPart(i, patch),
      onOpenDetails: () => strips.show(i),
      disabled,
      inTable: false,
      idPrefix: `${idPrefix}-p${i}`,
      showLabel: true,
      context: lineContext(line, isSplit ? i : null),
    };
    if (readOnly) {
      const ro = { part, inTable: false, showLabel: true, context: common.context };
      const details = readOnlyDetails(part);
      return (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-4">
            <div className="sm:col-span-2">
              <ReadOnlyAnswer def={purpose} {...ro} />
            </div>
            <ReadOnlyAnswer def={payment} {...ro} />
            <ReadOnlyAnswer def={incoterm} {...ro} />
            <div className="sm:col-span-2">
              <ReadOnlyAnswer def={delivery} {...ro} />
            </div>
          </div>
          {details.length > 0 && (
            <div className="mt-3">
              <ReadOnlyDetails items={details} />
            </div>
          )}
        </>
      );
    }
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-4">
          <div className="sm:col-span-2">
            <AnswerField def={purpose} {...common} />
          </div>
          <AnswerField def={payment} {...common} />
          <AnswerField def={incoterm} {...common} />
          <div className="sm:col-span-2">
            <AnswerField def={delivery} {...common} />
          </div>
        </div>
        {strips.shown(part, i) && (
          <div className="mt-3">
            <DetailStrip
              part={part}
              onPart={common.onPart}
              disabled={disabled}
              idPrefix={common.idPrefix}
              context={common.context}
              onLeave={() => strips.hide(i)}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <li className="border-b border-gray-200 last:border-b-0 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-base font-semibold text-gray-900 tabular-nums">
          Import {line.lineNo}
          <span className="font-normal text-gray-600 text-sm"> · {formatPageDate(line.declarationDate)}</span>
        </p>
        <QuestionBadge count={questions.length} />
        <span className="ml-auto" />
        <StatusBadge missing={status.missing} readOnly={readOnly} />
        {!readOnly && <RowMenu label={`More actions, ${ctx}`} items={lineMenuItems(line, parts.length, split, onAddFile)} disabled={disabled} />}
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm text-gray-600">Customs declaration (BOE) no.</p>
          <p className="text-[15px] font-medium text-gray-900 tabular-nums break-all">{line.declarationNo}</p>
        </div>
        <div className="sm:text-right shrink-0">
          <p className="text-[15px] font-medium text-gray-900 tabular-nums">AED {formatAmount(line.totalValue)}</p>
          <p className="text-sm text-gray-600 tabular-nums">VAT AED {formatAmount(line.totalVat)}</p>
        </div>
      </div>

      {conflict && !readOnly && (
        <div className="mt-3">
          <ConflictNote note={conflict} lineId={key} onUseMine={onUseMine} onKeepTheirs={onKeepTheirs} disabled={disabled} />
        </div>
      )}

      {lockedNote && !readOnly && (
        <div className="mt-3">
          <LockedReplyNote texts={lockedNote} lineId={key} onDismiss={onDismissLocked} />
        </div>
      )}

      {showQuestions && (
        <div className="mt-3">
          <QuestionBoxes
            line={line}
            questions={questions}
            replies={answer?.replies}
            replyMeta={replyMeta}
            onReply={setReply}
            disabled={disabled}
            idPrefix={idPrefix}
            sideBySide={false}
            readOnly={readOnly}
            sent={sentReplies}
            notes={answer?.notes}
            savedAnswer={savedAnswer}
            onNote={setNote}
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {parts.map((part, i) =>
          isSplit ? (
            <div key={i} className="rounded-[10px] border border-gray-200 bg-gray-50/50 p-3">
              {readOnly ? (
                <p className="text-[15px] mb-3">
                  <span className="font-semibold text-tme-blue">Invoice no.</span>{' '}
                  <span className={`tabular-nums break-all ${part.invoiceRef?.trim() ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
                    {part.invoiceRef?.trim() || 'not given'}
                  </span>
                </p>
              ) : (
                <>
                  <label htmlFor={`${idPrefix}-p${i}-inv`} className="block text-[15px] font-semibold leading-snug text-tme-blue mb-1.5">
                    Invoice no.
                  </label>
                  <div className="flex items-start gap-2 mb-3">
                    <InvoiceRefInput
                      id={`${idPrefix}-p${i}-inv`}
                      value={part.invoiceRef ?? ''}
                      index={i}
                      context={lineContext(line, i)}
                      disabled={disabled}
                      inTable={false}
                      onChange={(s) => setPart(i, { invoiceRef: s })}
                    />
                    <Button tone="dangerGhost" onClick={() => removePart(i)} disabled={disabled} aria-label={`Remove invoice ${i + 1}, ${ctx}`} className="shrink-0">
                      Remove
                    </Button>
                  </div>
                </>
              )}
              {fieldsFor(part, i)}
            </div>
          ) : (
            <div key={i}>{fieldsFor(part, i)}</div>
          )
        )}
        {!readOnly && isSplit && parts.length < VAT_CUSTOMS_MAX_PARTS && (
          <Button tone="ghost" onClick={split} disabled={disabled} className="-ml-3">
            <Plus className="w-4 h-4" aria-hidden />
            Add invoice
          </Button>
        )}
        <FilledByNote answer={answer} readOnly={readOnly} />
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-[15px] font-semibold text-tme-blue">Documents</span>
        <DocPills line={line} boe={boe} invoice={invoice} other={other} names={names} onAddFile={onAddFile} disabled={disabled} readOnly={readOnly} big />
      </div>
    </li>
  );
});

// ------------------------------------------------------------------
// Toolbar pieces
// ------------------------------------------------------------------

type Confirm = { kind: 'apply' } | { kind: 'defaults' } | null;

/**
 * "Saved 11:02" / "Saving…" / the error. `compact` = the header (short error, the full text in the table).
 * The text size comes from the parent (15px in the page band, 14px in the phone bar).
 */
export function SaveStatus({ save, onRetry, compact = false }: { save: SaveState; onRetry: () => void; compact?: boolean }) {
  if (save.status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-600 whitespace-nowrap">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  if (save.status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-600 whitespace-nowrap">
        <Check className="w-4 h-4 text-green-700" strokeWidth={3} aria-hidden />
        Saved {formatDubaiTime(save.at)}
      </span>
    );
  }
  if (save.status === 'error') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium text-tme-red">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
        {compact ? 'Not saved yet' : save.message}
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 min-h-10 px-1 font-semibold underline underline-offset-2 rounded tme-btn-focus"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden />
          Try again
        </button>
      </span>
    );
  }
  return <span className="text-gray-600 whitespace-nowrap">Answers save automatically</span>;
}

// ------------------------------------------------------------------
// The section
// ------------------------------------------------------------------

export interface CustomsTableProps {
  lines: VatCustomsPageLine[];
  answers: VatCustomsAnswers;
  defaults: VatCustomsDefaults;
  sentAt: string | null;
  fileCounts: Record<string, LineFileCounts>;
  save: SaveState;
  disabled: boolean;
  /** Download Excel: a link, or null in the demo. */
  excelHref: string | null;
  hasExcel: boolean;
  /** A calm note from the page (e.g. "The list of imports was updated by TME ..."). */
  notice: string | null;
  onDismissNotice: () => void;
  onChange: OnLineChange;
  /** Replace the whole map (Copy to empty rows / Same as last quarter); `changed` = the ids filled. */
  onFill: (next: VatCustomsAnswers, changed: string[]) => void;
  onAddFile: OnAddFile;
  onRetrySave: () => void;
  /** A closed request: what was sent, read-only (no inputs, no fill buttons, no save state). */
  readOnly?: boolean;
  /** Round 4 C: who sent each reply and when, per line id then question id. */
  replyMeta?: Record<string, LineReplyMeta>;
  /** Round 4 D: contact names next to the emails under the replies; missing = emails only. */
  peopleNames?: Record<string, string>;
  /** Round 5: replies already sent, per line id then question id (the sent text): read-only. */
  sentReplies?: Record<string, Record<string, string>>;
  /** Round 5 item 8: the server's copy of the answers (stored notes with who / when). */
  savedAnswers?: VatCustomsAnswers;
  /** Round 5: lines someone else changed meanwhile (their version shows, plus a note). */
  conflicts?: Record<string, LineConflictNote>;
  onUseMine?: (lineId: string) => void;
  onKeepTheirs?: (lineId: string) => void;
  /** Round 5 review: text typed into replies already sent (refused), per line id then question id; shown until dismissed. */
  lockedNotes?: Record<string, Record<string, string>>;
  onDismissLocked?: (lineId: string) => void;
}

export default function CustomsTable({ peopleNames, ...props }: CustomsTableProps) {
  return (
    <PeopleNamesContext.Provider value={peopleNames}>
      <SentAtContext.Provider value={props.sentAt}>
        <CustomsTableBody {...props} />
      </SentAtContext.Provider>
    </PeopleNamesContext.Provider>
  );
}

function CustomsTableBody(props: Omit<CustomsTableProps, 'peopleNames'>) {
  const {
    lines,
    answers,
    defaults,
    sentAt,
    fileCounts,
    save,
    disabled,
    excelHref,
    hasExcel,
    notice,
    onDismissNotice,
    onChange,
    onFill,
    onAddFile,
    onRetrySave,
    readOnly = false,
    replyMeta,
    sentReplies,
    savedAnswers,
    conflicts,
    onUseMine,
    onKeepTheirs,
    lockedNotes,
    onDismissLocked,
  } = props;
  const wide = useIsWide();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [sourceId, setSourceId] = useState<string>('');
  const [filter, setFilter] = useState<CustomsLineFilter>('all');
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);

  const total = lines.length;
  const answered = useMemo(() => lines.filter((l) => isVatCustomsLineComplete(answers[String(l.id)])).length, [lines, answers]);
  const lineIds = useMemo(() => lines.map((l) => String(l.id)), [lines]);
  const questionCount = useMemo(() => lines.reduce((n, l) => n + (l.questions?.length ?? 0), 0), [lines]);
  const openCount = total - answered;

  // Rows that can be copied: their first (or only) part is fully answered.
  const sources = useMemo(
    () => lines.filter((l) => isVatCustomsPartComplete(copyableAnswer(answers[String(l.id)]?.parts?.[0]))),
    [lines, answers]
  );
  const emptyCount = useMemo(() => lineIds.filter((id) => isFillableLine(answers[id])).length, [answers, lineIds]);
  const activeSource = sources.find((l) => String(l.id) === sourceId) ?? sources[0] ?? null;
  const defaultsText = defaults ? describePart(copyableAnswer(defaults)) : '';

  const answersSnapshot = useRef(answers);
  answersSnapshot.current = answers;
  const pickFilter = (next: CustomsLineFilter) => {
    setFilter(next);
    setShownIds(filterCustomsLineIds(next, lines, answers));
  };
  // The lines changed (TME updated the list or the questions): take the filter again.
  useEffect(() => {
    setShownIds((prev) => (prev === null ? prev : filterCustomsLineIds(filter, lines, answersSnapshot.current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const visibleLines = useMemo(
    () => (shownIds ? lines.filter((l) => shownIds.has(String(l.id))) : lines),
    [lines, shownIds]
  );

  const doApply = () => {
    if (!activeSource) return;
    const r = fillEmptyLines(answers, lineIds, answers[String(activeSource.id)]?.parts?.[0]);
    if (r.filled.length > 0) onFill(r.answers, r.filled);
    setConfirm(null);
  };
  const doDefaults = () => {
    const r = fillEmptyLines(answers, lineIds, defaults);
    if (r.filled.length > 0) onFill(r.answers, r.filled);
    setConfirm(null);
  };

  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

  const segments: Array<{ key: CustomsLineFilter; label: string; count: number; amber?: boolean }> = [
    { key: 'all', label: 'All', count: total },
    { key: 'open', label: 'Still open', count: openCount },
    ...(questionCount > 0 ? [{ key: 'questions' as const, label: 'TME questions', count: questionCount, amber: true }] : []),
  ];
  // With open questions, that one comes first.
  if (questionCount > 0) segments.unshift(segments.pop() as (typeof segments)[number]);

  const rowProps = (line: VatCustomsPageLine) => {
    const f = fileCounts[String(line.id)] ?? NO_FILES;
    return {
      line,
      answer: answers[String(line.id)],
      replyMeta: replyMeta?.[String(line.id)],
      boe: f.boe,
      invoice: f.invoice,
      other: f.other,
      boeNames: f.names?.boe.join('\n') ?? '',
      invoiceNames: f.names?.invoice.join('\n') ?? '',
      otherNames: f.names?.other.join('\n') ?? '',
      onChange,
      onAddFile,
      disabled: disabled || readOnly,
      readOnly,
      sentReplies: sentReplies?.[String(line.id)],
      savedAnswer: savedAnswers?.[String(line.id)],
      conflict: conflicts?.[String(line.id)],
      onUseMine,
      onKeepTheirs,
      lockedNote: lockedNotes?.[String(line.id)],
      onDismissLocked,
    };
  };

  const headers: Array<[string, string]> = [
    ['No.', 'text-right !pl-1 !pr-0.5'],
    ['BOE no. and date', ''],
    ['Value (AED)', 'text-right'],
    ['VAT (AED)', 'text-right'],
    ['Purpose', '!pl-3'],
    ['Paid or free', '!pl-3'],
    ['Delivery terms', '!pl-3'],
    ['Delivery place', '!pl-3'],
    ['Documents', ''],
    ['Status', ''],
    ['', ''],
  ];

  const fillHint =
    !readOnly && emptyCount > 0 && sources.length === 0
      ? 'Tip: answer one import completely, then use "Copy to empty rows" to give the empty ones the same answers.'
      : null;

  return (
    <div>
      {/* Phone / tablet (cards): only this slim line sticks (progress + save state), so the
          client always sees "Saved". Wide screens: the page band shows both. */}
      <div className="xl:hidden sticky top-0 z-20 -mx-4 sm:-mx-10 mb-3 bg-white/95 backdrop-blur px-4 sm:px-10 py-2.5 border-y border-gray-200">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <div className="h-1.5 w-16 rounded-full bg-tme-line overflow-hidden shrink-0" aria-hidden>
            <div
              className={`h-full rounded-full transition-all ${answered === total ? 'bg-green-600' : 'bg-tme-blue'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="font-semibold whitespace-nowrap tabular-nums text-tme-blue">
            {answered} of {total} answered
          </p>
          {readOnly ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-gray-600 whitespace-nowrap">
              <Lock className="w-4 h-4" aria-hidden />
              Closed
            </span>
          ) : (
            <div className="min-w-0 ml-auto" aria-live="polite">
              <SaveStatus save={save} onRetry={onRetrySave} compact />
            </div>
          )}
        </div>
      </div>

      {/* No overflow-hidden here: the table header sticks to the page while scrolling. */}
      <section className="bg-white border border-gray-200 rounded-[14px]" aria-labelledby="vat-imports-title">
        <GrainGradient
          color="#3B82F6"
          seed="tme-staff-card-vat-imports"
          grainOpacity={0.35}
          className={`px-5 border-b border-gray-200 rounded-t-[14px] ${wide ? 'py-3.5' : 'py-3'}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 min-h-6">
            <h2 id="vat-imports-title" className={`font-semibold leading-snug text-tme-blue ${wide ? 'text-base' : 'text-[17px]'}`}>
              Your imports
            </h2>
            <span className={`font-medium text-gray-600 tabular-nums ${wide ? 'text-[13px]' : 'text-[15px]'}`}>
              {readOnly
                ? `${answered} of ${total} answered`
                : openCount > 0
                  ? `${openCount} of ${total} still ${openCount === 1 ? 'needs' : 'need'} your answers`
                  : `All ${total} answered`}
            </span>
          </div>
        </GrainGradient>

        {/* Filter + toolbar */}
        <div className={wide ? 'px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-2' : 'px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-3'}>
          <div
            className={wide ? 'inline-flex items-center gap-0.5 rounded-[9px] bg-gray-100 p-[3px]' : 'inline-flex flex-wrap items-center gap-1 rounded-[10px] bg-gray-100 p-1'}
            role="group"
            aria-label="Show imports"
          >
            {segments.map((s) => {
              const active = filter === s.key;
              if (wide) {
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => pickFilter(s.key)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 h-[30px] px-3 rounded-[7px] text-[13px] font-medium whitespace-nowrap transition-colors tme-btn-focus ${
                      active ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {s.label}
                    <span className={`text-xs font-medium tabular-nums ${s.amber ? 'text-amber-700' : 'text-gray-500'}`}>{s.count}</span>
                  </button>
                );
              }
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pickFilter(s.key)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors tme-btn-focus ${
                    active ? 'bg-white text-tme-blue shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-gray-700 hover:text-gray-900'
                  }`}
                >
                  {s.label}
                  <span
                    className={`min-w-6 h-6 px-1.5 inline-flex items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${
                      s.amber ? 'bg-amber-100 text-amber-800' : active ? 'bg-tme-blue/10 text-tme-blue' : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={wide ? 'flex items-center gap-1 ml-auto -mr-2.5' : 'flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto'}>
            {!readOnly && wide && (
              <button
                type="button"
                className={QUIET_BTN}
                onClick={() => setConfirm(confirm?.kind === 'apply' ? null : { kind: 'apply' })}
                disabled={disabled || sources.length === 0 || emptyCount === 0}
                aria-expanded={confirm?.kind === 'apply'}
                title={
                  sources.length === 0
                    ? 'Answer one import first, then copy it to the empty ones.'
                    : emptyCount === 0
                      ? 'Every import already has answers.'
                      : 'Copy one import’s answers to every import that is still empty.'
                }
              >
                <CopyCheck className="w-4 h-4" aria-hidden />
                Copy to empty rows
              </button>
            )}
            {defaults && !readOnly && wide && (
              <button
                type="button"
                className={QUIET_BTN}
                onClick={() => setConfirm(confirm?.kind === 'defaults' ? null : { kind: 'defaults' })}
                disabled={disabled || emptyCount === 0}
                aria-expanded={confirm?.kind === 'defaults'}
                title={emptyCount === 0 ? 'Every import already has answers.' : 'Use your usual answers from the last VAT filing.'}
              >
                <History className="w-4 h-4" aria-hidden />
                Same as last quarter
              </button>
            )}
            {!readOnly && !wide && (
              <Button
                tone="plain"
                size="sm"
                onClick={() => setConfirm(confirm?.kind === 'apply' ? null : { kind: 'apply' })}
                disabled={disabled || sources.length === 0 || emptyCount === 0}
                aria-expanded={confirm?.kind === 'apply'}
                fullWidthOnMobile
                title={
                  sources.length === 0
                    ? 'Answer one import first, then copy it to the empty ones.'
                    : emptyCount === 0
                      ? 'Every import already has answers.'
                      : 'Copy one import’s answers to every import that is still empty.'
                }
              >
                <CopyCheck className="w-4 h-4" aria-hidden />
                Copy to empty rows
              </Button>
            )}
            {defaults && !readOnly && !wide && (
              <Button
                tone="plain"
                size="sm"
                onClick={() => setConfirm(confirm?.kind === 'defaults' ? null : { kind: 'defaults' })}
                disabled={disabled || emptyCount === 0}
                aria-expanded={confirm?.kind === 'defaults'}
                fullWidthOnMobile
                title={emptyCount === 0 ? 'Every import already has answers.' : 'Use your usual answers from the last VAT filing.'}
              >
                <History className="w-4 h-4" aria-hidden />
                Same as last quarter
              </Button>
            )}
          </div>
          {sentAt && (
            <p className={`w-full text-gray-600 tabular-nums ${wide ? 'text-[13px]' : 'text-sm'}`}>Last sent to TME: {formatDubaiDateTime(sentAt)}</p>
          )}
          {fillHint && <p className={`w-full text-gray-600 ${wide ? 'text-[13px]' : 'text-sm'}`}>{fillHint}</p>}
        </div>

        {!readOnly && (notice || confirm || save.status === 'error') && (
          <div className="px-4 sm:px-5 pb-4 space-y-2">
            {save.status === 'error' && (
              <div className="hidden xl:flex rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2 items-center gap-2 text-[15px]">
                <SaveStatus save={save} onRetry={onRetrySave} />
              </div>
            )}
            {notice && (
              <div className="rounded-[10px] border border-blue-100 bg-[#eef2fa] pl-3.5 pr-1 py-1 flex items-center gap-2 text-[15px] text-tme-blue" role="status">
                <Info className="w-[18px] h-[18px] shrink-0" aria-hidden />
                <span className="flex-1 min-w-0 py-2">{notice}</span>
                <button
                  type="button"
                  onClick={onDismissNotice}
                  className="shrink-0 inline-flex items-center justify-center size-11 rounded-[10px] text-gray-600 hover:text-gray-900 hover:bg-white/70 tme-btn-focus"
                  aria-label="Close this note"
                >
                  <X className="w-5 h-5" aria-hidden />
                </button>
              </div>
            )}
            {confirm && (
              <div className="rounded-[10px] border border-tme-line bg-[#F8FAFD] p-4">
                {confirm.kind === 'apply' && activeSource ? (
                  <>
                    <p className="text-[15px] leading-relaxed text-gray-700">
                      Copy the answers of{' '}
                      {sources.length > 1 ? (
                        <span className="inline-block w-80 max-w-full align-middle">
                          <ChoiceSelect
                            id="vat-copy-source"
                            value={String(activeSource.id)}
                            options={sources.map((l) => ({ value: String(l.id), label: `Import ${l.lineNo}`, sub: `BOE ${l.declarationNo}` }))}
                            onChange={(v) => v && setSourceId(v)}
                            ariaLabel="Copy the answers of"
                            display={`Import ${activeSource.lineNo} (BOE ${activeSource.declarationNo})`}
                            size="inline"
                            clearable={false}
                            sheetTitle="Copy the answers of"
                          />
                        </span>
                      ) : (
                        <strong>
                          Import {activeSource.lineNo} (BOE {activeSource.declarationNo})
                        </strong>
                      )}{' '}
                      to the <strong>{emptyCount}</strong> empty {emptyCount === 1 ? 'row' : 'rows'}:{' '}
                      <span className="text-gray-900 font-medium">{describePart(copyableAnswer(answers[String(activeSource.id)]?.parts?.[0]))}</span>
                    </p>
                    <p className="text-sm text-gray-600 mt-1.5">Rows you already started stay as they are. You can still change any row afterwards.</p>
                    <div className="flex flex-col-reverse gap-2 mt-3 sm:flex-row">
                      <Button tone="plain" onClick={() => setConfirm(null)} fullWidthOnMobile>
                        Cancel
                      </Button>
                      <Button tone="primary" onClick={doApply} fullWidthOnMobile>
                        Copy to {emptyCount} empty {emptyCount === 1 ? 'row' : 'rows'}
                      </Button>
                    </div>
                  </>
                ) : confirm.kind === 'defaults' && defaults ? (
                  <>
                    <p className="text-[15px] leading-relaxed text-gray-700">
                      Use your usual answers from the last VAT filing: <span className="font-medium text-tme-blue">{defaultsText}</span>
                    </p>
                    <p className="text-sm text-gray-600 mt-1.5">
                      This fills the {emptyCount} empty {emptyCount === 1 ? 'row' : 'rows'}. Rows you already started stay as they are. You can
                      still change any row afterwards.
                    </p>
                    <div className="flex flex-col-reverse gap-2 mt-3 sm:flex-row">
                      <Button tone="plain" onClick={() => setConfirm(null)} fullWidthOnMobile>
                        Cancel
                      </Button>
                      <Button tone="primary" onClick={doDefaults} fullWidthOnMobile>
                        Fill {emptyCount} empty {emptyCount === 1 ? 'row' : 'rows'}
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        )}

        {visibleLines.length === 0 ? (
          <div className="border-t border-gray-200 px-5 py-6 text-center text-[15px] text-gray-700">
            <p>{filter === 'open' ? 'Every import is answered.' : 'No open questions from TME.'}</p>
            <Button tone="ghost" onClick={() => pickFilter('all')} className="mt-1">
              Show all imports
            </Button>
          </div>
        ) : wide ? (
          // From 1280 px only (useIsWide): the table fits without a sideways scroll and
          // uses the page scroll (no scroll box inside the page) with a sticky header.
          <table
            className="w-full text-sm border-separate border-spacing-0 table-fixed [&>tbody:last-child>tr:last-child>td]:border-b-0 [&>tbody:last-child>tr:last-child>td:first-child]:rounded-bl-[13px] [&>tbody:last-child>tr:last-child>td:last-child]:rounded-br-[13px]"
            style={{ minWidth: TABLE_MIN_W }}
          >
            <colgroup>
              {COL_DEFS.map((c, i) => (
                <col key={i} className={c.cls} style={c.w ? { width: c.cls ? undefined : c.w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {headers.map(([label, cls], i) => (
                  <th
                    key={i}
                    scope="col"
                    className={`sticky top-0 z-10 h-10 bg-[#F9FAFB] px-2.5 align-middle text-[12.5px] font-medium leading-tight whitespace-nowrap overflow-hidden text-ellipsis text-gray-600 border-y border-gray-200 ${cls} ${
                      cls.includes('text-right') ? '' : 'text-left'
                    }`}
                  >
                    {label === 'Delivery place' ? (
                      <span className="inline-flex items-center gap-1.5">
                        {label}
                        <InfoTip text={DELIVERY_HELP} label="What is the delivery place on the invoice?" />
                      </span>
                    ) : label ? (
                      label
                    ) : (
                      <span className="sr-only">Actions</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            {visibleLines.map((line) => (
              <LineRows key={line.id} {...rowProps(line)} />
            ))}
          </table>
        ) : (
          <ul className="border-t border-gray-200">
            {visibleLines.map((line) => (
              <LineCard key={line.id} {...rowProps(line)} />
            ))}
          </ul>
        )}

        {/* Download Excel: at the bottom of the list (22.10), the help as plain text (no tooltip-only info). */}
        {hasExcel && (
          <div className="border-t border-gray-200 px-4 sm:px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {wide ? (
              excelHref ? (
                <a href={excelHref} className={`${QUIET_BTN} -ml-2.5`}>
                  <Download className="w-4 h-4" aria-hidden />
                  Download as Excel
                </a>
              ) : (
                <button type="button" disabled className={`${QUIET_BTN} -ml-2.5`}>
                  <Download className="w-4 h-4" aria-hidden />
                  Download as Excel (not in the demo)
                </button>
              )
            ) : excelHref ? (
              <ButtonLink href={excelHref} tone="ghost" size="sm" className="-ml-2">
                <Download className="w-4 h-4" aria-hidden />
                Download Excel
              </ButtonLink>
            ) : (
              <Button tone="ghost" size="sm" disabled className="-ml-2">
                <Download className="w-4 h-4" aria-hidden />
                Download Excel (not in the demo)
              </Button>
            )}
            {!readOnly && <p className={`text-gray-600 ${wide ? 'text-[13px]' : 'text-sm'}`}>{EXCEL_HELP}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
