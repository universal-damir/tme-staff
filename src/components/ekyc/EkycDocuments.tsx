"use client";

import React, { useRef, useState } from "react";
import { CheckCircle, FileText, Loader2, Upload } from "lucide-react";
import { TME_COLORS } from "@/lib/constants";
import {
  EKYC_DOCUMENT_SLOTS,
  EKYC_DOCUMENT_UPLOAD_HINT,
  type EkycDocumentSlot,
  type EkycText,
  type IndividualKycData,
} from "@/types/ekyc";
import type { EkycClientDocument, EkycClientDocuments } from "@/lib/ekyc-token";
import { Bi, BiHelp, BiLabel, biInline, useEkycBilingual } from "./Bi";
import { FieldError, FieldHint } from "./EkycField";
import { EKYC_UI } from "./texts";

const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type EkycUploadResult =
  | { ok: true; document: EkycClientDocument }
  | { ok: false; closedStatus?: number; message: EkycText };

function SlotRow({
  token,
  slot,
  label,
  hint,
  document,
  error,
  readOnly,
  busy,
  onUpload,
}: {
  token: string;
  slot: EkycDocumentSlot;
  label: EkycText;
  hint?: EkycText;
  document: EkycClientDocument | undefined;
  error: EkycText | undefined;
  readOnly: boolean;
  /** An upload for this slot is running (the form holds this, so Submit can wait). */
  busy: boolean;
  onUpload: (slot: EkycDocumentSlot, file: File) => Promise<EkycUploadResult>;
}) {
  const bilingual = useEkycBilingual();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<EkycText | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    const typeOk =
      ALLOWED_MIME.has(file.type) || /\.(pdf|jpe?g|png)$/.test(lower);
    if (!typeOk) return setLocalError(EKYC_UI.wrongType);
    setLocalError(null);
    try {
      // The form shrinks a large photo, checks the size and uploads.
      const result = await onUpload(slot, file);
      if (!result.ok) setLocalError(result.message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const shownError = localError ?? (document ? undefined : error);
  const borderColor = shownError
    ? TME_COLORS.error
    : document
      ? TME_COLORS.primary
      : TME_COLORS.border;

  return (
    <div
      id={`ekyc-documents-${slot}-field`}
      className="scroll-mt-28 flex flex-col rounded-lg border-2 p-3 sm:p-4"
      style={{ borderColor }}
    >
      <BiLabel text={label} className="min-w-0" />
      <FieldHint text={hint} />

      <div className="mt-auto pt-3 flex flex-col sm:flex-row sm:items-center gap-3">
        {document ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <CheckCircle
              className="h-5 w-5 shrink-0"
              style={{ color: TME_COLORS.success }}
            />
            <div className="min-w-0">
              <div className="font-medium text-gray-800">
                <Bi text={EKYC_UI.onFile} variant="inline" />
              </div>
              <a
                href={`/api/kyc/${token}/file?slot=${slot}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 truncate text-xs underline"
                style={{ color: TME_COLORS.primary }}
                title={biInline(EKYC_UI.view, bilingual)}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {document.filename || biInline(EKYC_UI.view, bilingual)}
                </span>
                {document.size > 0 && (
                  <span className="shrink-0 text-gray-500 no-underline">
                    ({formatSize(document.size)})
                  </span>
                )}
              </a>
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {!readOnly && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
              style={{
                borderColor: TME_COLORS.primary,
                color: document ? TME_COLORS.primary : "#fff",
                backgroundColor: document ? "#fff" : TME_COLORS.primary,
              }}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <Bi
                text={
                  busy
                    ? EKYC_UI.uploading
                    : document
                      ? EKYC_UI.replace
                      : EKYC_UI.upload
                }
                variant="inline"
                className="items-center"
              />
            </button>
          </>
        )}
      </div>
      <FieldError message={shownError ?? undefined} />
    </div>
  );
}

/** Individual uploads (decision D4): one slot per document this person needs. */
export function EkycDocuments({
  token,
  data,
  documents,
  errors,
  readOnly,
  busySlots,
  onUpload,
}: {
  token: string;
  data: IndividualKycData;
  documents: EkycClientDocuments;
  errors: Record<string, EkycText>;
  readOnly: boolean;
  busySlots: Partial<Record<EkycDocumentSlot, boolean>>;
  onUpload: (slot: EkycDocumentSlot, file: File) => Promise<EkycUploadResult>;
}) {
  const slots = EKYC_DOCUMENT_SLOTS.filter((d) => d.requiredWhen(data));
  return (
    <div>
      <div className="mb-3 space-y-1">
        <BiHelp text={EKYC_DOCUMENT_UPLOAD_HINT} />
        <BiHelp text={EKYC_UI.maxSize} icon={false} className="pl-5" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {slots.map((def) => (
          <SlotRow
            key={def.slot}
            token={token}
            slot={def.slot}
            label={def.label}
            hint={def.hint}
            document={documents[def.slot]}
            error={errors[`documents.${def.slot}`]}
            readOnly={readOnly}
            busy={busySlots[def.slot] === true}
            onUpload={onUpload}
          />
        ))}
      </div>
    </div>
  );
}
