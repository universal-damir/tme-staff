import { describe, expect, it } from 'vitest';
import { detectInvoiceFile } from './invoice-file-validation';

const enc = (s: string) => new TextEncoder().encode(s);

const UBL_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- exported by Odoo -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-001</cbc:ID>
  <cbc:IssueDate>2026-10-01</cbc:IssueDate>
</Invoice>`;

const UBL_CREDIT_NOTE_PREFIXED = `﻿<?xml version="1.0"?>
<ubl:CreditNote xmlns:ubl='urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>CN-001</cbc:ID>
</ubl:CreditNote>`;

describe('detectInvoiceFile XML', () => {
  it('accepts a UBL invoice (default namespace, declaration + comment first)', () => {
    expect(detectInvoiceFile(enc(UBL_INVOICE))).toEqual({
      ext: '.xml', mime: 'application/xml', channel: 'digital_xml',
    });
  });

  it('accepts a prefixed UBL credit note with a BOM', () => {
    expect(detectInvoiceFile(enc(UBL_CREDIT_NOTE_PREFIXED))?.ext).toBe('.xml');
  });

  it('refuses HTML with a script', () => {
    expect(detectInvoiceFile(enc('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectInvoiceFile(enc('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body/></html>'))).toBeNull();
  });

  it('refuses a UBL invoice carrying a script, XHTML or SVG element', () => {
    const withScript = UBL_INVOICE.replace('</Invoice>', '<x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)</x:script></Invoice>');
    expect(detectInvoiceFile(enc(withScript))).toBeNull();
    const withSvg = UBL_INVOICE.replace('</Invoice>', '<s:svg xmlns:s="http://www.w3.org/2000/svg" onload="alert(1)"/></Invoice>');
    expect(detectInvoiceFile(enc(withSvg))).toBeNull();
    const withXslt = UBL_INVOICE.replace('?>', '?><?xml-stylesheet type="text/xsl" href="x.xsl"?>');
    expect(detectInvoiceFile(enc(withXslt))).toBeNull();
  });

  it('refuses a DOCTYPE (XXE)', () => {
    const xxe = UBL_INVOICE.replace(
      '<!-- exported by Odoo -->',
      '<!DOCTYPE Invoice [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
    );
    expect(detectInvoiceFile(enc(xxe))).toBeNull();
  });

  it('refuses random XML and Invoice roots outside the UBL namespace', () => {
    expect(detectInvoiceFile(enc('<?xml version="1.0"?><note><to>x</to></note>'))).toBeNull();
    expect(detectInvoiceFile(enc('<Invoice><ID>1</ID></Invoice>'))).toBeNull();
    expect(detectInvoiceFile(enc('<Invoice xmlns="urn:example:other"><ID>1</ID></Invoice>'))).toBeNull();
    // Invoice namespace on a CreditNote root, and a prefix bound to nothing.
    expect(detectInvoiceFile(enc('<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'))).toBeNull();
    expect(detectInvoiceFile(enc('<a:Invoice xmlns:b="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'))).toBeNull();
    expect(detectInvoiceFile(enc('<InvoiceList xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'))).toBeNull();
  });

  it('refuses a namespace spelled with character references (dodge) and any namespace off the UBL list', () => {
    // http://www.w3.org/1999/xhtml with ':' and 'x' as references.
    const dodge = UBL_INVOICE.replace(
      '</Invoice>',
      '<h:img xmlns:h="http&#58;//www.w3.org/1999/&#x78;html" src="x" onerror="alert(1)"/></Invoice>'
    );
    expect(detectInvoiceFile(enc(dodge))).toBeNull();
    const named = UBL_INVOICE.replace('</Invoice>', '<cbc:Note>&lt;script&gt;alert(1)&lt;/script&gt;</cbc:Note></Invoice>');
    expect(detectInvoiceFile(enc(named))).toBeNull();
    const mathml = UBL_INVOICE.replace('</Invoice>', '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"/></Invoice>');
    expect(detectInvoiceFile(enc(mathml))).toBeNull();
    const vendor = UBL_INVOICE.replace('</Invoice>', '<v:x xmlns:v="urn:example:vendor"/></Invoice>');
    expect(detectInvoiceFile(enc(vendor))).toBeNull();
  });

  it('accepts a signed UBL invoice (UBL extensions, XML Signature, XAdES, xsi)', () => {
    const signed = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent>
    <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"
      xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2"
      xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
      <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:Object>
        <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"/>
      </ds:Object></ds:Signature>
    </sig:UBLDocumentSignatures>
  </ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:ID>A &amp; B &#8211; INV-7</cbc:ID>
</Invoice>`;
    expect(detectInvoiceFile(enc(signed))?.ext).toBe('.xml');
  });

  it('still accepts PDF and images by magic bytes', () => {
    expect(detectInvoiceFile(enc('%PDF-1.7\n'))?.ext).toBe('.pdf');
    expect(detectInvoiceFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext).toBe('.jpg');
  });
});
