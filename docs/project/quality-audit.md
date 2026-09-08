# Quality and Architecture Audit

## Summary

The non-streaming response-validation core is small, understandable, framework-free, and returns Zod-parsed wire values. POST is non-retryable by default. Those intended rules are confirmed.

The API is not yet production-grade as a general typed transport: request types do not flow end to end, request schemas are unused at runtime, URL/header/body semantics contain implicit behavior, the package has no working lint gate or tests, and the public root combines a typed client with a substantially weaker streaming-upload primitive. Backend consumers also do not consistently honor the claimed domain-port/ACL boundary.

Severity count in this document: `CRITICAL 0`, `HIGH 0`, `MEDIUM 7`, `LOW 2`, `INFO 1`.

## TQ-001 — Request descriptor typing does not protect call input

**ID:** TQ-001<br>
**Category:** QUALITY<br>
**Severity:** MEDIUM<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** `src/types.ts:12-38,92-102`; `src/client.ts:277-289`

**Observation:** `ReqSchema` is never used to type `ReqInput.body`; `TransportClient.call` erases request/error descriptor generics with `any`; and `requestSchema` is explicitly not parsed at runtime.

**Evidence:** The public call accepts `input: ReqInput` where `body?: unknown`, regardless of descriptor request schema. Current callers can omit a required body or send a mismatched value without a transport type/runtime error.

**Failure Scenario:** A descriptor declares a canonical request schema, but an adapter passes a renamed/malformed field. Compilation succeeds; JSON is sent; failure occurs remotely or creates an unintended operation.

**Impact:** The advertised typed endpoint model is response-safe but not end-to-end request-safe. Contract drift can escape local verification.

**Current Mitigation:** Current backend retryable calls are bodyless GETs. Llama inbound domain DTO validation and mapper construction reduce risk for its POSTs.

**Recommended Direction:** In a remediation pass, decide whether request schemas are runtime-enforced or compile-time-only; derive body/input types from the descriptor and test missing/malformed bodies. Preserve an explicit escape hatch only for intentionally untyped protocol payloads.

**Confidence:** CONFIRMED.

## TQ-002 — URL and path semantics rely on string concatenation

**ID:** TQ-002<br>
**Category:** QUALITY<br>
**Severity:** MEDIUM<br>
**Kind:** UNCLEAR SEMANTICS<br>
**Location:** `src/client.ts:26-45`; `src/descriptors.ts:76-91`

**Observation:** Base/path joining trims/prepends one slash but is not URL-aware. `endpoint()` substitutes raw values, only the first matching placeholder, without encoding. Paths may already contain query/fragment content while `input.query` blindly appends another `?`.

**Evidence:** Values containing `/`, `..`, `?`, `#`, `%`, or Unicode are inserted directly. Multiple trailing base slashes survive partially. Arrays/objects become JSON in a single query parameter; `null` is omitted and repeated keys are impossible.

**Failure Scenario:** A future descriptor uses a user-controlled path parameter containing `/../admin` or `?mode=x`, changing the parsed URL. Another endpoint expects repeated query keys but emits a JSON string.

**Impact:** Correctness and target-path containment depend on undocumented caller discipline.

**Current Mitigation:** All discovered production descriptors use static paths; `endpoint()` has no discovered consumer.

**Recommended Direction:** Define relative-path, base-prefix, encoding, query-array, empty/null, and existing-query policy before changing code; implement with URL-aware component handling and a dedicated matrix.

**Confidence:** CONFIRMED implementation; risk is prospective for current consumers.

## TQ-003 — Package quality gates are incomplete

**ID:** TQ-003<br>
**Category:** QUALITY<br>
**Severity:** MEDIUM<br>
**Kind:** CONFIRMED DEFECT<br>
**Location:** `package.json`; `tsconfig.json`; repository ESLint configuration

**Observation:** The declared lint script fails because no ESLint flat config applies to this package. TypeScript disables several strictness/correctness checks. There is no test script or package test suite.

**Evidence:** `npm run lint` exits 2 with “ESLint couldn't find an eslint.config” while typecheck/build pass. `strictNullChecks`, `noImplicitAny`, `strictPropertyInitialization`, casing, and switch fallthrough checks are disabled.

**Failure Scenario:** A public type regression, unsafe `any`, or invalid retry/abort branch merges while CI's intended package lint/test gates provide no signal.

**Impact:** Static and behavioral confidence is materially below production-library expectations.

**Current Mitigation:** TypeScript compilation succeeds, consumer applications have their own tests, and CI intends to run monorepo lint/typecheck/build/test.

**Recommended Direction:** Add a package-scoped lint config through the repository config package, stage strictness improvements with consumer impact review, and add focused transport tests before runtime remediation.

**Confidence:** CONFIRMED; failure predates this documentation pass.

## TA-001 — Backend consumers bypass claimed domain-owned ports

**ID:** TA-001<br>
**Category:** ARCHITECTURE<br>
**Severity:** MEDIUM<br>
**Kind:** ARCHITECTURAL RISK<br>
**Location:** backend machine registry/health/NDrive domains and `apps/backend/src/integrations/machine-service/*`

**Observation:** Backend domain services inject/import `SimIntegrationService`, `InferenceIntegrationService`, `FmsIntegrationService`, and an integration-owned upload target/result model directly. SIM exposes canonical wire types as its service API.

**Evidence:** Repository imports show machine registry/health and NDrive depending on concrete integration paths. This disagrees with the README rule that domains depend only on domain-owned ports and receive domain values.

**Failure Scenario:** A transport/error/wire change forces domain edits or lets transport error types and canonical wire shapes become de facto domain contracts.

**Impact:** Reduced replaceability and larger semantic blast radius; intended ACL isolation is only partially true.

**Current Mitigation:** Calls are physically grouped under `integrations/`, use runtime schemas, and do not call Fetch directly. Machine-service's llama path correctly implements a domain-owned port.

**Recommended Direction:** Human architecture decision: either introduce backend domain-owned ports and pure mappings, or explicitly narrow the architecture claim for these simple internal integrations. Do not mechanically add pass-through interfaces without deciding value.

**Confidence:** CONFIRMED architecture drift.

## TA-002 — Public package exposes two transport regimes with unequal guarantees

**ID:** TA-002<br>
**Category:** ARCHITECTURE<br>
**Severity:** MEDIUM<br>
**Kind:** ARCHITECTURAL RISK<br>
**Location:** `src/index.ts`; `src/client.ts`; `src/pool-manager.ts`

**Observation:** Root exports present `PoolManager` beside the typed client, but PoolManager delegates auth, response parsing, error taxonomy, retry, timeout, cancellation, headers, and target policy to callers. Public `withRetry` also exposes a low-level policy helper independently.

**Evidence:** The FMS consumer manually builds credentials, parses bodies, logs failures, and constructs transport errors. No common safety interface applies.

**Failure Scenario:** A new consumer chooses the convenient primitive and assumes typed-client guarantees that are absent, producing inconsistent security and SRE behavior.

**Impact:** Governance and remediation must cover two APIs; package name alone does not identify guarantees.

**Current Mitigation:** PoolManager is currently used only for a Node-readable streaming upload that global Fetch ergonomics did not serve; its consumer performs canonical response parsing.

**Recommended Direction:** Explicitly classify the upload API as a separate governed capability (possibly a subpath/interface), define its required guarantees, and reconsider whether `withRetry` must be public. Preserve current runtime behavior until consumer design is reviewed.

**Confidence:** CONFIRMED.

## TQ-004 — Success/error body semantics are schema-dependent but undocumented and untested

**ID:** TQ-004<br>
**Category:** QUALITY<br>
**Severity:** MEDIUM<br>
**Kind:** UNCLEAR SEMANTICS<br>
**Location:** `src/client.ts:47-55,112-142,214-240`

**Observation:** Content type is ignored; invalid JSON becomes text; empty success becomes `undefined`; 204/205 use the same parsing path; non-2xx bodies are skipped unless an error schema exists; 401/403 bodies are never consumed; streams accept any 2xx body/media type. Unknown-field stripping/passthrough is delegated entirely to each Zod schema.

**Evidence:** `safeParseJson` reads text and falls back to the raw string. All success meaning is delegated to the response schema. Error parsing behavior differs between typed and streaming calls.

**Failure Scenario:** An HTML 200 page passes a permissive string schema, a legitimate 204 fails a JSON-object schema, or an unconsumed error body delays connection reuse.

**Impact:** Consumers cannot confidently predict edge-status/media behavior and regressions have no tests.

**Current Mitigation:** Current canonical success schemas are objects and reject unexpected strings; ordinary Zod objects strip unknown fields by default; consumer adapters handle streams.

**Recommended Direction:** Decide and document media/empty-body/error-drain semantics, then add tests before altering them. Keep runtime schema parse as the final success authority.

**Confidence:** CONFIRMED.

## TA-003 — llama.cpp wire ownership and trust classification are unclear

**ID:** TA-003<br>
**Category:** ARCHITECTURE<br>
**Severity:** MEDIUM<br>
**Kind:** UNCLEAR SEMANTICS<br>
**Location:** machine-service `llama.service.ts` and `llama.mapper.ts`

**Observation:** The target is a separate llama.cpp process using an OpenAI-compatible contract, yet its client is marked `trust: internal`. Response schemas are local (reasonable for a third-party boundary), while `LlamaChatCompletionRequestBody` aliases the domain `InferenceRequestModel` and no request schema exists.

**Evidence:** Contract violations are classified as internal bugs, and the mapper's wire request type is a direct domain alias with a spread plus `stream` change.

**Failure Scenario:** A llama.cpp version changes its external response and is alerted as an internally owned contract defect; domain model evolution silently changes the wire request.

**Impact:** Error ownership and anti-corruption-layer independence are ambiguous.

**Current Mitigation:** The adapter has pure-looking mapper methods and runtime response/chunk Zod parsing. The target is usually a controlled local process.

**Recommended Direction:** Decide whether the deployment owns/version-locks the llama.cpp wire contract. Then align trust classification and define an independent request wire schema/type without moving it into generic transport.

**Confidence:** CONFIRMED code; ownership decision is UNCLEAR.

## TQ-005 — Public generic configuration accepts invalid retry/timeout values

**ID:** TQ-005<br>
**Category:** QUALITY<br>
**Severity:** LOW<br>
**Kind:** MISSING GUARANTEE<br>
**Location:** `src/types.ts:52-75`; `src/retry.ts:32-79`; `src/client.ts`

**Observation:** There is no runtime validation for finite positive attempts/timeouts, non-negative delays, sensible factors, or jitter range. Exported default objects are mutable.

**Evidence:** `maxAttempts <= 0` can throw `undefined`; negative/NaN delays and factors reach timer/math APIs; consumers can mutate shared retry constants.

**Failure Scenario:** Misconfiguration disables attempts, creates immediate retry loops, or alters shared defaults process-wide.

**Impact:** Configuration/programming failures are late and poorly classified.

**Current Mitigation:** Discovered consumers use exported literals and positive timeout values.

**Recommended Direction:** Validate/freeze normalized client policy at creation in a later behavior-change pass.

**Confidence:** CONFIRMED.

## TQ-006 — Documentation contains stale or framework-specific claims

**ID:** TQ-006<br>
**Category:** QUALITY<br>
**Severity:** LOW<br>
**Kind:** CONFIRMED DEFECT<br>
**Location:** package `README.md`; `src/types.ts:48-50`; backend inference integration comments

**Observation:** The README claims low-level HTTP is banned everywhere, the auth type says strategies read `nestjs-cls`, and a backend comment says transport streaming is GET-only. Repository evidence contradicts all three as universal/current statements.

**Evidence:** Enforcement is workspace-specific; auth is generic and some strategies do not use CLS; `streamPost` exists and is used.

**Failure Scenario:** Maintainers make decisions based on stale constraints or assume enforcement exists where it does not.

**Impact:** Low immediate runtime risk, but it increases future agent error probability.

**Current Mitigation:** Source code is compact enough to inspect.

**Recommended Direction:** Reconcile README/source comments during the remediation/enforcement pass, using these project docs as evidence.

**Confidence:** CONFIRMED.

## TQ-007 — Response wire validation itself is correctly implemented

**ID:** TQ-007<br>
**Category:** QUALITY<br>
**Severity:** INFO<br>
**Kind:** INTENTIONAL DESIGN<br>
**Location:** `src/client.ts:129-142`

**Observation:** Non-streaming 2xx bodies are passed through the descriptor's required Zod schema, and `parsed.data` is returned. Internal/external trust selects distinct contract error classes.

**Evidence:** No response cast substitutes for this parse path. Backend descriptors use canonical runtime schemas.

**Failure Scenario:** Not a defect; weakening or bypassing this path would remove a core boundary guarantee.

**Impact:** Positive high-value architecture constraint.

**Current Mitigation:** Required by the descriptor type and runtime branch.

**Recommended Direction:** Preserve and add regression tests, including transformations, unknown fields, invalid JSON, and trust-specific failures.

**Confidence:** CONFIRMED.
