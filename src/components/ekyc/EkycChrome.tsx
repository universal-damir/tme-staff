'use client';

/**
 * Page chrome of the eKYC client form: the sticky header (who, save state,
 * Save draft), the step list (sidebar on desktop, folding list on a phone)
 * and the Back / Continue bar. Follows Good Services: clear progress, always
 * a way back, always saved, every step reachable.
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Loader2, Save } from 'lucide-react';
import { Button, GrainGradient } from '@/components/ui';
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
      <span className="inline-flex items-center gap-1.5 text-sm text-gray-600 sm:text-[13px]" role="status">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> <Bi text={EKYC_UI.saving} variant="inline" />
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 sm:text-[13px]" role="status">
        <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> <Bi text={EKYC_UI.saved} variant="inline" />
      </span>
    );
  }
  if (state === 'error' || state === 'too_large') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-tme-red sm:text-[13px]" role="status">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <Bi text={state === 'too_large' ? EKYC_UI.tooLarge : EKYC_UI.notSaved} variant="inline" />
        </span>
        {state === 'error' && onRetry && (
          <button type="button" onClick={onRetry} className="tme-btn-focus inline-flex min-h-11 shrink-0 items-center rounded-lg px-1 font-semibold underline underline-offset-2 sm:min-h-8">
            <Bi text={EKYC_UI.retry} variant="inline" />
          </button>
        )}
      </span>
    );
  }
  return null;
}

/**
 * Sticky header (the ONE sticky element on top): the TME Services cloud band
 * with the wordmark, the area name, company / person, save state and an
 * always-visible Save draft. On a phone the step bar sits inside it.
 */
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
    <GrainGradient
      as="header"
      color="#3B82F6"
      seed="tme-staff-ekyc-header"
      grainOpacity={0.5}
      className="top-0 z-40 border-b border-gray-200"
      // Inline, so it wins over the band's own `relative`.
      style={{ position: 'sticky' }}
    >
      <div className="mx-auto flex max-w-[1216px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        <div className="shrink-0">
          <div className="text-lg font-extrabold leading-none tracking-[-0.01em] text-tme-blue">TME Services</div>
          <div className="mt-1.5 h-[3px] w-7 rounded-sm bg-tme-beige" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 border-l border-gray-300 pl-3 sm:pl-4">
          <div className="truncate text-[15px] font-semibold leading-snug text-tme-blue sm:text-sm sm:font-medium">{EKYC_UI.area.en}</div>
          {displayName && <div className="truncate text-sm leading-snug text-gray-600 sm:text-[15px]">{displayName}</div>}
        </div>
        {showSave && (
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden sm:block">
              <SaveStatus state={saveState} onRetry={onRetry} />
            </div>
            {saveState === 'saved' && (
              // Phone: a short green "Saved" beside the Save button (no room for the full state line).
              <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700 sm:hidden" role="status">
                <Check className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden="true" />
                <Bi text={EKYC_UI.saved} variant="inline" />
              </span>
            )}
            {/* On a phone the button shows the icon only; the label stays for screen readers. */}
            <Button
              tone="secondary"
              onClick={onSave}
              disabled={saveDisabled}
              className="min-w-11 max-sm:px-2.5"
              title={biInline(EKYC_UI.saveDraft, bilingual)}
            >
              {saveState === 'saving' ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="sr-only sm:not-sr-only">
                <Bi text={EKYC_UI.saveDraft} variant="inline" />
              </span>
            </Button>
          </div>
        )}
      </div>
      {showSave && (saveState === 'error' || saveState === 'too_large') && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-1.5 sm:hidden">
          <SaveStatus state={saveState} onRetry={onRetry} />
        </div>
      )}
      {children}
    </GrainGradient>
  );
}

function StatusIcon({ status, number, current }: { status: StepStatus; number: number; current: boolean }) {
  if (status === 'done') {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full sm:h-6 sm:w-6 bg-green-600">
        <Check className="h-4 w-4 text-white" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full sm:h-6 sm:w-6 bg-tme-red">
        <AlertCircle className="h-4 w-4 text-white" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold sm:h-6 sm:w-6 sm:text-xs sm:font-semibold ${
        current ? 'border-tme-blue text-tme-blue' : 'border-gray-300 text-gray-600'
      }`}
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
                className={`tme-btn-focus flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors sm:min-h-9 sm:gap-2.5 sm:rounded-lg sm:py-1.5 ${
                  isCurrent ? 'bg-tme-blue/[0.08]' : 'hover:bg-gray-100'
                }`}
              >
                <StatusIcon status={entry.status} number={index + 1} current={isCurrent} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[15px] sm:text-sm ${isCurrent ? 'font-semibold text-tme-blue' : 'font-normal text-gray-800'}`}>
                    <Bi text={entry.title} />
                  </span>
                  {entry.status === 'error' ? (
                    <span className="block text-sm font-medium text-tme-red sm:text-[13px]">{biInline(STATUS_TEXT.error, bilingual)}</span>
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
    <div className="border-t border-gray-200/70 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="ekyc-mobile-steps"
        className="tme-btn-focus flex min-h-11 w-full items-center gap-2 px-4 pb-1.5 pt-2 text-left sm:min-h-10 sm:px-6"
      >
        <span className="min-w-0 flex-1 text-[15px] leading-snug sm:text-sm">
          <span className="font-semibold text-tme-blue">{stepText.en}</span>
          {title && <span className="font-semibold text-tme-blue">: {title.en}</span>}
          {bilingual && (
            <span lang="de" className="block text-sm leading-snug text-gray-600 sm:text-[13px]">
              {stepText.de}
              {title?.de ? `: ${title.de}` : ''}
            </span>
          )}
        </span>
        <span className="sr-only">{biInline(open ? EKYC_UI.hideSteps : EKYC_UI.showSteps, bilingual)}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-tme-blue transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div className="flex gap-1 px-4 pb-3 sm:px-6" aria-hidden="true">
        {entries.map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-[3px] ${i <= current ? 'bg-tme-blue' : 'bg-tme-line'}`} />
        ))}
      </div>
      {open && (
        <div id="ekyc-mobile-steps" className="max-h-[70dvh] overflow-y-auto border-t border-gray-200 bg-white px-2 py-2 shadow-lg">
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
      className={`${typing ? 'max-lg:hidden ' : ''}fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 pt-3 backdrop-blur-sm lg:static lg:z-auto lg:mt-8 lg:border-t lg:border-gray-200 lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-6 lg:backdrop-blur-none`}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-[1216px] items-center justify-between gap-3">
        {onBack ? (
          <Button tone="plain" onClick={onBack} className="shrink-0 max-sm:px-3.5">
            <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <Bi text={EKYC_UI.back} variant="inline" />
          </Button>
        ) : (
          <span />
        )}
        {/* Phone: the main button takes the rest of the row, so it is easy to hit with a thumb. */}
        <Button ref={nextRef} tone="primary" onClick={onNext} disabled={nextDisabled} busy={nextBusy} className="max-sm:flex-1">
          <Bi text={nextLabel} variant="inline" className="items-center" />
          {!nextBusy && <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
