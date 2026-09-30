/**
 * Smoke test of the client form page: loads the prefill, shows the price and
 * the role variant, blocks submit until the price box is ticked, then posts
 * the answers and shows the thank-you view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
}));

import SupplierPolicyIntakePage from '@/app/supplier-checks/[token]/page';

const manager = { name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' };
const payload = {
  status: 'invited',
  companyName: 'Cognit FZCO',
  priceAed: 1450,
  prefill: {
    companyName: 'Cognit FZCO',
    companyCode: '10614',
    trn: '100000000000003',
    registeredAddress: 'IFZA Business Park, Dubai',
    vatPeriodsText: 'February to April',
    priceAed: 1450,
    suggested: { implementer: manager, reviewer: manager, supervisor: manager },
    officers: [manager],
  },
  submitted: null,
  expiresAt: '2026-11-29T10:00:00Z',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('Supplier policy form page', () => {
  it('prefills, keeps Confirm greyed out until both boxes are ticked, then submits', async () => {
    render(<SupplierPolicyIntakePage />);
    await screen.findByText('Supplier Verification Policy');

    expect(screen.getAllByText(/AED 1,450/).length).toBeGreaterThan(0);
    expect(screen.getByText(/One person holds all three roles/)).toBeTruthy();

    const confirm = screen.getByRole('button', { name: /Confirm my policy details/ }) as HTMLButtonElement;
    const [priceBox, dutyBox] = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(dutyBox.closest('label')?.textContent).toContain(
      'TME Services does not check our suppliers or purchases'
    );

    // Neither ticked, then only one: still disabled, with the hint.
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Tick both boxes to confirm.')).toBeTruthy();
    fireEvent.click(confirm);
    fireEvent.click(priceBox);
    expect(confirm.disabled).toBe(true);
    fireEvent.click(priceBox);
    fireEvent.click(dutyBox);
    expect(confirm.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(priceBox);
    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute('aria-disabled')).toBe('false');
    expect(screen.queryByText('Tick both boxes to confirm.')).toBeNull();
    fireEvent.click(confirm);

    await screen.findByText('Thank you, we have received your details');
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      implementer: manager,
      supervisor: manager,
      recordsLocationIsRegisteredOffice: true,
      priceAgreed: true,
      dutyAcknowledged: true,
      shownPriceAed: 1450,
    });
  });

  it('shows the TRN in groups of five and one VAT period per line', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            ...payload,
            prefill: {
              ...payload.prefill,
              trn: '100492437700003',
              vatPeriodsText: 'January to March, April to June, July to September and October to December',
            },
          }),
          { status: 200 }
        )
    );
    render(<SupplierPolicyIntakePage />);
    await screen.findByText('Supplier Verification Policy');
    expect(screen.getByText('10049 24377 00003')).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    for (const period of ['January to March', 'April to June', 'July to September', 'October to December']) {
      expect(items).toContain(period);
    }
  });

  it('shows a TRN that is not 15 digits as it is, and a single period on one line', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            ...payload,
            prefill: { ...payload.prefill, trn: '1004924377', vatPeriodsText: 'February to April' },
          }),
          { status: 200 }
        )
    );
    render(<SupplierPolicyIntakePage />);
    await screen.findByText('Supplier Verification Policy');
    expect(screen.getByText('1004924377')).toBeTruthy();
    expect(screen.getByText('February to April').tagName).toBe('DD');
  });

  it('shows the server message when the acknowledgement is refused', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ error: 'duty_not_acknowledged' }), { status: 400 })
        : new Response(JSON.stringify(payload), { status: 200 })
    );
    render(<SupplierPolicyIntakePage />);
    await screen.findByText('Supplier Verification Policy');
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: /Confirm my policy details/ }));
    expect(
      await screen.findByText('Please tick the box to confirm that checking suppliers stays with your company.')
    ).toBeTruthy();
  });

  it('shows the closed view on 410 and the thank-you view for a submitted link', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 410 }));
    const { unmount } = render(<SupplierPolicyIntakePage />);
    await screen.findByText('This link is closed');
    unmount();

    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ ...payload, status: 'synced' }), { status: 200 })
    );
    render(<SupplierPolicyIntakePage />);
    await waitFor(() => screen.getByText('Thank you, we have received your details'));
  });

  it('marks a person option as selected, fills the fields, and un-selects on edit', async () => {
    const finance = { name: 'Anna Smith', position: 'Finance Manager', email: 'anna@example.com' };
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({ ...payload, prefill: { ...payload.prefill, officers: [manager, finance] } }),
          { status: 200 }
        )
    );
    render(<SupplierPolicyIntakePage />);
    await screen.findByText('Supplier Verification Policy');

    const implementer = screen.getByRole('group', { name: 'Implementer' });
    const within = (el: HTMLElement) => ({
      option: (name: RegExp) =>
        Array.from(el.querySelectorAll('button[aria-pressed]')).find((b) => name.test(b.textContent || '')) as HTMLButtonElement,
    });
    const ali = within(implementer).option(/Ali Khan/);
    const anna = within(implementer).option(/Anna Smith/);

    // The prefilled manager is shown as the selected option.
    expect(ali.getAttribute('aria-pressed')).toBe('true');
    expect(anna.getAttribute('aria-pressed')).toBe('false');

    expect(
      within(screen.getByRole('group', { name: 'Reviewer' })).option(/Same person as Implementer/)
    ).toBeUndefined();

    fireEvent.click(anna);
    expect(anna.getAttribute('aria-pressed')).toBe('true');
    expect(anna.textContent).toContain('Selected');
    expect(ali.getAttribute('aria-pressed')).toBe('false');
    const nameInput = document.getElementById('svp-implementer-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Anna Smith');
    expect((document.getElementById('svp-implementer-position') as HTMLInputElement).value).toBe('Finance Manager');
    expect((document.getElementById('svp-implementer-email') as HTMLInputElement).value).toBe('anna@example.com');

    // Typing over the details un-selects the option.
    fireEvent.change(nameInput, { target: { value: 'Anna Smith-Jones' } });
    expect(anna.getAttribute('aria-pressed')).toBe('false');

    // While the Implementer is an officer, the Reviewer gets no duplicate
    // "Same person as Implementer" option; once typed over, it appears.
    const reviewer = screen.getByRole('group', { name: 'Reviewer' });
    expect(within(reviewer).option(/Same person as Implementer/)).toBeTruthy();
    const copy = within(reviewer).option(/Same person as Implementer/);
    expect(copy.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(copy);
    expect(copy.getAttribute('aria-pressed')).toBe('true');
    expect((document.getElementById('svp-reviewer-name') as HTMLInputElement).value).toBe('Anna Smith-Jones');

    // Pressing a selected option again clears the fields.
    fireEvent.click(copy);
    expect(copy.getAttribute('aria-pressed')).toBe('false');
    expect((document.getElementById('svp-reviewer-name') as HTMLInputElement).value).toBe('');
  });

  it('shows a missing Supervisor email next to the field and links to it', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            ...payload,
            prefill: {
              ...payload.prefill,
              suggested: { ...payload.prefill.suggested, supervisor: { ...manager, email: '' } },
              officers: [],
            },
          }),
          { status: 200 }
        )
    );
    render(<SupplierPolicyIntakePage />);
    await screen.findByText('Supplier Verification Policy');
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByText('Confirm my policy details'));

    // GOV.UK pattern: summary at the top (focused) linking to the field.
    expect(await screen.findByRole('alert')).toHaveFocus();
    const link = await screen.findByRole('link', {
      name: 'Supervisor: the email is missing. The Supervisor signs the policy.',
    });
    expect(link.getAttribute('href')).toBe('#svp-supervisor-email');
    const email = document.getElementById('svp-supervisor-email') as HTMLInputElement;
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain('svp-supervisor-email-error');
    expect(screen.getByText('The email is missing. The Supervisor signs the policy.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
