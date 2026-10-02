import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { EKYC_DEFAULT_CURRENCY, formatEkycMoney, isEkycMoney, parseEkycMoney, type EkycText } from '@/types/ekyc';
import { EkycBilingualContext, EKYC_TYPE } from './Bi';
import { EkycField } from './EkycField';
import {
  ekycCountryIso,
  ekycLinesFromValue,
  ekycMoneyFromTyped,
  ekycPasteLines,
  ekycPhoneForDisplay,
  formatAmountTyping,
  normalizeEkycAmount,
} from './EkycInputs';
import { opensKeyboard } from './EkycChrome';

afterEach(cleanup);

/** A field kept in state, so typing goes round through value / onChange like in the form. */
function Harness({
  kind,
  initial,
  bilingual = false,
  onValue,
  phoneCountry,
  hint,
  prefilled,
  tagSlot,
}: {
  kind: 'money' | 'phone' | 'text' | 'lines';
  initial: string;
  bilingual?: boolean;
  onValue?: (v: unknown) => void;
  phoneCountry?: 'AE' | 'DE';
  hint?: EkycText;
  prefilled?: boolean;
  tagSlot?: boolean;
}) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <EkycBilingualContext.Provider value={bilingual}>
      <EkycField
        field={{
          id: 'f',
          label: { en: 'Question in English', de: 'Frage auf Deutsch' },
          hint,
          kind,
          required: true,
          prefillable: false,
        }}
        path="f"
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
        phoneCountry={phoneCountry}
        prefilled={prefilled}
        tagSlot={tagSlot}
      />
    </EkycBilingualContext.Provider>
  );
}

describe('money: amount + currency', () => {
  it('digits only: every other sign is dropped, so German 50.000 and English 50,000 are the same', () => {
    expect(ekycMoneyFromTyped('AED', '50.000')).toBe('AED 50,000');
    expect(ekycMoneyFromTyped('AED', '50,000')).toBe('AED 50,000');
    expect(ekycMoneyFromTyped('EUR', '1.250.000')).toBe('EUR 1,250,000');
    expect(ekycMoneyFromTyped('USD', '100000')).toBe('USD 100,000');
    expect(ekycMoneyFromTyped('AED', 'AED 100,000')).toBe('AED 100,000');
    expect(ekycMoneyFromTyped('AED', '')).toBe('');
    expect(ekycMoneyFromTyped('AED', 'abc')).toBe('');
    expect(normalizeEkycAmount('50.')).toBe('50');
    expect(normalizeEkycAmount('1.2345')).toBe('12345'); // no decimals
    expect(normalizeEkycAmount("1'000 000")).toBe('1000000');
    expect(normalizeEkycAmount('007')).toBe('7');
    expect(normalizeEkycAmount('000')).toBe('0');
  });

  it('live thousand separators while typing; the caret stays after the same digit', () => {
    expect(formatAmountTyping('1000', 4)).toEqual({ text: '1,000', caret: 5 });
    expect(formatAmountTyping('10000', 5)).toEqual({ text: '10,000', caret: 6 });
    expect(formatAmountTyping('100000', 6)).toEqual({ text: '100,000', caret: 7 });
    expect(formatAmountTyping('1,0000', 6)).toEqual({ text: '10,000', caret: 6 });
    // "5" typed after the comma of "1,000": the caret stays after the "5" of "15,000".
    expect(formatAmountTyping('15,000', 2)).toEqual({ text: '15,000', caret: 2 });
    expect(formatAmountTyping('1,5000', 3)).toEqual({ text: '15,000', caret: 2 });
    // A comma deleted: the digits stay, the caret stays before the same digit.
    expect(formatAmountTyping('1000', 1)).toEqual({ text: '1,000', caret: 1 });
    expect(formatAmountTyping('0050', 4)).toEqual({ text: '50', caret: 2 });
    expect(formatAmountTyping('', 0)).toEqual({ text: '', caret: 0 });
  });

  it('parse and format round trip; the default currency is AED', () => {
    expect(EKYC_DEFAULT_CURRENCY).toBe('AED');
    for (const v of ['AED 50,000', 'USD 1,250.50', 'EUR 7', 'CHF 1,000,000']) {
      const p = parseEkycMoney(v);
      expect(p).not.toBeNull();
      expect(formatEkycMoney(p!.currency, p!.amount)).toBe(v);
      expect(isEkycMoney(v)).toBe(true);
    }
    expect(parseEkycMoney('100000')?.currency).toBe('AED');
  });

  it('starts on AED; commas appear while typing; a pasted German 50.000 becomes 50,000', () => {
    const onValue = vi.fn();
    render(<Harness kind="money" initial="" onValue={onValue} />);
    expect(screen.getByText('AED')).toBeTruthy();
    const amount = document.getElementById('ekyc-f') as HTMLInputElement;
    expect(amount.inputMode).toBe('numeric');
    act(() => amount.focus());
    for (const [typed, shown] of [
      ['1', '1'],
      ['10', '10'],
      ['100', '100'],
      ['1000', '1,000'],
      ['1,0000', '10,000'],
      ['10,0000', '100,000'],
    ]) {
      fireEvent.change(amount, { target: { value: typed, selectionStart: typed.length } });
      expect(amount.value).toBe(shown);
    }
    expect(onValue).toHaveBeenLastCalledWith('AED 100,000');
    expect(amount.selectionStart).toBe(amount.value.length);
    // Paste (the browser puts the text in the box, the change reads it).
    fireEvent.change(amount, { target: { value: '50.000' } });
    expect(amount.value).toBe('50,000');
    expect(onValue).toHaveBeenLastCalledWith('AED 50,000');
    // Letters and decimal marks never stay.
    fireEvent.change(amount, { target: { value: '50,000abc' } });
    expect(amount.value).toBe('50,000');
    fireEvent.change(amount, { target: { value: '1.250,50' } });
    expect(amount.value).toBe('125,050');
    fireEvent.blur(amount);
    expect(amount.value).toBe('125,050');
  });

  it('an older value loads into currency + amount', () => {
    render(<Harness kind="money" initial="AED 100,000" />);
    expect((document.getElementById('ekyc-f') as HTMLInputElement).value).toBe('100,000');
    expect(screen.getByText('AED')).toBeTruthy();
    cleanup();
    render(<Harness kind="money" initial="250000 USD" />);
    expect((document.getElementById('ekyc-f') as HTMLInputElement).value).toBe('250,000');
    expect(screen.getByText('USD')).toBeTruthy();
  });
});

describe('phone: the shared PhoneInput', () => {
  it('a phone field renders the country picker and stores E.164', () => {
    const onValue = vi.fn();
    render(<Harness kind="phone" initial="" onValue={onValue} />);
    const input = document.getElementById('ekyc-f') as HTMLInputElement;
    expect(input.type).toBe('tel');
    expect(screen.getByText('+971')).toBeTruthy();
    fireEvent.change(input, { target: { value: '50 123 4567' } });
    expect(onValue).toHaveBeenLastCalledWith('+971501234567');
    // The label still names the number input.
    expect(input.getAttribute('aria-labelledby')).toBe('ekyc-f-label');
  });

  it('an older free-form value still shows; the home number starts on the home country', () => {
    render(<Harness kind="phone" initial="+49 (151) 1234 5678" />);
    expect(screen.getByText('+49')).toBeTruthy();
    expect((document.getElementById('ekyc-f') as HTMLInputElement).value.replace(/\D/g, '')).toBe('15112345678');
    cleanup();
    render(<Harness kind="phone" initial="" phoneCountry="DE" />);
    expect(screen.getByText('+49')).toBeTruthy();
    expect(ekycPhoneForDisplay('050 123 4567', 'AE').e164).toBe('+971501234567');
    expect(ekycPhoneForDisplay('call me', 'AE').unreadable).toBe(true);
    expect(ekycCountryIso('Germany')).toBe('DE');
    expect(ekycCountryIso('Ivory Coast')).toBe('CI');
    expect(ekycCountryIso('')).toBeUndefined();
  });

  it('a number that cannot be read is shown as it was saved', () => {
    render(<Harness kind="phone" initial="call the office" />);
    expect(screen.getByText(/Saved earlier as: call the office/)).toBeTruthy();
  });

  it('the phone number input counts as typing (the bottom bar steps aside)', async () => {
    render(<Harness kind="phone" initial="" />);
    const input = document.getElementById('ekyc-f') as HTMLInputElement;
    expect(opensKeyboard(input)).toBe(true);
    act(() => input.focus());
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});

describe('label and help: four levels', () => {
  const hint = { en: 'Help in English.', de: 'Hilfe auf Deutsch.' };

  it('bilingual: question, German question, help with an icon, German help, each with its own style', () => {
    render(<Harness kind="text" initial="" bilingual hint={hint} />);
    const en = screen.getByText('Question in English');
    const de = screen.getByText('Frage auf Deutsch');
    const helpEn = screen.getByText('Help in English.');
    const helpDe = screen.getByText('Hilfe auf Deutsch.');
    expect(en.className).toBe(EKYC_TYPE.labelEn);
    expect(de.className).toBe(EKYC_TYPE.labelDe);
    expect(helpEn.className).toBe(EKYC_TYPE.helpEn);
    expect(helpDe.className).toBe(EKYC_TYPE.helpDe);
    expect(de.getAttribute('lang')).toBe('de');
    // Four different looks.
    expect(new Set([en.className, de.className, helpEn.className, helpDe.className]).size).toBe(4);
    expect(EKYC_TYPE.labelEn).toContain('text-[15px]');
    expect(EKYC_TYPE.labelDe).toContain('text-[13px]');
    expect(EKYC_TYPE.helpEn).toContain('text-[13px]');
    expect(EKYC_TYPE.helpDe).toContain('italic');
    // The help is its own element with an info icon, outside the label.
    const help = document.getElementById('ekyc-f-hint') as HTMLElement;
    expect(help.querySelector('svg')).toBeTruthy();
    expect(help.closest('label')).toBeNull();
    expect(en.closest('label')).toBeTruthy();
  });

  it('English only: the same question and help styles, no German lines', () => {
    render(<Harness kind="text" initial="" hint={hint} />);
    expect(screen.getByText('Question in English').className).toBe(EKYC_TYPE.labelEn);
    expect(screen.getByText('Help in English.').className).toBe(EKYC_TYPE.helpEn);
    expect(screen.queryByText('Frage auf Deutsch')).toBeNull();
    expect(screen.queryByText('Hilfe auf Deutsch.')).toBeNull();
  });
});

describe('lines: one box per activity', () => {
  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="ekyc-f"]'));

  it('the stored text splits into boxes; empty lines are dropped', () => {
    expect(ekycLinesFromValue('Trading\n\nConsulting')).toEqual(['Trading', 'Consulting']);
    expect(ekycLinesFromValue('')).toEqual(['']);
    render(<Harness kind="lines" initial={'General Trading\nConsultancy'} />);
    expect(boxes().map((b) => b.value)).toEqual(['General Trading', 'Consultancy']);
    expect(boxes()[0].id).toBe('ekyc-f');
  });

  it('typing joins the boxes with a line break; empty boxes are not saved', () => {
    const onValue = vi.fn();
    render(<Harness kind="lines" initial="" onValue={onValue} />);
    expect(boxes()).toHaveLength(1);
    // One box: no remove button (at least one stays).
    expect(screen.queryByRole('button', { name: /Remove activity/ })).toBeNull();
    fireEvent.change(boxes()[0], { target: { value: 'Trading' } });
    expect(onValue).toHaveBeenLastCalledWith('Trading');
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
    expect(boxes()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
    fireEvent.change(boxes()[2], { target: { value: 'Consulting' } });
    expect(onValue).toHaveBeenLastCalledWith('Trading\nConsulting');
    expect(boxes()).toHaveLength(3);
  });

  it('Enter adds a box below and moves there; x removes a box', async () => {
    const onValue = vi.fn();
    render(<Harness kind="lines" initial={'Trading\nConsulting'} onValue={onValue} />);
    act(() => boxes()[0].focus());
    fireEvent.keyDown(boxes()[0], { key: 'Enter' });
    expect(boxes().map((b) => b.value)).toEqual(['Trading', '', 'Consulting']);
    await waitFor(() => expect(document.activeElement).toBe(boxes()[1]));
    expect(onValue).not.toHaveBeenCalled(); // an empty box changes nothing stored
    fireEvent.change(boxes()[1], { target: { value: 'Retail' } });
    expect(onValue).toHaveBeenLastCalledWith('Trading\nRetail\nConsulting');
    fireEvent.click(screen.getByRole('button', { name: 'Remove activity 1' }));
    expect(boxes().map((b) => b.value)).toEqual(['Retail', 'Consulting']);
    expect(onValue).toHaveBeenLastCalledWith('Retail\nConsulting');
  });

  it('pasting several lines fills one box per line', async () => {
    expect(ekycPasteLines(['ab'], 0, 1, 1, 'X\nY\n\nZ')).toEqual({ rows: ['aX', 'Y', 'Zb'], focus: 2 });
    const onValue = vi.fn();
    render(<Harness kind="lines" initial="" onValue={onValue} />);
    act(() => boxes()[0].focus());
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => 'General Trading\r\nConsultancy\n\nIT Services\n' } });
    expect(boxes().map((b) => b.value)).toEqual(['General Trading', 'Consultancy', 'IT Services']);
    expect(onValue).toHaveBeenLastCalledWith('General Trading\nConsultancy\nIT Services');
    await waitFor(() => expect(document.activeElement).toBe(boxes()[2]));
  });
});

describe('pre-filled tag: a fixed slot under the input', () => {
  it('the tag sits under the input, not in the label', () => {
    render(<Harness kind="text" initial="12345" prefilled />);
    const tag = screen.getByText('Pre-filled');
    const slot = tag.closest('[data-ekyc-tag-slot]') as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.className).toContain('mt-1.5'); // 6px under the input
    expect(slot.className).toContain('h-[18px]'); // fixed height
    expect(tag.closest('label')).toBeNull();
    const input = document.getElementById('ekyc-f') as HTMLElement;
    // The slot comes right after the input.
    expect(input.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a field without a tag keeps the same empty slot when its row has one', () => {
    render(<Harness kind="text" initial="" tagSlot />);
    const slot = document.querySelector('[data-ekyc-tag-slot]') as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.textContent).toBe('');
    expect(slot.className).toContain('h-[18px]');
    cleanup();
    render(<Harness kind="text" initial="" />);
    expect(document.querySelector('[data-ekyc-tag-slot]')).toBeNull();
  });
});
