import { TME_COLORS } from '@/lib/constants';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div
          className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center"
          style={{ backgroundColor: TME_COLORS.secondary }}
        >
          <svg
            className="w-10 h-10"
            style={{ color: TME_COLORS.primary }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>

        <h1
          className="text-2xl font-bold mb-4"
          style={{ color: TME_COLORS.primary }}
        >
          TME Staff Onboarding
        </h1>

        <p className="text-gray-600 mb-6">
          Welcome to the TME Staff Onboarding Portal. If you have received an
          onboarding link, please use that link to access your form.
        </p>

        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500">
          <p className="mb-2">
            <strong>Need help?</strong>
          </p>
          <p>
            Contact your HR representative or email us at{' '}
            <a
              href="mailto:info@tme-services.com"
              className="underline"
              style={{ color: TME_COLORS.primary }}
            >
              info@tme-services.com
            </a>
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100">
          <a
            href="https://tme-services.com"
            className="text-sm hover:underline"
            style={{ color: TME_COLORS.primary }}
          >
            &larr; Return to TME Services
          </a>
        </div>
      </div>
    </main>
  );
}
