import type { RetryConfig } from './types';

/** For internally-owned services (machine-service, etc.).
 *  Fast initial retry; no Retry-After needed since we own both sides. */
export const INTERNAL_RETRY_CONFIG: RetryConfig = {
     maxAttempts: 3,
     initialDelayMs: 100,
     backoffFactor: 2,
     maxDelayMs: 2000,
     jitterFactor: 0.3,
     respectRetryAfter: false,
};

/** For third-party / external services (LLM providers, etc.).
 *  Slower initial retry; honour Retry-After on 429 to avoid burning quota. */
export const EXTERNAL_RETRY_CONFIG: RetryConfig = {
     maxAttempts: 3,
     initialDelayMs: 500,
     backoffFactor: 2,
     maxDelayMs: 10000,
     jitterFactor: 0.3,
     respectRetryAfter: true,
};

export const DEFAULT_TIMEOUT_MS = 30000;

/** Generous enough for every known legitimate response (including large llama.cpp
 *  completions), while bounding a compromised/misbehaving endpoint's amplification. */
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
