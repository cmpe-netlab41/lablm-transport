import type { ZodTypeAny } from 'zod';
import type {
     ClientConfig,
     EndpointDescriptor,
     QueryValue,
     ReqInput,
     ResponseMeta,
     StreamEndpointDescriptor,
     TransportClient,
     TransportResponse,
} from './types';
import {
     IntegrationContractViolationError,
     IntegrationNetworkError,
     IntegrationRedirectBlockedError,
     IntegrationTimeoutError,
     IntegrationUnauthorizedError,
     ResponseTooLargeError,
     UpstreamContractError,
     UpstreamError,
} from './errors';
import { withRetry } from './retry';

const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE']);

// TS-001: fetch is told never to follow redirects. A cross-origin redirect would
// otherwise carry custom credential headers (e.g. x-inference-token) to a
// destination the auth strategy never scoped them for — Undici only strips
// standard Authorization/cookie headers on origin change, not custom ones.
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function isIdempotent(descriptor: EndpointDescriptor<any, any, any>): boolean {
     return descriptor.idempotent ?? IDEMPOTENT_METHODS.has(descriptor.method);
}

function serializeQueryValue(v: QueryValue): string | null {
     if (v === null) return null;
     if (typeof v === 'object') return JSON.stringify(v);
     return String(v);
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
     const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
     const p = path.startsWith('/') ? path : `/${path}`;
     const url = `${base}${p}`;
     if (!query || Object.keys(query).length === 0) return url;
     const params = new URLSearchParams();
     for (const [k, v] of Object.entries(query)) {
          const serialized = serializeQueryValue(v);
          if (serialized !== null) params.set(k, serialized);
     }
     return `${url}?${params.toString()}`;
}

// TS-004: bodies are read via a manual reader loop, counting bytes as they arrive,
// rather than Response.text(). fetch decompresses transparently before these bytes
// reach us, so this counts true decoded size — a Content-Length pre-check would not
// (it reflects the wire/compressed size and a small compressed body can still
// decompress into an unbounded one).
async function readBoundedText(
     response: Response,
     maxBytes: number,
     targetService: string,
     path: string,
): Promise<string> {
     if (!response.body) return '';
     const reader = response.body.getReader();
     const chunks: Uint8Array[] = [];
     let total = 0;
     while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) {
               await reader.cancel('response exceeded configured size limit');
               throw new ResponseTooLargeError(targetService, path, maxBytes);
          }
          chunks.push(value);
     }
     reader.releaseLock();
     return Buffer.concat(chunks).toString('utf8');
}

function parseJsonText(text: string): unknown {
     if (!text) return undefined;
     try {
          return JSON.parse(text);
     } catch {
          return text;
     }
}

async function executeOnce<ResSchema extends ZodTypeAny>(
     descriptor: EndpointDescriptor<any, ResSchema, any>,
     input: ReqInput,
     path: string,
     config: ClientConfig,
     opts: { signal?: AbortSignal } | undefined,
): Promise<TransportResponse<import('zod').infer<ResSchema>>> {
     const baseUrl = input.baseUrl ?? config.baseUrl;
     if (!baseUrl) {
          throw new Error(
               `[transport] baseUrl is required but was not provided. ` +
                    `Set it in ClientConfig or pass it via ReqInput.baseUrl for service "${config.targetService}".`,
          );
     }

     const controller = new AbortController();
     const onExternalAbort = () => controller.abort(opts?.signal?.reason);
     opts?.signal?.addEventListener('abort', onExternalAbort, { once: true });
     if (opts?.signal?.aborted) onExternalAbort();
     const timer = setTimeout(() => controller.abort(), config.timeoutMs);

     const authHeaders = await config.authStrategy({
          targetService: config.targetService,
          method: descriptor.method,
          path,
     });

     const hasBody = descriptor.method !== 'GET' && descriptor.method !== 'DELETE' && input.body !== undefined;

     const headers: Record<string, string> = {
          Accept: 'application/json',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          ...authHeaders,
     };

     let response: Response;
     let latencyMs: number;
     try {
          const requestStart = Date.now();
          response = await fetch(buildUrl(baseUrl, path, input.query), {
               method: descriptor.method,
               headers,
               body: hasBody ? JSON.stringify(input.body) : undefined,
               signal: controller.signal,
               redirect: 'manual',
          });
          latencyMs = Date.now() - requestStart;
     } catch (err) {
          if (opts?.signal?.aborted) throw err;
          if (controller.signal.aborted) {
               throw new IntegrationTimeoutError(config.targetService, path, config.timeoutMs);
          }
          throw new IntegrationNetworkError(config.targetService, path, err instanceof Error ? err : undefined);
     } finally {
          clearTimeout(timer);
          opts?.signal?.removeEventListener('abort', onExternalAbort);
     }

     if (REDIRECT_STATUS_CODES.has(response.status)) {
          throw new IntegrationRedirectBlockedError(config.targetService, path, response.status);
     }

     if (response.status === 401 || response.status === 403) {
          throw new IntegrationUnauthorizedError(config.targetService, path, response.status as 401 | 403);
     }

     if (!response.ok) {
          const retryAfterHeader = response.headers.get('Retry-After') ?? undefined;
          let errorBody: unknown;
          if (descriptor.errorSchema) {
               const text = await readBoundedText(response, config.maxResponseBytes, config.targetService, path);
               const raw = parseJsonText(text);
               const parsed = descriptor.errorSchema.safeParse(raw);
               errorBody = parsed.success ? parsed.data : raw;
          }
          throw new UpstreamError(config.targetService, path, response.status, errorBody, retryAfterHeader);
     }

     const bodyText = await readBoundedText(response, config.maxResponseBytes, config.targetService, path);
     const rawBody = parseJsonText(bodyText);
     const parsed = descriptor.responseSchema.safeParse(rawBody);

     if (!parsed.success) {
          if (config.trust === 'internal') {
               throw new IntegrationContractViolationError(config.targetService, path, parsed.error);
          }
          throw new UpstreamContractError(config.targetService, path, parsed.error);
     }

     const meta: ResponseMeta = {
          latencyMs,
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
     };

     return { data: parsed.data, meta };
}

async function executeStream(
     descriptor: StreamEndpointDescriptor,
     input: ReqInput,
     path: string,
     config: ClientConfig,
     opts: { signal?: AbortSignal } | undefined,
): Promise<{ stream: ReadableStream<Uint8Array>; meta: ResponseMeta }> {
     const baseUrl = input.baseUrl ?? config.baseUrl;
     if (!baseUrl) {
          throw new Error(
               `[transport] baseUrl is required but was not provided. ` +
                    `Set it in ClientConfig or pass it via ReqInput.baseUrl for service "${config.targetService}".`,
          );
     }

     // The AbortController drives both the connect-timeout and any caller-supplied
     // cancellation signal. Once headers arrive we only clear the timeout timer —
     // the controller (and thus the caller's signal) stays wired to the fetch for
     // the life of the stream, so aborting `opts.signal` later still cancels reads.
     const controller = new AbortController();
     const onExternalAbort = () => controller.abort();
     opts?.signal?.addEventListener('abort', onExternalAbort, { once: true });
     if (opts?.signal?.aborted) onExternalAbort();
     const timer = setTimeout(() => controller.abort(), config.timeoutMs);
     const removeExternalAbortListener = () => opts?.signal?.removeEventListener('abort', onExternalAbort);
     let keepExternalAbortListener = false;

     const authHeaders = await config.authStrategy({
          targetService: config.targetService,
          method: descriptor.method,
          path,
     });

     const hasBody = descriptor.method === 'POST' && input.body !== undefined;

     let response: Response;
     let latencyMs: number;
     try {
          const requestStart = Date.now();
          response = await fetch(buildUrl(baseUrl, path, input.query), {
               method: descriptor.method,
               headers: {
                    Accept: 'text/event-stream',
                    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
                    ...authHeaders,
               },
               body: hasBody ? JSON.stringify(input.body) : undefined,
               signal: controller.signal,
               redirect: 'manual',
          });
          latencyMs = Date.now() - requestStart;
          keepExternalAbortListener = true;
     } catch (err) {
          if (opts?.signal?.aborted) {
               throw err;
          }
          if (controller.signal.aborted) {
               throw new IntegrationTimeoutError(config.targetService, path, config.timeoutMs);
          }
          throw new IntegrationNetworkError(config.targetService, path, err instanceof Error ? err : undefined);
     } finally {
          clearTimeout(timer);
          if (!keepExternalAbortListener) removeExternalAbortListener();
     }

     if (REDIRECT_STATUS_CODES.has(response.status)) {
          removeExternalAbortListener();
          throw new IntegrationRedirectBlockedError(config.targetService, path, response.status);
     }

     if (response.status === 401 || response.status === 403) {
          removeExternalAbortListener();
          throw new IntegrationUnauthorizedError(config.targetService, path, response.status as 401 | 403);
     }

     if (!response.ok) {
          const retryAfterHeader = response.headers.get('Retry-After') ?? undefined;
          removeExternalAbortListener();
          const text = await readBoundedText(response, config.maxResponseBytes, config.targetService, path);
          const errorBody = parseJsonText(text);
          throw new UpstreamError(config.targetService, path, response.status, errorBody, retryAfterHeader);
     }

     if (!response.body) {
          removeExternalAbortListener();
          throw new IntegrationNetworkError(config.targetService, path);
     }

     const meta: ResponseMeta = {
          latencyMs,
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
     };

     return { stream: withCleanup(response.body, removeExternalAbortListener), meta };
}

function withCleanup(stream: ReadableStream<Uint8Array>, cleanup: () => void): ReadableStream<Uint8Array> {
     const reader = stream.getReader();
     let cleaned = false;

     const cleanupOnce = () => {
          if (cleaned) return;
          cleaned = true;
          cleanup();
     };

     return new ReadableStream<Uint8Array>({
          async pull(controller) {
               try {
                    const { done, value } = await reader.read();
                    if (done) {
                         cleanupOnce();
                         reader.releaseLock();
                         controller.close();
                         return;
                    }

                    controller.enqueue(value);
               } catch (error) {
                    cleanupOnce();
                    reader.releaseLock();
                    controller.error(error);
               }
          },
          async cancel(reason) {
               cleanupOnce();
               try {
                    await reader.cancel(reason);
               } finally {
                    reader.releaseLock();
               }
          },
     });
}

export function createTransportClient(config: ClientConfig): TransportClient {
     return {
          call<ResSchema extends ZodTypeAny>(
               descriptor: EndpointDescriptor<any, ResSchema, any>,
               input: ReqInput,
               opts?: { signal?: AbortSignal },
          ): Promise<TransportResponse<import('zod').infer<ResSchema>>> {
               const path = descriptor.path(input);
               return withRetry(
                    () => executeOnce(descriptor, input, path, config, opts),
                    config.retry,
                    isIdempotent(descriptor),
               );
          },
          stream(
               descriptor: StreamEndpointDescriptor,
               input: ReqInput,
               opts?: { signal?: AbortSignal },
          ): Promise<{ stream: ReadableStream<Uint8Array>; meta: ResponseMeta }> {
               const path = descriptor.path(input);
               return executeStream(descriptor, input, path, config, opts);
          },
     };
}
