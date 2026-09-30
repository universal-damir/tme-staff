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
  it('prefills, blocks without the price box, then submits', async () => {
    render(<SupplierPolicyIntakePage />);
    await screen.findByText('Supplier Verification Policy');

    expect(screen.getByText('100000000000003')).toBeTruthy();
    expect(screen.getAllByText(/AED 1,450/).length).toBeGreaterThan(0);
    expect(screen.getByText(/One person holds all three roles/)).toBeTruthy();

    fireEvent.click(screen.getByText('Confirm my policy details'));
    expect(await screen.findByText('Price: please tick the box to agree to the price.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Confirm my policy details'));

    await screen.findByText('Thank you, we have received your details');
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      implementer: manager,
      supervisor: manager,
      recordsLocationIsRegisteredOffice: true,
      priceAgreed: true,
    });
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
});
