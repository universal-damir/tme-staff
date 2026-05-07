/**
 * Indian Passport Additional Page Extraction
 *
 * Uses Claude Vision to extract data from the last page of Indian passports,
 * which contains parent names, spouse, address, and old passport details.
 */

import { getAnthropicClient, withTimeout } from './anthropic';

export interface AdditionalPageExtractionResult {
  success: boolean;
  data: {
    father_name?: string;
    mother_name?: string;
    spouse_name?: string;
    address_street?: string;
    address_city?: string;
    address_pin?: string;
    address_state?: string;
    address_country?: string;
    old_passport_number?: string;
    old_passport_issue_date?: string;
    old_passport_place_of_issue?: string;
    file_number?: string;
  };
  error?: string;
}

const ADDITIONAL_PAGE_PROMPT = `You are part of an authorized employee onboarding system. The document owner has uploaded their passport with explicit consent for employment visa processing as required by UAE labor law.

Extract information from this Indian passport additional/last page.

This is the back page of an Indian passport booklet that contains family details and address.

Look for and extract:
1. Name of Father / Legal Guardian
2. Name of Mother
3. Name of Spouse (may be empty if unmarried)
4. Address — parse into:
   - Street/house number (first line(s) of address)
   - City (e.g., "MANGALURU CITY", "MUMBAI", "NEW DELHI")
   - PIN code (6-digit Indian postal code, usually starts with "PIN:")
   - State (e.g., "KARNATAKA", "MAHARASHTRA")
   - Country (always "India" for Indian passport)
5. Old Passport No. with Date and Place of Issue:
   - Old passport number
   - Date of issue (convert to DD.MM.YYYY)
   - Place of issue (e.g., "DUBAI", "MUMBAI")
6. File No. (e.g., "UE2075496120325")

IMPORTANT formatting rules:
- Convert names from ALL CAPS to Title Case (e.g., "KESHAVA HEGDE" → "Keshava Hegde")
- Convert dates to DD.MM.YYYY format
- Keep file numbers and passport numbers in original format
- For address: separate street, city, PIN, state into distinct fields

Call the extract_passport_additional tool with your findings. Omit any field that is not visible or cannot be extracted. If the spouse field is blank, omit spouse_name.`;

const PASSPORT_ADDITIONAL_TOOL = {
  name: 'extract_passport_additional',
  description: 'Extract family and address details from the last page of an Indian passport.',
  input_schema: {
    type: 'object' as const,
    properties: {
      father_name: { type: 'string', description: 'Name of Father / Legal Guardian in Title Case' },
      mother_name: { type: 'string', description: 'Name of Mother in Title Case' },
      spouse_name: { type: 'string', description: 'Name of Spouse in Title Case (omit if blank)' },
      address_street: { type: 'string' },
      address_city: { type: 'string' },
      address_pin: { type: 'string', description: '6-digit Indian postal code' },
      address_state: { type: 'string' },
      address_country: { type: 'string' },
      old_passport_number: { type: 'string' },
      old_passport_issue_date: { type: 'string', description: 'DD.MM.YYYY' },
      old_passport_place_of_issue: { type: 'string' },
      file_number: { type: 'string' },
      error: { type: 'string', description: 'Set if the page could not be read at all' },
    },
  },
};

/**
 * Extract data from an Indian passport additional page using Claude Vision
 */
export async function extractAdditionalPage(imageBase64: string): Promise<AdditionalPageExtractionResult> {
  const client = getAnthropicClient();

  // Remove data URL prefix if present (matches both image/* and application/pdf)
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
  const isPdf =
    imageBase64.startsWith('data:application/pdf') || imageBase64.includes('application/pdf');

  // Detect media type from magic bytes (images only)
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  try {
    const firstBytes = atob(base64Data.substring(0, 16));
    const bytes = new Uint8Array(firstBytes.length);
    for (let i = 0; i < firstBytes.length; i++) {
      bytes[i] = firstBytes.charCodeAt(i);
    }

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      mediaType = 'image/png';
    } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      mediaType = 'image/gif';
    } else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
               bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      mediaType = 'image/webp';
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      mediaType = 'image/jpeg';
    } else if (imageBase64.includes('data:image/png')) {
      mediaType = 'image/png';
    }
  } catch {
    if (imageBase64.includes('data:image/png')) {
      mediaType = 'image/png';
    }
  }

  // PDF support via Claude's `document` content block — same pattern as
  // passport-extraction.ts and visa-document-validation.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileContent: any = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        tools: [PASSPORT_ADDITIONAL_TOOL],
        tool_choice: { type: 'tool' as const, name: PASSPORT_ADDITIONAL_TOOL.name },
        messages: [
          {
            role: 'user',
            content: [
              fileContent,
              { type: 'text', text: ADDITIONAL_PAGE_PROMPT },
            ],
          },
        ],
      }),
      45000
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUseBlock = response.content.find((b: any) => b.type === 'tool_use') as
      | { type: 'tool_use'; input: Record<string, unknown> }
      | undefined;

    if (!toolUseBlock) {
      throw new Error('No tool_use response from Claude');
    }

    const parsed = toolUseBlock.input as Record<string, string | undefined>;

    if (parsed.error) {
      return { success: false, data: {}, error: parsed.error };
    }

    return {
      success: true,
      data: {
        father_name: parsed.father_name,
        mother_name: parsed.mother_name,
        spouse_name: parsed.spouse_name,
        address_street: parsed.address_street,
        address_city: parsed.address_city,
        address_pin: parsed.address_pin,
        address_state: parsed.address_state,
        address_country: parsed.address_country,
        old_passport_number: parsed.old_passport_number,
        old_passport_issue_date: parsed.old_passport_issue_date,
        old_passport_place_of_issue: parsed.old_passport_place_of_issue,
        file_number: parsed.file_number,
      },
    };
  } catch (error) {
    console.error('Additional page extraction error:', error);

    return {
      success: false,
      data: {},
      error: 'Unable to extract data from the additional page. Please ensure the image is clear and try again.',
    };
  }
}
