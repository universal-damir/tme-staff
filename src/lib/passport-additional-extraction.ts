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

Respond with a JSON object in exactly this format:
{
  "success": true,
  "data": {
    "father_name": "Keshava Hegde",
    "mother_name": "Hemavathi Shetty",
    "spouse_name": "Lilia Strotchi",
    "address_street": "23-6-447 Market Road, Jeppu",
    "address_city": "Mangaluru City",
    "address_pin": "575002",
    "address_state": "Karnataka",
    "address_country": "India",
    "old_passport_number": "Z3069032",
    "old_passport_issue_date": "27.04.2015",
    "old_passport_place_of_issue": "Dubai",
    "file_number": "UE2075496120325"
  }
}

If a field is not visible or cannot be extracted, omit it from the data object.
If the spouse field is blank/empty, omit "spouse_name".
If you cannot read the page at all, return:
{
  "success": false,
  "data": {},
  "error": "Description of the problem"
}`;

/**
 * Extract data from an Indian passport additional page using Claude Vision
 */
export async function extractAdditionalPage(imageBase64: string): Promise<AdditionalPageExtractionResult> {
  const client = getAnthropicClient();

  // Remove data URL prefix if present
  const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');

  // Detect media type from magic bytes
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

  try {
    const response = await withTimeout(
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: ADDITIONAL_PAGE_PROMPT,
              },
            ],
          },
        ],
      }),
      45000
    );

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON response');
    }

    const result = JSON.parse(jsonMatch[0]) as AdditionalPageExtractionResult;

    return {
      success: result.success ?? false,
      data: result.data || {},
      error: result.error,
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
