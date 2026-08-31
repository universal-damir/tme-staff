import { describe, it, expect } from 'vitest';
import {
  COMPANY_SETUP_DOC_SLOTS,
  documentsErrorForRow,
  isCompanySetupDocSlot,
} from './company-setup-token';

const ROW = '11111111-2222-3333-4444-555555555555';

const clientRef = (personKey: string, slot: string) => ({
  path: `${ROW}/${personKey}/${slot}/abc.pdf`,
  filename: 'abc.pdf',
  uploadedAt: '2026-08-31T10:00:00.000Z',
});

describe('company setup document slots', () => {
  it('includes the nationality-dependent additional passport page', () => {
    expect(COMPANY_SETUP_DOC_SLOTS).toContain('passport_additional');
    expect(isCompanySetupDocSlot('passport_additional')).toBe(true);
    expect(isCompanySetupDocSlot('passport_back')).toBe(false);
  });
});

describe('documentsErrorForRow', () => {
  it('accepts client refs whose path matches their person key and slot', () => {
    const documents = {
      '0': { passport: clientRef('0', 'passport'), photo: clientRef('0', 'photo') },
      '1': { passport_additional: clientRef('1', 'passport_additional') },
    };
    expect(documentsErrorForRow(documents, ROW)).toBeNull();
  });

  it('tolerates a stale person segment — removing a person re-keys refs but not paths', () => {
    const documents = { '1': { passport: clientRef('2', 'passport') } };
    expect(documentsErrorForRow(documents, ROW)).toBeNull();
  });

  it('rejects a person segment that is not an array index', () => {
    const documents = { '0': { passport: clientRef('9', 'passport') } };
    expect(documentsErrorForRow(documents, ROW)).toMatch(/invalid path/);
  });

  it('rejects a ref whose path points at a different slot', () => {
    const documents = { '0': { photo: clientRef('0', 'passport') } };
    expect(documentsErrorForRow(documents, ROW)).toMatch(/invalid path/);
  });

  it('rejects another submission entirely', () => {
    const documents = {
      '0': {
        passport: {
          path: '99999999-2222-3333-4444-555555555555/0/passport/abc.pdf',
          filename: 'abc.pdf',
          uploadedAt: '2026-08-31T10:00:00.000Z',
        },
      },
    };
    expect(documentsErrorForRow(documents, ROW)).toMatch(/invalid path/);
  });

  it('accepts staff-provided refs in the portal namespace', () => {
    const documents = {
      '2': {
        passport: {
          path: `${ROW}/staff/2-passport.pdf`,
          filename: 'passport.pdf',
          uploadedAt: '2026-08-31T10:00:00.000Z',
          source: 'staff' as const,
        },
      },
    };
    expect(documentsErrorForRow(documents, ROW)).toBeNull();
  });

  it('does not let a client ref hide in the staff namespace', () => {
    const documents = {
      '0': {
        passport: {
          path: `${ROW}/staff/0-passport.pdf`,
          filename: 'passport.pdf',
          uploadedAt: '2026-08-31T10:00:00.000Z',
        },
      },
    };
    expect(documentsErrorForRow(documents, ROW)).toMatch(/invalid path/);
  });

  it('rejects an unknown source', () => {
    const documents = {
      '0': { passport: { ...clientRef('0', 'passport'), source: 'someone_else' } },
    };
    expect(documentsErrorForRow(documents, ROW)).toMatch(/invalid source/);
  });

  it('still rejects traversal and unknown keys', () => {
    expect(
      documentsErrorForRow(
        { '0': { passport: { ...clientRef('0', 'passport'), path: `${ROW}/0/passport/../../x` } } },
        ROW
      )
    ).toMatch(/invalid path/);
    expect(documentsErrorForRow({ '9': {} }, ROW)).toMatch(/invalid person key/);
    expect(documentsErrorForRow({ '0': { selfie: clientRef('0', 'selfie') } }, ROW)).toMatch(
      /invalid document slot/
    );
  });
});
