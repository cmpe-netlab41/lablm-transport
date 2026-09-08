import {
  IntegrationTimeoutError,
  IntegrationNetworkError,
  UpstreamError,
} from './errors';
import type { RetryConfig } from './types';

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  if (err instanceof IntegrationTimeoutError) return true;
  if (err instanceof IntegrationNetworkError) return true;
  if (err instanceof UpstreamError && RETRYABLE_STATUS_CODES.has(err.statusCode)) return true;
  return false;
}

/**
 * Returns a jittered delay by sampling uniformly from [base*(1-f), base*(1+f)],
 * capped at maxDelayMs.
 *
 * Why jitter at all: without it, clients that fail simultaneously retry at identical
 * intervals, hitting the upstream in coordinated bursts (thundering herd). Randomness
 * spreads retries across time so the burst dissipates.
 *
 * Why this range instead of [0, base] ("full jitter"):
 * AWS-style full jitter allows near-zero waits on early attempts, which can be too
 * aggressive. Centering the window on the exponential base (±f%) preserves the backoff
 * growth curve while still breaking synchronisation across callers. At f=0.3, each
 * attempt delays between 70% and 130% of the computed exponential — predictable enough
 * to reason about, random enough to de-correlate concurrent retriers.
 */
function fullJitter(base: number, jitterFactor: number, maxDelayMs: number): number {
  const lo = base * (1 - jitterFactor);
  const hi = base * (1 + jitterFactor);
  const jittered = lo + Math.random() * (hi - lo);
  return Math.min(jittered, maxDelayMs);
}

function parseRetryAfterMs(header: string): number | undefined {
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds)) return seconds * 1000;
  const ts = Date.parse(header);
  if (!isNaN(ts)) return Math.max(0, ts - Date.now());
  return undefined;
}

function computeDelay(attempt: number, err: unknown, config: RetryConfig): number {
  if (config.respectRetryAfter && err instanceof UpstreamError && err.retryAfterHeader) {
    const ms = parseRetryAfterMs(err.retryAfterHeader);
    if (ms !== undefined) return ms;
  }
  const exponential = config.initialDelayMs * Math.pow(config.backoffFactor, attempt);
  return fullJitter(exponential, config.jitterFactor, config.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isIdempotent: boolean,
): Promise<T> {
  if (!isIdempotent) return fn();

  let lastError: unknown;
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastError = err;
      if (attempt < config.maxAttempts - 1) {
        await sleep(computeDelay(attempt, err, config));
      }
    }
  }
  throw lastError;
}
