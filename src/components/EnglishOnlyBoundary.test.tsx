/**
 * The English-letters boundary, as the browser actually drives it.
 *
 * The rule itself is covered in english-only.test.ts. What is tested here is
 * the part that can silently stop working: the fold reaching a React-controlled
 * field. Assigning `.value` on a controlled input does NOT reach React — it
 * holds the last value it wrote and treats an event carrying that value as a
 * no-op — so the boundary goes through the prototype's own setter. If that
 * detail is ever "simplified" away, the field snaps back to the unfolded text
 * and nothing else in the suite notices.
 */

import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnglishOnlyBoundary } from '@/components/EnglishOnlyBoundary';

/** A controlled field, exactly as the client and staff forms render one. */
function ControlledField({
  label,
  initial = '',
  ...rest
}: { label: string; initial?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [value, setValue] = useState(initial);
  return (
    <label>
      {label}
      <input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} {...rest} />
    </label>
  );
}

/** What the browser sends when text is pasted or autofilled into a field. */
function pasteInto(field: HTMLElement, text: string) {
  fireEvent.input(field, { target: { value: text } });
}

describe('EnglishOnlyBoundary', () => {
  it('folds a pasted Turkish address and the React state follows', () => {
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="Home Address" />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('Home Address') as HTMLInputElement;

    pasteInto(field, 'Bestekar Sadi Hoşses cd. Atakent-Karşıyaka Izmir');

    expect(field.value).toBe('Bestekar Sadi Hosses cd. Atakent-Karsiyaka Izmir');
  });

  it('leaves nothing behind when the text is in another script', () => {
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="First Name" />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('First Name') as HTMLInputElement;

    pasteInto(field, 'محمد');

    expect(field.value).toBe('');
  });

  it('does not touch text that is already English', () => {
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="Last Name" />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('Last Name') as HTMLInputElement;

    pasteInto(field, "O'Brien-Smith");

    expect(field.value).toBe("O'Brien-Smith");
  });

  it('folds a textarea too', () => {
    function ControlledArea() {
      const [value, setValue] = useState('');
      return (
        <textarea aria-label="Notes" value={value} onChange={(e) => setValue(e.target.value)} />
      );
    }
    render(
      <EnglishOnlyBoundary>
        <ControlledArea />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('Notes') as HTMLTextAreaElement;

    pasteInto(field, 'Gökçe\nWałęsa');

    expect(field.value).toBe('Gokce\nWalesa');
  });

  it('leaves a field marked data-allow-non-english alone', () => {
    const arabic = 'شركة تي إم إي';
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="Company Name (Arabic)" data-allow-non-english="true" />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('Company Name (Arabic)') as HTMLInputElement;

    pasteInto(field, arabic);

    expect(field.value).toBe(arabic);
  });

  it('leaves a search box alone — a query is not stored data', () => {
    const arabic = 'شركة';
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="Search" type="search" />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('Search') as HTMLInputElement;

    pasteInto(field, arabic);

    expect(field.value).toBe(arabic);
  });

  it('leaves a password alone — folding one would change what was typed', () => {
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="Password" type="password" />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('Password') as HTMLInputElement;

    pasteInto(field, 'Müllerß1');

    expect(field.value).toBe('Müllerß1');
  });

  it('leaves a read-only field alone', () => {
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="Synced Name" initial="Gökçe" readOnly />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('Synced Name') as HTMLInputElement;

    pasteInto(field, 'Gökçe');

    expect(field.value).toBe('Gökçe');
  });

  it('folds a field rendered outside its own subtree — modals use a portal', () => {
    // The staff and client modals render into document.body, so they are NOT
    // descendants of anything the boundary wraps. The boundary listens on the
    // document for exactly this reason.
    render(
      <>
        <EnglishOnlyBoundary />
        <ControlledField label="Modal Field" />
      </>
    );
    const field = screen.getByLabelText('Modal Field') as HTMLInputElement;

    pasteInto(field, 'Şengül');

    expect(field.value).toBe('Sengul');
  });

  it('says what it did instead of letting a key look broken', () => {
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="First Name" />
      </EnglishOnlyBoundary>
    );
    const field = screen.getByLabelText('First Name') as HTMLInputElement;

    pasteInto(field, '\u015Eeng\u00FCl');

    const note = document.querySelector('[data-english-only-note]') as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.textContent).toBe('Changed to English letters');
    expect(note.style.opacity).toBe('1');
    // Announced, not just drawn — the field it belongs to may have focus.
    expect(note.getAttribute('role')).toBe('status');
  });

  it('says nothing when the text was already English', () => {
    render(
      <EnglishOnlyBoundary>
        <ControlledField label="Last Name" />
      </EnglishOnlyBoundary>
    );
    pasteInto(screen.getByLabelText('Last Name'), 'Ozkilic');

    const note = document.querySelector('[data-english-only-note]') as HTMLElement | null;
    expect(note === null || note.style.opacity === '0').toBe(true);
  });

  it('takes its note away with it when unmounted', () => {
    const { unmount } = render(
      <EnglishOnlyBoundary>
        <ControlledField label="City" />
      </EnglishOnlyBoundary>
    );
    pasteInto(screen.getByLabelText('City'), '\u0130zmir');
    expect(document.querySelector('[data-english-only-note]')).not.toBeNull();

    unmount();

    expect(document.querySelector('[data-english-only-note]')).toBeNull();
  });

  it('stops folding once it is unmounted', () => {
    const { unmount } = render(<EnglishOnlyBoundary />);
    render(<ControlledField label="After Unmount" />);
    unmount();

    const field = screen.getByLabelText('After Unmount') as HTMLInputElement;
    pasteInto(field, 'Gökçe');

    expect(field.value).toBe('Gökçe');
  });
});
