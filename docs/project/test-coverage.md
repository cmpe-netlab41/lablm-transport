# Test Coverage

The transport package has three focused test files (Jest + ts-jest, real local `node:http` servers / a real `undici Pool`): `src/client.redirect.spec.ts` (TS-001), `src/client.size-limit.spec.ts` (TS-004), and `src/pool-manager.spec.ts` (TS-004, PoolManager's first test file). Consumer tests validate selected canonical schemas, inbound HTTP security, domain mappers, and a mocked AbortError-to-domain mapping, but they do not execute transport retry/timeout/header behavior, and no local test HTTP server targets those.

`Covered?` means the transport guarantee itself is executable, not merely that adjacent code has a test.

## Quality and behavioral matrix

| Behavior | Covered? | Test / evidence | Confidence | Missing scenario | Priority |
|---|---|---|---|---|---|
| Successful validated response | No | Source inspection only | High | Real response and Zod output/transform | P0 |
| Schema-invalid successful response | Partial | llama mapper unit test, not transport | High | Internal/external error selection through client | P0 |
| Request-schema enforcement/type | No | None; currently not implemented | High | Compile-time and runtime request mismatch | P0 |
| 4xx / 401 / 403 | No | Inbound machine security tests are unrelated | High | Body drain and error class/status | P0 |
| 5xx | No | None | High | Retryable versus non-retryable statuses | P0 |
| Network/DNS/TLS failure | No | None | High | Classification, cause, retries | P0 |
| Header/attempt timeout | No | None | High | Exact timer start/end and cleanup | P0 |
| Caller abort before/during Fetch | Partial | Adapter mapping uses mocked AbortError | Medium | Real transport abort category and no retry | P0 |
| Abort during auth/body/backoff | No | None | High | Prompt stop, no future work, cleanup | P0 |
| Retryable failure then success | No | None | High | Attempts and returned final metadata | P0 |
| Retry exhaustion | No | None | High | Exact bound and final error metadata | P0 |
| Non-retryable POST | No | Source only | High | Prove exactly one attempt | P0 |
| Explicit idempotent POST | No | No current consumer | High | Opt-in attempt behavior and key policy | P1 |
| Invalid JSON / text / empty / 204 / 205 | No | None | High | Schema-dependent outcomes | P0 |
| Error schema valid/invalid/absent | No | None | High | Raw fallback and safe metadata | P1 |
| Content-Type mismatch | No | None | High | JSON body under wrong media type | P1 |
| Unknown-field and Zod transform behavior | No | Canonical contract tests cover selected schemas, not transport return | Medium | strict/strip/passthrough and transformed `parsed.data` | P1 |
| Query encoding | No | None | High | Unicode, object/array, boolean, empty, null | P1 |
| Path/base joining and encoding | No | None | High | slashes, base prefix, reserved chars, traversal | P0 |
| GET/DELETE/body and body serialization | No | None | High | undefined, BigInt, circular, DELETE body | P1 |
| Stream success/frame delegation | No | Consumer parsers only | Medium | Headers/content type/raw byte contract | P1 |
| Stream mid-read abort/early stop | No | None | High | cancel and listener/reader cleanup | P0 |
| Pool upload success/error | Partial | `pool-manager.spec.ts` — real stream, status/body, size cap; not `closeAll()` lifecycle | Medium | `closeAll()` and concurrent-pool lifecycle | P1 |
| Pool key/origin rotation | No | None | High | stale-origin data misdelivery regression | P0 |

## Security matrix

| Behavior | Covered? | Test / evidence | Confidence | Missing scenario | Priority |
|---|---|---|---|---|---|
| Credential redaction/serialization | No | Source shows no request-header logging | Medium | safe error/log serializer with malicious body | P0 |
| Same-origin redirect credentials | Yes (moot) | `client.redirect.spec.ts` — all redirects blocked regardless of origin | High | none; no redirect of any kind is followed | — |
| Cross-origin standard/custom credentials | Yes | `client.redirect.spec.ts` proves the redirect target receives zero requests | High | none | — |
| Redirect loop/hop bound | Yes (moot) | `client.redirect.spec.ts` — first redirect response is blocked, so no hop occurs | High | none; hop-count concept no longer applies | — |
| Absolute URL / target escape | No | None | High | schemes, loopback, link-local, metadata, ports | P0 |
| Authorization/header override | No | Local Headers diagnostic only | High | case collision and precedence at server | P0 |
| TLS verification | No | Source/config search only | Medium | trusted/untrusted certificate server | P1 |
| Oversized success/error response | Yes | `client.size-limit.spec.ts` — uncompressed and gzip-decompression-bomb cases, both success and error-body paths; `pool-manager.spec.ts` for PoolManager | High | none for buffered paths; `executeStream`'s 2xx success path is intentionally unbounded (TR-001) | — |
| Pool stale-origin credential/data routing | No | Source proof only | High | origin change under same key | P0 |

## SRE matrix

| Behavior | Covered? | Test / evidence | Confidence | Missing scenario | Priority |
|---|---|---|---|---|---|
| Retry attempt bound | No | Source loop only | High | fake-timer exact count | P0 |
| Backoff/jitter bound | No | Formula inspection only | High | deterministic RNG extremes and cap | P1 |
| Retry-After seconds/date | No | Source parser only | High | strict valid formats | P0 |
| Malformed/negative/oversized Retry-After | No | None | High | delay/deadline cap | P0 |
| Overall operation bound | No | Not implemented | High | auth + attempt + body + backoff | P0 |
| Cancellation stops retries/timers | No | Not implemented fully | High | backoff/auth/body cleanup | P0 |
| Non-replayable body is not retried | No | Current APIs happen to separate streams | Medium | explicit type/runtime guarantee | P1 |
| Nested retry amplification | No | Static call-chain audit | High | backend→machine→llama outage test | P0 |
| Pool connection/pool bounds | No | None | High | concurrent load and lifecycle | P1 |
| Observability of attempts/outcome | No | Not implemented | High | stable descriptor/target dimensions | P1 |

## Recommended test sequence

1. Add deterministic unit tests around retry, cancellation, strict Retry-After, descriptor typing, URL construction, and error classification.
2. Add a local real-HTTP harness for headers, slow/trickling bodies, aborts, empty/media responses, compression, and stream cleanup (redirects are now covered by `client.redirect.spec.ts`).
3. Add PoolManager integration tests for origin binding, upload cancellation/deadline, concurrency, and `closeAll()` lifecycle (response limit is now covered by `pool-manager.spec.ts`).
4. Add one cross-service health test proving a caller deadline cannot create orphaned nested retries.

This is a coverage plan, not authorization to change runtime semantics during the audit pass.
