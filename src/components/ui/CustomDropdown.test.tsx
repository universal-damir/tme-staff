import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CustomDropdown from './CustomDropdown';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
];

function Harness({ searchable = false, onPick }: { searchable?: boolean; onPick?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <>
      <span id="lbl">Letter</span>
      <CustomDropdown
        value={value}
        onChange={(v) => {
          setValue(v);
          onPick?.(v);
        }}
        options={OPTIONS}
        placeholder="Pick one"
        searchable={searchable}
        ariaLabelledBy="lbl"
        searchPlaceholder="Suchen..."
        noOptionsText="Nichts gefunden"
      />
    </>
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('CustomDropdown keyboard', () => {
  it('non-searchable: arrows move the active option, Enter picks it, the list is a listbox', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const trigger = screen.getByRole('button', { name: 'Letter' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[0].id);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[2].id);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    expect(onPick).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.textContent).toContain('Bravo');
    // Reopening starts on the chosen option, marked selected.
    fireEvent.keyDown(trigger, { key: ' ' });
    const reopened = screen.getAllByRole('option');
    expect(reopened[1].getAttribute('aria-selected')).toBe('true');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(reopened[1].id);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('searchable: typing filters, Enter picks the first match; texts can be passed in', async () => {
    const onPick = vi.fn();
    render(<Harness searchable onPick={onPick} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Letter' }), { key: 'Enter' });
    const box = screen.getByPlaceholderText('Suchen...');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('Nichts gefunden')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'char' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(onPick).toHaveBeenCalledWith('c');
  });

  it('a blank error marks the field without an empty message line', () => {
    const { container } = render(<CustomDropdown value="" onChange={() => {}} options={OPTIONS} error=" " />);
    expect(container.querySelector('p')).toBeNull();
    const { container: c2 } = render(<CustomDropdown value="" onChange={() => {}} options={OPTIONS} error="Required" />);
    expect(c2.querySelector('p')?.textContent).toBe('Required');
  });
});
