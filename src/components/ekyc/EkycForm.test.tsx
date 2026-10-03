import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import { EkycForm, keepaliveBody } from './EkycForm';
import { EkycBilingualContext } from './Bi';
import { EKYC_LATIN_NAME_HINT, EKYC_PREFILL_NOTICE, EKYC_PREFILLED_FIELD_MARK, EKYC_SUBMITTED_NOTICE } from '@/types/ekyc';
import { CORPORATE_STEPS, INDIVIDUAL_STEPS } from '@/lib/ekyc-steps';
import { EKYC_ENTITY_TYPES_WITH_ZONE, ekycRequiredDocumentSlots, emptyCorporateKyc, emptyIndividualKyc, type IndividualKycData } from '@/types/ekyc';
import { buildInitialEkycData } from '@/lib/ekyc-form';
import type { EkycClientPayload } from '@/lib/ekyc-token';

// jsdom has no canvas: stand in for the drawn signature pad.
vi.mock('@/components/SignatureCanvas', () => ({
  SignaturePad: ({ label }: { label: React.ReactNode }) => <div data-testid="signature-pad">{label}</div>,
}));
// jsdom cannot decode images: the shrink step hands the file back unchanged.
vi.mock('@/lib/supabase', () => ({ shrinkImageToBudget: async (f: File) => f }));

const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function corporatePayload(over: Partial<EkycClientPayload> = {}): EkycClientPayload {
  return {
    type: 'corporate',
    status: 'open',
    displayName: 'Bäckerei FZCO',
    bilingual: false,
    prefill: {
      prefilledFieldIds: ['companyName', 'licenses.0.licenseNumber'],
      companyName: 'Bäckerei FZCO',
      licenses: [
        {
          licenseNumber: '12345',
          issueDate: '',
          expiryDate: '',
          issuingAuthority: '',
          issuingAuthorityUnit: '',
          mainActivities: '',
        },
      ],
    },
    formData: null,
    documents: {},
    expiresAt: null,
    ...over,
  };
}

function individualPayload(over: Partial<EkycClientPayload> = {}): EkycClientPayload {
  return { ...corporatePayload(), type: 'individual', prefill: null, displayName: 'Jürgen Müller', ...over };
}

function renderForm(payload: EkycClientPayload, readOnly = false) {
  return render(
    <EkycBilingualContext.Provider value={payload.bilingual}>
      <EkycForm token="t" payload={payload} readOnly={readOnly} onSubmitted={() => {}} onClosed={() => {}} />
    </EkycBilingualContext.Provider>
  );
}

const heading = () => screen.getByRole('heading', { level: 1 });
const start = () => fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
/** Open a step from the desktop step list (the phone list stays folded). */
const openStep = (title: string) => {
  const nav = screen.getByRole('navigation', { name: 'Steps' });
  fireEvent.click(within(nav).getByRole('button', { name: new RegExp(`^\\d*\\s*${title}`) }));
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe('EkycForm', () => {
  it('first visit: start page says what is needed and how long; the pre-fill notice shows once', () => {
    renderForm(corporatePayload());
    expect(heading().textContent).toContain('KYC form for Corporate Clients');
    expect(screen.getByText('What you need')).toBeTruthy();
    expect(screen.getByText('It takes about 15 minutes.')).toBeTruthy();
    expect(screen.getAllByText(EKYC_PREFILL_NOTICE.en)).toHaveLength(1);
    start();
    expect(heading().textContent).toBe('Company');
  });

  it('corporate: a pre-filled field carries a small tag (sentence as tooltip) and stays editable', () => {
    renderForm(corporatePayload());
    start();
    expect(screen.getByText(/some answers on this page were filled in by TME Services/i)).toBeTruthy();
    const tag = screen.getByTitle(EKYC_PREFILLED_FIELD_MARK.en);
    expect(tag.textContent).toContain('Pre-filled');
    const name = document.getElementById('ekyc-companyName') as HTMLInputElement;
    expect(name.value).toBe('Bäckerei FZCO');
    fireEvent.change(name, { target: { value: 'Größe LLC' } });
    expect(name.value).toBe('Größe LLC');
  });

  it('no question numbers on screen (the PDF keeps them)', () => {
    renderForm(corporatePayload());
    start();
    const label = document.getElementById('ekyc-companyName-label') as HTMLElement;
    expect(label.textContent).not.toMatch(/^\s*1\./);
  });

  it('every step renders for the corporate form, then Check your answers', () => {
    renderForm(corporatePayload());
    start();
    for (const step of CORPORATE_STEPS) {
      openStep(step.title.en);
      expect(heading().textContent).toBe(step.title.en);
    }
    openStep('Check your answers');
    expect(heading().textContent).toBe('Check your answers');
    expect(screen.getAllByRole('button', { name: /^Change/ })).toHaveLength(CORPORATE_STEPS.length);
  });

  it('every step renders for the individual form (no pre-fill), then Check your answers', () => {
    renderForm(individualPayload());
    expect(screen.queryByText(EKYC_PREFILL_NOTICE.en)).toBeNull();
    start();
    for (const step of INDIVIDUAL_STEPS) {
      openStep(step.title.en);
      expect(heading().textContent).toBe(step.title.en);
    }
    openStep('Check your answers');
    expect(heading().textContent).toBe('Check your answers');
  });

  it('English only unless bilingual; bilingual shows the German under the English', () => {
    const { unmount } = renderForm(corporatePayload());
    start();
    expect(screen.queryByText('Unternehmen')).toBeNull();
    unmount();
    renderForm(corporatePayload({ bilingual: true }));
    start();
    expect(screen.getAllByText('Company').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unternehmen').length).toBeGreaterThan(0);
    const next = screen.getByRole('button', { name: /Continue/ });
    expect(within(next).getByText('Weiter')).toBeTruthy();
    expect(next.textContent).not.toContain(' / ');
  });

  it('Continue checks only this step: names what is missing (by label) and stays', () => {
    renderForm(corporatePayload());
    start();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(heading().textContent).toBe('Company');
    const summary = screen.getByText('Please check these answers:').closest('[role="alert"]') as HTMLElement;
    expect(within(summary).getByText('Type of Entity / Legal Status: Please choose an answer.')).toBeTruthy();
    expect(within(summary).queryByText(/License/)).toBeNull();
    // The step list now flags the step.
    const nav = screen.getByRole('navigation', { name: 'Steps' });
    expect(within(nav).getByText('Needs attention')).toBeTruthy();
  });

  it('a single choice with 3+ options is a dropdown; two options are buttons side by side', () => {
    renderForm(corporatePayload());
    start();
    const entity = document.getElementById('ekyc-entityType-field') as HTMLElement;
    expect(within(entity).queryByRole('radio')).toBeNull();
    expect(within(entity).getByRole('button', { name: /Type of Entity/ })).toBeTruthy();
    const branch = document.querySelector('#ekyc-isBranchOrSubsidiary-field [role="radiogroup"]') as HTMLElement;
    expect(branch.getAttribute('aria-labelledby')).toBe('ekyc-isBranchOrSubsidiary-label');
    expect(within(branch).getAllByRole('radio')).toHaveLength(2);
  });

  it('licenses: add up to 3, then the button goes away; a row can be removed', () => {
    renderForm(corporatePayload());
    start();
    openStep('Licenses');
    const add = () => screen.queryByRole('button', { name: /Add another license/ });
    fireEvent.click(add()!);
    fireEvent.click(add()!);
    expect(add()).toBeNull();
    expect(screen.getByText('License 3')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0]);
    expect(screen.queryByText('License 3')).toBeNull();
    expect(add()).not.toBeNull();
  });

  it('Submit on Check your answers with gaps names them and opens no dialog', () => {
    renderForm(corporatePayload());
    start();
    openStep('Check your answers');
    expect(screen.getAllByText(EKYC_PREFILL_NOTICE.en)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByText('Please complete the following before you submit:').closest('[role="alert"]') as HTMLElement;
    expect(within(summary).getByText(/Type of Entity \/ Legal Status: Please choose an answer\./)).toBeTruthy();
    expect(within(summary).queryByText(/Corporate website/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    // A link takes the client to the step with the problem.
    fireEvent.click(within(summary).getByText(/Type of Entity/));
    expect(heading().textContent).toBe('Company');
  });

  it('individual: upload slots follow the answers', () => {
    renderForm(individualPayload());
    start();
    openStep('Documents');
    expect(screen.getByText('Passport Copy')).toBeTruthy();
    expect(screen.queryByText('EID Front, in case of a resident of the UAE')).toBeNull();
    openStep('Address and contact');
    const uaeQuestion = document.getElementById('ekyc-uaeResident-field') as HTMLElement;
    fireEvent.click(within(uaeQuestion).getByRole('radio', { name: 'Yes' }));
    openStep('Documents');
    expect(screen.getByText('EID Front, in case of a resident of the UAE')).toBeTruthy();
  });

  it('a return visit opens on the first step with something missing', () => {
    renderForm(corporatePayload({ formData: { companyName: 'X' } }));
    expect(heading().textContent).toBe('Company');
    expect(screen.queryByText('What you need')).toBeNull();
  });

  it('read-only after submit: confirmation, the answers, nothing to edit', () => {
    renderForm(corporatePayload({ status: 'submitted', formData: { companyName: 'Bäckerei FZCO' } }), true);
    expect(screen.getByText('We have received your form')).toBeTruthy();
    expect(screen.getByText(EKYC_SUBMITTED_NOTICE.en)).toBeTruthy();
    expect(screen.getAllByText('Bäckerei FZCO').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save draft/ })).toBeNull();
    expect(document.querySelector('input')).toBeNull();
  });

  it('D8: a person name turns Latin as it is typed and shows the hint; a company name does not', () => {
    renderForm(corporatePayload());
    start();
    const company = document.getElementById('ekyc-companyName') as HTMLInputElement;
    fireEvent.change(company, { target: { value: 'Größe LLC' } });
    expect(company.value).toBe('Größe LLC');
    openStep('Contact and addresses');
    const contact = document.getElementById('ekyc-primaryContactName') as HTMLInputElement;
    fireEvent.change(contact, { target: { value: 'Jürgen Müller' } });
    expect(contact.value).toBe('Juergen Mueller');
    expect(screen.getAllByText(EKYC_LATIN_NAME_HINT.en).length).toBeGreaterThan(0);
  });

  it('Save draft sits in the header and saves now; a step change saves too', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderForm(corporatePayload());
    const save = screen.getByRole('button', { name: /Save draft/ });
    expect(save.closest('header')).toBeTruthy();
    start();
    fireEvent.change(document.getElementById('ekyc-companyName') as HTMLInputElement, { target: { value: 'A LLC' } });
    openStep('Licenses');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/autosave');
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0));
  });

  it('individual: Submit waits while a file uploads', async () => {
    let finish: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/upload')
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      )
    );
    renderForm(individualPayload());
    start();
    openStep('Documents');
    const slot = document.getElementById('ekyc-documents-passport-field') as HTMLElement;
    const input = slot.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'pass.png', { type: 'image/png' })] } });
    });
    openStep('Check your answers');
    await waitFor(() => expect((screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText('Please wait until the upload is finished.')).toBeTruthy();
    await act(async () => {
      finish(
        new Response(
          JSON.stringify({ slot: 'passport', document: { filename: 'pass.png', mimeType: 'image/png', size: 1, uploadedAt: 't' } }),
          { status: 200 }
        )
      );
    });
    await waitFor(() => expect((screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('pass.png')).toBeTruthy();
  });

  it('every Continue press with problems brings the summary back into focus; typing later keeps the focus', () => {
    renderForm(corporatePayload());
    start();
    const next = screen.getByRole('button', { name: /Continue/ });
    fireEvent.click(next);
    const summary = screen.getByText('Please check these answers:').closest('[role="alert"]') as HTMLElement;
    expect(document.activeElement).toBe(summary);
    const name = document.getElementById('ekyc-companyName') as HTMLInputElement;
    name.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(summary);
    name.focus();
    fireEvent.change(name, { target: { value: 'New name LLC' } });
    expect(document.activeElement).toBe(name);
    // Field errors are not alerts of their own: only the summary is.
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('Type of Entity and Mainland or Freezone share a row; the label carries no star', () => {
    renderForm(corporatePayload({ formData: { companyName: 'X', entityType: EKYC_ENTITY_TYPES_WITH_ZONE[0] } }));
    openStep('Company');
    const entity = document.getElementById('ekyc-entityType-field') as HTMLElement;
    const zone = document.getElementById('ekyc-entityZone-field') as HTMLElement;
    expect(entity.parentElement).toBe(zone.parentElement);
    expect(entity.className).toContain('grid-rows-subgrid');
    expect(document.getElementById('ekyc-companyName-field')?.parentElement).not.toBe(entity.parentElement);
    expect(document.getElementById('ekyc-entityType-label')?.textContent).not.toContain('*');
  });

  it('return visit: a pre-fill tag stays only where the value is still the pre-filled one', () => {
    const base = buildInitialEkycData('corporate', corporatePayload().prefill, null) as ReturnType<typeof emptyCorporateKyc>;
    const draft = {
      ...base,
      // The client added a license above the pre-filled one, so row 0 now holds a different number.
      licenses: [{ ...base.licenses[0], licenseNumber: '777' }, base.licenses[0]],
    };
    renderForm(corporatePayload({ formData: draft }));
    openStep('Company');
    expect(screen.getAllByTitle(EKYC_PREFILLED_FIELD_MARK.en)).toHaveLength(1);
    openStep('Licenses');
    expect(screen.queryByTitle(EKYC_PREFILLED_FIELD_MARK.en)).toBeNull();
  });

  it('Check your answers: "Missing" shows before Submit; the error list follows the step order', () => {
    renderForm(corporatePayload());
    start();
    openStep('Check your answers');
    expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByText('Please complete the following before you submit:').closest('[role="alert"]') as HTMLElement;
    const lines = within(summary)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    expect(at(/^Type of Entity/)).toBeLessThan(at(/^Mode of Payment/));
    expect(at(/^Mode of Payment/)).toBeLessThan(at(/^License 1/));
    expect(at(/^License 1/)).toBeLessThan(at(/^Signature/));
  });

  it('confirm dialog: Cancel has the focus, Escape closes it, the focus goes back to Submit; no repeated pre-fill notice', () => {
    const data = {
      ...emptyIndividualKyc(),
      fullName: 'Juergen Mueller',
      nationality: 'Germany',
      dualNationality: 'no',
      uaeResident: 'no',
      homeAddress: { street: 'Hauptstrasse 5', city: 'Muenchen', postalCode: '80331', country: 'Germany' },
      homePhone: '+49 89 1234567',
      gccNational: 'no',
      incomeSources: ['investments'],
      isPep: 'no',
      rcaIsPep: 'no',
      sanctioned: 'no',
      highRisk: 'no',
      trustCharity: 'no',
      modesOfPayment: ['bank_transfer'],
      declaration: { authorizedPersonName: 'Juergen Mueller', signature: SIGNATURE, date: '2026-10-02' },
    } as IndividualKycData;
    const documents = Object.fromEntries(
      ekycRequiredDocumentSlots(data).map((slot) => [slot, { filename: `${slot}.pdf`, mimeType: 'application/pdf', size: 1, uploadedAt: 't' }])
    );
    renderForm(individualPayload({ formData: data, documents }));
    expect(heading().textContent).toBe('Check your answers');
    const submit = screen.getByRole('button', { name: 'Submit' });
    fireEvent.click(submit);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toContain('Submit the form?');
    expect(document.activeElement?.textContent).toContain('Cancel');
    expect(within(dialog).queryByText(EKYC_PREFILL_NOTICE.en)).toBeNull();
    // Tab from the last button wraps to the first.
    const buttons = within(dialog).getAllByRole('button');
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(submit);
  });

  it('an error link to an upload focuses the slot button, not the hidden file input', () => {
    renderForm(individualPayload());
    start();
    openStep('Check your answers');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByText('Please complete the following before you submit:').closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(summary).getByText(/^Passport Copy/));
    return waitFor(() => {
      const slot = document.getElementById('ekyc-documents-passport-field') as HTMLElement;
      expect(slot.contains(document.activeElement)).toBe(true);
      expect((document.activeElement as HTMLElement).tagName).toBe('BUTTON');
    });
  });

  it('the leave-page save leaves an unchanged signature out', () => {
    const d = { ...emptyIndividualKyc(), declaration: { authorizedPersonName: 'A', signature: SIGNATURE, date: '' } };
    const same = keepaliveBody(d, SIGNATURE) as { formData: IndividualKycData; keepSignature?: boolean };
    expect(same.keepSignature).toBe(true);
    expect('signature' in same.formData.declaration).toBe(false);
    expect(same.formData.declaration.authorizedPersonName).toBe('A');
    expect(keepaliveBody(d, 'data:image/png;base64,OLD')).toEqual({ formData: d });
    expect(keepaliveBody(emptyIndividualKyc(), '')).toEqual({ formData: emptyIndividualKyc() });
  });

  it('the phone bar at the bottom steps aside while a text field has focus', async () => {
    renderForm(corporatePayload());
    start();
    const bar = screen.getByRole('button', { name: /Continue/ }).parentElement?.parentElement as HTMLElement;
    expect(bar.className).not.toContain('max-lg:hidden');
    const name = document.getElementById('ekyc-companyName') as HTMLInputElement;
    act(() => name.focus());
    await waitFor(() => expect(bar.className).toContain('max-lg:hidden'));
    act(() => name.blur());
    await waitFor(() => expect(bar.className).not.toContain('max-lg:hidden'));
  });
  it('round 4: the pre-filled tag sits under the input; every field of its row keeps the slot, the next row has none', () => {
    renderForm(corporatePayload());
    start();
    openStep('Licenses');
    const cell = (id: string) => document.getElementById(`ekyc-licenses-0-${id}-field`) as HTMLElement;
    const tagSlot = cell('licenseNumber').querySelector('[data-ekyc-tag-slot]') as HTMLElement;
    expect(within(tagSlot).getByText('Pre-filled')).toBeTruthy();
    expect(within(cell('licenseNumber').querySelector('label') as HTMLElement).queryByText('Pre-filled')).toBeNull();
    // The same empty slot under the two dates of that row.
    for (const id of ['issueDate', 'expiryDate']) {
      const slot = cell(id).querySelector('[data-ekyc-tag-slot]') as HTMLElement;
      expect(slot).toBeTruthy();
      expect(slot.textContent).toBe('');
      expect(slot.className).toBe(tagSlot.className);
    }
    expect(cell('issuingAuthority').querySelector('[data-ekyc-tag-slot]')).toBeNull();
    // Main activities: one box per activity.
    expect(document.getElementById('ekyc-licenses-0-mainActivities')?.tagName).toBe('INPUT');
    expect(screen.getByRole('button', { name: 'Add activity' })).toBeTruthy();
  });

  it('round 4: an error link on a money field focuses the AMOUNT box, not the currency picker', () => {
    renderForm(corporatePayload());
    start();
    openStep('Check your answers');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByText('Please complete the following before you submit:').closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(summary).getByText(/^What is the authorized share capital/));
    return waitFor(() => expect(document.activeElement).toBe(document.getElementById('ekyc-authorizedShareCapital')));
  });

  it('round 4: an error link on a phone field focuses the NUMBER box, not the country picker', () => {
    renderForm(individualPayload({ formData: { uaeResident: 'yes' } })); // a return visit: no start page
    openStep('Check your answers');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByText('Please complete the following before you submit:').closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(summary).getByText(/^Contact number in the UAE/));
    return waitFor(() => {
      const number = document.getElementById('ekyc-uaePhone') as HTMLInputElement;
      expect(number.type).toBe('tel');
      expect(document.activeElement).toBe(number);
    });
  });

  it('round 4: an error link on the activities focuses the first activity box', () => {
    renderForm(corporatePayload());
    start();
    openStep('Check your answers');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByText('Please complete the following before you submit:').closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(summary).getByText(/Main activities of the reporting entity/));
    return waitFor(() => expect(document.activeElement).toBe(document.getElementById('ekyc-licenses-0-mainActivities')));
  });
});
