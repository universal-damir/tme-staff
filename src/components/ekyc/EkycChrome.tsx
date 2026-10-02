'use client';

/**
 * Page chrome of the eKYC client form: the sticky header (who, save state,
 * Save draft), the step list (sidebar on desktop, folding list on a phone)
 * and the Back / Continue bar. Follows Good Services: clear progress, always
 * a way back, always saved, every step reachable.
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Loader2, Save } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import type { EkycText } from '@/types/ekyc';
import { Bi, biInline, useEkycBilingual } from './Bi';
import { EKYC_UI } from './texts';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'too_large';
export type StepStatus = 'done' | 'error' | 'todo';

export interface StepEntry {
  title: EkycText;
  status: StepStatus;
}

function fill(text: EkycText, values: Record<string, string | number>): EkycText {
  const apply = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
  return { en: apply(text.en), de: apply(text.de || text.en) };
}

export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-gray-500" role="status">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> <Bi text={EKYC_UI.saving} variant="inline" />
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium" style={{ color: '#15803d' }} role="status">
        <CheckCircle className="h-4 w-4 shrink-0" /> <Bi text={EKYC_UI.saved} variant="inline" />
      </span>
    );
  }
  if (state === 'error' || state === 'too_large') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs sm:text-sm text-red-600" role="status">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          <Bi text={state === 'too_large' ? EKYC_UI.tooLarge : EKYC_UI.notSaved} variant="inline" />
        </span>
        {state === 'error' && onRetry && (
          <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline underline-offset-2">
            <Bi text={EKYC_UI.retry} variant="inline" />
          </button>
        )}
      </span>
    );
  }
  return null;
}

/** Sticky header: brand, company / person, save state and an always-visible Save draft. */
export function EkycHeader({
  displayName,
  saveState,
  onSave,
  onRetry,
  showSave,
  saveDisabled,
  children,
}: {
  displayName: string | null;
  saveState: SaveState;
  onSave: () => void;
  onRetry: () => void;
  showSave: boolean;
  saveDisabled: boolean;
  /** Second row on a phone (the step bar). */
  children?: React.ReactNode;
}) {
  const bilingual = useEkycBilingual();
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1216px] items-center gap-3 px-4 py-2.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: TME_COLORS.secondary }}>
            {EKYC_UI.brand.en}
          </div>
          {displayName && (
            <div className="truncate text-sm font-semibold sm:text-base" style={{ color: TME_COLORS.primary }}>
              {displayName}
            </div>
          )}
        </div>
        {showSave && (
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden sm:block">
              <SaveStatus state={saveState} onRetry={onRetry} />
            </div>
            {saveState === 'saved' && (
              // Phone: a short green "Saved" beside the Save button (no room for the full state line).
              <span className="inline-flex items-center gap-1 text-xs font-medium sm:hidden" style={{ color: '#15803d' }} role="status">
                <Check className="h-4 w-4 shrink-0" strokeWidth={3} />
                <Bi text={EKYC_UI.saved} variant="inline" />
              </span>
            )}
            {/* On a phone the button shows the icon only; the label stays for screen readers. */}
            <button
              type="button"
              onClick={onSave}
              disabled={saveDisabled}
              className="inline-flex h-11 min-w-[44px] items-center justify-center gap-2 rounded-lg border-2 px-2.5 text-sm font-medium transition-colors hover:bg-gray-50 disabled:opacity-60 sm:px-4"
              style={{ borderColor: TME_COLORS.primary, color: TME_COLORS.primary }}
              title={biInline(EKYC_UI.saveDraft, bilingual)}
            >
              {saveState === 'saving' ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Save className="h-4 w-4 shrink-0" />
              )}
              <span className="sr-only sm:not-sr-only">
                <Bi text={EKYC_UI.saveDraft} variant="inline" />
              </span>
            </button>
          </div>
        )}
      </div>
      {showSave && (saveState === 'error' || saveState === 'too_large') && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-1.5 sm:hidden">
          <SaveStatus state={saveState} onRetry={onRetry} />
        </div>
      )}
      {children}
    </header>
  );
}

function StatusIcon({ status, number, current }: { status: StepStatus; number: number; current: boolean }) {
  if (status === 'done') {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: TME_COLORS.success }}>
        <Check className="h-4 w-4 text-white" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500">
        <AlertCircle className="h-4 w-4 text-white" />
      </span>
    );
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold"
      style={{
        borderColor: current ? TME_COLORS.primary : TME_COLORS.border,
        color: current ? TME_COLORS.primary : '#6b7280',
      }}
    >
      {number}
    </span>
  );
}

const STATUS_TEXT: Record<StepStatus, EkycText> = {
  done: EKYC_UI.stepDone,
  error: EKYC_UI.stepErrors,
  todo: EKYC_UI.stepTodo,
};

/** The list of steps; every step can be opened (a draft never traps the client). */
export function EkycStepList({
  entries,
  current,
  onSelect,
}: {
  entries: StepEntry[];
  current: number;
  onSelect: (index: number) => void;
}) {
  const bilingual = useEkycBilingual();
  return (
    <nav aria-label={biInline(EKYC_UI.steps, bilingual)}>
      <ol className="space-y-1">
        {entries.map((entry, index) => {
          const isCurrent = index === current;
          return (
            <li key={index}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isCurrent ? '' : 'hover:bg-gray-100'
                }`}
                style={isCurrent ? { backgroundColor: 'rgba(36,63,123,0.08)' } : undefined}
              >
                <StatusIcon status={entry.status} number={index + 1} current={isCurrent} />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm ${isCurrent ? 'font-semibold' : 'font-medium'}`}
                    style={{ color: isCurrent ? TME_COLORS.primary : '#1f2937' }}
                  >
                    <Bi text={entry.title} />
                  </span>
                  {entry.status === 'error' ? (
                    <span className="block text-xs text-red-600">{biInline(STATUS_TEXT.error, bilingual)}</span>
                  ) : (
                    <span className="sr-only">{biInline(isCurrent ? EKYC_UI.stepCurrent : STATUS_TEXT[entry.status], bilingual)}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Phone: "Step 3 of 8 · Shareholders" with a progress bar; the step list folds out of it. */
export function EkycMobileStepBar({
  entries,
  current,
  onSelect,
}: {
  entries: StepEntry[];
  current: number;
  onSelect: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const bilingual = useEkycBilingual();
  const total = entries.length;
  const stepText = fill(EKYC_UI.stepOf, { n: current + 1, total });
  const title = entries[current]?.title;
  return (
    <div className="border-t border-gray-100 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="ekyc-mobile-steps"
        className="flex min-h-[44px] w-full items-center gap-2 px-4 py-2 text-left"
      >
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-semibold" style={{ color: TME_COLORS.primary }}>
            {stepText.en}
          </span>
          {title && <span className="text-gray-700"> · {title.en}</span>}
          {bilingual && (
            <span lang="de" className="block text-xs leading-snug text-gray-500">
              {stepText.de}
              {title?.de ? ` · ${title.de}` : ''}
            </span>
          )}
        </span>
        <span className="sr-only">{biInline(open ? EKYC_UI.hideSteps : EKYC_UI.showSteps, bilingual)}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: TME_COLORS.primary }}
        />
      </button>
      <div className="h-1 w-full bg-gray-100" aria-hidden>
        <div
          className="h-1 transition-all duration-300"
          style={{ width: `${((current + 1) / total) * 100}%`, backgroundColor: TME_COLORS.primary }}
        />
      </div>
      {open && (
        <div id="ekyc-mobile-steps" className="max-h-[70vh] overflow-y-auto border-t border-gray-100 bg-white px-2 py-2 shadow-lg">
          <EkycStepList
            entries={entries}
            current={current}
            onSelect={(i) => {
              setOpen(false);
              onSelect(i);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Is this element a text entry that opens the phone keyboard? */
export function opensKeyboard(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color', 'image', 'hidden'].includes(type);
}

/** True while a text entry has focus (the phone keyboard is likely open). */
function useTypingFocus(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onIn = (e: FocusEvent) => setTyping(opensKeyboard(e.target));
    // Focus moving between two inputs fires focusout then focusin: check after both.
    const onOut = () => setTimeout(() => setTyping(opensKeyboard(document.activeElement)), 0);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}

/**
 * Back / Continue. In the page flow on desktop, a fixed bar at the bottom on
 * a phone. The phone bar steps aside while the client types, so it never
 * covers the field above the keyboard.
 */
export function EkycStepNav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextBusy,
  nextRef,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: EkycText;
  nextDisabled?: boolean;
  nextBusy?: boolean;
  nextRef?: React.Ref<HTMLButtonElement>;
}) {
  const typing = useTypingFocus();
  return (
    <div
      data-typing={typing ? 'true' : undefined}
      className={`${typing ? 'max-lg:hidden ' : ''}fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 pt-3 backdrop-blur-sm lg:static lg:z-auto lg:mt-8 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none`}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-[1216px] items-center justify-between gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border-2 px-4 text-sm font-medium transition-colors hover:bg-gray-50"
            style={{ color: TME_COLORS.primary, borderColor: TME_COLORS.primary, backgroundColor: '#fff' }}
          >
            <ChevronLeft className="h-4 w-4 shrink-0" />
            <Bi text={EKYC_UI.back} variant="inline" />
          </button>
        ) : (
          <span />
        )}
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: TME_COLORS.primary }}
        >
          {nextBusy && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          <Bi text={nextLabel} variant="inline" className="items-center" />
          {!nextBusy && <ChevronRight className="h-4 w-4 shrink-0" />}
        </button>
      </div>
    </div>
  );
}
