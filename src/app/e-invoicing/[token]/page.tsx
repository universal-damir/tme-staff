'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Button,
  Card,
  ClientPageHeader,
  CustomDropdown,
  FormFooter,
  Input,
  PageBody,
  StatusChip,
} from '@/components/ui';
import { requestJson, failureMessage, FAILURE_MESSAGES } from '@/lib/request-outcome';
import { uploadFileToRoute } from '@/lib/upload-client';
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  AlertCircle,
  UploadCloud,
  FileText,
  FileCode2,
  Info,
  Trash2,
} from 'lucide-react';

type XmlCapability = 'yes' | 'maybe' | 'no';

interface SoftwareGuidance {
  xml: XmlCapability;
  note: string;
}

type PageState =
  | 'loading'
  | 'form'
  | 'success'
  | 'already_submitted'
  | 'not_found'
  | 'closed' // cancelled / expired
  | 'error';

interface UploadedFile {
  filename: string;
  channel: 'digital_xml' | 'physical';
}

interface IntakeData {
  company_name: string | null;
  status: string;
  price_aed: number | null;
  accounting_software: string | null;
  accounting_software_other: string | null;
  no_invoices_issued?: boolean;
  files: UploadedFile[];
  software_options: string[];
  software_guidance?: Record<string, SoftwareGuidance>;
}

const ACCEPT = '.pdf,.xml,application/pdf,application/xml,text/xml,image/jpeg,image/png,image/webp';

const PAGE_TITLE = 'E-invoicing readiness pre-assessment';

// NOTE: Frame and StatusView are defined at MODULE scope (not inside the page
// component). Defining them inline would give them a new identity on every
// render, so React would remount the whole subtree on each keystroke and the
// "Other" text input would lose focus after one character.
function Frame({
  title = PAGE_TITLE,
  companyName,
  children,
}: {
  title?: string;
  companyName?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-tme-page">
      <ClientPageHeader eyebrow="E-invoicing" title={title} subtitle={companyName || undefined} />
      <PageBody>{children}</PageBody>
    </div>
  );
}

/** One centred message (loading, link problems, thank you). */
function StatusView({
  icon,
  heading,
  children,
}: {
  icon: React.ReactNode;
  heading: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center py-8 text-center">
        {icon}
        <h2 className="text-xl font-semibold mb-2 text-tme-blue sm:text-lg">{heading}</h2>
        {children}
      </div>
    </Card>
  );
}

// Contextual hint shown once a client picks their accounting system: whether it
// can export the structured XML that UAE e-invoicing needs, and roughly how. The
// content is TME's estimate from vendor docs (see ACCOUNTING_SOFTWARE_GUIDANCE);
// kept reassuring so a "no" never reads as a dead end.
function XmlGuidance({ software, guidance }: { software: string; guidance: SoftwareGuidance }) {
  // Deliberately no "green / good news" box for software that CAN export XML:
  // telling a client their system is capable reads as "you're already ready /
  // compliant", which they aren't — the pre-assessment still has to run. Only
  // the softer "usually can" / "we'll help" guidance is shown.
  if (guidance.xml === 'yes') return null;

  const tone =
    guidance.xml === 'maybe'
      ? { Icon: FileCode2, headline: `${software} can usually export invoices as XML` }
      : { Icon: Info, headline: "We'll help you get export-ready" };

  const { Icon } = tone;
  return (
    <div className="mt-3 rounded-xl p-4 flex gap-3 bg-blue-50/60 border border-blue-100">
      <Icon className="w-5 h-5 shrink-0 mt-0.5 text-tme-blue" aria-hidden />
      <div>
        <p className="text-[15px] font-semibold text-tme-blue sm:text-sm">{tone.headline}</p>
        <p className="text-[15px] text-gray-700 mt-1 leading-relaxed sm:text-[13px]">{guidance.note}</p>
      </div>
    </div>
  );
}

export default function EInvoicingIntakePage() {
  const params = useParams();
  const token = String(params?.token ?? '');

  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<IntakeData | null>(null);
  const [software, setSoftware] = useState('');
  const [softwareOther, setSoftwareOther] = useState('');
  const [priceAgreed, setPriceAgreed] = useState(false);
  const [noInvoices, setNoInvoices] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why the form could not be loaded (offline, server error, ...).
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const outcome = await requestJson<IntakeData>(
        `/api/e-invoicing/${token}`,
        {},
        { form: 'e-invoicing', action: 'load', ref: token }
      );
      if (cancelled) return;
      if (!outcome.ok) {
        if (outcome.status === 404) return setState('not_found');
        if (outcome.status === 410) return setState('closed');
        setLoadError(failureMessage(outcome));
        return setState('error');
      }
      const json = outcome.data;
      setData(json);
      setFiles(json.files ?? []);
      setSoftware(json.accounting_software ?? '');
      setSoftwareOther(json.accounting_software_other ?? '');
      setNoInvoices(json.no_invoices_issued === true);
      if (json.status === 'submitted' || json.status === 'synced') {
        setState('already_submitted');
      } else {
        setState('form');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setError(null);
      setUploading(true);
      try {
        for (const file of Array.from(fileList)) {
          const outcome = await uploadFileToRoute<{ files?: UploadedFile[] }>(
            `/api/e-invoicing/${token}/upload`,
            {},
            file,
            { form: 'e-invoicing', action: 'upload:invoice', ref: token }
          );
          if (!outcome.ok) {
            const msg =
              outcome.code === 'unsupported_file_type' || outcome.kind === 'wrong_file'
                ? `"${file.name}" is not a PDF, an image or a UBL / PINT-AE XML invoice.`
                : outcome.kind === 'too_large'
                ? `"${file.name}" is too large. Please upload a file smaller than 10 MB.`
                : outcome.code === 'too_many_files'
                ? 'You can upload at most 10 invoices.'
                : `Could not upload "${file.name}". ${failureMessage(outcome)}`;
            setError(msg);
            break;
          }
          setFiles(outcome.data?.files ?? []);
        }
      } catch {
        setError(FAILURE_MESSAGES.server_error);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [token]
  );

  const handleDelete = useCallback(
    async (index: number) => {
      setError(null);
      setDeletingIndex(index);
      try {
        const outcome = await requestJson<{ files?: UploadedFile[] }>(
          `/api/e-invoicing/${token}/upload?index=${index}`,
          { method: 'DELETE' },
          { form: 'e-invoicing', action: 'remove:invoice', ref: token }
        );
        if (!outcome.ok) {
          setError(`Could not remove that file. ${failureMessage(outcome)}`);
          return;
        }
        setFiles(outcome.data?.files ?? []);
      } finally {
        setDeletingIndex(null);
      }
    },
    [token]
  );

  // When a fee was quoted, the client must tick "I agree to the price" —
  // except receive-only clients: they get no pre-assessment, so no fee.
  const priceRequired = data?.price_aed != null && !noInvoices;
  const canSubmit =
    // Receive-only clients don't need to name a system (there is no issuance
    // setup to assess) — but a half-filled "Other" still needs its free text.
    (noInvoices ? !software || software !== 'Other' || softwareOther.trim().length > 0
                : !!software && (software !== 'Other' || softwareOther.trim().length > 0)) &&
    // Receive-only clients (no invoices issued) may submit without uploads —
    // they still need an ASP appointment, so the intake must go through.
    (noInvoices || files.length > 0) &&
    (!priceRequired || priceAgreed) &&
    !uploading &&
    deletingIndex === null &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    const outcome = await requestJson(
      `/api/e-invoicing/${token}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounting_software: software,
          accounting_software_other: software === 'Other' ? softwareOther.trim() : undefined,
          price_agreed: priceAgreed,
          no_invoices_issued: noInvoices,
        }),
      },
      { form: 'e-invoicing', action: 'submit', ref: token }
    );
    if (!outcome.ok) {
      setError(
        outcome.code === 'no_invoices_uploaded'
          ? 'Please upload at least one invoice before submitting.'
          : outcome.code === 'price_not_agreed'
            ? 'Please agree to the pre-assessment fee before submitting.'
            : `Could not submit. ${failureMessage(outcome)}`
      );
      setSubmitting(false);
      return;
    }
    setState('success');
  }, [canSubmit, token, software, softwareOther, priceAgreed, noInvoices]);

  if (state === 'loading') {
    return (
      <Frame>
        <StatusView icon={<Loader2 className="w-8 h-8 animate-spin mb-3 text-tme-blue" aria-hidden />} heading="Loading…" />
      </Frame>
    );
  }

  if (state === 'error') {
    return (
      <Frame>
        <StatusView
          icon={<XCircle className="w-12 h-12 mb-4 text-tme-red" aria-hidden />}
          heading="We could not open the form"
        >
          <p className="text-base text-gray-600 sm:text-[15px]">{loadError}</p>
        </StatusView>
      </Frame>
    );
  }

  if (state === 'not_found') {
    return (
      <Frame>
        <StatusView
          icon={<XCircle className="w-12 h-12 mb-4 text-tme-red" aria-hidden />}
          heading="This link isn’t valid"
        >
          <p className="text-base text-gray-600 sm:text-[15px]">
            The link may be incorrect. Please use the link from your TME email, or contact your TME
            consultant.
          </p>
        </StatusView>
      </Frame>
    );
  }

  if (state === 'closed') {
    return (
      <Frame>
        <StatusView
          icon={<AlertTriangle className="w-12 h-12 mb-4 text-amber-600" aria-hidden />}
          heading="This link has expired"
        >
          <p className="text-base text-gray-600 sm:text-[15px]">Please contact your TME consultant to receive a fresh link.</p>
        </StatusView>
      </Frame>
    );
  }

  if (state === 'success' || state === 'already_submitted') {
    // noInvoices is set from the GET response for the already-submitted view,
    // and from the live checkbox state right after a fresh submit.
    return (
      <Frame companyName={data?.company_name}>
        <StatusView
          icon={<CheckCircle className="w-12 h-12 mb-4 text-green-700" aria-hidden />}
          heading="Thank you — we’ve received your submission"
        >
          {noInvoices ? (
            <p className="text-base text-gray-600 max-w-md leading-relaxed sm:text-[15px]">
              You confirmed that your company does not issue any invoices. Every business with a UAE
              license must still appoint an Accredited Service Provider (ASP), the company that
              exchanges your e-invoices and reports them to the tax authority. This applies even if
              you only receive supplier invoices. TME Services is building UAE e-invoicing software
              and plans to become an ASP before the end of 2026. There is nothing you need to do now.
              We will contact you when the ASP registration moves forward.
            </p>
          ) : (
            <p className="text-base text-gray-600 max-w-md leading-relaxed sm:text-[15px]">
              Our team will review your invoices and accounting setup, and your TME consultant will
              be in touch with the next steps. No further action is needed from you right now.
            </p>
          )}
        </StatusView>
      </Frame>
    );
  }

  // ---------- Form ----------
  const softwareOptions = (data?.software_options ?? []).map((o) => ({ value: o, label: o }));
  const guidance =
    software && software !== 'Other' ? data?.software_guidance?.[software] ?? null : null;
  const showUploads = !noInvoices || files.length > 0;
  return (
    <Frame companyName={data?.company_name}>
      <Card>
        <p className="text-base text-gray-700 leading-relaxed sm:text-sm">
          The UAE is introducing mandatory e-invoicing. To pre-assess how ready your business is, we
          need just two things from you: the accounting system you use and a range of sample invoices.
          The more invoice types you share, the more precisely we can pinpoint your gap. Your files are
          used only for this pre-assessment and are never shared.
        </p>

        {/* Receive-only declaration: waives the upload requirement, never the
            assessment itself — every licensed business still needs an ASP. */}
        <label className="mt-5 flex items-start gap-3 rounded-[10px] border-2 border-gray-200 p-3.5 cursor-pointer sm:gap-2.5 sm:rounded-lg sm:border sm:border-gray-300 sm:p-3 has-[:checked]:border-tme-blue has-[:checked]:bg-blue-50/50">
          <input
            type="checkbox"
            checked={noInvoices}
            onChange={(e) => setNoInvoices(e.target.checked)}
            disabled={uploading || submitting}
            className="mt-0.5 w-5 h-5 shrink-0 accent-tme-blue sm:w-4 sm:h-4"
          />
          <span className="text-[15px] text-gray-800 leading-snug sm:text-sm">
            We confirm that our company does not issue any invoices to clients or business partners.
            We only receive supplier invoices.
          </span>
        </label>

        {noInvoices && (
          <div className="mt-3 rounded-xl p-4 flex gap-3 bg-blue-50/60 border border-blue-100">
            <Info className="w-5 h-5 shrink-0 mt-0.5 text-tme-blue" aria-hidden />
            <div>
              <p className="text-[15px] font-semibold text-tme-blue sm:text-sm">
                You still need an Accredited Service Provider (ASP)
              </p>
              <p className="text-[15px] text-gray-700 mt-1 leading-relaxed sm:text-[13px]">
                An ASP is the company that exchanges your e-invoices and reports them to the tax
                authority. Every business with a UAE license must appoint one, even if it only
                receives supplier invoices. If your yearly revenue is below AED 50 million, the
                deadline to appoint an ASP is 31.03.2027 and e-invoicing starts on 01.07.2027. If you
                use an accounting or bookkeeping system, you can tell us below (optional).
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card title={noInvoices ? 'Your accounting system' : 'Your invoicing system'}>
        <CustomDropdown
          label={
            noInvoices
              ? 'Which accounting or bookkeeping system do you use? (optional)'
              : 'Which invoicing system do you use?'
          }
          value={software}
          onChange={setSoftware}
          options={softwareOptions}
          placeholder="Select…"
        />
        {software === 'Other' && (
          <div className="mt-3">
            <Input
              label="Name of your system"
              value={softwareOther}
              onChange={(e) => setSoftwareOther(e.target.value)}
              placeholder="Please specify your system"
            />
          </div>
        )}
        {!noInvoices && guidance && <XmlGuidance software={software} guidance={guidance} />}
      </Card>

      {/* Invoice upload — hidden for receive-only clients, except that files
          uploaded BEFORE ticking the declaration stay listed and deletable
          (they would otherwise be stuck on the submission, invisible). */}
      {showUploads && (
        <Card title={noInvoices ? 'Files you uploaded' : 'Sample invoices (XML file preferred)'}>
          {!noInvoices && (
            <>
              <p className="text-[15px] text-gray-700 leading-relaxed mb-4 sm:text-sm">
                Upload 1 to 10 recent invoices. To help us find your gap more precisely, please
                include different types where you have them: standard tax invoices, credit notes,
                commercial invoices, and advance or cost-recharge invoices. XML files (the structured
                e-invoice file your system can export) give the most accurate result. PDF is fine too,
                although results may vary.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-2 border-dashed border-tme-line rounded-xl">
                <div className="flex items-start gap-3 flex-[1_1_200px] min-w-0">
                  <UploadCloud className="w-[22px] h-[22px] shrink-0 mt-0.5 text-tme-blue" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-gray-900 sm:text-sm">Your sample invoices</p>
                    <p className="text-sm text-gray-600 sm:text-[13px]">XML, PDF, JPG, PNG or WEBP, up to 10 MB each.</p>
                  </div>
                </div>
                <Button
                  tone="secondary"
                  busy={uploading}
                  onClick={() => inputRef.current?.click()}
                  className="w-full sm:w-auto"
                >
                  {uploading ? 'Uploading…' : 'Upload file'}
                </Button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </>
          )}

          {noInvoices && files.length > 0 && (
            <p className="text-[15px] text-gray-700 leading-relaxed sm:text-sm">
              You uploaded sample invoices before confirming the declaration above. They will not
              be reviewed. You can remove them below.
            </p>
          )}

          {files.length > 0 && (
            <ul className="mt-4 space-y-2">
              {files.map((f, i) => (
                <li
                  key={`${f.filename}-${i}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-3 pr-1 py-1 rounded-[10px] border border-gray-200"
                >
                  {f.channel === 'digital_xml' ? (
                    <FileCode2 className="w-5 h-5 shrink-0 text-tme-blue" aria-hidden />
                  ) : (
                    <FileText className="w-5 h-5 shrink-0 text-tme-blue" aria-hidden />
                  )}
                  <span className="text-[15px] text-gray-800 break-all flex-1 min-w-0 sm:text-sm">{f.filename}</span>
                  <StatusChip tone="blue">{f.channel === 'digital_xml' ? 'XML' : 'PDF / image'}</StatusChip>
                  <Button
                    tone="dangerGhost"
                    onClick={() => handleDelete(i)}
                    disabled={deletingIndex !== null || uploading || submitting}
                    aria-label={`Remove ${f.filename}`}
                    className="w-11 shrink-0 px-0! sm:w-9 sm:min-h-9!"
                  >
                    {deletingIndex === i ? (
                      <Loader2 className="w-5 h-5 animate-spin sm:w-4 sm:h-4" aria-hidden />
                    ) : (
                      <Trash2 className="w-5 h-5 sm:w-4 sm:h-4" aria-hidden />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Send to TME">
        <div className="space-y-4">
          {data?.price_aed != null && !noInvoices && (
            <label className="flex items-start gap-3 rounded-[10px] border-2 border-gray-200 p-3.5 cursor-pointer sm:gap-2.5 sm:rounded-lg sm:border sm:border-gray-300 sm:p-3 has-[:checked]:border-tme-blue has-[:checked]:bg-blue-50/50">
              <input
                type="checkbox"
                checked={priceAgreed}
                onChange={(e) => setPriceAgreed(e.target.checked)}
                className="mt-0.5 w-5 h-5 shrink-0 accent-tme-blue sm:w-4 sm:h-4"
              />
              <span className="text-[15px] text-gray-800 leading-snug sm:text-sm">
                I agree to the pre-assessment fee of{' '}
                <strong className="text-tme-blue">AED {data.price_aed.toLocaleString('en-US')}</strong>{' '}
                (plus 5% VAT). The fee will be invoiced together with your pre-assessment report.
              </span>
            </label>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm font-medium text-tme-red sm:text-[13px]"
            >
              <AlertCircle className="w-[18px] h-[18px] shrink-0 mt-px" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <FormFooter>
            <Button tone="primary" size="lg" onClick={handleSubmit} disabled={!canSubmit} busy={submitting} fullWidthOnMobile>
              {submitting ? 'Submitting…' : noInvoices ? 'Send my answers to TME' : 'Send invoices for review'}
            </Button>
          </FormFooter>
        </div>
      </Card>
    </Frame>
  );
}
