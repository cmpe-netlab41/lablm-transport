# @lablm/transport

Framework-agnostic typed HTTP transport for LabLM. Business code never calls `fetch` directly — it depends on a typed adapter, which depends on this library.

## Layering

```
domain / orchestration
  → adapter (src/integrations/)        ACL: toRequest (domain→wire), toModel (wire→domain)
      → @lablm/transport               auth, retry, timeout, error normalisation, response parse
          → @lablm/contracts-*         zod schemas + inferred wire types (single source of truth)
```

**Hard rules:**

- `createTransportClient` returns the **validated wire type** — never a domain model.
- Domain ↔ wire mapping lives in **pure functions** `toRequest`/`toModel` inside the adapter.
- Domain code imports its **port interface** from its own `ports/` folder. It never imports wire types.

## Adding a new endpoint

1. Define schemas in the owning service's `packages/contracts/<service>/` package.
2. Write `toRequest` and `toModel` mapper functions in the adapter file.
3. Define an `EndpointDescriptor` constant (typed against the contract schemas).
4. Call `client.call(descriptor, toRequest(...))` and pass the result to `toModel`.

## Retry defaults

| | Internal | External |
|---|---|---|
| Max attempts | 3 | 3 |
| Initial delay | 100 ms | 500 ms |
| Max delay | 2 s | 10 s |
| Retry-After | No | Yes |

`POST` is never retried by default. Set `idempotent: true` on a descriptor to override for POSTs that carry an idempotency key.

## Redirect policy

Transport never follows HTTP redirects. Every call is made with `redirect: 'manual'`; any `301`/`302`/`303`/`307`/`308` response throws `IntegrationRedirectBlockedError` instead of being followed. This is not configurable — a redirect target is a different origin and would otherwise silently receive whatever credential headers the `AuthStrategy` attached (standard `Authorization`/cookies are stripped cross-origin by the runtime, but custom headers are not). If a future consumer genuinely needs redirect-following, that requires a deliberate, reviewed design (e.g. an explicit allowlist plus credential recompute per destination) — not just flipping this default.

## Response size limit

`ClientConfig.maxResponseBytes` (required — mirroring `timeoutMs`, no silent default inside the client) caps buffered response bodies. Exceeding it aborts the read and throws `ResponseTooLargeError` — this is checked against actual decoded bytes as they're read, not `Content-Length`, so it isn't fooled by a compressed body that decompresses into something much larger. `DEFAULT_MAX_RESPONSE_BYTES` (10 MiB) is exported for callers that don't need a different value. `PoolManager.streamUpload`'s `StreamUploadConfig.maxResponseBytes` is the same guarantee for its buffered upload response. This does not bound `stream()`'s successful response — that's a raw, unbuffered `ReadableStream` handed to the caller, not something transport buffers itself.

## ESLint enforcement

`fetch`, `axios`, `node:http`, `node:https`, and `undici` are banned everywhere except this package. Violations are build-time errors.
