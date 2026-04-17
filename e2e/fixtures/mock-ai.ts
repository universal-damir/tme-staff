/**
 * Mock all AI endpoints so tests don't hit Claude (slow + costs money).
 * Canned successful responses per endpoint. Tests can override any endpoint
 * by calling page.route() again after mockAllAi().
 */

import type { Page } from '@playwright/test';

type Handler = (url: string) => Record<string, unknown>;

const HANDLERS: Record<string, Handler> = {
  '/api/validate-photo': () => ({
    valid: true,
    errors: [],
    suggestions: [],
    confidence: 95,
  }),
  '/api/validate-passport-page': () => ({
    matches: true,
    page_type: 'INSIDE_PAGES',
    confidence: 90,
    details: 'Valid passport spread',
  }),
  '/api/extract-passport': () => ({
    success: true,
    data: {
      title: 'Mr',
      first_name: 'Test',
      family_name: 'User',
      passport_no: 'X12345678',
      passport_issue_date: '01.01.2020',
      passport_expiry_date: '01.01.2030',
      nationality: 'Germany',
      date_of_birth: '01.01.1990',
      gender: 'Male',
      place_of_birth: 'Berlin',
    },
    confidence: { passport_no: 'high', expiry_date: 'high' },
    mrz_verified: true,
  }),
  '/api/extract-passport-additional': () => ({
    success: true,
    data: {
      father_name: 'Test Father',
      mother_name: 'Test Mother',
      address_street: '123 Test St',
      address_city: 'Test City',
      address_pin: '123456',
      address_state: 'Test State',
      address_country: 'India',
    },
  }),
  '/api/extract-eid': () => ({
    success: true,
    data: {
      emirates_id_number: '784-1990-1234567-1',
      first_name: 'Test',
      family_name: 'User',
      nationality: 'German',
      issue_date: '01.01.2023',
      expiry_date: '01.01.2028',
      date_of_birth: '01.01.1990',
      gender: 'Male',
    },
    confidence: { emirates_id_number: 'high', issue_date: 'high', expiry_date: 'high' },
  }),
  '/api/extract-pakistan-id': () => ({
    success: true,
    data: {
      cnic_number: '35202-1234567-1',
      full_name: 'Test Khan',
      father_name: 'Test Father',
      date_of_birth: '01.01.1990',
      gender: 'Male',
      issue_date: '01.01.2020',
      expiry_date: '01.01.2030',
      address: 'House 1, Street 2, Lahore',
      address_city: 'Lahore',
    },
    confidence: { cnic_number: 'high', issue_date: 'high', expiry_date: 'high' },
  }),
  '/api/validate-visa-document': () => ({
    valid: true,
    details: 'Valid visa document',
    detected_type: 'employment_visa',
    expiry_date: '01.01.2028',
  }),
};

export async function mockAllAi(page: Page): Promise<void> {
  for (const [endpoint, handler] of Object.entries(HANDLERS)) {
    await page.route(endpoint, async route => {
      const body = handler(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
  }
}
