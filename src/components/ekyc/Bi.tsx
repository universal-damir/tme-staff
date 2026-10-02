'use client';

import React, { createContext, useContext } from 'react';
import { Info } from 'lucide-react';
import type { EkycOption, EkycText } from '@/types/ekyc';

/** True when the form shows German under the English (R5). */
export const EkycBilingualContext = createContext(false);

export function useEkycBilingual(): boolean {
  return useContext(EkycBilingualContext);
}

function germanLine(text: EkycText | EkycOption): string | null {
  const de = (text.de || '').trim();
  return de && de !== text.en.trim() ? de : null;
}

/** True when the German line differs from the English (else only the English shows). */
export function hasGermanLine(text: EkycText | EkycOption): boolean {
  return germanLine(text) !== null;
}

/**
 * English, and in a bilingual form the German under it, smaller and muted
 * (never below 12px, so it stays readable under a small hint).
 * Paragraph breaks (blank lines) in the text become separate paragraphs.
 */
export function Bi({
  text,
  className = '',
  deClassName = '',
  paragraphs = false,
  variant = 'block',
}: {
  text: EkycText | EkycOption | undefined;
  className?: string;
  deClassName?: string;
  paragraphs?: boolean;
  /**
   * 'inline': for buttons, chips and the save state. Two short lines stacked
   * inside the control, the German smaller and muted by opacity (so it works
   * on a dark button too), no block layout that breaks a flex row.
   */
  variant?: 'block' | 'inline';
}) {
  const bilingual = useEkycBilingual();
  if (!text) return null;
  const de = bilingual ? germanLine(text) : null;
  if (variant === 'inline') {
    if (!de) return <span className={className}>{text.en}</span>;
    return (
      <span className={`inline-flex flex-col leading-tight ${className}`}>
        <span>{text.en}</span>
        <span lang="de" className={`text-[0.8em] font-normal opacity-75 ${deClassName}`}>
          {de}
        </span>
      </span>
    );
  }
  if (paragraphs) {
    const enParts = text.en.split(/\n\s*\n/);
    const deParts = de ? de.split(/\n\s*\n/) : [];
    return (
      <div className={className}>
        {enParts.map((p, i) => (
          <p key={`en-${i}`} className="mb-2 last:mb-0 whitespace-pre-line">
            {p}
          </p>
        ))}
        {deParts.length > 0 && (
          <div lang="de" className={`mt-1 text-[length:max(0.9em,12px)] leading-snug text-gray-500 ${deClassName}`}>
            {deParts.map((p, i) => (
              <p key={`de-${i}`} className="mb-2 last:mb-0 whitespace-pre-line">
                {p}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <span className={className}>
      <span className="block">{text.en}</span>
      {de && (
        <span lang="de" className={`block text-[length:max(0.85em,12px)] font-normal leading-snug text-gray-500 ${deClassName}`}>
          {de}
        </span>
      )}
    </span>
  );
}

/**
 * The text levels of the form, in ONE place so they cannot drift apart:
 *   1. question / title (English): navy, semibold
 *   2. German question / title: smaller, regular, slate-500, right under
 *   3. help (English): 13px slate-600, set apart by an info icon
 *   4. German help: 12px italic slate-400, right under the English help
 * The English-only form uses the same sizes, without lines 2 and 4.
 */
export const EKYC_TYPE = {
  labelEn: 'block text-[15px] font-semibold leading-snug text-[#243F7B]',
  labelDe: 'mt-0.5 block text-[13px] font-normal leading-snug text-slate-500',
  /** Smaller label: Check your answers rows, row headings inside a group. */
  labelSmEn: 'block text-sm font-semibold leading-snug text-[#243F7B]',
  labelSmDe: 'mt-0.5 block text-xs font-normal leading-snug text-slate-500',
  helpEn: 'block text-[13px] leading-relaxed text-slate-600',
  helpDe: 'mt-0.5 block text-xs italic leading-relaxed text-slate-400',
  /** Step / page title: the size comes from the heading (h1 / h3), the German line is fixed. */
  titleDe: 'mt-1 block text-[15px] font-normal leading-snug text-slate-500',
  titleSmDe: 'mt-0.5 block text-[13px] font-normal leading-snug text-slate-500',
  introEn: 'block text-sm leading-relaxed text-slate-600',
  introDe: 'mt-0.5 block text-[13px] italic leading-relaxed text-slate-400',
  /** A notice box: the colour comes from the box (warn / info), the German line is lighter. */
  noticeEn: 'block font-medium',
  noticeDe: 'mt-0.5 block text-[13px] font-normal italic opacity-80',
} as const;

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/);
}

/**
 * English line, and in a bilingual form the German line under it, each with
 * its own level class. Spans only, so it fits inside a label or a heading.
 * `paragraphs`: blank lines in the text become separate paragraphs.
 */
export function BiPair({
  text,
  enClassName,
  deClassName,
  paragraphs = false,
  className = '',
}: {
  text: EkycText | EkycOption | undefined;
  enClassName: string;
  deClassName: string;
  paragraphs?: boolean;
  className?: string;
}) {
  const bilingual = useEkycBilingual();
  if (!text) return null;
  const de = bilingual ? germanLine(text) : null;
  const lines = (value: string, cls: string, lang?: string) =>
    paragraphs ? (
      <span lang={lang} className={`${cls} space-y-1.5`}>
        {splitParagraphs(value).map((p, i) => (
          <span key={i} className="block whitespace-pre-line">
            {p}
          </span>
        ))}
      </span>
    ) : (
      <span lang={lang} className={cls}>
        {value}
      </span>
    );
  return (
    <span className={`block ${className}`}>
      {lines(text.en, enClassName)}
      {de && lines(de, deClassName, 'de')}
    </span>
  );
}

/** Level 1 + 2: a question (field label, upload slot, Check your answers row). */
export function BiLabel({
  text,
  size = 'md',
  className = '',
}: {
  text: EkycText | EkycOption | undefined;
  size?: 'md' | 'sm';
  className?: string;
}) {
  return (
    <BiPair
      text={text}
      enClassName={size === 'sm' ? EKYC_TYPE.labelSmEn : EKYC_TYPE.labelEn}
      deClassName={size === 'sm' ? EKYC_TYPE.labelSmDe : EKYC_TYPE.labelDe}
      className={className}
    />
  );
}

/**
 * Level 3 + 4: help under a question. A small info icon sets it apart from
 * the label; English and German share the indent.
 */
export function BiHelp({
  text,
  id,
  icon = true,
  paragraphs = false,
  className = '',
}: {
  text: EkycText | undefined;
  id?: string;
  icon?: boolean;
  paragraphs?: boolean;
  className?: string;
}) {
  if (!text) return null;
  return (
    <div id={id} data-ekyc-help="" className={`flex gap-1.5 ${className}`}>
      {icon && <Info aria-hidden="true" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-slate-400" />}
      <BiPair
        text={text}
        enClassName={EKYC_TYPE.helpEn}
        deClassName={EKYC_TYPE.helpDe}
        paragraphs={paragraphs}
        className="min-w-0"
      />
    </div>
  );
}

/** A title: the English takes the heading's own size and colour, the German sits under it. */
export function BiTitle({ text, size = 'page' }: { text: EkycText | undefined; size?: 'page' | 'section' }) {
  return (
    <BiPair text={text} enClassName="block" deClassName={size === 'page' ? EKYC_TYPE.titleDe : EKYC_TYPE.titleSmDe} />
  );
}

/** The short text under a title (step intro, Check your answers intro). */
export function BiIntro({
  text,
  paragraphs = false,
  className = '',
}: {
  text: EkycText | undefined;
  paragraphs?: boolean;
  className?: string;
}) {
  return (
    <BiPair
      text={text}
      enClassName={EKYC_TYPE.introEn}
      deClassName={EKYC_TYPE.introDe}
      paragraphs={paragraphs}
      className={className}
    />
  );
}

/** The text of a notice box (pre-fill notice). */
export function BiNotice({ text, className = '' }: { text: EkycText | undefined; className?: string }) {
  return <BiPair text={text} enClassName={EKYC_TYPE.noticeEn} deClassName={EKYC_TYPE.noticeDe} className={className} />;
}

/** One-line label for places that take a plain string (dropdown option rows, placeholders). */
export function biInline(text: EkycText | EkycOption, bilingual: boolean): string {
  const de = bilingual ? germanLine(text) : null;
  return de ? `${text.en} / ${de}` : text.en;
}
