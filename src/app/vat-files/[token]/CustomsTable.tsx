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
// Look (11.10): a compact "fintech" table: ~52 px rows, quiet select cells
// (hairline until hover / focus), document pills, a "..." menu per row.
//
// Read-only (11.10, a closed request): the same table with the answers as
// plain text, the replies as text, document pills that only show what came
// in, no menus, no split / remove, no "Copy to empty rows". Nothing can
// call onChange / onFill / onAddFile.

import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
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
  X,
} from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import ChoiceSelect, { type ChoiceOption } from './ChoiceSelect';
import {
  copyableAnswer,
  fillEmptyLines,
  filterCustomsLineIds,
  formatAmount,
  formatDubaiDateTime,
  formatDubaiTime,
  formatPageDate,
  filledByLine,
  isFillableLine,
  questionAskedLine,
  replyWhoLine,
  type CustomsLineFilter,
} from '@/lib/vat-customs';
import {
  VAT_CUSTOMS_DELIVERY_OPTIONS,
  VAT_CUSTOMS_INCOTERM_OPTIONS,
  VAT_CUSTOMS_MAX_PARTS,
  VAT_CUSTOMS_MAX_TEXT_CHARS,
  VAT_CUSTOMS_PAYMENT_OPTIONS,
  VAT_CUSTOMS_PURPOSE_OPTIONS,
  isVatCustomsLineComplete,
  isVatCustomsPartComplete,
  vatCustomsOptionLabel,
  type VatCustomsAnswerPart,
  type VatCustomsAnswers,
  type VatCustomsDefaults,
  type VatCustomsDocKind,
  type VatCustomsLineAnswer,
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

type OnLineChange = (lineId: string, next: VatCustomsLineAnswer) => void;
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

/** Round 4 C: "Sent by x on dd.mm.yyyy hh:mm" under a reply (nothing when unknown). */
function ReplyWho({ meta, className = '' }: { meta: VatCustomsReplyMeta | undefined; className?: string }) {
  const text = replyWhoLine(meta);
  if (!text) return null;
  return <span className={`block text-[11px] leading-snug text-gray-500 break-words ${className}`}>{text}</span>;
}

/** Round 4 C: "Filled in by Anshad Muhammed, TME Services, on 08.10.2026" when the shown answer is TME's. */
function FilledByNote({ answer, readOnly }: { answer: VatCustomsLineAnswer | undefined; readOnly: boolean }) {
  const text = filledByLine(answer);
  if (!text) return null;
  return (
    <p className="flex items-center gap-1.5 text-[11px] leading-snug text-gray-500">
      <Pencil className="w-3 h-3 shrink-0 text-gray-400" aria-hidden />
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

const PRIMARY = TME_COLORS.primary;
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#243F7B]/40';

// ------------------------------------------------------------------
// Small hooks / helpers
// ------------------------------------------------------------------

/** True from 768 px: the table. Below: cards. */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
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
  /** The text box is shown but optional for this value. */
  optionalText?: (value: string | null | undefined) => boolean;
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
    // U10: a customer return needs the original BOE (optional text, no new field).
    optionalText: (v) => v === 'customer_return',
    detail: (v) =>
      v === 'customer_return'
        ? { label: 'Original BOE no. (optional)', placeholder: 'The BOE of the first import, if you have it' }
        : { label: 'Purpose: please explain', ...EXPLAIN },
  },
  {
    key: 'payment',
    label: 'Paid / FOC',
    options: VAT_CUSTOMS_PAYMENT_OPTIONS,
    textKey: 'paymentOther',
    needsText: (v) => v === 'other',
    detail: () => ({ label: 'Paid / FOC: please explain', ...EXPLAIN }),
  },
  {
    key: 'incoterm',
    label: 'Incoterms',
    options: VAT_CUSTOMS_INCOTERM_OPTIONS,
    textKey: 'incotermOther',
    needsText: (v) => v === 'other',
    detail: () => ({ label: 'Incoterms: please explain', placeholder: 'As written on the supplier invoice' }),
  },
  {
    key: 'delivery',
    label: 'Delivery place on the invoice',
    options: VAT_CUSTOMS_DELIVERY_OPTIONS,
    textKey: 'deliveryPlace',
    needsText: (v) => v === 'outside_uae' || v === 'other',
    detail: (v) =>
      v === 'outside_uae'
        ? { label: 'Delivery place: name the place on the invoice', placeholder: 'e.g. "FCA Loughborough"' }
        : { label: 'Delivery place: please explain', ...EXPLAIN },
    // No Incoterm on the invoice = no named place (isVatCustomsPartComplete agrees).
    optional: (part) => part.incoterm === 'not_stated',
  },
];

/** Short table labels where the full option label is too long for one line. */
const SHORT_LABELS: Record<string, Record<string, string>> = {
  delivery: { uae_premises: 'UAE office / warehouse', uae_port: 'UAE port / airport', outside_uae: 'Outside the UAE' },
  purpose: { customer_return: 'Customer return' },
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
      if (o.value === 'other') return { value: o.value, label: 'Other (please explain)', pencil: true };
      if (def.key === 'incoterm' && o.value !== 'not_stated') {
        const [code, ...rest] = o.label.split(' - ');
        return { value: o.value, label: code, sub: rest.join(' - '), strong: true };
      }
      const m = /^(.*?)\s*\((.*)\)$/.exec(o.label);
      if (m && def.key === 'delivery') {
        const sub = m[2].charAt(0).toUpperCase() + m[2].slice(1);
        return { value: o.value, label: m[1], sub, pencil: def.needsText(o.value) };
      }
      return { value: o.value, label: o.label, pencil: !!def.optionalText?.(o.value) };
    }),
  ])
) as Record<FieldDef['key'], ChoiceOption[]>;

/** The fields of a part whose answer needs (or may take) a few words. */
function detailDefs(part: VatCustomsAnswerPart): FieldDef[] {
  return FIELDS.filter((f) => f.needsText(part[f.key]) || !!f.optionalText?.(part[f.key]));
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

type RowState = 'done' | 'started' | 'empty';

function lineState(answer: VatCustomsLineAnswer | undefined): { state: RowState; text: string } {
  const parts = partsOf(answer);
  if (isVatCustomsLineComplete(answer)) return { state: 'done', text: 'answered' };
  if (!parts.some(hasAnyAnswer) && parts.length === 1) return { state: 'empty', text: 'not started' };
  let missing = 0;
  let total = 0;
  for (const p of parts) {
    const g = partGaps(p, parts.length > 1);
    missing += g.missing;
    total += g.total;
  }
  return {
    state: 'started',
    text: missing > 0 ? `${missing} of ${total} ${total === 1 ? 'answer' : 'answers'} missing` : 'not complete yet',
  };
}

const ACCENT: Record<RowState, string> = { done: '#34B37A', started: '#F0B54A', empty: 'transparent' };

function partsOf(answer: VatCustomsLineAnswer | undefined): VatCustomsAnswerPart[] {
  const parts = answer?.parts ?? [];
  return parts.length > 0 ? parts : [{}];
}

function hasAnyAnswer(part: VatCustomsAnswerPart): boolean {
  return FIELDS.some((f) => !!part[f.key]) || !!part.invoiceRef;
}

/** "For sale / stock / trading, Paid, CIF, UAE - port / airport" */
function describePart(part: VatCustomsAnswerPart): string {
  const bits: string[] = [];
  for (const f of FIELDS) {
    const v = part[f.key];
    if (!v) continue;
    if (v === 'other') bits.push(part[f.textKey] ? `Other: ${part[f.textKey]}` : 'Other');
    else if (f.key === 'incoterm' && v !== 'not_stated') bits.push(v);
    else if (f.key === 'delivery' && v === 'outside_uae') bits.push(part.deliveryPlace ? `Outside the UAE (${part.deliveryPlace})` : 'Outside the UAE');
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
          ? 'fixed z-50 pointer-events-none rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg whitespace-pre-line text-left normal-case tracking-normal'
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
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-gray-400 hover:text-gray-700 ${FOCUS_RING}`}
      >
        <Info className="w-3.5 h-3.5" aria-hidden />
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

function RowMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled: boolean }) {
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
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40 ${FOCUS_RING} ${pos ? 'bg-gray-100 text-gray-700' : ''}`}
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      {pos && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className="fixed z-50 w-64 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
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
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              <it.icon className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-gray-800">{it.label}</span>
                {it.hint && <span className="block text-xs text-gray-500 leading-snug">{it.hint}</span>}
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
  const choiceMissing = hasAnyAnswer(part) && !value && !optional;
  const hasDetail = !!value && (def.needsText(value) || !!def.optionalText?.(value));
  const short = value ? cellLabel(def, value, inTable) : '';
  // The written words show in the cell only where they ARE the answer (Other, the place outside the UAE).
  // Paid / FOC and Incoterms are narrow: there the cell keeps "Other" + pencil (words in the tooltip).
  const inline = hasDetail && !!text && def.needsText(value) && (def.key === 'purpose' || def.key === 'delivery');
  const shown = inline ? `${short}: ${text}` : short;
  const full = value ? vatCustomsOptionLabel(def.options, value) : '';
  const title = hasDetail && text && def.needsText(value) ? `${value === 'other' ? 'Other' : full.replace(/\s*\([^)]*\)\s*$/, '')}: ${text}` : full;

  /** Show the details strip and put the cursor in this answer's field. */
  const editDetails = () => {
    onOpenDetails?.();
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`${selectId}-text`)?.focus()));
  };
  const pickValue = (next: string | null) => {
    onPart({ [def.key]: next } as Partial<VatCustomsAnswerPart>);
    // The answer needs a few words: the details strip opens under the row; go there.
    if (next && (def.needsText(next) || def.optionalText?.(next))) editDetails();
  };

  return (
    <div className="min-w-0">
      {showLabel && (
        <label htmlFor={selectId} className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
          {def.label}
          {optional && <span className="font-normal text-gray-400">(optional)</span>}
          {def.key === 'delivery' && <InfoTip text={DELIVERY_HELP} label="What is the delivery place on the invoice?" />}
        </label>
      )}
      <div className="relative">
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
          placeholder={optional ? 'Optional' : 'Select'}
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
            className={`absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 hover:text-[#243F7B] hover:bg-gray-100 disabled:opacity-40 ${FOCUS_RING} ${
              inTable ? 'right-[26px]' : 'right-[30px]'
            }`}
          >
            <Pencil className="w-3 h-3" aria-hidden />
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
  const short = value ? cellLabel(def, value, inTable) : '';
  // The words show next to the choice where they ARE the answer; the others are under the row.
  const inline = !!text && def.needsText(value) && (def.key === 'purpose' || def.key === 'delivery');
  const shown = inline ? `${short}: ${text}` : short;
  const full = value ? vatCustomsOptionLabel(def.options, value) : '';
  const empty = optional ? 'Not needed' : 'Not answered';
  return (
    <div className="min-w-0">
      {showLabel && <p className="text-xs font-medium text-gray-600 mb-1">{def.label}</p>}
      <p
        className={
          inTable
            ? `flex items-center min-h-9 py-1.5 px-2.5 text-[13px] leading-snug break-words ${value ? 'text-gray-900' : 'text-gray-400'}`
            : `flex items-center min-h-11 px-3 py-2 rounded-lg border border-gray-100 bg-gray-50 text-sm break-words ${value ? 'text-gray-900' : 'text-gray-400'}`
        }
        title={inline ? `${full.replace(/\s*\([^)]*\)\s*$/, '')}: ${text}` : full || undefined}
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
    out.push({ label: value === 'customer_return' ? 'Original BOE no.' : def.label, text });
  }
  return out;
}

function ReadOnlyDetails({ items }: { items: Array<{ label: string; text: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1.5 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 text-[13px]">
      {items.map((d) => (
        <p key={d.label} className="min-w-0 break-words">
          <span className="text-gray-500">{d.label}:</span> <span className="text-gray-900">{d.text}</span>
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
        <label htmlFor={textId} className="text-xs font-medium text-gray-700">
          {label}
        </label>
        {missing && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
            <span className="sr-only">needed</span>
          </>
        )}
        {near && (
          <span className={`ml-auto text-[11px] tabular-nums ${text.length >= VAT_CUSTOMS_MAX_TEXT_CHARS ? 'text-amber-700' : 'text-gray-400'}`} aria-live="polite">
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
        className="block w-full resize-none overflow-hidden rounded-lg border border-gray-200 bg-white px-3 py-[7px] text-base md:text-[13px] leading-6 md:leading-5 text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-300 focus:outline-none focus:border-[#243F7B] focus:ring-2 focus:ring-[#243F7B]/20 disabled:bg-gray-50"
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
    <div className="flex flex-wrap gap-x-4 gap-y-3 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2.5" onBlur={onBlur}>
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
  return { parts, setPart, split, removePart, setReply };
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

/** "Done" after the No. of an answered import (muted green, text = readable without colour). */
function DoneBadge() {
  return (
    <span className="inline-flex items-center h-[18px] px-1.5 rounded bg-emerald-50 text-[10.5px] font-semibold text-emerald-700 leading-none" aria-hidden>
      Done
    </span>
  );
}

function QuestionBadge({ count, small = false }: { count: number; small?: boolean }) {
  if (count === 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${small ? 'h-4 px-1' : 'h-5 px-1.5'} rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800 tabular-nums leading-none`}
      title={`TME has ${count} ${count === 1 ? 'question' : 'questions'} on this import`}
    >
      <MessageCircleQuestion className="w-3 h-3" aria-hidden />
      {count}
      <span className="sr-only">{count === 1 ? 'question' : 'questions'} from TME</span>
    </span>
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
}: {
  kind: 'boe' | 'invoice';
  state: 0 | 1 | 2;
  names: string;
  ctx: string;
  disabled: boolean;
  onAdd: () => void;
  readOnly?: boolean;
}) {
  const label = kind === 'boe' ? 'BOE' : 'Invoice';
  const noun = kind === 'boe' ? 'BOE' : 'invoice';
  const base = 'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors';
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
            aria-label={got ? `${label} received, ${ctx}` : `No ${noun}, ${ctx}`}
            className={`${base} ${FOCUS_RING} ${
              got ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'border border-dashed border-gray-200 bg-white text-gray-400'
            }`}
          >
            {got ? <Check className="w-3 h-3" strokeWidth={3} aria-hidden /> : <X className="w-3 h-3" aria-hidden />}
            {label}
          </span>
        )}
      </Tip>
    );
  }
  if (state === 1) {
    return (
      <span className={`${base} border border-gray-200 bg-white text-gray-500`}>
        <Loader2 className="w-3 h-3 animate-spin" style={{ color: PRIMARY }} aria-hidden />
        {label}
        <span className="sr-only">uploading</span>
      </span>
    );
  }
  const received = state === 2;
  const tip = received
    ? names
      ? `${label} received:\n${names}\nClick to add another.`
      : `${label} received by TME. Click to add another.`
    : `No ${noun} yet. Click to upload the ${kind === 'boe' ? 'Bill of Entry' : 'supplier invoice'}.`;
  return (
    <Tip text={tip}>
      {(describedBy) => (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-label={received ? `${label} received. Add another ${noun}, ${ctx}` : `Add ${noun}, ${ctx}`}
          className={`${base} ${FOCUS_RING} disabled:opacity-50 disabled:cursor-not-allowed ${
            received
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100'
              : 'border border-dashed border-gray-300 bg-white text-gray-500 hover:border-[#243F7B] hover:text-[#243F7B]'
          }`}
        >
          {received ? <Check className="w-3 h-3" strokeWidth={3} aria-hidden /> : <Plus className="w-3 h-3" aria-hidden />}
          {label}
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
}) {
  const ctx = lineContext(line, null);
  return (
    <div className="flex items-center gap-1">
      <DocPill kind="boe" state={boe} names={names.boe} ctx={ctx} disabled={disabled} readOnly={readOnly} onAdd={() => onAddFile(line.id, 'boe')} />
      <DocPill kind="invoice" state={invoice} names={names.invoice} ctx={ctx} disabled={disabled} readOnly={readOnly} onAdd={() => onAddFile(line.id, 'invoice')} />
      {/* Other files: the "..." menu adds one; the clip shows once there are some. */}
      {other > 0 && readOnly && (
        <Tip text={`Other files:\n${names.other || `${other} received`}`}>
          {(describedBy) => (
            <span
              tabIndex={0}
              aria-describedby={describedBy}
              aria-label={`${other} other ${other === 1 ? 'file' : 'files'}, ${ctx}`}
              className={`inline-flex items-center gap-0.5 h-6 px-1.5 rounded-full bg-gray-100 text-[11px] font-semibold tabular-nums text-gray-700 ${FOCUS_RING}`}
            >
              <Paperclip className="w-3 h-3" aria-hidden />
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
              className={`inline-flex items-center gap-0.5 h-6 px-1.5 rounded-full bg-gray-100 text-[11px] font-semibold tabular-nums text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 ${FOCUS_RING}`}
            >
              <Paperclip className="w-3 h-3" aria-hidden />
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
function QuestionHead({ q, index, count }: { q: LineQuestion; index: number; count: number }) {
  return (
    <>
      <span className="block text-[12px] font-semibold mb-0.5" style={{ color: PRIMARY }}>
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
}: {
  line: Pick<VatCustomsPageLine, 'lineNo' | 'declarationNo'>;
  questions: LineQuestion[];
  replies: Record<string, string> | undefined;
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
    const box = `rounded-lg border p-2.5 ${sideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 items-start' : ''}`;
    const replyText = (text: string, meta: VatCustomsReplyMeta | undefined) =>
      text ? (
        <div className={`rounded-lg bg-white border border-gray-100 px-2.5 py-1.5 ${sideBySide ? '' : 'mt-2'}`}>
          <p className="text-[13px] leading-snug break-words whitespace-pre-line text-gray-900">
            <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Your reply</span>
            {text}
          </p>
          <ReplyWho meta={meta} className="mt-1" />
        </div>
      ) : (
        <p className={`text-[13px] text-gray-400 ${sideBySide ? 'py-1.5' : 'mt-2'}`}>No reply sent.</p>
      );
    return (
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={q.id} className={box} style={{ backgroundColor: '#FBF8F2', borderColor: '#E7DBC5' }}>
            <div className="flex items-start gap-2 min-w-0">
              <MessageCircleQuestion className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
              <p className="text-[13px] leading-snug break-words min-w-0 whitespace-pre-line text-gray-800">
                <QuestionHead q={q} index={i} count={questions.length} />
                {q.text}
              </p>
            </div>
            {replyText((replies?.[String(q.id)] ?? '').trim(), replyMeta?.[String(q.id)])}
          </div>
        ))}
        {earlier.map(([qid, text]) => (
          <div key={`e${qid}`} className="rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-2 text-[13px] leading-snug break-words whitespace-pre-line">
            <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Your reply to an earlier TME question</span>
            <span className="text-gray-900">{text}</span>
            <ReplyWho meta={replyMeta?.[qid]} className="mt-1" />
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
            className={`rounded-lg border p-2.5 ${sideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 items-start' : ''}`}
            style={{ backgroundColor: '#FBF8F2', borderColor: '#E7DBC5' }}
          >
            <div className="flex items-start gap-2 min-w-0">
              <MessageCircleQuestion className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
              <p id={textId} className="text-[13px] leading-snug break-words min-w-0 whitespace-pre-line text-gray-800">
                <QuestionHead q={q} index={i} count={questions.length} />
                {q.text}
              </p>
            </div>
            <label htmlFor={replyId} className="sr-only">
              Your reply to TME question {questions.length > 1 ? `${i + 1} ` : ''}on {ctx}
            </label>
            <textarea
              id={replyId}
              value={replies?.[String(q.id)] ?? ''}
              disabled={disabled}
              maxLength={VAT_CUSTOMS_MAX_TEXT_CHARS}
              onChange={(e) => onReply(q.id, e.target.value)}
              rows={sideBySide ? 2 : 3}
              placeholder="Your reply"
              aria-describedby={textId}
              className={`w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-base md:text-[13px] leading-snug text-gray-900 placeholder:text-gray-400 resize-y focus:outline-none focus:border-[#243F7B] focus:ring-2 focus:ring-[#243F7B]/20 disabled:bg-gray-50 ${
                sideBySide ? '' : 'mt-2'
              }`}
            />
            {(replies?.[String(q.id)] ?? '').trim() && replyMeta?.[String(q.id)] ? (
              <ReplyWho meta={replyMeta[String(q.id)]} className={sideBySide ? 'col-start-2 -mt-2' : 'mt-1'} />
            ) : null}
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
  return (
    <div className="relative flex-1 min-w-0">
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        maxLength={VAT_CUSTOMS_MAX_TEXT_CHARS}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Invoice ${index + 1} no.`}
        aria-label={`Invoice no., ${context}${missing ? ', needed' : ''}`}
        className={`w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 tabular-nums hover:border-gray-300 focus:outline-none focus:border-[#243F7B] focus:ring-2 focus:ring-[#243F7B]/20 disabled:bg-gray-50 ${
          inTable ? 'h-9 pl-2.5 pr-6 text-[13px]' : 'h-11 pl-3 pr-7 text-base'
        }`}
      />
      {missing && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />}
    </div>
  );
}

// ------------------------------------------------------------------
// Laptop: one <tbody> per import
// ------------------------------------------------------------------

// Columns: no. | BOE no. + date | Value | VAT | 4 answers | Documents | menu.
// Fits at 1280 px without a sideways scroll (U12): 1220 of ~1230 px. The answer
// columns fit their common labels on one line ("For sale / stock / trading",
// "Will be paid", "Not stated", "UAE office / warehouse").
const COL_WIDTHS = [68, 112, 96, 80, 208, 128, 122, 200, 166, 40];
const COLS = COL_WIDTHS.length;
const TABLE_MIN_W = COL_WIDTHS.reduce((a, b) => a + b, 0);
const TD_BASE = 'py-2 align-top group-hover/row:bg-gray-50/60 transition-colors';
const TD = `px-2 ${TD_BASE}`;
/** Answer cells: a little less padding, so the labels fit on one line. */
const ATD = `px-1.5 ${TD_BASE}`;
/** The 3 px status bar on the left edge of every row of an import. */
const EDGE = 'shadow-[inset_3px_0_0_var(--row-accent)]';
const SUB_BG = 'bg-gray-50/50';
const NUM = 'tabular-nums text-right whitespace-nowrap';
/** A plain text cell, centred on the 36 px select line. */
const LINE = 'flex items-center h-9';

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
}: LineProps) {
  const key = String(line.id);
  const { parts, setPart, split, removePart, setReply } = useLineActions(key, answer, onChange);
  const status = lineState(answer);
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
          <td className={`${TD} ${EDGE} ${bg} pt-0`} colSpan={4} />
          <td className={`${ATD} ${bg} pt-0 pb-3 pr-3`} colSpan={COLS - 4}>
            <ReadOnlyDetails items={details} />
          </td>
        </tr>
      ) : null;
    }
    return strips.shown(part, i) ? (
      <tr>
        <td className={`${TD} ${EDGE} ${bg} pt-0`} colSpan={4} />
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
    <tbody
      className="group/row [&>tr:last-child>td]:border-b [&>tr:last-child>td]:border-gray-100"
      style={{ '--row-accent': ACCENT[status.state] } as React.CSSProperties}
    >
      <tr>
        <td className={`${TD} ${EDGE} pl-3.5`}>
          <div className="flex items-center gap-1.5 h-9" title={`Import ${line.lineNo}: ${status.text}`}>
            <span className="text-[13px] font-semibold tabular-nums text-gray-900" aria-hidden>
              {line.lineNo}
            </span>
            {status.state === 'done' && <DoneBadge />}
            <span className="sr-only">
              Import {line.lineNo}, {status.text}
            </span>
          </div>
        </td>
        <td className={TD}>
          <div className="flex flex-col justify-center h-9 leading-tight">
            <span className="text-[13px] font-medium tabular-nums text-gray-900 whitespace-nowrap">{line.declarationNo}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500 tabular-nums">
              {formatPageDate(line.declarationDate)}
              <QuestionBadge count={questions.length} small />
            </span>
          </div>
        </td>
        <td className={TD}>
          <div className={`${LINE} justify-end ${NUM} text-[13px] font-medium text-gray-900`}>{formatAmount(line.totalValue)}</div>
        </td>
        <td className={TD}>
          <div className={`${LINE} justify-end ${NUM} text-[13px] text-gray-500`}>{formatAmount(line.totalVat)}</div>
        </td>
        {isSplit ? (
          <td className={TD} colSpan={4}>
            <div className="flex items-center gap-3 h-9 pl-2.5 text-[13px] text-gray-500">
              <Scissors className="w-3.5 h-3.5 text-gray-400" aria-hidden />
              <span>{readOnly ? `Split into ${parts.length} invoices, answered per invoice below.` : `Split into ${parts.length} invoices. Please answer per invoice below.`}</span>
              {!readOnly && parts.length < VAT_CUSTOMS_MAX_PARTS && (
                <button
                  type="button"
                  onClick={split}
                  disabled={disabled}
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 h-7 text-[13px] font-medium hover:bg-[#243F7B]/5 disabled:opacity-50 ${FOCUS_RING}`}
                  style={{ color: PRIMARY }}
                  aria-label={`Add invoice, ${ctx}`}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden />
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
          <div className="flex items-center h-9">
            <DocPills line={line} boe={boe} invoice={invoice} other={other} names={names} onAddFile={onAddFile} disabled={disabled} readOnly={readOnly} />
          </div>
        </td>
        <td className={`${TD_BASE} pl-0.5 pr-2 text-right`}>
          {!readOnly && (
            <div className="flex items-center justify-end h-9">
              <RowMenu label={`More actions, ${ctx}`} items={lineMenuItems(line, parts.length, split, onAddFile)} disabled={disabled} />
            </div>
          )}
        </td>
      </tr>
      {!isSplit && strip(parts[0], 0, '')}
      {isSplit &&
        parts.map((part, i) => (
          <React.Fragment key={i}>
            <tr>
              <td className={`${TD} ${EDGE} ${SUB_BG}`} />
              <td className={`${TD} ${SUB_BG}`} colSpan={3}>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-300 select-none w-3 shrink-0" aria-hidden>
                    └
                  </span>
                  {readOnly ? (
                    <span className={`${LINE} min-w-0 text-[13px] tabular-nums ${part.invoiceRef?.trim() ? 'text-gray-900' : 'text-gray-400'}`}>
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
                        className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 ${FOCUS_RING}`}
                        title="Remove this invoice"
                        aria-label={`Remove invoice ${i + 1}, ${ctx}`}
                      >
                        <X className="w-4 h-4" />
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
              <td className={`${TD} ${SUB_BG}`} colSpan={2}>
                {isVatCustomsPartComplete(part) && part.invoiceRef?.trim() ? (
                  <span className={`${LINE} gap-1 text-xs font-medium text-emerald-700`}>
                    <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />
                    Answered
                  </span>
                ) : null}
              </td>
            </tr>
            {strip(part, i, SUB_BG)}
          </React.Fragment>
        ))}
      {filledByLine(answer) && (
        <tr>
          <td className={`${TD} ${EDGE} pt-0 pb-2`} colSpan={4} />
          <td className={`${ATD} pt-0 pb-2 pr-3`} colSpan={COLS - 4}>
            <FilledByNote answer={answer} readOnly={readOnly} />
          </td>
        </tr>
      )}
      {showQuestions && (
        <tr>
          <td className={`${TD} ${EDGE} pt-0 pb-3 pl-4 pr-3`} colSpan={COLS}>
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
}: LineProps) {
  const key = String(line.id);
  const { parts, setPart, split, removePart, setReply } = useLineActions(key, answer, onChange);
  const status = lineState(answer);
  const isSplit = parts.length > 1;
  const idPrefix = `c${line.id}`;
  const showQuestions = questionsOrReplies(line, answer, readOnly);
  const questions = line.questions ?? NO_QUESTIONS;
  const ctx = lineContext(line, null);
  const names = useMemo(() => ({ boe: boeNames, invoice: invoiceNames, other: otherNames }), [boeNames, invoiceNames, otherNames]);
  const [purpose, payment, incoterm, delivery] = FIELDS;
  const missingShort = status.state === 'started' ? /^(\d+) of/.exec(status.text)?.[1] : undefined;

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
          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
            <div className="col-span-2">
              <ReadOnlyAnswer def={purpose} {...ro} />
            </div>
            <ReadOnlyAnswer def={payment} {...ro} />
            <ReadOnlyAnswer def={incoterm} {...ro} />
            <div className="col-span-2">
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
        <div className="grid grid-cols-2 gap-x-2 gap-y-3">
          <div className="col-span-2">
            <AnswerField def={purpose} {...common} />
          </div>
          <AnswerField def={payment} {...common} />
          <AnswerField def={incoterm} {...common} />
          <div className="col-span-2">
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
    <li
      className="rounded-xl border border-gray-200 bg-white p-3.5 pl-4"
      style={{ boxShadow: `inset 3px 0 0 ${ACCENT[status.state]}, 0 1px 2px rgba(16,24,40,0.04)` }}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-gray-900 tabular-nums">
          Import {line.lineNo}
          <span className="font-normal text-gray-500 text-xs"> · {formatPageDate(line.declarationDate)}</span>
          <span className="sr-only">, {status.text}</span>
        </p>
        <QuestionBadge count={questions.length} />
        <span className="ml-auto" />
        {status.state === 'done' && <DoneBadge />}
        {missingShort && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap" aria-hidden>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {missingShort} missing
          </span>
        )}
        {!readOnly && <RowMenu label={`More actions, ${ctx}`} items={lineMenuItems(line, parts.length, split, onAddFile)} disabled={disabled} />}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">BOE no.</p>
          <p className="text-sm font-medium text-gray-900 tabular-nums break-all">{line.declarationNo}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-medium text-gray-900 tabular-nums">AED {formatAmount(line.totalValue)}</p>
          <p className="text-xs text-gray-500 tabular-nums">VAT AED {formatAmount(line.totalVat)}</p>
        </div>
      </div>

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
          />
        </div>
      )}

      <div className="mt-3 space-y-3">
        {parts.map((part, i) =>
          isSplit ? (
            <div key={i} className="rounded-lg border border-gray-200 bg-gray-50/50 p-2.5">
              {readOnly ? (
                <p className="text-[13px] mb-2.5">
                  <span className="text-xs font-medium text-gray-600">Invoice no.</span>{' '}
                  <span className={`tabular-nums break-all ${part.invoiceRef?.trim() ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                    {part.invoiceRef?.trim() || 'not given'}
                  </span>
                </p>
              ) : (
                <>
                  <label htmlFor={`${idPrefix}-p${i}-inv`} className="block text-xs font-medium text-gray-600 mb-1">
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
                    <button
                      type="button"
                      onClick={() => removePart(i)}
                      disabled={disabled}
                      aria-label={`Remove invoice ${i + 1}, ${ctx}`}
                      className={`shrink-0 h-11 px-2.5 rounded-lg text-xs font-medium text-gray-500 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 ${FOCUS_RING}`}
                    >
                      Remove
                    </button>
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
          <button
            type="button"
            onClick={split}
            disabled={disabled}
            className={`inline-flex items-center gap-1 rounded-md h-8 px-1.5 text-[13px] font-medium disabled:opacity-50 ${FOCUS_RING}`}
            style={{ color: PRIMARY }}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            Add invoice
          </button>
        )}
        <FilledByNote answer={answer} readOnly={readOnly} />
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-600">Documents</span>
        <DocPills line={line} boe={boe} invoice={invoice} other={other} names={names} onAddFile={onAddFile} disabled={disabled} readOnly={readOnly} />
      </div>
    </li>
  );
});

// ------------------------------------------------------------------
// Toolbar pieces
// ------------------------------------------------------------------

type Confirm = { kind: 'apply' } | { kind: 'defaults' } | null;

/** "Saved 11:02" / "Saving…" / the error. `compact` = the header (short error, the full text in the table). */
export function SaveStatus({ save, onRetry, compact = false }: { save: SaveState; onRetry: () => void; compact?: boolean }) {
  if (save.status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  if (save.status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
        <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} aria-hidden />
        Saved {formatDubaiTime(save.at)}
      </span>
    );
  }
  if (save.status === 'error') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: TME_COLORS.error }}>
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
        {compact ? 'Not saved yet' : save.message}
        <button type="button" onClick={onRetry} className={`inline-flex items-center gap-1 font-semibold underline underline-offset-2 rounded ${FOCUS_RING}`}>
          <RotateCcw className="w-3 h-3" aria-hidden />
          Try again
        </button>
      </span>
    );
  }
  return <span className="text-xs text-gray-500 whitespace-nowrap">Auto-save on</span>;
}

const GHOST_BTN = `inline-flex items-center justify-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-lg border border-gray-200 bg-white text-xs sm:text-[13px] font-medium text-gray-700 shadow-[0_1px_1px_rgba(16,24,40,0.03)] transition-colors hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white ${FOCUS_RING}`;

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
}

export default function CustomsTable(props: CustomsTableProps) {
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
    };
  };

  const headers: Array<[string, string]> = [
    ['No.', 'pl-3.5'],
    ['BOE no. / date', ''],
    ['Value (AED)', 'text-right'],
    ['VAT (AED)', 'text-right'],
    ['Purpose', 'pl-4'],
    ['Paid / FOC', 'pl-4'],
    ['Incoterms', 'pl-4'],
    ['Delivery place', 'pl-4'],
    ['Documents', ''],
    ['', ''],
  ];

  return (
    <section
      className="md:rounded-xl md:border md:border-gray-200 md:bg-white md:shadow-[0_1px_3px_rgba(16,24,40,0.05)]"
      aria-labelledby="vat-imports-title"
    >
      {/* Phone: only this slim line sticks (progress + save state), so the
          client always sees "Saved". Laptop: the page header shows both. */}
      <div className="md:hidden sticky top-0 z-20 -mx-4 bg-white/95 backdrop-blur px-4 py-2.5 border-y border-gray-200">
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden shrink-0" aria-hidden>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: answered === total ? TME_COLORS.success : PRIMARY }} />
          </div>
          <p className="text-[13px] font-semibold whitespace-nowrap tabular-nums" style={{ color: PRIMARY }}>
            {answered} of {total} answered
          </p>
          {readOnly ? (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
              <Lock className="w-3.5 h-3.5" aria-hidden />
              Closed
            </span>
          ) : (
            <div className="min-w-0 ml-auto" aria-live="polite">
              <SaveStatus save={save} onRetry={onRetrySave} compact />
            </div>
          )}
        </div>
      </div>

      {/* Title + toolbar: one line on a laptop. */}
      <div className="md:px-4 pt-3.5 pb-3 flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex items-baseline gap-2 min-w-0 mr-1">
          <h2 id="vat-imports-title" className="text-[15px] font-semibold" style={{ color: PRIMARY }}>
            Your imports
          </h2>
          {sentAt && <span className="hidden lg:inline text-xs text-gray-500 whitespace-nowrap">Last sent to TME: {formatDubaiDateTime(sentAt)}</span>}
        </div>

        <div className="inline-flex items-center rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Show imports">
          {segments.map((s) => {
            const active = filter === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => pickFilter(s.key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors ${FOCUS_RING} ${
                  active ? 'bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-gray-600 hover:text-gray-900'
                }`}
                style={active ? { color: PRIMARY } : undefined}
              >
                {s.amber && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />}
                {s.label}
                <span
                  className={`min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                    s.amber ? 'bg-amber-100 text-amber-800' : active ? 'bg-[#243F7B]/10' : 'bg-gray-200/70 text-gray-600'
                  }`}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          {!readOnly && (
            <button
              type="button"
              onClick={() => setConfirm(confirm?.kind === 'apply' ? null : { kind: 'apply' })}
              disabled={disabled || sources.length === 0 || emptyCount === 0}
              aria-expanded={confirm?.kind === 'apply'}
              className={GHOST_BTN}
              title={
                sources.length === 0
                  ? 'Answer one import first, then copy it to the empty ones.'
                  : emptyCount === 0
                    ? 'Every import already has answers.'
                    : 'Copy one import’s answers to every import that is still empty.'
              }
            >
              <CopyCheck className="w-3.5 h-3.5 text-gray-500" aria-hidden />
              Copy to empty rows
            </button>
          )}
          {defaults && !readOnly && (
            <button
              type="button"
              onClick={() => setConfirm(confirm?.kind === 'defaults' ? null : { kind: 'defaults' })}
              disabled={disabled || emptyCount === 0}
              aria-expanded={confirm?.kind === 'defaults'}
              className={GHOST_BTN}
              title={emptyCount === 0 ? 'Every import already has answers.' : 'Use your usual answers from the last VAT filing.'}
            >
              <History className="w-3.5 h-3.5 text-gray-500" aria-hidden />
              Same as last quarter
            </button>
          )}
          {hasExcel && (
            <span className="inline-flex items-center gap-0.5">
              {excelHref ? (
                <a href={excelHref} className={GHOST_BTN}>
                  <Download className="w-3.5 h-3.5 text-gray-500" aria-hidden />
                  Download Excel
                </a>
              ) : (
                <button type="button" disabled className={GHOST_BTN} title="Demo: no file to download">
                  <Download className="w-3.5 h-3.5 text-gray-500" aria-hidden />
                  Download Excel
                </button>
              )}
              {!readOnly && <InfoTip text={EXCEL_HELP} label="About the Excel list" />}
            </span>
          )}
        </div>
      </div>

      {!readOnly && (notice || confirm || save.status === 'error') && (
        <div className="md:px-4 pb-3 space-y-2">
          {save.status === 'error' && (
            <div className="hidden md:flex rounded-lg px-3 py-2 items-center gap-2 text-[13px]" style={{ backgroundColor: 'rgba(239,68,68,0.06)' }}>
              <SaveStatus save={save} onRetry={onRetrySave} />
            </div>
          )}
          {notice && (
            <div className="rounded-lg px-3 py-2 flex items-start gap-2 text-[13px]" style={{ backgroundColor: 'rgba(36,63,123,0.05)', color: PRIMARY }} role="status">
              <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span className="flex-1 min-w-0">{notice}</span>
              <button type="button" onClick={onDismissNotice} className={`shrink-0 p-0.5 rounded text-gray-500 hover:bg-gray-100 ${FOCUS_RING}`} aria-label="Close this note">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {confirm && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(36,63,123,0.25)', backgroundColor: 'rgba(36,63,123,0.03)' }}>
              {confirm.kind === 'apply' && activeSource ? (
                <>
                  <p className="text-[13px] text-gray-700">
                    Copy the answers of{' '}
                    {sources.length > 1 ? (
                      <span className="inline-block w-72 max-w-full align-middle">
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
                  <p className="text-xs text-gray-500 mt-1">Rows you already started stay as they are. You can still change any row afterwards.</p>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <button type="button" onClick={doApply} className={`h-8 px-3 rounded-lg font-semibold text-white text-[13px] ${FOCUS_RING}`} style={{ backgroundColor: PRIMARY }}>
                      Copy to {emptyCount} empty {emptyCount === 1 ? 'row' : 'rows'}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className={`h-8 px-3 rounded-lg font-medium text-[13px] text-gray-600 hover:bg-gray-100 ${FOCUS_RING}`}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : confirm.kind === 'defaults' && defaults ? (
                <>
                  <p className="text-[13px] text-gray-700">
                    Use your usual answers from the last VAT filing:{' '}
                    <span className="font-medium" style={{ color: PRIMARY }}>
                      {defaultsText}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    This fills the {emptyCount} empty {emptyCount === 1 ? 'row' : 'rows'}. Rows you already started stay as they are. You can
                    still change any row afterwards.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <button type="button" onClick={doDefaults} className={`h-8 px-3 rounded-lg font-semibold text-white text-[13px] ${FOCUS_RING}`} style={{ backgroundColor: PRIMARY }}>
                      Fill {emptyCount} empty {emptyCount === 1 ? 'row' : 'rows'}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className={`h-8 px-3 rounded-lg font-medium text-[13px] text-gray-600 hover:bg-gray-100 ${FOCUS_RING}`}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {visibleLines.length === 0 ? (
        <p className="md:border-t border-gray-100 p-6 text-center max-md:rounded-xl max-md:border max-md:bg-white text-[13px] text-gray-600">
          {filter === 'open' ? 'Every import is answered.' : 'No open questions from TME.'}{' '}
          <button type="button" onClick={() => pickFilter('all')} className={`font-semibold underline underline-offset-2 rounded ${FOCUS_RING}`} style={{ color: PRIMARY }}>
            Show all imports
          </button>
        </p>
      ) : wide ? (
        // Below 1280 px the table may scroll sideways; from 1280 px it fits and
        // uses the page scroll (no scroll box inside the page) with a sticky header.
        <div className="overflow-x-auto xl:overflow-visible">
          <table className="w-full text-[13px] border-separate border-spacing-0 table-fixed" style={{ minWidth: TABLE_MIN_W }}>
            <colgroup>
              {COL_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {headers.map(([label, cls], i) => (
                  <th
                    key={i}
                    scope="col"
                    className={`sticky top-0 xl:top-[var(--vat-top,0px)] z-10 bg-gray-50 px-2 h-9 text-[11px] font-semibold uppercase tracking-wide text-gray-500 border-y border-gray-200 whitespace-nowrap ${cls} ${
                      cls.includes('text-right') ? '' : 'text-left'
                    }`}
                  >
                    {label === 'Delivery place' ? (
                      <span className="inline-flex items-center gap-1">
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
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visibleLines.map((line) => (
            <LineCard key={line.id} {...rowProps(line)} />
          ))}
        </ul>
      )}
      {wide && visibleLines.length > 0 && (
        <p className="xl:hidden px-4 py-2 text-[11px] text-gray-400">Scroll sideways in the table to see all columns.</p>
      )}
    </section>
  );
}
