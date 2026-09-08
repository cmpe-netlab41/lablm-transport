# Security Audit

## Summary

The package does not log requests, headers, bodies, or credentials; no TLS verification bypass, custom insecure agent, or global TLS-disable switch exists in transport. Both typed-call fetch sites now set `redirect: 'manual'` and reject any 3xx response with `IntegrationRedirectBlockedError` before headers, retries, or body parsing occur (see TS-001, RESOLVED). The explicit upload pool does not follow redirects automatically. Both the typed client's body reads and `PoolManager`'s buffered upload response are now bounded by a required `maxResponseBytes`, enforced against decoded (post-decompression) bytes as they stream in, not against `Content-Length` (see TS-004, RESOLVED).

Security posture is nevertheless not production-safe without deployment constraints: current machine communication defaults to plaintext HTTP; pool keys can remain attached to a stale origin; and target/header/error policies are not explicit.

Severity count (open): `CRITICAL 0`, `HIGH 2`, `MEDIUM 3`, `LOW 0`, `INFO 1`. Resolved: `2` (TS-001, TS-004).

## TS-001 — Cross-origin redirects forward custom capability credentials

**ID:** TS-001<br>
**Category:** SECURITY<br>
**Severity:** HIGH<br>
**Kind:** CONFIRMED DEFECT<br>
**Status:** RESOLVED (2026-09-02)<br>
**Location:** `src/client.ts:96-102,187-197` (now includes the fix); backend inference auth strategy

**Observation (historical):** Fetch used the default `redirect: follow`. Node's bundled Undici strips standard auth/cookie headers on an origin change but does not strip arbitrary credential headers. Backend inference sends `x-inference-token` on every health request.

**Evidence (historical):** Node 22.13.1 bundled Undici 6.21.1 source sets redirect mode to `follow`, caps at 20, and deletes only `authorization`, `proxy-authorization`, `cookie`, and `host` cross-origin. The inference strategy returns both `Authorization` and `x-inference-token`.

**Failure Scenario (historical):** A compromised or misconfigured machine endpoint replies with a cross-origin 30x. Fetch follows it, drops the S2S bearer, but forwards the signed inference capability to the redirect destination.

**Impact (historical):** Capability disclosure/replay across a trust boundary; the token has a unique JTI and short lifetime, but may authorize an operation before expiry and affects every custom auth header added in future.

**Fix implemented:** Both `executeOnce` and `executeStream` now pass `redirect: 'manual'` to `fetch`. Verified empirically (Node 22.13.1) that with `redirect: 'manual'`, a cross-origin redirect target is never contacted at all — no header, standard or custom, is ever sent to it. Immediately after each fetch resolves and before any 401/403/`!response.ok`/body handling, a `REDIRECT_STATUS_CODES` check (`301`, `302`, `303`, `307`, `308`) throws the new `IntegrationRedirectBlockedError` (see `src/errors.ts`, exported from `src/index.ts`). This is a blanket policy — no allowlist or per-destination credential recompute — chosen over building new registry/allowlist infrastructure because no consumer (`inference-integration.module.ts`, `sim-integration.module.ts`, `llama.service.ts`) relies on redirect-following, matching this finding's own "prefer `redirect: error/manual`" recommendation. `IntegrationRedirectBlockedError` is not in `retry.ts`'s `isRetryable` list, so a blocked redirect is never retried. Regression-tested with real local HTTP servers in `src/client.redirect.spec.ts` (cross-origin credential non-leak, non-retry, streaming path, and a non-redirect happy-path check).

**Residual note:** This also resolves TS-005's "reevaluate after redirects" concern (redirects are never followed, so there is nothing to reevaluate) and does not change TS-006's header-composition/precedence behavior, which remains open.

**Confidence:** CONFIRMED fix verified against the same runtime version (Node 22.13.1) the original finding was confirmed against.

## TS-002 — A pool key can silently retain a stale origin

**ID:** TS-002<br>
**Category:** SECURITY<br>
**Severity:** HIGH<br>
**Kind:** CONFIRMED DEFECT<br>
**Location:** `src/pool-manager.ts:32-59`; FMS target derivation

**Observation:** `getOrCreatePool(poolKey, origin)` returns an existing pool without checking whether its origin matches the new origin. FMS keys are `machineId:diskName`, while machine IP/origin can be updated without changing that identity.

**Evidence:** Origin is used only in `new Pool(origin)` on first key use. Later calls with the same key ignore `origin`.

**Failure Scenario:** A machine IP changes or an address is reassigned. A later file upload carries an S2S token, upload capability, and file bytes intended for the new origin but is sent through the old pool to the prior address.

**Impact:** File and credential disclosure, data misdelivery, or writes to the wrong storage service. Blast radius is the FMS upload path rather than all typed-client consumers.

**Current Mitigation:** Pools close on application shutdown, and target IDs are stable logical disk identities. No runtime origin check exists.

**Recommended Direction:** Human decision on origin rotation: reject key/origin mismatch, rotate/close the pool atomically, or include a canonical origin generation in identity. Add a regression test before changing lifecycle semantics.

**Confidence:** CONFIRMED.

## TS-003 — Current machine credentials and uploads default to plaintext HTTP

**ID:** TS-003<br>
**Category:** SECURITY<br>
**Severity:** HIGH<br>
**Kind:** ARCHITECTURAL RISK<br>
**Location:** backend machine URL builders; machine-service llama configuration; FMS upload integration

**Observation:** Machine service URLs default to `http` and examples/defaults use private/loopback HTTP. Backend sends S2S bearer tokens, operation capability tokens, and upload bytes over those URLs. Transport neither upgrades nor rejects HTTP.

**Evidence:** URL builders default the protocol to HTTP; FMS origin derives from that builder; auth headers contain bearer/capability values. No transport TLS bypass exists because TLS is not used on those default paths.

**Failure Scenario:** An attacker with access to the machine network observes or modifies health, telemetry, inference, or FMS traffic and replays a still-valid credential or alters payloads.

**Impact:** Confidentiality/integrity loss. FMS upload tokens have a materially longer lifecycle than short S2S/inference tokens, and file contents may be exposed.

**Current Mitigation:** Targets are intended internal machines; signed tokens are scoped/expiring and inference has replay protection. No documented network encryption guarantee was found in the audited scope.

**Recommended Direction:** Architecture decision: require HTTPS/mTLS, or document and enforce an equivalent protected-network/tunnel boundary. Do not add an unconditional transport HTTPS rule until local-loopback and deployment topology are classified.

**Confidence:** CONFIRMED application behavior; practical exposure is UNCLEAR without deployment network controls.

## TS-004 — Buffered and decompressed response size is unbounded

**ID:** TS-004<br>
**Category:** SECURITY<br>
**Severity:** HIGH<br>
**Kind:** MISSING GUARANTEE<br>
**Status:** RESOLVED (2026-09-02)<br>
**Location:** `src/client.ts` (`readBoundedText`, replacing the old `safeParseJson`); `src/pool-manager.ts:46-54`

**Observation (historical):** Typed calls read successful/error bodies fully as text, and PoolManager accumulates all response chunks before concatenation. No byte limit exists before or after automatic decompression.

**Evidence (historical):** `Response.text()` and `Buffer.concat(chunks)` are the only body readers. Fetch/Undici decompression is delegated to the runtime with no package cap.

**Failure Scenario (historical):** A malicious/failed registered machine sends a huge or compression-amplified JSON/error body. The backend or machine service buffers it and can exhaust heap or trigger severe garbage collection.

**Impact (historical):** Process-wide availability loss from one dependency response; typed-client blast radius includes every non-streaming consumer.

**Fix implemented:** `ClientConfig` gained a required `maxResponseBytes: number` field (mirroring `timeoutMs` — a flat, required scalar, not an optional silent default), with `DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024` exported from `src/defaults.ts`. `safeParseJson(Response)` was replaced by `readBoundedText(response, maxBytes, targetService, path)`, which reads via `response.body.getReader()` and counts bytes as they arrive; the moment the running total exceeds the cap it calls `reader.cancel()` and throws the new `ResponseTooLargeError` — before the body is fully materialized and before any schema parsing. This is used for both the success body and the `errorSchema`-parsed error body in `executeOnce`, and the non-2xx error body in `executeStream`. `PoolManager.streamUpload` got the same treatment: `StreamUploadConfig.maxResponseBytes` (also required) is checked inside the existing `for await` chunk loop, throwing `ResponseTooLargeError` before `Buffer.concat`. Verified empirically (Node 22.13.1) that a 1004-byte gzip response can decode to 1,000,000 bytes, and that `Content-Length` reflects only the wire size — so enforcement counts the actual decoded bytes read from `response.body`, not `Content-Length`, per this finding's own "ideally before or during decompression" direction. `ResponseTooLargeError` is not in `retry.ts`'s `isRetryable` list, so it is never retried. `executeStream`'s success path (the raw stream handed to the caller) is deliberately untouched — that is a separate, already-tracked time/cancellation concern (TR-001), not a buffering one. Regression-tested with real local HTTP servers, including a gzip-decompression-bomb case, in `src/client.size-limit.spec.ts` and `src/pool-manager.spec.ts` (PoolManager's first test file).

**Consumer updates:** all four call sites now pass the field explicitly — `inference-integration.module.ts`, `sim-integration.module.ts`, and `llama.service.ts` (`createTransportClient`), and `fms-integration.service.ts` (`StreamUploadConfig`) — all using `DEFAULT_MAX_RESPONSE_BYTES`. Making the field required meant `tsc` caught every call site that needed updating; none was missed. 10 MiB was chosen as generous for every known legitimate payload (SIM/inference-health responses are KB-scale; the one consumer with a large legitimate response, llama.cpp's non-streaming chat completion, has no `max_tokens` upper bound but realistically produces well under 1 MiB of text) while still bounding a compromised/misbehaving endpoint's amplification to a small fixed multiple of that instead of unbounded memory growth.

**Residual note:** Does not touch TA-002 (PoolManager's separately-weaker error/retry/schema regime — it now shares one error class with the typed client for this one guarantee, nothing else), TR-003 (PoolManager cancellation/deadline gap — orthogonal to buffering), or TQ-004 (schema/error-body ambiguity — a size-capped read still hands `parseJsonText`'s same undefined/string/parsed-JSON output to schema code, unchanged from before).

**Confidence:** CONFIRMED fix verified against the same runtime version (Node 22.13.1) the original finding was confirmed against.

## TS-005 — Dynamic target control is delegated without a transport trust policy

**ID:** TS-005<br>
**Category:** SECURITY<br>
**Severity:** MEDIUM<br>
**Kind:** ARCHITECTURAL RISK<br>
**Location:** `ReqInput.baseUrl`; backend machine registration/health/FMS origin paths

**Observation:** Any caller can override the client base URL. Current backend origins ultimately derive from stored IPs submitted through authorized APIs; inference health also permits caller-selected HTTP/HTTPS and a positive port. The transport does not classify or constrain loopback, link-local, metadata, private ranges, or ports.

**Evidence:** `input.baseUrl ?? config.baseUrl` is used directly. DTOs validate IP syntax but not allowed ranges/ownership. Generic transport lacks target policy hooks.

**Failure Scenario:** A principal able to register/change/check a machine points the backend at an unintended internal service or link-local target, causing credential-bearing requests to a chosen host/port/path.

**Impact:** SSRF-style network reachability and credential presentation outside the intended machine set. Exact exploitability depends on authorization and network topology.

**Current Mitigation:** Machine CRUD/health routes have authentication and permission guards; most port/protocol values are server configuration; descriptors use fixed paths.

**Recommended Direction:** Keep dynamic internal targets supported, but validate target provenance/ranges/ports in the owning application and optionally pass a target-policy strategy to transport. ~~Bind credentials to the validated destination and reevaluate after redirects.~~ Moot as of TS-001's fix: redirects are never followed, so there is no post-redirect destination to reevaluate credentials against.

**Confidence:** CONFIRMED capability; exploitability is STRONGLY INFERRED/UNCLEAR by deployment.

## TS-006 — Header precedence is broad and case-insensitive duplication is possible

**ID:** TS-006<br>
**Category:** SECURITY<br>
**Severity:** MEDIUM<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** `src/client.ts:85-92,178-197`; `AuthStrategy`

**Note:** Unaffected by TS-001's fix — header composition itself (spread order, casing) is unchanged; only the post-fetch redirect check was added.

**Observation:** Auth headers are spread after transport defaults, so an auth strategy can replace `Accept`/`Content-Type`. Differently cased duplicates survive object creation and Fetch combines them. There is no allowlist or duplicate check.

**Evidence:** In the audited runtime, a record with `Authorization` and `authorization` becomes a comma-joined authorization value; the same occurs for `Accept`. PoolManager accepts arbitrary caller headers with no normalization policy.

**Failure Scenario:** A composed auth strategy accidentally emits a lower-case duplicate or overrides content framing, causing ambiguous authorization or request interpretation.

**Impact:** Authentication failures, request smuggling-like ambiguity at intermediaries, or mismatched body parsing. Current concrete strategies do not collide.

**Current Mitigation:** Typed calls have no general caller-header input; discovered strategies use consistent names.

**Recommended Direction:** Normalize case, assign ownership by header, reject duplicates for security-sensitive headers, and narrow auth output to credential/correlation headers. Test precedence at a real server.

**Confidence:** CONFIRMED API/runtime behavior.

## TS-007 — Errors and metadata may retain arbitrary upstream data

**ID:** TS-007<br>
**Category:** SECURITY<br>
**Severity:** MEDIUM<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** `src/errors.ts`; `src/client.ts:119-142`; FMS integration logging

**Observation:** `UpstreamError.body` may hold arbitrary raw JSON/text, `retryAfterHeader` is retained verbatim, success metadata returns all response headers, and dynamic paths/causes are public fields. No safe serializer/redactor exists. FMS logs raw failed bodies.

**Evidence:** Transport itself performs no logging, but fields are enumerable and available to structured loggers. FMS explicitly passes `JSON.stringify(rawBody)` to `logger.error`.

**Failure Scenario:** An upstream reflects credentials/personal data in an error body/header; application-wide exception logging or FMS logging persists it.

**Impact:** Sensitive data disclosure in logs/telemetry. Auth request headers are not directly copied, which limits current exposure.

**Current Mitigation:** Transport messages omit request headers/body and current canonical FMS error schema is small. Some adapters log only class/error codes.

**Recommended Direction:** Define bounded, schema-approved error details and an explicit redacted serializer; filter response headers; stop raw fallback logging. Preserve safe causes for diagnostics.

**Confidence:** CONFIRMED retention; sensitive content occurrence is service-dependent.

## TS-008 — TLS verification is not weakened in transport

**ID:** TS-008<br>
**Category:** SECURITY<br>
**Severity:** INFO<br>
**Kind:** INTENTIONAL DESIGN<br>
**Location:** all package source

**Observation:** No `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED`, custom insecure dispatcher/agent, or certificate bypass exists in transport.

**Evidence:** Global Fetch and `new Pool(origin)` receive no TLS overrides. Redirects to non-HTTP(S) schemes are rejected by Fetch; PoolManager does not install redirect handling.

**Failure Scenario:** Not a defect. Future debugging changes could weaken this invariant.

**Impact:** Positive baseline; HTTPS uses runtime certificate verification.

**Current Mitigation:** Runtime defaults.

**Recommended Direction:** Preserve and mechanically ban TLS-disable patterns; separately resolve plaintext HTTP topology in TS-003.

**Confidence:** CONFIRMED.
