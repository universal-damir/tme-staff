'use client';

import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Text fields never cut text (Damir 22.10.2026).
 *
 * A single-line text field that grows DOWN as the text wraps, so the whole value is always
 * visible (a plain <input> scrolls sideways and hides the start of a long value).
 * It is a <textarea rows={1}> that behaves like an input:
 * - Enter adds no new line; inside a form it submits like an input would (default submit
 *   button, or implicit submission when it is the only text field), otherwise nothing.
 * - Pasted / dropped new lines become spaces.
 * - Height: CSS `field-sizing: content` where supported (Chrome/Edge), else a JS fallback
 *   that re-measures on mount, every render, typing, width changes (ResizeObserver) and
 *   programmatic `el.value = ...` (react-hook-form reset/setValue).
 * The LOOK comes from `className` (the caller's field chrome; use min-h, not h, for the
 * start height). See `textFieldClasses` in Input.tsx for the standard TME look.
 */

export type AutoGrowKind = 'text' | 'email' | 'search' | 'url';

export interface AutoGrowTextProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  /** What the old <input type> was: sets the phone keyboard and autocorrect like the input did. */
  kind?: AutoGrowKind;
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

let fieldSizingSupport: boolean | null = null;
function hasFieldSizing(): boolean {
  if (fieldSizingSupport === null) {
    fieldSizingSupport =
      typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');
  }
  return fieldSizingSupport;
}

function fit(el: HTMLTextAreaElement | null) {
  if (!el || hasFieldSizing()) return;
  el.style.height = 'auto';
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + Math.max(border, 0)}px`;
}

const PATCHED = Symbol('autogrow-value-patched');

/** Re-measure when code sets `el.value` directly (RHF reset/setValue). Wraps React's own tracker. */
function patchValueSetter(el: HTMLTextAreaElement) {
  const host = el as HTMLTextAreaElement & { [PATCHED]?: boolean };
  if (host[PATCHED]) return;
  const desc =
    Object.getOwnPropertyDescriptor(el, 'value') ??
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (!desc?.get || !desc.set) return;
  const { get, set } = desc;
  Object.defineProperty(el, 'value', {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      return get.call(this);
    },
    set(v: string) {
      set.call(this, v);
      fit(this as HTMLTextAreaElement);
    },
  });
  host[PATCHED] = true;
}

const TEXT_LIKE_INPUT_TYPES = new Set(['text', 'email', 'search', 'url', '']);

function implicitSubmit(el: HTMLTextAreaElement) {
  const form = el.form;
  if (!form) return;
  const elements = Array.from(form.elements);
  const submitter = elements.find(
    (x) =>
      (x instanceof HTMLButtonElement && x.type === 'submit') ||
      (x instanceof HTMLInputElement && (x.type === 'submit' || x.type === 'image'))
  ) as HTMLButtonElement | HTMLInputElement | undefined;
  if (submitter) {
    if (!submitter.disabled) form.requestSubmit(submitter);
    return;
  }
  // No submit button: browsers submit only when this is the form's one text field.
  const textFields = elements.filter(
    (x) =>
      (x instanceof HTMLInputElement && TEXT_LIKE_INPUT_TYPES.has(x.type)) ||
      (x instanceof HTMLTextAreaElement && x.dataset.autogrow !== undefined)
  );
  if (textFields.length === 1) form.requestSubmit();
}

export const AutoGrowText = forwardRef<HTMLTextAreaElement, AutoGrowTextProps>(
  ({ kind = 'text', className = '', onChange, onKeyDown, style, ...props }, forwardedRef) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    const setRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        innerRef.current = el;
        if (el && !hasFieldSizing()) patchValueSetter(el);
        if (typeof forwardedRef === 'function') forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      },
      [forwardedRef]
    );

    // Controlled value / prop changes: re-measure after every render (fallback only).
    useIsoLayoutEffect(() => {
      fit(innerRef.current);
    });

    // Width changes (rotation, sidebar, a hidden step shown) re-wrap the text.
    useEffect(() => {
      const el = innerRef.current;
      if (!el || hasFieldSizing() || typeof ResizeObserver === 'undefined') return;
      let lastWidth = el.clientWidth;
      const ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        if (w !== lastWidth) {
          lastWidth = w;
          fit(el);
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      if (/[\r\n]/.test(el.value)) {
        const caret = el.selectionStart;
        el.value = el.value.replace(/\r\n|[\r\n]/g, ' ');
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* not focused */
        }
      }
      fit(el);
      onChange?.(e);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        implicitSubmit(e.currentTarget);
      }
    };

    const keyboard: React.TextareaHTMLAttributes<HTMLTextAreaElement> =
      kind === 'email' || kind === 'url'
        ? { inputMode: kind, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }
        : kind === 'search'
          ? { inputMode: 'search', enterKeyHint: 'search' }
          : {};

    return (
      <textarea
        {...keyboard}
        {...props}
        ref={setRef}
        rows={1}
        data-autogrow={kind}
        aria-multiline={props['aria-multiline'] ?? false}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={style}
        className={`block resize-none overflow-hidden field-sizing-content break-words ${className}`}
      />
    );
  }
);

AutoGrowText.displayName = 'AutoGrowText';
