import type { ZodTypeAny } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Any JSON-serializable value that can appear as a query parameter value.
 *  Primitives are stringified as-is; objects and arrays are JSON.stringify'd.
 *  null values are omitted from the query string. */
export type QueryValue = string | number | boolean | null | QueryValue[] | { [key: string]: QueryValue };

/** Structured call input. Keeps path params, query, and body explicitly separated
 *  so the transport layer never conflates them. */
export interface ReqInput {
     /** Per-request base URL override. Takes precedence over ClientConfig.baseUrl.
      *  Required when ClientConfig.baseUrl is not set (e.g. dynamic-IP services). */
     baseUrl?: string;
     params?: Record<string, string | number>;
     query?: Record<string, QueryValue>;
     body?: unknown;
}

/** Describes a single remote endpoint. The type parameters flow through to call()'s return type. */
export interface EndpointDescriptor<
     ReqSchema extends ZodTypeAny | undefined = undefined,
     ResSchema extends ZodTypeAny = ZodTypeAny,
     ErrSchema extends ZodTypeAny | undefined = undefined,
> {
     method: HttpMethod;
     /** Build the URL path (and query string, if needed) from call input. */
     path: (input: ReqInput) => string;
     /** Outbound body schema — compile-time typing only, NOT validated at runtime. */
     requestSchema?: ReqSchema;
     /** Response schema — ALWAYS validated at runtime. Required. */
     responseSchema: ResSchema;
     /** Parsed against non-2xx response bodies when present. */
     errorSchema?: ErrSchema;
     /** Gates default retry. POSTs are non-idempotent unless this is explicitly true. */
     idempotent?: boolean;
}

/** Passed to AuthStrategy so it can mint scoped tokens. */
export interface CallContext {
     /** Logical service name; used as the JWT `aud` claim. */
     targetService: string;
     method: HttpMethod;
     path: string;
}

/** Pluggable auth. Returns extra HTTP headers (e.g. Authorization, X-Correlation-Id).
 *  Reads ambient context (correlation-id, userId) from nestjs-cls — never from parameters. */
export type AuthStrategy = (ctx: CallContext) => Promise<Record<string, string>>;

export interface RetryConfig {
     maxAttempts: number;
     initialDelayMs: number;
     backoffFactor: number;
     maxDelayMs: number;
     /** Applied as ±jitterFactor * computed delay (full-jitter). */
     jitterFactor: number;
     /** When true, honours the Retry-After header on 429/503. Set for external services. */
     respectRetryAfter: boolean;
}

export interface ClientConfig {
     /** Default base URL for all calls. May be omitted when every call supplies
      *  its own baseUrl via ReqInput. */
     baseUrl?: string;
     authStrategy: AuthStrategy;
     retry: RetryConfig;
     timeoutMs: number;
     /** Hard cap on buffered response body bytes (post-decompression) for non-streaming
      *  success/error reads. Exceeding it aborts the read and throws ResponseTooLargeError
      *  instead of buffering further. Does not apply to executeStream's success path. */
     maxResponseBytes: number;
     /** 'internal' = we own the contract; parse failure → IntegrationContractViolationError (our bug).
      *  'external' = third party owns it; parse failure → UpstreamContractError (their bug). */
     trust: 'internal' | 'external';
     /** Logical service name used in error messages and CallContext. */
     targetService: string;
}

/** Transport-level metadata returned alongside every successful response.
 *  Adapters decide which fields (if any) to propagate into domain models. */
export interface ResponseMeta {
     /** Wall-clock time from request sent to response headers received, in milliseconds.
      *  Excludes auth-strategy overhead and body parsing — pure network + server time. */
     latencyMs: number;
     statusCode: number;
     headers: Record<string, string>;
}

export interface TransportResponse<T> {
     data: T;
     meta: ResponseMeta;
}

export interface TransportClient {
     call<ResSchema extends ZodTypeAny>(
          descriptor: EndpointDescriptor<any, ResSchema, any>,
          input: ReqInput,
          opts?: { signal?: AbortSignal },
     ): Promise<TransportResponse<import('zod').infer<ResSchema>>>;
     stream(
          descriptor: StreamEndpointDescriptor,
          input: ReqInput,
          opts?: { signal?: AbortSignal },
     ): Promise<{ stream: ReadableStream<Uint8Array>; meta: ResponseMeta }>;
}

/** Describes an endpoint whose response body is a long-lived byte stream
 *  (e.g. SSE) rather than a single JSON document. Transport hands back the raw
 *  stream after handling auth/connection-level errors — it never parses frames
 *  or validates payloads; that's contract-specific and belongs to the caller. */
export interface StreamEndpointDescriptor {
     method: 'GET' | 'POST';
     path: (input: ReqInput) => string;
}
