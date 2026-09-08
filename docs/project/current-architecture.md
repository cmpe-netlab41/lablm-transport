# Current Architecture

## Package surface

`@lablm/transport` is private, version `0.0.1`, compiled as CommonJS to `dist`, and requires Node `undici` plus peer `zod >=4`. The installed explicit Undici dependency observed during the audit is `7.28.0`; Node `22.13.1` exposes global `fetch` backed by bundled Undici `6.21.1`.

The root export includes:

- `createTransportClient`;
- descriptor helpers `get`, `post`, `put`, `patch`, `del`, `endpoint`, `streamGet`, `streamPost`;
- the `TransportClient` and all configuration/descriptor/response types;
- eight error classes;
- public `withRetry`;
- internal/external retry constants and default timeout;
- `PoolManager` and stream-upload types.

`./auth` exports only `noopAuthStrategy`; `./defaults` exports retry and timeout constants. The manifest has `main`, `types`, and conditional `import/default` exports, but no explicit `require` condition. Build artifacts are not tracked by Git.

Compiler checks are intentionally loose: `strictNullChecks`, `noImplicitAny`, strict property initialization, case consistency, and fallthrough checks are disabled; `skipLibCheck` is enabled. The lint script has no discoverable ESLint flat config and currently fails before checking source.

## Typed client flow

`createTransportClient(config)` returns a stateless closure with `call` and `stream` methods.

For `call`:

```text
descriptor.path(input)
  -> decide retry eligibility from method/idempotent flag
  -> for each attempt:
       select input.baseUrl over config.baseUrl
       create AbortController and timeout timer
       invoke authStrategy({ targetService, method, path })
       build URL and JSON request
       global fetch (redirect: 'manual'; TS-001)
       block and classify a blocked redirect (IntegrationRedirectBlockedError)
       classify fetch failure
       classify 401/403 or other non-2xx
       read body bounded by config.maxResponseBytes (ResponseTooLargeError if exceeded; TS-004), JSON.parse when possible
       responseSchema.safeParse
       return { data, meta }
```

Successful non-streaming output is the Zod-parsed wire value. Zod transformations therefore flow into the returned value. Domain mapping is not implemented in this package.

## Descriptor and request model

`EndpointDescriptor<ReqSchema, ResSchema, ErrSchema>` carries method, path function, optional request schema, required response schema, optional error schema, and optional `idempotent` flag.

Response typing flows through `TransportClient.call`; request typing does not. `call` accepts `ReqInput`, whose `body` is `unknown`, and erases request/error generics with `any`. `requestSchema` is compile-time metadata and is never parsed. Path parameters are an optional untyped record. `endpoint()` performs first-occurrence string replacement and does not encode parameter values.

Helper defaults are:

| Helper | Default retry eligibility |
|---|---|
| GET | eligible unless descriptor explicitly sets `idempotent: false` |
| PUT | eligible; helper writes `idempotent: true` |
| DELETE | eligible unless overridden |
| POST | ineligible; helper writes `idempotent: false`, but caller may override true |
| PATCH | ineligible; caller may override true |
| Stream GET/POST | no retry engine |

The API does not model idempotency keys or business proof.

## URL and query behavior

`buildUrl` is private string concatenation:

- removes one trailing slash from the base;
- prepends one slash when the path lacks one;
- preserves other duplicate slashes and base path prefixes;
- accepts per-call arbitrary `baseUrl` overrides;
- does not accept an absolute descriptor path as a target override—the base is still prepended;
- appends `?` plus `URLSearchParams`, even if the descriptor path already contains query text;
- omits `null` query values;
- stringifies strings, numbers, and booleans;
- JSON-stringifies arrays and objects into a single parameter value;
- uses `params.set`, so repeated query keys are not represented;
- relies on `URLSearchParams` for key/value encoding.

Descriptor path functions can nevertheless place arbitrary text, queries, or fragments into the path. Raw endpoint parameters can inject `/`, `..`, `?`, `#`, or percent encodings and may be normalized by the URL parser.

## Request construction

The typed client supports JSON-like bodies only:

- GET and DELETE never send `input.body`;
- POST, PUT, and PATCH serialize a defined body with `JSON.stringify`;
- `Accept: application/json` is set for calls;
- `Content-Type: application/json` is set when the client considers a body present;
- auth-strategy headers are spread last and can override defaults;
- there is no descriptor/caller header surface, request-schema parse, or content negotiation policy; response bodies (not request bodies) are bounded by `config.maxResponseBytes` (TS-004).

Case-different header keys can coexist in the record and are combined by Fetch header normalization. In the audited Node runtime, `{ Authorization: A, authorization: B }` becomes one comma-joined `authorization` value.

## Response handling

For a successful call, the body is read via `readBoundedText`, which uses `response.body.getReader()` and counts bytes as they arrive rather than calling `Response.text()` directly; exceeding `config.maxResponseBytes` cancels the read and throws `ResponseTooLargeError` before the body is fully materialized or parsed (TS-004, RESOLVED — previously unbounded). Empty text becomes `undefined`; valid JSON becomes its parsed value; invalid JSON remains a string. Content type is ignored. The result is then parsed by the required response schema. This means `204`/`205` work only with a schema accepting `undefined`, and a string-accepting schema can deliberately accept non-JSON.

Unknown-field behavior is owned entirely by each Zod schema. The current canonical schemas are primarily ordinary `z.object(...)` schemas, whose default behavior strips unrecognized keys; transport adds no strict/passthrough policy. It returns `parsed.data`, so schema transformations and stripping are observable public behavior.

For `401`/`403`, the body is not consumed and `IntegrationUnauthorizedError` is thrown. For other non-2xx responses, the body is consumed only when `errorSchema` exists; successful parsing stores schema output, otherwise the raw parsed/string body is retained; the same `maxResponseBytes` bound applies to this read. Successful metadata includes latency to response headers, status, and every response header.

Fetch automatically handles supported content encodings; enforcement counts the decoded bytes read from `response.body` (verified empirically: a 1004-byte gzip response can decode to 1,000,000 bytes), not `Content-Length`, since `Content-Length` reflects only the wire size and would not catch a decompression bomb.

## Streaming client

`stream` supports GET and JSON POST. It sets `Accept: text/event-stream`, optionally `Content-Type: application/json`, authenticates once, blocks any redirect the same way `call` does (`redirect: 'manual'`, throwing `IntegrationRedirectBlockedError` on a 3xx), and returns a wrapped raw `ReadableStream<Uint8Array>` for any 2xx with a body. It does not validate content type or frames and does not retry. A non-2xx error body is read the same bounded way as `call`'s (TS-004); the 2xx success path's raw stream is deliberately not size-bounded here — that is a separate streaming time/cancellation concern (TR-001), not a buffering one, since transport never materializes the stream into memory itself.

The configured timer is a connect/response-header timeout and is cleared after headers. A caller signal stays connected for the stream lifetime through a wrapper cleanup callback. Cleanup runs on end, read error, or explicit stream cancellation. Merely releasing the wrapper reader or abandoning it without cancellation is not defined as cleanup. Error responses are buffered without a remaining timeout after the external listener is removed.

## Retry engine

Retryable categories are exactly:

- `IntegrationTimeoutError`;
- `IntegrationNetworkError`;
- `UpstreamError` with status `429`, `502`, `503`, or `504`.

`408`, `500`, blocked redirects, oversized responses, schema failures, auth failures, unauthorized failures, caller aborts, and programming/configuration errors are not retried. Attempts are bounded by `maxAttempts` when configuration contains a valid positive finite integer, but config is not validated.

Backoff uses `initialDelayMs * backoffFactor^attempt`, uniformly sampled from `base * (1-jitterFactor)` through `base * (1+jitterFactor)`, capped at `maxDelayMs`. The type comment calls this “full-jitter,” while the implementation and code comments correctly describe centered proportional jitter.

When enabled, any retryable `UpstreamError` carrying `Retry-After` bypasses jitter and `maxDelayMs`. Parsing uses permissive `parseInt` first, then `Date.parse`; negative and partially numeric values can be accepted. No overall deadline or abortable sleep exists.

## Timeout and cancellation

The timeout timer starts before auth and controls the fetch signal, but cannot interrupt an auth strategy. The fetch `try/finally` begins only after auth resolves, so an auth rejection leaves the timer and caller listener installed until later timeout/abort.

For non-streaming calls, the timer and caller listener are removed as soon as Fetch returns response headers. Body buffering and schema parsing are outside both timeout and caller cancellation. Cancellation during retry sleep does not interrupt the sleep; a later attempt starts, invokes auth, and reaches Fetch with an already-aborted signal.

Thus `timeoutMs` is not an overall operation deadline and does not even cover the complete HTTP body.

## Error model

| Error | Current meaning |
|---|---|
| `IntegrationTimeoutError` | internal AbortController fired before response headers |
| `IntegrationNetworkError` | other Fetch rejection, including DNS/TLS/socket/invalid target categories |
| `IntegrationUnauthorizedError` | HTTP 401 or 403 |
| `UpstreamError` | other non-2xx; may carry raw/error-schema body and `Retry-After` |
| `UpstreamContractError` | external-trust success body failed response schema |
| `IntegrationContractViolationError` | internal-trust success body failed response schema |
| `IntegrationRedirectBlockedError` | server returned a 301/302/303/307/308; transport never follows it (TS-001) |
| `ResponseTooLargeError` | buffered response (typed-client body or PoolManager upload response) exceeded `maxResponseBytes` (TS-004) |

Caller abort is a raw runtime abort error. Auth, path, URL, and serialization exceptions remain raw. Errors have no attempt count, retry outcome, stable endpoint name, request ID, or safe serialization contract. Target service, dynamic path, parsed body, retry header, and causes are public fields.

## PoolManager transport

`PoolManager` is a separate public transport for Node `Readable` uploads. It creates one explicit Undici `Pool` per `poolKey`, sends arbitrary caller headers and POST/PUT body streams, buffers the response into `Buffer[]` up to a required `StreamUploadConfig.maxResponseBytes` (TS-004, RESOLVED — previously unbounded; throws `ResponseTooLargeError` mid-loop, before `Buffer.concat`, if exceeded), and returns status/body without auth strategy, schema validation, retry, normalized errors, cancellation, or explicit timeout/concurrency options.

The installed Undici defaults provide implementation-level connect/header/body timeouts (header/body defaults are 300 seconds), but there is no library-level overall deadline and a trickling body can remain open. The pool default permits an unbounded number of clients (`connections: null`). Pool count is the unbounded size of the key map.

A key is bound only on first use. Reusing the same key with a different origin silently reuses the original pool/origin. Consumers explicitly call `closeAll()` on application shutdown.

## Lifecycle, connection reuse, and observability

Typed clients are application/module singletons in current consumers, but creating another typed client does not create a network pool: Node global Fetch uses the process-wide Undici dispatcher. `PoolManager` owns explicit long-lived pools.

The package has no logs, metrics, trace API, retry hooks, or stable endpoint identity. Backend and machine-service bootstrap OpenTelemetry auto-instrumentation, including HTTP/Undici instrumentation, before Nest startup, so raw HTTP spans and trace-context propagation are expected when those apps run with telemetry. Exact emitted attributes were not runtime-verified. This does not expose transport retry count, schema-failure metrics, logical descriptor identity, or final operation duration. Successful metadata reports only the final attempt’s header latency.

Logging is caller-owned, but not consistently single-owner. The FMS integration logs a non-2xx raw body and then NDrive logs the thrown error again; this can duplicate one failure. The llama adapter logs one mapped warning, while transport remains silent. No transport request metrics exist, and there is no package metric-label cardinality exposure today; future instrumentation lacks a stable descriptor name and could fall back to dynamic URLs.

## Architecture assessment

| Question | Classification | Answer |
|---|---|---|
| Framework-independent? | `CONFIRMED` with qualification | No framework imports; `PoolManager` is Node-specific. A type comment mentions `nestjs-cls`, but code does not depend on it. |
| Validated wire output? | `CONFIRMED` | Non-streaming success is parsed. Streams deliberately return raw bytes for adapter validation. |
| Domain mapping outside transport? | `CONFIRMED` | No domain imports or mappers in the package. |
| Consumers consistently use ACL/ports? | `ARCHITECTURE DRIFT` | Machine-service llama uses a domain port; backend domains directly depend on concrete integration services/models. |
| Transport depends on application/domain? | `CONFIRMED` no | Only Zod, Undici, and platform types/runtime APIs. |
| Descriptors remain protocol descriptions? | `CONFIRMED` | Current descriptors hold method/path/schemas/idempotency only; they lack stable names. |
| Authentication pluggable? | `CONFIRMED` | Async strategy per client, invoked per attempt. Header authority is overly broad. |
| Canonical schemas used? | `CONFIRMED` for backend machine calls; `UNCLEAR` for llama | Backend imports contract subpaths. Llama owns local third-party schemas and aliases its request wire type to a domain model. |
| Direct HTTP banned outside package? | `ARCHITECTURE DRIFT` | Backend ESLint bans it; other workspaces do not consistently enforce the claim and approved exceptions are not centrally modeled. |
