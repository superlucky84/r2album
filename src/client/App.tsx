import { lmount, mountCallback } from 'lithent';
import { lstate } from 'lithent/helper';
import type { HealthResponse } from '@/shared/types';

export const App = lmount(() => {
  const status = lstate<'loading' | 'ready' | 'error'>('loading');

  mountCallback(() => {
    const controller = new AbortController();

    fetch('/api/health', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        status.value = data.ok ? 'ready' : 'error';
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        status.value = 'error';
      });

    return () => {
      controller.abort();
    };
  });

  return () => (
    <main class="min-h-screen flex items-center justify-center p-6">
      <section class="max-w-md w-full rounded-2xl border border-neutral-800 bg-neutral-900/80 p-8 text-center shadow-xl">
        <h1 class="text-2xl font-semibold tracking-tight text-white">r2album</h1>
        <p class="mt-2 text-sm text-neutral-400">
          Private Cloudflare R2 Photo Gallery &amp; Digital Frame
        </p>
        <div
          class="mt-6 inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3.5 py-1.5 text-xs text-neutral-300"
          data-testid="health-status"
        >
          <span
            class={
              status.value === 'ready'
                ? 'h-2 w-2 rounded-full bg-emerald-400'
                : status.value === 'error'
                  ? 'h-2 w-2 rounded-full bg-rose-400'
                  : 'h-2 w-2 rounded-full bg-amber-400 animate-pulse'
            }
          />
          <span>
            {status.value === 'ready'
              ? 'API Connected'
              : status.value === 'error'
                ? 'API Offline'
                : 'Connecting...'}
          </span>
        </div>
      </section>
    </main>
  );
});
