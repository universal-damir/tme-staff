'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { CustomDropdown } from '@/components/ui';
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
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

// NOTE: Shell and Header are defined at MODULE scope (not inside the page
// component). Defining them inline would give them a new identity on every
// render, so React would remount the whole subtree on each keystroke and the
// "Other" text input would lose focus after one character.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
        {children}
      </div>
    </div>
  );
}

function Header({ companyName }: { companyName?: string | null }) {
  return (
    <div className="mb-8">
      <div
        className="text-xs font-semibold tracking-wide uppercase mb-2"
        style={{ color: TME_COLORS.secondary }}
      >
        TME Services — E-Invoicing
      </div>
      <h1 className="text-2xl font-bold" style={{ color: TME_COLORS.primary }}>
        E-Invoicing Readiness Pre-Assessment
      </h1>
      {companyName && <p className="text-gray-600 mt-1">{companyName}</p>}
    </div>
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
      ? {
          bg: 'rgba(36,63,123,0.06)',
          color: TME_COLORS.primary,
          Icon: FileCode2,
          headline: `${software} can usually export invoices as XML`,
        }
      : {
          bg: 'rgba(36,63,123,0.04)',
          color: TME_COLORS.primary,
          Icon: Info,
          headline: "We'll help you get export-ready",
        };

  const { Icon } = tone;
  return (
    <div className="mt-3 rounded-xl p-4 flex gap-3" style={{ backgroundColor: tone.bg }}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: tone.color }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: TME_COLORS.primary }}>
          {tone.headline}
        </p>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">{guidance.note}</p>
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/e-invoicing/${token}`);
        if (cancelled) return;
        if (res.status === 404) return setState('not_found');
        if (res.status === 410) return setState('closed');
        if (!res.ok) return setState('error');
        const json: IntakeData = await res.json();
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
      } catch {
        if (!cancelled) setState('error');
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
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch(`/api/e-invoicing/${token}/upload`, {
            method: 'POST',
            body: fd,
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            const code = j?.error ?? 'upload_failed';
            const msg =
              code === 'unsupported_file_type'
                ? `"${file.name}" isn't a PDF, image, or XML invoice.`
                : code === 'file_size_out_of_range'
                ? `"${file.name}" is too large (max 15 MB).`
                : code === 'too_many_files'
                ? 'You can upload at most 10 invoices.'
                : `Could not upload "${file.name}". Please try again.`;
            setError(msg);
            break;
          }
          const j: { files: UploadedFile[] } = await res.json();
          setFiles(j.files ?? []);
        }
      } catch {
        setError('Upload failed — please check your connection and try again.');
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
        const res = await fetch(`/api/e-invoicing/${token}/upload?index=${index}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          setError('Could not remove that file — please try again.');
          return;
        }
        const j: { files: UploadedFile[] } = await res.json();
        setFiles(j.files ?? []);
      } catch {
        setError('Could not remove that file — please check your connection and try again.');
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
    try {
      const res = await fetch(`/api/e-invoicing/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounting_software: software,
          accounting_software_other: software === 'Other' ? softwareOther.trim() : undefined,
          price_agreed: priceAgreed,
          no_invoices_issued: noInvoices,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(
          j?.error === 'no_invoices_uploaded'
            ? 'Please upload at least one invoice before submitting.'
            : j?.error === 'price_not_agreed'
              ? 'Please agree to the pre-assessment fee before submitting.'
              : 'Could not submit — please try again.'
        );
        setSubmitting(false);
        return;
      }
      setState('success');
    } catch {
      setError('Submission failed — please try again.');
      setSubmitting(false);
    }
  }, [canSubmit, token, software, softwareOther, priceAgreed, noInvoices]);

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-16 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: TME_COLORS.primary }} />
          Loading…
        </div>
      </Shell>
    );
  }

  if (state === 'not_found' || state === 'error') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-12 text-center">
          <XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            This link isn’t valid
          </h2>
          <p className="text-gray-600">
            The link may be incorrect. Please use the link from your TME email, or contact your TME
            consultant.
          </p>
        </div>
      </Shell>
    );
  }

  if (state === 'closed') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-12 text-center">
          <AlertTriangle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.secondary }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            This link has expired
          </h2>
          <p className="text-gray-600">
            Please contact your TME consultant to receive a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  if (state === 'success' || state === 'already_submitted') {
    // noInvoices is set from the GET response for the already-submitted view,
    // and from the live checkbox state right after a fresh submit.
    return (
      <Shell>
        <Header companyName={data?.company_name} />
        <div className="flex flex-col items-center py-10 text-center">
          <CheckCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.success }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            Thank you — we’ve received your submission
          </h2>
          {noInvoices ? (
            <p className="text-gray-600 max-w-md">
              You confirmed that your company does not issue any invoices. Please note that every
              entity which holds a UAE license and conducts business must still appoint an
              Accredited Service Provider (ASP), even if it only receives supplier invoices over
              the network. TME Services is developing UAE-compliant e-invoicing software and is in
              the process of becoming an ASP before the end of 2026. Currently there is nothing to
              be done from your side. We will get back to you as soon as we make progress on the
              ASP registration.
            </p>
          ) : (
            <p className="text-gray-600 max-w-md">
              Our team will review your invoices and accounting setup, and your TME consultant will
              be in touch with the next steps. No further action is needed from you right now.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  // ---------- Form ----------
  const softwareOptions = (data?.software_options ?? []).map((o) => ({ value: o, label: o }));
  const guidance =
    software && software !== 'Other' ? data?.software_guidance?.[software] ?? null : null;
  return (
    <Shell>
      <Header companyName={data?.company_name} />

      <p className="text-gray-600 mb-8 text-sm leading-relaxed">
        The UAE is introducing mandatory e-invoicing. To pre-assess how ready your business is, we
        need just two things from you: the accounting system you use and a range of sample invoices.
        The more invoice types you share, the more precisely we can pinpoint your gap. Your files are
        used only for this pre-assessment and are never shared.
      </p>

      {/* Receive-only declaration: waives the upload requirement, never the
          assessment itself — every licensed business still needs an ASP. */}
      <div className="mb-8">
        <label
          className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer"
          style={{ borderColor: TME_COLORS.border }}
        >
          <input
            type="checkbox"
            checked={noInvoices}
            onChange={(e) => setNoInvoices(e.target.checked)}
            disabled={uploading || submitting}
            className="mt-0.5 w-4 h-4 shrink-0"
            style={{ accentColor: TME_COLORS.primary }}
          />
          <span className="text-sm text-gray-700">
            We confirm that our company does not issue any invoices to clients or business partners.
            We only receive supplier invoices.
          </span>
        </label>

        {noInvoices && (
          <div
            className="mt-3 rounded-xl p-4 flex gap-3"
            style={{ backgroundColor: 'rgba(36,63,123,0.06)' }}
          >
            <Info className="w-5 h-5 shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: TME_COLORS.primary }}>
                An ASP appointment is still required
              </p>
              <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                Under the UAE e-invoicing framework, every entity which holds a UAE license and
                conducts business must appoint an Accredited Service Provider (ASP), even if it
                only receives supplier invoices over the network and never issues its own. The
                deadline to appoint an ASP for businesses with revenue below AED 50 million is
                31.03.2027, with go-live on 01.07.2027. If you use an accounting or bookkeeping
                system, you can optionally tell us below.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Accounting software */}
      <div className="mb-8">
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
          <input
            type="text"
            value={softwareOther}
            onChange={(e) => setSoftwareOther(e.target.value)}
            placeholder="Please specify your system"
            className="w-full mt-2 px-3 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200"
            style={{ height: 42 }}
            onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
            onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
          />
        )}
        {!noInvoices && guidance && <XmlGuidance software={software} guidance={guidance} />}
      </div>

      {/* Invoice upload — hidden for receive-only clients, except that files
          uploaded BEFORE ticking the declaration stay listed and deletable
          (they would otherwise be stuck on the submission, invisible). */}
      {(!noInvoices || files.length > 0) && (
      <div className="mb-6">
        {!noInvoices && (
        <>
        <label className="block text-sm font-medium mb-1" style={{ color: TME_COLORS.primary }}>
          Sample invoices (XML file preferred)
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Upload 1–10 recent invoices. To help us determine your gap more precisely, please include a
          variety where you have them — standard tax invoices, credit notes, commercial invoices, and
          advance / cost-recharge invoices. XML (e-invoice) files give the most accurate result, but
          PDF is fine too, although results may vary.
        </p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed rounded-xl py-8 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-60"
          style={{ borderColor: TME_COLORS.border }}
        >
          {uploading ? (
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: TME_COLORS.primary }} />
          ) : (
            <UploadCloud className="w-6 h-6" style={{ color: TME_COLORS.primary }} />
          )}
          <span className="text-sm text-gray-600">
            {uploading ? 'Uploading…' : 'Click to choose files'}
          </span>
        </button>
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
          <p className="text-xs text-gray-500 mb-1">
            You uploaded sample invoices before confirming the declaration above. They will not
            be reviewed. You can remove them below.
          </p>
        )}

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((f, i) => (
              <li
                key={`${f.filename}-${i}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100"
              >
                {f.channel === 'digital_xml' ? (
                  <FileCode2 className="w-5 h-5 shrink-0" style={{ color: TME_COLORS.primary }} />
                ) : (
                  <FileText className="w-5 h-5 shrink-0" style={{ color: TME_COLORS.primary }} />
                )}
                <span className="text-sm text-gray-700 truncate flex-1">{f.filename}</span>
                <span
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(36,63,123,0.08)', color: TME_COLORS.primary }}
                >
                  {f.channel === 'digital_xml' ? 'XML' : 'PDF / image'}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(i)}
                  disabled={deletingIndex !== null || uploading || submitting}
                  aria-label={`Remove ${f.filename}`}
                  title="Remove this file"
                  className="shrink-0 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {deletingIndex === i ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {data?.price_aed != null && !noInvoices && (
        <label
          className="mb-4 flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer"
          style={{ borderColor: TME_COLORS.border }}
        >
          <input
            type="checkbox"
            checked={priceAgreed}
            onChange={(e) => setPriceAgreed(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0"
            style={{ accentColor: TME_COLORS.primary }}
          />
          <span className="text-sm text-gray-700">
            I agree to the pre-assessment fee of{' '}
            <strong style={{ color: TME_COLORS.primary }}>
              AED {data.price_aed.toLocaleString('en-US')}
            </strong>{' '}
            (plus 5% VAT). The fee will be invoiced together with your pre-assessment report.
          </span>
        </label>
      )}

      {error && (
        <div
          className="mb-4 text-sm rounded-lg p-3"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: TME_COLORS.error }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-3 rounded-lg font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{ backgroundColor: TME_COLORS.primary }}
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? 'Submitting…' : 'Submit for review'}
      </button>
    </Shell>
  );
}
