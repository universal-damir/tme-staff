'use client';

/**
 * Keeps text fields in English letters for as long as it is mounted.
 *
 * Mounted in the root layout: every field in this app — onboarding, renewal,
 * dependants, company setup — is copied onto an ICP, MoHRE or DET form, and
 * those take A-Z and nothing else. The rule is the app's rule, not each
 * field's, so nobody has to remember it when adding the next field.
 *
 * It listens on the document rather than on a wrapper element, so a dropdown
 * or phone-code panel rendered through a portal is covered too.
 *
 * It catches three ways text arrives:
 *   - typing and pasting, on `beforeinput` — the character never lands,
 *   - a script keyboard (Arabic, Chinese, Japanese), on `compositionend` —
 *     a composition cannot be cancelled mid-word, so it is folded on commit,
 *   - autofill, drag-and-drop and anything else, on `input` — the last net.
 *
 * Left alone: a password (folding one would silently change what the person
 * thinks they typed), a search box (a query is not stored data), and any field
 * under `data-allow-non-english="true"`.
 *
 * Whenever it changes something it SAYS SO. A letter that quietly refuses to
 * appear reads as a broken keyboard, and a name that quietly changes shape
 * reads as a typo somebody else made: a small note by the field for a second
 * and a half, so the person sees the rule instead of guessing at it.
 *
 * MIRRORED FILE: `tme-portal/src/components/shared/EnglishOnlyBoundary.tsx`.
 */

import { useEffect } from 'react';
import { toEnglishLetters } from '@/lib/english-only';

/** Input types that hold prose. A date, colour or file picker holds none. */
const TEXTUAL_INPUT_TYPES = new Set(['text', 'tel', 'url', 'email', '']);

type TextField = HTMLInputElement | HTMLTextAreaElement;

function isGuardedField(node: EventTarget | null): node is TextField {
  if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement)) return false;
  if (node.readOnly || node.disabled) return false;
  if (node.closest('[data-allow-non-english="true"]')) return false;
  if (node instanceof HTMLInputElement) {
    return TEXTUAL_INPUT_TYPES.has(node.type);
  }
  return true;
}

/**
 * Write a value into a React-controlled field.
 *
 * Assigning `.value` on a controlled input does not reach React: React holds
 * the last value it wrote and treats an event carrying that same value as a
 * no-op. Going through the prototype's own setter clears that tracker, so the
 * `input` event dispatched after it is seen and component state follows the
 * field instead of snapping back.
 */
function setFieldValue(field: TextField, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(field, value);
  } else {
    field.value = value;
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Fold a field's whole value, keeping the caret where the person is typing.
 * Returns true when it actually changed something, so the caller can say so.
 */
function foldField(field: TextField): boolean {
  const folded = toEnglishLetters(field.value);
  if (folded === field.value) return false;
  const caret = field.selectionStart ?? folded.length;
  // The fold only ever shortens the text, so stepping the caret back by what
  // was dropped leaves it under the same character.
  const removed = field.value.length - folded.length;
  setFieldValue(field, folded);
  const next = Math.max(0, Math.min(folded.length, caret - removed));
  field.setSelectionRange(next, next);
  return true;
}

/** The note shown by a field the moment its text is changed. */
const NOTE_CHANGED = 'Changed to English letters';
/** ...and when nothing was left to keep: the whole insert was another script. */
const NOTE_BLOCKED = 'English letters only';

/** How long the note stays up. Long enough to read, short enough to ignore. */
const NOTE_MS = 1500;

/**
 * One note element, reused. It sits on `document.body` above everything —
 * the modals it has to appear over run to z-index 100.
 */
function createNote(): HTMLDivElement {
  const note = document.createElement('div');
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  note.dataset.englishOnlyNote = 'true';
  Object.assign(note.style, {
    position: 'fixed',
    zIndex: '2147483000',
    padding: '5px 10px',
    borderRadius: '8px',
    backgroundColor: '#243F7B',
    color: '#ffffff',
    fontFamily: 'Inter, sans-serif',
    fontSize: '12px',
    fontWeight: '500',
    lineHeight: '1.3',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 120ms ease-out',
    boxShadow: '0 4px 12px rgba(36, 63, 123, 0.25)',
  } satisfies Partial<CSSStyleDeclaration>);
  return note;
}

export function EnglishOnlyBoundary({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    // True while a script keyboard is mid-word. `beforeinput` fires for every
    // intermediate state of a composition and preventDefault does not stop it,
    // so the fold waits for `compositionend`.
    let composing = false;

    // Built on first use: most sessions never type a letter that needs folding,
    // and an unused element on every page is rent for nothing.
    let note: HTMLDivElement | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const showNote = (field: TextField, message: string) => {
      if (!note) {
        note = createNote();
        document.body.appendChild(note);
      }
      note.textContent = message;

      // Above the field, or under it when the field sits at the top of the
      // screen. Measured after the text is set so the width is the real one.
      const box = field.getBoundingClientRect();
      note.style.opacity = '1';
      const height = note.offsetHeight;
      const above = box.top - height - 6;
      note.style.top = `${above >= 4 ? above : box.bottom + 6}px`;
      note.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - note.offsetWidth - 4))}px`;

      // Typing a whole word in another script folds letter by letter. Each one
      // pushes the note out again rather than stacking up a queue of them.
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (note) note.style.opacity = '0';
      }, NOTE_MS);
    };

    const onBeforeInput = (event: Event) => {
      if (composing) return;
      const field = event.target;
      if (!isGuardedField(field)) return;
      const incoming = (event as InputEvent).data;
      if (!incoming) return;

      const folded = toEnglishLetters(incoming);
      if (folded === incoming) return;

      // Replace the insertion with its folded form in place, so the caret
      // behaves like an ordinary edit rather than jumping to the end.
      event.preventDefault();
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      setFieldValue(field, field.value.slice(0, start) + folded + field.value.slice(end));
      const caret = start + folded.length;
      field.setSelectionRange(caret, caret);
      // Nothing survived the fold, so from where the person sits the key simply
      // did nothing — that is the case that most needs explaining.
      showNote(field, folded ? NOTE_CHANGED : NOTE_BLOCKED);
    };

    const onInput = (event: Event) => {
      if (composing) return;
      const field = event.target;
      if (!isGuardedField(field)) return;
      if (foldField(field)) showNote(field, NOTE_CHANGED);
    };

    const onCompositionStart = () => {
      composing = true;
    };

    const onCompositionEnd = (event: Event) => {
      composing = false;
      const field = event.target;
      if (!isGuardedField(field)) return;
      // A script keyboard commits a whole word at once, and none of it can be
      // kept — say English letters only rather than claiming a change.
      if (foldField(field)) showNote(field, field.value ? NOTE_CHANGED : NOTE_BLOCKED);
    };

    // The note is anchored to a fixed screen position, so it has to go the
    // moment the field moves out from under it.
    const hideNote = () => {
      clearTimeout(hideTimer);
      if (note) note.style.opacity = '0';
    };

    // Capture phase, so the value is folded before any React handler reads it.
    document.addEventListener('beforeinput', onBeforeInput, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('compositionstart', onCompositionStart, true);
    document.addEventListener('compositionend', onCompositionEnd, true);
    document.addEventListener('focusout', hideNote, true);
    document.addEventListener('scroll', hideNote, true);
    window.addEventListener('resize', hideNote);
    return () => {
      document.removeEventListener('beforeinput', onBeforeInput, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('compositionstart', onCompositionStart, true);
      document.removeEventListener('compositionend', onCompositionEnd, true);
      document.removeEventListener('focusout', hideNote, true);
      document.removeEventListener('scroll', hideNote, true);
      window.removeEventListener('resize', hideNote);
      clearTimeout(hideTimer);
      note?.remove();
    };
  }, []);

  return <>{children}</>;
}

export default EnglishOnlyBoundary;
