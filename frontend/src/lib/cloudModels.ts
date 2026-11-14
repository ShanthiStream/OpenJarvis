import { useEffect, useState } from 'react';

import { fetchOpenRouterFreeModels, type OpenRouterFreeModel } from './api';

/**
 * Hand-picked cloud choices shown when the live catalog is unavailable.
 * OpenRouter free models come from /v1/openrouter/models instead of this list.
 */
export const POPULAR_CLOUD_MODELS: Array<{ id: string; label: string }> = [
  { id: 'openrouter/auto', label: 'OpenRouter Auto' },
  { id: 'openrouter/anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (OpenRouter)' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

/**
 * Live $0 OpenRouter catalog, fetched once per mount of the consumer.
 * Errors are exposed as an empty list rather than blocking local models.
 */
export function useCloudModelCatalog() {
  const [openrouterFree, setOpenrouterFree] = useState<OpenRouterFreeModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOpenRouterFreeModels()
      .then((models) => {
        if (cancelled) return;
        setOpenrouterFree(models);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOpenrouterFree([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { openrouterFree, loading, error };
}

/** Compact "128k ctx" label for the dropdown. */
export function formatContextLength(contextLength?: number | null): string {
  if (!contextLength || contextLength <= 0) return '';
  if (contextLength >= 1_000_000) return `${(contextLength / 1_000_000).toFixed(1)}M ctx`;
  return `${Math.round(contextLength / 1000)}k ctx`;
}
