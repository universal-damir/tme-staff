'use client';

import { useState, useEffect } from 'react';
import { JOB_TITLES } from '@/lib/constants';

interface DropdownOption {
  value: string;
  label: string;
}

/**
 * Fetches MOHRE professions from the proxy API for use in job title dropdowns.
 * Falls back to hardcoded JOB_TITLES if API fails.
 * Always appends "Other" as the last option.
 */
export function useMohreProfessions() {
  const [professions, setProfessions] = useState<DropdownOption[]>(() => {
    return [...JOB_TITLES].map((t) => ({ value: t, label: t }));
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchProfessions() {
      try {
        const res = await fetch('/api/mohre-professions');
        if (!res.ok) throw new Error('API error');

        const data = await res.json();
        if (cancelled) return;

        if (data.professions && data.professions.length > 0) {
          const options: DropdownOption[] = data.professions.map((p: { description_english: string }) => ({
            value: p.description_english,
            label: p.description_english,
          }));
          options.push({ value: 'Other', label: 'Other' });
          setProfessions(options);
        }
      } catch {
        // Keep hardcoded fallback on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProfessions();
    return () => { cancelled = true; };
  }, []);

  return { professions, loading };
}
