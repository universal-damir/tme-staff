/**
 * UAE Bank Directory — IBAN-based auto-derivation
 *
 * Source: HSBC "Beneficiary Bank Codes for AutoPay Services" (March 2022)
 * Entity ID = 3-digit bank code at IBAN positions 4-6.
 *
 * UAE IBAN format: AE + 2 check digits + 3 bank code + 16 account number = 23 chars
 */

export interface UaeBankInfo {
  entityId: string;      // 3-digit code from IBAN positions 4-6
  name: string;          // Full bank name for salary WPS
  swift8: string;        // 8-char SWIFT/BIC
  swift11: string;       // 11-char SWIFT/BIC
  routingCode: string;   // Local Clearing Code (for WPS)
  entityType: 'BK' | 'EX' | 'FC' | 'CB';
}

/**
 * Map keyed by 3-digit entity ID (extracted from IBAN positions 4-6).
 * All data from HSBC "Beneficiary Bank Codes for AutoPay Services" March 2022.
 */
export const UAE_BANK_DIRECTORY: Map<string, UaeBankInfo> = new Map([
  // Central Bank
  ['001', { entityId: '001', name: 'Central Bank of UAE', swift8: 'CBAUAEAA', swift11: 'CBAUAEAAXXX', routingCode: '800110101', entityType: 'CB' }],

  // Banks (BK)
  ['002', { entityId: '002', name: 'The Royal Bank Of Scotland N.V.', swift8: 'ABNAAEAD', swift11: 'ABNAAEADXXX', routingCode: '400220101', entityType: 'BK' }],
  ['003', { entityId: '003', name: 'Abu Dhabi Commercial Bank', swift8: 'ADCBAEAA', swift11: 'ADCBAEAAXXX', routingCode: '600310101', entityType: 'BK' }],
  ['004', { entityId: '004', name: 'Al Ahli Bank Of Kuwait K.S.C.', swift8: 'ABKKAEAD', swift11: 'ABKKAEADXXX', routingCode: '200420101', entityType: 'BK' }],
  ['005', { entityId: '005', name: 'Rafidain Bank', swift8: 'RAFBAEAD', swift11: 'RAFBAEADXXX', routingCode: '400510101', entityType: 'BK' }],
  ['007', { entityId: '007', name: 'Arab African International Bank', swift8: 'ARAIAEAD', swift11: 'ARAIAEADXXX', routingCode: '900720101', entityType: 'BK' }],
  ['008', { entityId: '008', name: 'Al Masraf', swift8: 'ABINAEAA', swift11: 'ABINAEAAXXX', routingCode: '100810101', entityType: 'BK' }],
  ['009', { entityId: '009', name: 'Arab Bank', swift8: 'ARABAEAD', swift11: 'ARABAEADXXX', routingCode: '000910101', entityType: 'BK' }],
  ['011', { entityId: '011', name: 'Bank of Baroda', swift8: 'BARBAEAD', swift11: 'BARBAEADXXX', routingCode: '801120101', entityType: 'BK' }],
  ['012', { entityId: '012', name: 'Bank of Sharjah', swift8: 'SHARAEAS', swift11: 'SHARAEASXXX', routingCode: '401230101', entityType: 'BK' }],
  ['014', { entityId: '014', name: 'Blom Bank France', swift8: 'BLOMAEAD', swift11: 'BLOMAEADXXX', routingCode: '001420151', entityType: 'BK' }],
  ['015', { entityId: '015', name: 'Banque Misr', swift8: 'BMISAEAA', swift11: 'BMISAEAAXXX', routingCode: '001510102', entityType: 'BK' }],
  ['016', { entityId: '016', name: 'Credit Agricole Corporate and Investment Bank', swift8: 'BSUIAEAD', swift11: 'BSUIAEADXXX', routingCode: '301620101', entityType: 'BK' }],
  ['017', { entityId: '017', name: 'Al Khaliji France S.A.', swift8: 'LICOAEAD', swift11: 'LICOAEADXXX', routingCode: '201720101', entityType: 'BK' }],
  ['018', { entityId: '018', name: 'BNP Paribas', swift8: 'BNPAAEAA', swift11: 'BNPAAEAAXXX', routingCode: '401810101', entityType: 'BK' }],
  ['019', { entityId: '019', name: 'Barclays Bank', swift8: 'BARCAEAD', swift11: 'BARCAEADXXX', routingCode: '401920110', entityType: 'BK' }],
  ['020', { entityId: '020', name: 'HSBC Bank Middle East', swift8: 'BBMEAEAD', swift11: 'BBMEAEADXXX', routingCode: '302020120', entityType: 'BK' }],
  ['021', { entityId: '021', name: 'Citibank NA', swift8: 'CITIAEAD', swift11: 'CITIAEADXXX', routingCode: '102120101', entityType: 'BK' }],
  ['022', { entityId: '022', name: 'Commercial Bank International', swift8: 'CLBIAEAD', swift11: 'CLBIAEADXXX', routingCode: '002220101', entityType: 'BK' }],
  ['023', { entityId: '023', name: 'Commercial Bank of Dubai', swift8: 'CBDUAEAD', swift11: 'CBDUAEADXXX', routingCode: '102320150', entityType: 'BK' }],
  ['024', { entityId: '024', name: 'Dubai Islamic Bank', swift8: 'DUIBAEAD', swift11: 'DUIBAEADXXX', routingCode: '802420101', entityType: 'BK' }],
  ['025', { entityId: '025', name: 'El Nilein Bank', swift8: 'NILBAEAA', swift11: 'NILBAEAAXXX', routingCode: '002510101', entityType: 'BK' }],
  ['026', { entityId: '026', name: 'Emirates NBD', swift8: 'EBILAEAD', swift11: 'EBILAEADXXX', routingCode: '202620103', entityType: 'BK' }],
  ['027', { entityId: '027', name: 'First Abu Dhabi Bank', swift8: 'FGBMAEAA', swift11: 'FGBMAEAAXXX', routingCode: '102710102', entityType: 'BK' }],
  ['028', { entityId: '028', name: 'Habib Bank Limited', swift8: 'HABBAEAD', swift11: 'HABBAEADXXX', routingCode: '102820111', entityType: 'BK' }],
  ['029', { entityId: '029', name: 'Habib Bank AG Zurich', swift8: 'HBZUAEAD', swift11: 'HBZUAEADXXX', routingCode: '302920101', entityType: 'BK' }],
  ['030', { entityId: '030', name: 'Investbank PSC', swift8: 'IBTFAEAS', swift11: 'IBTFAEASXXX', routingCode: '503030102', entityType: 'BK' }],
  ['031', { entityId: '031', name: 'Janata Bank', swift8: 'JANBAEAA', swift11: 'JANBAEAAXXX', routingCode: '103110110', entityType: 'BK' }],
  ['033', { entityId: '033', name: 'Mashreqbank', swift8: 'BOMLAEAD', swift11: 'BOMLAEADXXX', routingCode: '203320101', entityType: 'BK' }],
  ['034', { entityId: '034', name: 'Emirates Islamic Bank', swift8: 'MEBLAEAD', swift11: 'MEBLAEADXXX', routingCode: '703420114', entityType: 'BK' }],
  ['035', { entityId: '035', name: 'First Abu Dhabi Bank', swift8: 'NBADAEAA', swift11: 'NBADAEAAXXX', routingCode: '803510106', entityType: 'BK' }],
  ['036', { entityId: '036', name: 'National Bank Of Bahrain', swift8: 'NBOBAEAA', swift11: 'NBOBAEAAXXX', routingCode: '203610101', entityType: 'BK' }],
  ['038', { entityId: '038', name: 'National Bank Of Fujairah', swift8: 'NBFUAEAF', swift11: 'NBFUAEAFXXX', routingCode: '703820101', entityType: 'BK' }],
  ['039', { entityId: '039', name: 'National Bank of Oman', swift8: 'NBOMAEAD', swift11: 'NBOMAEADXXX', routingCode: '903910101', entityType: 'BK' }],
  ['040', { entityId: '040', name: 'National Bank of Ras Al-Khaimah', swift8: 'NRAKAEAK', swift11: 'NRAKAEAKXXX', routingCode: '104060106', entityType: 'BK' }],
  ['041', { entityId: '041', name: 'Sharjah Islamic Bank', swift8: 'NBSHAEAS', swift11: 'NBSHAEASXXX', routingCode: '404130101', entityType: 'BK' }],
  ['042', { entityId: '042', name: 'National Bank Of Umm Al Qaiwain', swift8: 'UMMQAEAD', swift11: 'UMMQAEADXXX', routingCode: '104251001', entityType: 'BK' }],
  ['043', { entityId: '043', name: 'Industrial and Commercial Bank of China', swift8: 'ICBKAEAA', swift11: 'ICBKAEAAXXX', routingCode: '804310101', entityType: 'BK' }],
  ['044', { entityId: '044', name: 'Standard Chartered Bank', swift8: 'SCBLAEAD', swift11: 'SCBLAEADXXX', routingCode: '504420120', entityType: 'BK' }],
  ['045', { entityId: '045', name: 'First Abu Dhabi Bank', swift8: 'UNBEAEAA', swift11: 'UNBEAEAAXXX', routingCode: '704510131', entityType: 'BK' }],
  ['046', { entityId: '046', name: 'United Arab Bank', swift8: 'UARBAEAA', swift11: 'UARBAEAAXXX', routingCode: '904630101', entityType: 'BK' }],
  ['047', { entityId: '047', name: 'United Bank Ltd.', swift8: 'UNILAEAD', swift11: 'UNILAEADXXX', routingCode: '604720106', entityType: 'BK' }],
  ['049', { entityId: '049', name: 'Deutsche Bank', swift8: 'DEUTAEAA', swift11: 'DEUTAEAAXXX', routingCode: '204910101', entityType: 'BK' }],
  ['050', { entityId: '050', name: 'Abu Dhabi Islamic Bank', swift8: 'ABDIAEAD', swift11: 'ABDIAEADXXX', routingCode: '405010101', entityType: 'BK' }],
  ['051', { entityId: '051', name: 'Dubai Bank', swift8: 'DBXPAEAD', swift11: 'DBXPAEADXXX', routingCode: '005120101', entityType: 'BK' }],
  ['052', { entityId: '052', name: 'Noor Islamic Bank', swift8: 'NISLAEAD', swift11: 'NISLAEADXXX', routingCode: '905220101', entityType: 'BK' }],
  ['053', { entityId: '053', name: 'Al Hilal Bank', swift8: 'HLALAEAA', swift11: 'HLALAEAAXXX', routingCode: '105310101', entityType: 'BK' }],
  ['054', { entityId: '054', name: 'Doha Bank', swift8: 'DOHBAEAD', swift11: 'DOHBAEADXXX', routingCode: '705420101', entityType: 'BK' }],
  ['055', { entityId: '055', name: 'SAMBA Financial Group', swift8: 'SAMBAEAD', swift11: 'SAMBAEADXXX', routingCode: '605520101', entityType: 'BK' }],
  ['056', { entityId: '056', name: 'National Bank Of Kuwait', swift8: 'NBOKAEAD', swift11: 'NBOKAEADXXX', routingCode: '505620101', entityType: 'BK' }],
  ['057', { entityId: '057', name: 'Ajman Bank', swift8: 'AJMNAEAJ', swift11: 'AJMNAEAJXXX', routingCode: '805740101', entityType: 'BK' }],
  ['086', { entityId: '086', name: 'Wio Bank', swift8: 'WIOBAEAD', swift11: 'WIOBAEADXXX', routingCode: '808610001', entityType: 'BK' }],

  // Finance Companies (FC)
  ['081', { entityId: '081', name: 'Finance House', swift8: 'FHOUAEAD', swift11: 'FHOUAEADXXX', routingCode: '208110101', entityType: 'FC' }],
  ['082', { entityId: '082', name: 'Dunia Finance', swift8: 'E082XXXX', swift11: 'E082XXXXXXX', routingCode: '108210101', entityType: 'FC' }],
  ['083', { entityId: '083', name: 'Islamic Finance Company', swift8: 'E083XXXX', swift11: 'E083XXXXXXX', routingCode: '008310101', entityType: 'FC' }],
  ['113', { entityId: '113', name: 'Siraj Finance PJSC', swift8: 'SRAJAEAA', swift11: 'SRAJAEAAXXX', routingCode: '711310001', entityType: 'FC' }],

  // Additional banks
  ['092', { entityId: '092', name: 'Gulf International Bank', swift8: 'GULFAEAA', swift11: 'GULFAEAAXXX', routingCode: '509210001', entityType: 'BK' }],
  ['093', { entityId: '093', name: 'Intesa Sanpaolo', swift8: 'BCITAEAB', swift11: 'BCITAEABXXX', routingCode: '309314334', entityType: 'BK' }],
  ['097', { entityId: '097', name: 'Al Maryah Community Bank', swift8: 'E097AEXX', swift11: 'E097AEXXXXX', routingCode: '009710001', entityType: 'BK' }],

  // Exchange Houses (EX)
  ['205', { entityId: '205', name: 'Al Ahalia Money Exchange Bureau', swift8: 'E205XXXX', swift11: 'E205XXXXXXX', routingCode: '820510101', entityType: 'EX' }],
  ['206', { entityId: '206', name: 'Al Ansari Exchange', swift8: 'ALANAEAA', swift11: 'ALANAEAAXXX', routingCode: '720610101', entityType: 'EX' }],
  ['209', { entityId: '209', name: 'Al Bader Exchange', swift8: 'E209XXXX', swift11: 'E209XXXXXXX', routingCode: '420910101', entityType: 'EX' }],
  ['214', { entityId: '214', name: 'Al Falah Exchange Co', swift8: 'E214XXXX', swift11: 'E214XXXXXXX', routingCode: '221410101', entityType: 'EX' }],
  ['215', { entityId: '215', name: 'Al Fardan Exchange', swift8: 'FEXEAEAA', swift11: 'FEXEAEAAXXX', routingCode: '121510101', entityType: 'EX' }],
  ['216', { entityId: '216', name: 'Al Fuad Exchange', swift8: 'ALFXAEAD', swift11: 'ALFXAEADXXX', routingCode: '021610101', entityType: 'EX' }],
  ['217', { entityId: '217', name: 'Al Gergawi Exchange', swift8: 'E217XXXX', swift11: 'E217XXXXXXX', routingCode: '921710101', entityType: 'EX' }],
  ['218', { entityId: '218', name: 'Al Ghurair Exchange', swift8: 'E218XXXX', swift11: 'E218XXXXXXX', routingCode: '821810101', entityType: 'EX' }],
  ['219', { entityId: '219', name: 'Al Ghurair International Exchange', swift8: 'E219XXXX', swift11: 'E219XXXXXXX', routingCode: '721910101', entityType: 'EX' }],
  ['232', { entityId: '232', name: 'Al Razouki International Exchange', swift8: 'E232XXXX', swift11: 'E232XXXXXXX', routingCode: '023210101', entityType: 'EX' }],
  ['233', { entityId: '233', name: 'Al Zari & Al Fardan Exchange', swift8: 'E233XXXX', swift11: 'E233XXXXXXX', routingCode: '923310101', entityType: 'EX' }],
  ['234', { entityId: '234', name: 'Al Zarooni Exchange', swift8: 'E234XXXX', swift11: 'E234XXXXXXX', routingCode: '823410101', entityType: 'EX' }],
  ['235', { entityId: '235', name: 'Alukkas Exchange', swift8: 'E235XXXX', swift11: 'E235XXXXXXX', routingCode: '723510101', entityType: 'EX' }],
  ['236', { entityId: '236', name: 'Arabian Exchange Co.', swift8: 'E236XXXX', swift11: 'E236XXXXXXX', routingCode: '623610101', entityType: 'EX' }],
  ['238', { entityId: '238', name: 'Asia Exchange Centre', swift8: 'E238XXXX', swift11: 'E238XXXXXXX', routingCode: '423810101', entityType: 'EX' }],
  ['245', { entityId: '245', name: 'City Exchange', swift8: 'E245XXXX', swift11: 'E245XXXXXXX', routingCode: '024510101', entityType: 'EX' }],
  ['246', { entityId: '246', name: 'Deniba International Exchange', swift8: 'E246XXXX', swift11: 'E246XXXXXXX', routingCode: '924610101', entityType: 'EX' }],
  ['249', { entityId: '249', name: 'Dubai Exchange Centre', swift8: 'E249XXXX', swift11: 'E249XXXXXXX', routingCode: '624910101', entityType: 'EX' }],
  ['252', { entityId: '252', name: 'Emirates India International Exchange', swift8: 'EIIEAEAD', swift11: 'EIIEAEADXXX', routingCode: '625210101', entityType: 'EX' }],
  ['253', { entityId: '253', name: 'Federal Exchange', swift8: 'E253XXXX', swift11: 'E253XXXXXXX', routingCode: '525310101', entityType: 'EX' }],
  ['254', { entityId: '254', name: 'First Gulf Exchange Centre', swift8: 'E254XXXX', swift11: 'E254XXXXXXX', routingCode: '425410101', entityType: 'EX' }],
  ['256', { entityId: '256', name: 'Gulf Express Exchange', swift8: 'E256XXXX', swift11: 'E256XXXXXXX', routingCode: '225610101', entityType: 'EX' }],
  ['258', { entityId: '258', name: 'Habib Exchange Co.', swift8: 'E258XXXX', swift11: 'E258XXXXXXX', routingCode: '025810101', entityType: 'EX' }],
  ['259', { entityId: '259', name: 'Hadi Express Exchange', swift8: 'E259XXXX', swift11: 'E259XXXXXXX', routingCode: '925910101', entityType: 'EX' }],
  ['267', { entityId: '267', name: 'Lari Exchange', swift8: 'LAEEAEAA', swift11: 'LAEEAEAAXXX', routingCode: '426710101', entityType: 'EX' }],
  ['268', { entityId: '268', name: 'Leela Megh Exchange', swift8: 'E268XXXX', swift11: 'E268XXXXXXX', routingCode: '326810101', entityType: 'EX' }],
  ['269', { entityId: '269', name: 'Malik Exchange', swift8: 'E269XXXX', swift11: 'E269XXXXXXX', routingCode: '226910101', entityType: 'EX' }],
  ['270', { entityId: '270', name: 'Multinet Trust Exchange', swift8: 'E270XXXX', swift11: 'E270XXXXXXX', routingCode: '427010101', entityType: 'EX' }],
  ['273', { entityId: '273', name: 'National Exchange Co.', swift8: 'E273XXXX', swift11: 'E273XXXXXXX', routingCode: '127310101', entityType: 'EX' }],
  ['275', { entityId: '275', name: 'Orient Exchange Co.', swift8: 'OECOAEAD', swift11: 'OECOAEADXXX', routingCode: '927510101', entityType: 'EX' }],
  ['277', { entityId: '277', name: 'Redha Al Ansari Exchange', swift8: 'E277XXXX', swift11: 'E277XXXXXXX', routingCode: '727710101', entityType: 'EX' }],
  ['279', { entityId: '279', name: 'Saad Exchange', swift8: 'E279XXXX', swift11: 'E279XXXXXXX', routingCode: '527910101', entityType: 'EX' }],
  ['281', { entityId: '281', name: 'Sajwani Exchange', swift8: 'E281XXXX', swift11: 'E281XXXXXXX', routingCode: '628110101', entityType: 'EX' }],
  ['285', { entityId: '285', name: 'Shaheen Money Exchange', swift8: 'E285XXXX', swift11: 'E285XXXXXXX', routingCode: '228510101', entityType: 'EX' }],
  ['286', { entityId: '286', name: 'Sharjah International Exchange', swift8: 'E286XXXX', swift11: 'E286XXXXXXX', routingCode: '128610101', entityType: 'EX' }],
  ['289', { entityId: '289', name: 'Alneel Exchange', swift8: 'E289XXXX', swift11: 'E289XXXXXXX', routingCode: '828910101', entityType: 'EX' }],
  ['290', { entityId: '290', name: 'Al Rostamani International Exchange', swift8: 'E290XXXX', swift11: 'E290XXXXXXX', routingCode: '029010101', entityType: 'EX' }],
  ['291', { entityId: '291', name: 'UAE Exchange Center', swift8: 'UAEXAEAA', swift11: 'UAEXAEAAXXX', routingCode: '929110101', entityType: 'EX' }],
  ['293', { entityId: '293', name: 'Universal Exchange Centre', swift8: 'UECEAEAD', swift11: 'UECEAEADXXX', routingCode: '729310101', entityType: 'EX' }],
  ['294', { entityId: '294', name: 'Wall Street Exchange Centre', swift8: 'WSEEAEAD', swift11: 'WSEEAEADXXX', routingCode: '629410101', entityType: 'EX' }],
  ['301', { entityId: '301', name: 'GCC Exchange', swift8: 'E301XXXX', swift11: 'E301XXXXXXX', routingCode: '930110101', entityType: 'EX' }],
  ['303', { entityId: '303', name: 'Belhasa Global Exchange', swift8: 'E303XXXX', swift11: 'E303XXXXXXX', routingCode: '730310101', entityType: 'EX' }],
  ['308', { entityId: '308', name: 'Al Nebal International Exchange', swift8: 'E308XXXX', swift11: 'E308XXXXXXX', routingCode: '230810101', entityType: 'EX' }],
  ['312', { entityId: '312', name: 'Delma Exchange', swift8: 'E312XXXX', swift11: 'E312XXXXXXX', routingCode: '131210101', entityType: 'EX' }],
  ['313', { entityId: '313', name: 'Sharaf Exchange', swift8: 'E313XXXX', swift11: 'E313XXXXXXX', routingCode: '031310101', entityType: 'EX' }],
  ['314', { entityId: '314', name: 'Lulu Exchange', swift8: 'E314XXXX', swift11: 'E314XXXXXXX', routingCode: '931410101', entityType: 'EX' }],
  ['316', { entityId: '316', name: 'Al Jaber Exchange', swift8: 'E316XXXX', swift11: 'E316XXXXXXX', routingCode: '731610101', entityType: 'EX' }],

  // GPSSA
  ['851', { entityId: '851', name: 'GPSSA – Pension Contributions', swift8: 'E851XXXX', swift11: 'E851XXXXXXX', routingCode: '985110101', entityType: 'BK' }],
]);

/**
 * Check if an IBAN starts with AE (UAE).
 */
export function isUaeIban(iban: string): boolean {
  const clean = iban.replace(/\s/g, '').toUpperCase();
  return clean.startsWith('AE') && clean.length === 23;
}

/**
 * Validate IBAN format. Supports UAE (23 chars) and international (15-34 chars).
 */
export function validateIbanFormat(iban: string): { valid: boolean; message?: string } {
  const clean = iban.replace(/\s/g, '').toUpperCase();

  if (!clean) {
    return { valid: false, message: 'IBAN is required' };
  }

  if (!/^[A-Z]{2}/.test(clean)) {
    return { valid: false, message: 'IBAN must start with a country code (e.g. AE)' };
  }

  if (clean.startsWith('AE')) {
    if (clean.length !== 23) {
      return { valid: false, message: 'UAE IBAN must be 23 characters (AE + 21 digits)' };
    }
    if (!/^AE\d{21}$/.test(clean)) {
      return { valid: false, message: 'UAE IBAN must be AE followed by 21 digits' };
    }
    return { valid: true };
  }

  if (clean.length < 15 || clean.length > 34) {
    return { valid: false, message: 'IBAN must be 15-34 characters' };
  }
  if (!/^[A-Z]{2}\d{2}/.test(clean)) {
    return { valid: false, message: 'IBAN must start with country code + 2 check digits' };
  }

  return { valid: true };
}

/**
 * Look up bank details from a UAE IBAN.
 * Returns null if IBAN is not UAE or bank code is not in directory.
 */
export function lookupBankFromIban(iban: string): UaeBankInfo | null {
  const clean = iban.replace(/\s/g, '').toUpperCase();
  if (!isUaeIban(clean)) return null;
  const bankCode = clean.substring(4, 7);
  return UAE_BANK_DIRECTORY.get(bankCode) ?? null;
}

/**
 * Format IBAN for display: AExx xxx xxxx xxxx xxxx xxxx
 */
export function formatIbanDisplay(iban: string): string {
  const c = iban.replace(/\s/g, '').toUpperCase();
  if (c.length <= 4) return c;
  if (c.length <= 7) return `${c.slice(0, 4)} ${c.slice(4)}`;
  let out = `${c.slice(0, 4)} ${c.slice(4, 7)}`;
  for (let i = 7; i < c.length; i += 4) {
    out += ` ${c.slice(i, i + 4)}`;
  }
  return out;
}
