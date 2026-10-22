'use client';

// The answer picker of the customs table (11.10, replaces the native
// <select>): a select-only combobox (WAI-ARIA APG pattern). Focus stays on
// the button; the open list is announced through aria-activedescendant.
//
// Laptop: a floating panel in a portal (fixed position, flips above the
// button near the bottom of the screen, never cut by the table).
// Phone (< 768 px): a bottom sheet with big tap targets.
//
// Keyboard: Enter / Space / Arrow keys open; Up / Down / Home / End /
// PageUp / PageDown move; letters jump (type-ahead); Enter or Space picks;
// Escape closes; Tab closes and moves on.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Pencil } from 'lucide-react';

export interface ChoiceOption {
  value: string;
  /** Main line ("CIF", "Paid"). */
  label: string;
  /** A muted second line ("Cost, Insurance and Freight (sea)"). */
  sub?: string;
  /** Bold main line (Incoterm codes). */
  strong?: boolean;
  /** "Other (please explain)": a pencil, the client writes more below. */
  pencil?: boolean;
}

interface Props {
  id: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** "Purpose, import 3, BOE 1010..." */
  ariaLabel: string;
  ariaDescribedBy?: string;
  /** The short text on the closed button ("" = nothing chosen). */
  display: string;
  /** Full text for the tooltip when the button shows a short one. */
  displayTitle?: string;
  /** Keep room on the right for the pencil button the caller lays over the cell. */
  reserveRight?: boolean;
  placeholder?: string;
  /** An amber border: this answer is required and still empty. */
  needed?: boolean;
  /** table = quiet cell; card = phone field; inline = a picker inside a sentence. */
  size: 'table' | 'card' | 'inline';
  /** Offer "No answer" to clear a chosen value (default yes). */
  clearable?: boolean;
  /** The bottom sheet's heading on phones ("Purpose"). */
  sheetTitle: string;
  sheetSubtitle?: string;
}

const PANEL_MIN_W = 300;
const PANEL_MAX_H = 340;

type Place = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

export default function ChoiceSelect({
  id,
  value,
  options: baseOptions,
  onChange,
  disabled = false,
  ariaLabel,
  ariaDescribedBy,
  display,
  displayTitle,
  reserveRight = false,
  placeholder = 'Select',
  needed = false,
  size,
  sheetTitle,
  sheetSubtitle,
  clearable = true,
}: Props) {
  // A chosen answer can be cleared again (the native picker had "Select…").
  const options: ChoiceOption[] = useMemo(() => (value && clearable ? [{ value: '', label: 'No answer' }, ...baseOptions] : baseOptions), [value, clearable, baseOptions]);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Place | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-opt-${i}`;
  const selectedIndex = value ? options.findIndex((o) => o.value === value) : -1;

  const measure = useCallback((): boolean => {
    const r = btn.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, PANEL_MIN_W), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const contentH = panel.current?.scrollHeight ?? options.length * 44 + 8;
    const want = Math.min(contentH, PANEL_MAX_H);
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    if (below >= Math.min(want, 260) || below >= above) {
      setPlace({ left, width, top: r.bottom + 4, maxHeight: Math.max(120, Math.min(PANEL_MAX_H, below)) });
    } else {
      setPlace({ left, width, bottom: vh - r.top + 4, maxHeight: Math.max(120, Math.min(PANEL_MAX_H, above)) });
    }
    return true;
  }, [options.length]);

  const openList = useCallback(
    (at?: number) => {
      if (disabled) return;
      const phone = window.matchMedia('(max-width: 767px)').matches;
      setSheet(phone);
      // Phone sheet: no highlight until a key is used (a tap needs none).
      setActive(at ?? (phone ? selectedIndex : Math.max(0, selectedIndex)));
      if (!phone) measure();
      setOpen(true);
    },
    [disabled, measure, selectedIndex]
  );

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus({ preventScroll: true });
  }, []);

  const pick = useCallback(
    (i: number) => {
      const o = options[i];
      close();
      if (!o) return;
      if (o.value !== value) onChange(o.value || null);
    },
    [close, onChange, options, value]
  );

  // Once drawn: measure the real height (flip if needed), keep the active option in view.
  useEffect(() => {
    if (open && !sheet) measure();
  }, [open, sheet, measure]);
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // Click outside, page scroll / resize.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (floating.current?.contains(t) || btn.current?.contains(t)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (sheet) return;
      if (panel.current && e.target instanceof Node && panel.current.contains(e.target)) return;
      if (!measure()) close(false);
    };
    const onResize = () => {
      if (!sheet && !measure()) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, sheet, close, measure]);

  // The sheet holds the page still while it is open.
  useEffect(() => {
    if (!open || !sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, sheet]);

  /** Type-ahead: the next option whose label starts with the typed letters. */
  const typeAhead = (ch: string): number => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 600 ? ch : t.text + ch;
    t.at = now;
    const q = t.text.toLowerCase();
    const n = options.length;
    const from = open ? active : selectedIndex;
    // One repeated letter cycles through the options with that letter.
    const cycling = q.length > 1 && q.split('').every((c) => c === q[0]);
    const needle = cycling ? q[0] : q;
    const start = cycling || q.length === 1 ? from + 1 : Math.max(from, 0);
    for (let k = 0; k < n; k++) {
      const i = (start + k + n) % n;
      if (options[i].value && options[i].label.toLowerCase().startsWith(needle)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const n = options.length;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      } else if (e.key === 'Home') {
        e.preventDefault();
        openList(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        openList(n - 1);
      } else if (printable) {
        const i = typeAhead(e.key);
        if (i >= 0) {
          e.preventDefault();
          openList(i);
        }
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(n - 1, a + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey) pick(active);
        else setActive((a) => Math.max(0, a - 1));
        return;
      case 'Home':
        e.preventDefault();
        setActive(0);
        return;
      case 'End':
        e.preventDefault();
        setActive(n - 1);
        return;
      case 'PageDown':
        e.preventDefault();
        setActive((a) => Math.min(n - 1, a + 8));
        return;
      case 'PageUp':
        e.preventDefault();
        setActive((a) => Math.max(0, a - 8));
        return;
      case 'Enter':
        e.preventDefault();
        pick(active);
        return;
      case ' ':
        e.preventDefault();
        if (Date.now() - typed.current.at < 600 && typed.current.text) {
          const i = typeAhead(' ');
          if (i >= 0) setActive(i);
        } else pick(active);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'Tab':
        close(false);
        return;
      default:
        if (printable) {
          const i = typeAhead(e.key);
          if (i >= 0) setActive(i);
        }
    }
  };

  const table = size === 'table';
  const chosen = !!value;
  // Card / inline: the bordered box; amber = required and still empty.
  const border = needed && !chosen ? 'border-amber-400 bg-white hover:border-amber-500' : 'border-gray-200 bg-white hover:border-gray-300';
  // Laptop table (quiet, 22.10 round 2): a filled answer reads as plain text with a small chevron;
  // a light border shows on hover / focus. Required and empty = a small amber "Choose" box.
  const tableTone =
    needed && !chosen
      ? 'border-amber-300 bg-amber-50 text-amber-800 font-medium hover:border-amber-400'
      : 'border-transparent bg-transparent hover:border-gray-300 hover:bg-white';
  const btnCls = table
    ? `inline-flex max-w-full h-8 px-2 gap-1.5 rounded-lg border text-sm focus-visible:border-tme-blue focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-tme-blue/25 ${tableTone}`
    : size === 'inline'
      ? `flex w-full min-h-11 py-1.5 px-3 gap-2 rounded-[10px] border-2 text-[15px] focus:border-tme-blue focus:bg-white ${border}`
      : `flex w-full min-h-[46px] py-2 px-3.5 gap-2 rounded-[10px] border-2 text-base focus:border-tme-blue focus:bg-white ${border}`;
  const textCls = table
    ? `min-w-0 truncate whitespace-nowrap ${chosen ? 'text-gray-900' : needed ? '' : 'text-gray-500'}`
    : `flex-1 min-w-0 break-words ${chosen ? 'text-gray-900' : 'text-gray-500'}`;
  const chevronCls = table
    ? `w-3.5 h-3.5 shrink-0 ${needed && !chosen ? 'text-amber-700' : 'text-gray-400'}`
    : 'w-[18px] h-[18px] shrink-0 text-tme-blue';

  const listItems = options.map((o, i) => {
    const selected = !!value && o.value === value;
    const isActive = i === active;
    const clear = o.value === '';
    return (
      <div
        key={o.value || '__none'}
        id={optId(i)}
        role="option"
        aria-selected={selected}
        aria-label={o.sub ? `${o.label}, ${o.sub}` : undefined}
        onPointerMove={() => setActive(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(i)}
        className={`flex items-start gap-2.5 rounded-md cursor-pointer select-none ${sheet ? 'px-3 py-3 min-h-12' : 'px-3 py-2 min-h-10'} ${
          isActive ? 'bg-gray-100' : ''
        } ${clear ? 'text-gray-600' : 'text-gray-900'}`}
      >
        {o.strong ? (
          // Incoterms: the code bold, its meaning muted on the same line.
          <span className={`flex-1 min-w-0 flex items-baseline gap-2 leading-5 ${table ? 'text-sm' : 'text-[15px]'}`}>
            <span className="w-10 shrink-0 font-semibold tabular-nums">{o.label}</span>
            {o.sub && <span className={`min-w-0 text-gray-600 ${table ? 'text-[13px]' : 'text-sm'}`}>{o.sub}</span>}
          </span>
        ) : (
          <span className="flex-1 min-w-0">
            <span className={`flex items-center gap-1.5 leading-5 ${table ? 'text-sm' : 'text-[15px]'}`}>
              {o.label}
              {o.pencil && <Pencil className="w-3.5 h-3.5 text-gray-500 shrink-0" aria-hidden />}
            </span>
            {o.sub && <span className={`block mt-0.5 leading-snug text-gray-600 ${table ? 'text-[13px]' : 'text-sm'}`}>{o.sub}</span>}
          </span>
        )}
        <Check
          className={`shrink-0 mt-0.5 w-4 h-4 ${selected ? 'text-tme-blue' : 'invisible'}`}
          strokeWidth={2.5}
          aria-hidden
        />
      </div>
    );
  });

  const listbox = (
    <div
      ref={panel}
      id={listId}
      role="listbox"
      aria-label={sheetTitle}
      tabIndex={-1}
      className={sheet ? 'overflow-y-auto overscroll-contain px-2 pb-2' : 'overflow-y-auto overscroll-contain p-1'}
      style={sheet ? { maxHeight: '62vh' } : { maxHeight: place?.maxHeight ?? PANEL_MAX_H }}
    >
      {listItems}
    </div>
  );

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        title={displayTitle || undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`min-w-0 items-center text-left leading-snug transition-colors focus:outline-none disabled:cursor-not-allowed disabled:text-gray-600 ${
          table ? 'disabled:hover:border-transparent disabled:hover:bg-transparent' : 'disabled:bg-gray-50'
        } ${btnCls} ${open ? '!border-tme-blue !bg-white' : ''}`}
      >
        <span className={textCls}>{chosen ? display : placeholder}</span>
        {reserveRight && <span className={`${table ? 'w-7' : 'w-11'} shrink-0`} aria-hidden />}
        <ChevronDown
          className={`${chevronCls} transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {sheet ? (
              <div ref={floating} className="fixed inset-0 z-[60]" key="sheet">
                <motion.div
                  className="absolute inset-0 bg-gray-900/30"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => close()}
                  aria-hidden
                />
                <motion.div
                  className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(16,24,40,0.12)] pb-[max(env(safe-area-inset-bottom),8px)]"
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ type: 'spring', damping: 34, stiffness: 420 }}
                >
                  <div className="flex justify-center pt-2 pb-1" aria-hidden>
                    <span className="h-1 w-9 rounded-full bg-gray-200" />
                  </div>
                  <div className="px-5 pt-1 pb-2">
                    <p className="text-[17px] font-semibold text-tme-blue">{sheetTitle}</p>
                    {sheetSubtitle && <p className="text-sm text-gray-600 mt-0.5">{sheetSubtitle}</p>}
                  </div>
                  {listbox}
                </motion.div>
              </div>
            ) : place ? (
              <motion.div
                key="panel"
                ref={floating}
                className="fixed z-[60] rounded-[10px] border border-gray-200 bg-white shadow-[0_10px_30px_-8px_rgba(16,24,40,0.18),0_2px_6px_rgba(16,24,40,0.06)]"
                style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom }}
                initial={{ opacity: 0, y: place.top !== undefined ? -4 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
              >
                {listbox}
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
