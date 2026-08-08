import { TME_COLORS } from '@/lib/constants';

/** Existing-document preview for the renewal confirm panels (staff + dependent).
 *  Stored passports can be PDFs (uploads accept them), and a PDF inside an
 *  <img> renders as a broken image — embed those via <object> with an
 *  open-in-new-tab fallback. */
export default function ExistingDocPreview({
  label,
  doc,
}: {
  label: string;
  doc: { path?: string; publicUrl?: string; filename?: string };
}) {
  const name = doc.filename || doc.path || (doc.publicUrl || '').split('?')[0];
  const isPdf = /\.pdf$/i.test(name || '');
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>{label}</label>
      <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
        {isPdf ? (
          <object data={doc.publicUrl} type="application/pdf" className="w-full h-64">
            <a
              href={doc.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center h-64 text-sm underline"
              style={{ color: TME_COLORS.primary }}
            >
              Open {label} (PDF)
            </a>
          </object>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={doc.publicUrl} alt={label} className="w-full h-auto max-h-64 object-contain" />
        )}
      </div>
    </div>
  );
}
