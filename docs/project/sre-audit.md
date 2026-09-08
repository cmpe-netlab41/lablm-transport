# Resilience, SRE, and Observability Audit

Severity count: `CRITICAL 0`, `HIGH 3`, `MEDIUM 7`, `LOW 0`, `INFO 1`.

## Current retry and time model

`maxAttempts` includes the initial attempt. Typed calls retry only when both the descriptor is transport-idempotent and the error is timeout, network, or HTTP `429/502/503/504`. POST/PATCH are one attempt by default. Streams and PoolManager uploads do not use `withRetry`.

Nominal calculations below assume auth resolves, every attempt reaches its response-header timeout, configuration values remain unchanged, and no body is read. They are **not actual overall bounds** because auth, buffered bodies, stream lifetime, and some retry delays can outlive the timer.

| Policy | Attempts | Per-attempt configured timer | Backoffs before attempts 2/3 | Nominal maximum to headers | Retry-After | Jitter |
|---|---:|---:|---|---:|---|---|
| Internal default | 3 | 30s | 70–130ms; 140–260ms | ~90.39s | Ignored | centered ±30%, capped per computed backoff |
| External default, no Retry-After | 3 | 30s | 350–650ms; 700–1300ms | ~91.95s | Enabled | centered ±30%, bypassed by Retry-After |
| External default, Retry-After | 3 | 30s | Remote value | Not policy-bounded | Any retryable status with header; permissive parse; no cap | None for header-directed delay |

Current consumers specialize this further:

| Operation | Attempt behavior | Configured timer | Nominal maximum / lifetime |
|---|---|---:|---|
| Backend SIM system info GET | 3 internal attempts | 15s | ~45.39s to headers; body still unbounded |
| Backend inference health GET | 3 internal attempts | 15s | ~45.39s to headers; body still unbounded |
| Backend SIM telemetry stream | 1 attempt plus caller reconnect | 15s | 15s to headers; intended long-lived stream, caller cancellation only |
| llama.cpp health GET | 3 internal attempts | 60s | ~180.39s to headers; body still unbounded |
| llama.cpp completion POST | 1 attempt | 60s | 60s to headers; body still unbounded |
| llama.cpp streaming POST | 1 attempt | 60s | 60s to headers; intended long-lived stream |
| FMS PoolManager PUT upload | 1 library attempt | no explicit package policy | Undici implementation defaults include 300s header/body inactivity timeouts; no overall bound or caller cancellation |

## TR-001 — Configured timeout is not an operation or complete-attempt bound

**ID:** TR-001<br>
**Category:** RELIABILITY<br>
**Severity:** HIGH<br>
**Kind:** CONFIRMED DEFECT<br>
**Location:** `src/client.ts:70-110,129-142,158-211`

**Observation:** The timer starts before auth but cannot interrupt auth. It is cleared when Fetch resolves headers, before body buffering and schema parsing. If auth rejects, setup cleanup is skipped. Streaming error bodies are read after both timeout and caller listener are removed.

**Evidence:** `authStrategy` is awaited outside Fetch's `try/finally`; `safeParseJson` runs after that `finally`. Caller signals are detached before non-stream body reads.

**Failure Scenario:** An auth provider hangs; or an upstream returns headers then trickles a huge/never-ending body. The operation exceeds `timeoutMs` indefinitely. Repeated auth failures leave timers/listeners alive until later expiry/abort.

**Impact:** Callers cannot calculate latency bounds; work and memory can persist after their expected budget. Blast radius covers every typed-client operation.

**Current Mitigation:** Current auth normally signs synchronously/quickly; response schemas expect small bodies; Fetch cancellation works before headers.

**Recommended Direction:** Define attempt and overall deadline semantics first. In remediation, include auth/body/parsing as decided, compose caller/deadline signals, and guarantee cleanup in one outer `finally`. Add fake-timer and slow-body real-server tests.

**Confidence:** CONFIRMED.

## TR-002 — Nested health retries can amplify to nine orphaned llama attempts

**ID:** TR-002<br>
**Category:** SRE<br>
**Severity:** HIGH<br>
**Kind:** CONFIRMED DEFECT<br>
**Location:** backend inference integration; machine-service inference health controller/service; llama client

**Observation:** Backend `/v1/health` calls make three 15s attempts. Each machine handler calls llama health with three 60s attempts. The machine health controller does not turn client disconnect into an AbortSignal, unlike its chat-completion handler.

**Evidence:** The consumer call chain is documented in `consumer-inventory.md`; both layers use `INTERNAL_RETRY_CONFIG`. `InferenceController.health()` calls `InferenceService.health()` without a signal.

**Failure Scenario:** llama.cpp hangs. Backend aborts each machine request after 15s and retries, while the machine continues each abandoned 3-attempt llama loop for up to ~180.39s nominally.

**Impact:** One logical health check can create up to nine llama attempts, overlap abandoned work, consume connections/capacity, and worsen an outage.

**Current Mitigation:** Retry counts are finite and backend returns/fails on its own shorter timer. Health is read-only.

**Recommended Direction:** Decide retry ownership and propagate request close/deadline through machine health to llama. Consider reducing one layer's retries only after modeling desired availability. Add an end-to-end cancellation/amplification test.

**Confidence:** CONFIRMED from code-path composition.

## TR-003 — Stream-upload operation has no explicit overall deadline or cancellation

**ID:** TR-003<br>
**Category:** RELIABILITY<br>
**Severity:** HIGH<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** `src/pool-manager.ts:32-45`; backend FMS upload path

**Observation:** PoolManager exposes no signal or timeout options. It waits for an inbound `Readable` upload, remote headers, and a fully buffered response. Undici defaults are implementation/version behavior, not a package contract, and idle timers do not create an overall deadline.

**Evidence:** `pool.request` receives method/path/headers/body only. The installed Pool defaults header/body inactivity timeout to 300 seconds and permits ongoing progress to extend total duration.

**Failure Scenario:** Client upload or storage target trickles indefinitely, the client disconnects without the signal reaching Pool.request, or the response never completes while making periodic progress.

**Impact:** Open inbound/outbound connections, upload reservations, streams, and memory can be retained indefinitely; FMS availability degrades.

**Current Mitigation:** The source stream should error on some inbound disconnects; machine service limits received file size; application cleanup catches rejected uploads. No explicit transport proof exists.

**Recommended Direction:** Define caller cancellation, upload/read idle timeout, overall deadline, and cleanup ownership for the upload API. Preserve no-retry semantics for non-replayable streams unless an end-to-end resumable/idempotent design exists.

**Confidence:** CONFIRMED API gap; exact runtime hang cases need real-server tests.

## TR-004 — Retry-After bypasses configured delay bounds

**ID:** TR-004<br>
**Category:** RELIABILITY<br>
**Severity:** MEDIUM<br>
**Kind:** CONFIRMED DEFECT<br>
**Location:** `src/retry.ts:39-53`

**Observation:** When enabled, Retry-After is returned directly without `maxDelayMs` or overall-deadline clamping. `parseInt` accepts partial/fractional/negative strings before HTTP-date parsing. The header is honored on all retryable statuses (`429/502/503/504`), not only the type comment's `429/503`.

**Evidence:** `computeDelay` returns parsed milliseconds immediately. Values such as `10garbage` parse as 10 seconds and `-1` as negative delay; remote HTTP dates can request very long waits.

**Failure Scenario:** A provider sends a malformed or multi-day Retry-After, suspending worker progress far beyond the configured maximum or causing surprising near-zero timer behavior.

**Impact:** External-policy wall-clock duration is not understandable or policy-bounded.

**Current Mitigation:** No discovered consumer currently uses `EXTERNAL_RETRY_CONFIG`; internal policy ignores the header.

**Recommended Direction:** Strictly parse delta-seconds/HTTP-date, reject negative/malformed values, cap against both retry delay and remaining overall deadline, and define applicable statuses.

**Confidence:** CONFIRMED.

## TR-005 — Caller cancellation does not interrupt retry backoff

**ID:** TR-005<br>
**Category:** RELIABILITY<br>
**Severity:** MEDIUM<br>
**Kind:** CONFIRMED DEFECT<br>
**Location:** `src/retry.ts:56-76`; `src/client.ts:277-289`

**Observation:** `withRetry` has no signal; sleep is a plain timer. Cancellation during backoff waits for the full delay and then starts another attempt/auth operation before Fetch observes the already-aborted signal.

**Evidence:** The retry callback closes over opts, but retry scheduling cannot inspect it.

**Failure Scenario:** A caller disconnects during a long Retry-After. The promise remains pending and later mints credentials/starts attempt setup despite cancellation.

**Impact:** Wasted work and slow cancellation; potentially severe when Retry-After is unbounded.

**Current Mitigation:** Default internal backoffs are short; the aborted Fetch itself is not retried because raw AbortError is non-retryable.

**Recommended Direction:** Make backoff abortable and check cancellation/deadline before auth and every attempt. Preserve timeout-versus-caller-cancel error distinction.

**Confidence:** CONFIRMED.

## TR-006 — Pool count and connection concurrency are not bounded by package policy

**ID:** TR-006<br>
**Category:** SRE<br>
**Severity:** MEDIUM<br>
**Kind:** ARCHITECTURAL RISK<br>
**Location:** `src/pool-manager.ts:29-62`

**Observation:** The map grows for every unique key until shutdown, and each Undici Pool uses the default `connections: null` (no client-count limit). No pending-request/backpressure policy is exposed. Origin/key mismatch is the separate HIGH security finding TS-002.

**Evidence:** Pools are created with `new Pool(origin)` and removed only by `closeAll()`.

**Failure Scenario:** Many target IDs or concurrent uploads create large numbers of pools/connections and overwhelm process descriptors, memory, or storage services.

**Impact:** Resource exhaustion and downstream overload under burst or adversarial workload.

**Current Mitigation:** Eligible targets are finite registered machine disks; application/auth/throttling may bound access, but no reviewed transport/caller limit was found for this path.

**Recommended Direction:** Decide whether queue/concurrency ownership belongs to upload orchestration or PoolManager; configure explicit limits and idle/rotation lifecycle only after load requirements are known.

**Confidence:** CONFIRMED library defaults; production pressure is UNCLEAR.

## TR-007 — Retry configuration validity is assumed

**ID:** TR-007<br>
**Category:** RELIABILITY<br>
**Severity:** MEDIUM<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** `src/retry.ts`; `src/types.ts:52-61`

**Observation:** `maxAttempts`, delays, factors, and jitter are not normalized or validated. Non-finite/negative values can break the loop/timer model, and shared default objects are mutable.

**Evidence:** A zero-attempt loop reaches `throw lastError` with `undefined`; arithmetic/timers receive values directly.

**Failure Scenario:** Environment-derived config or mutation creates zero attempts, synchronous retries, NaN backoff, or unexpectedly global policy changes.

**Impact:** Unclassified configuration failures and unpredictable recovery behavior.

**Current Mitigation:** Current consumers use the package constants and explicit positive timeouts.

**Recommended Direction:** Validate and freeze a normalized policy at client construction, with tests for invalid values.

**Confidence:** CONFIRMED.

## TR-008 — Failure taxonomy lacks several operational distinctions

**ID:** TR-008<br>
**Category:** RELIABILITY<br>
**Severity:** MEDIUM<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** `src/errors.ts`; `src/client.ts` error branches

**Observation:** DNS, TLS, connection, invalid-target, and unexpected Fetch failures all become `IntegrationNetworkError`; caller abort remains a raw runtime error; 429 is only status-bearing `UpstreamError`; invalid JSON and schema mismatch collapse into contract errors; auth/config/serialization errors are raw. Retry outcome/count is absent.

**Evidence:** Six classes and `instanceof` branches are the complete model. Some current consumers match error-name text for timeout or stringify message text.

**Failure Scenario:** Operators cannot separate TLS rollout failure from DNS outage, or a caller cannot reliably distinguish local auth/config failure from an unexpected bug without parsing cause/message.

**Impact:** Coarse alerts, brittle mappings, and reduced remediation automation. Existing categories for timeout/auth/status/contracts are still useful.

**Current Mitigation:** Network error retains an optional cause; status and target/path are preserved; caller abort generally has `AbortError`.

**Recommended Direction:** Define a compact discriminated taxonomy and safe metadata based on caller actions. Avoid excessive subclasses; add attempts/retry outcome and standard cause linkage.

**Confidence:** CONFIRMED.

## TO-001 — Transport-level observability is insufficient for SRE questions

**ID:** TO-001<br>
**Category:** OBSERVABILITY<br>
**Severity:** MEDIUM<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** package source; backend/machine telemetry bootstrap

**Observation:** No descriptor name, hooks, metrics, or explicit spans exist. Metadata reports final-attempt header latency only. Auto-instrumentation in both services should create HTTP/Undici spans and propagate trace context, but does not expose logical endpoint, retries as one operation, schema failures, or safe transport metrics. FMS also logs the same failed operation in both integration and domain layers.

**Evidence:** No observability imports in transport; descriptors lack names; both apps start OpenTelemetry auto-instrumentation before Nest.

**Failure Scenario:** Operators see several HTTP spans without knowing they are retries, cannot count timeout/schema failures by stable endpoint, or label full dynamic URLs externally.

**Impact:** It is hard to answer how many attempts occurred, final operation duration, why parsing failed, or which logical dependency is unhealthy.

**Current Mitigation:** Errors carry target service/path; correlation headers exist on SIM; application logs record selected failures; auto traces provide low-level visibility. No package metrics exist, so there is no current transport metric-label cardinality defect.

**Recommended Direction:** Add backend-neutral lifecycle/retry hooks or explicit spans after defining stable descriptor identity and redaction/cardinality policy. Decide metrics ownership rather than embedding a framework.

**Confidence:** CONFIRMED package gap; exact exported auto-span attributes were not runtime-tested.

## TR-009 — Streaming cleanup depends on explicit consumer behavior

**ID:** TR-009<br>
**Category:** RELIABILITY<br>
**Severity:** MEDIUM<br>
**Kind:** UNCLEAR SEMANTICS<br>
**Location:** `src/client.ts:242-275`; backend/machine stream parsers

**Observation:** Wrapper cleanup runs on stream completion/error/cancel. A consumer that stops reading and merely releases its reader does not invoke stream cancellation; adapter generators release locks in `finally` but do not themselves cancel.

**Evidence:** `withCleanup` has no hook for consumer lock release/abandonment, and parser finalizers call `reader.releaseLock()`.

**Failure Scenario:** A consumer breaks early without aborting/canceling; the underlying reader/connection and external abort listener remain retained.

**Impact:** Connection/listener leaks for non-lifecycle-aware consumers.

**Current Mitigation:** Current telemetry manager owns an AbortController and aborts on reconnect/close; llama request close is propagated for chat streams.

**Recommended Direction:** Specify early-stop protocol and make adapter generators cancel in `finally` when they did not reach EOF. Test completion, early break, abort, read failure, and listener cleanup.

**Confidence:** STRONGLY INFERRED from Streams semantics; needs real runtime proof.

## TR-010 — Current idempotency/body replay behavior is conservative

**ID:** TR-010<br>
**Category:** RELIABILITY<br>
**Severity:** INFO<br>
**Kind:** INTENTIONAL DESIGN<br>
**Location:** descriptors, typed client, current consumers

**Observation:** POST/PATCH are one attempt unless explicitly opted in; typed retry bodies are JSON-stringified anew; stream calls and Node Readable uploads are not retried. No consumer currently opts a write into retry.

**Evidence:** Helper defaults and consumer inventory.

**Failure Scenario:** Future code can still set `idempotent: true` without proof or key; the library cannot verify business semantics.

**Impact:** Safe current default with a review-enforced override risk.

**Current Mitigation:** Explicit flag and no automatic idempotency key.

**Recommended Direction:** Preserve default; document evidence/key/replay requirements and add regression tests before adding write retries.

**Confidence:** CONFIRMED.

## Stateful resilience assessment

| Mechanism | Current | Need |
|---|---|---|
| Circuit breaker | None | Not demonstrated. Do not add without dependency failure/load evidence. |
| Bulkhead / typed-client concurrency limit | None | Potentially useful only if caller queues do not own limits. |
| Pool upload concurrency limit | None; Undici pool clients unbounded by default | Potentially useful; ownership decision required because upload orchestration has domain context. |
| Overall retry budget/deadline propagation | None | Required for the nested health path before claiming bounded behavior. |
| Backpressure | Web streams and Node Readable provide per-stream backpressure; pool/operation admission is unbounded | Partial; load testing and ownership decision required. |
