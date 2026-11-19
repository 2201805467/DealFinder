import { setTimeout as sleep } from 'node:timers/promises';
import { ProviderError } from './provider-error.js';
import { boundedProviderJson, safeStoreFetch } from './safe-http.js';
import type { ProviderContext } from './store-provider.js';

/** One HTTP attempt. Worker owns bounded retries/backoff/jitter and persistent cooldown. */
export class SourceHttpClient {
  private nextRequest = 0;
  constructor(
    private readonly transport = safeStoreFetch(),
    private readonly spacingMs = 1100,
    private readonly timeoutMs = 10000,
  ) {}
  async get(url: URL, context: ProviderContext = {}, empty201 = false) {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.timeoutMs),
      ...(context.signal ? [context.signal] : []),
    ]);
    // Preserve coordinator/budget failures; they are not network errors to retry.
    await context.onRequest?.();
    try {
      const delay = Math.max(0, this.nextRequest - Date.now());
      this.nextRequest =
        Math.max(Date.now(), this.nextRequest) + this.spacingMs;
      if (delay) await sleep(delay, undefined, { signal });
      signal.throwIfAborted();
      const response = await this.transport(url, { signal, redirect: 'error' });
      if (response.status === 429) {
        const raw = response.headers.get('retry-after');
        const seconds =
          raw === null
            ? undefined
            : /^\d+$/.test(raw)
              ? Number(raw)
              : Math.max(0, Math.ceil((Date.parse(raw) - Date.now()) / 1000));
        const retry =
          seconds !== undefined && Number.isFinite(seconds)
            ? seconds
            : undefined;
        this.nextRequest = Math.max(
          this.nextRequest,
          Date.now() + (retry ?? 1) * 1000,
        );
        await response.body?.cancel();
        throw new ProviderError(
          'RATE_LIMIT',
          'Source rate limit reached.',
          retry,
        );
      }
      if (empty201 && response.status === 201) {
        await response.body?.cancel();
        return { data: [] as unknown, headers: response.headers };
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(
          response.status >= 500 ? 'UPSTREAM' : 'ACCESS_OR_QUOTA',
          'Source rejected the request.',
        );
      }
      return {
        data: await boundedProviderJson(response, signal),
        headers: response.headers,
      };
    } catch (error) {
      if (signal.aborted)
        throw new ProviderError(
          'TIMEOUT',
          'Source request cancelled or timed out.',
        );
      if (error instanceof ProviderError) throw error;
      if (error instanceof SyntaxError)
        throw new ProviderError('INVALID_RESPONSE', 'Source JSON is invalid.');
      throw new ProviderError('NETWORK', 'Source request failed.');
    }
  }
}
