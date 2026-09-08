# Enforcement Status

Overall direct-HTTP bypass verdict: **PARTIALLY ENFORCED**. Backend ESLint mechanically bans global Fetch and imports of Axios, Node HTTP/HTTPS, and Undici. Machine-service does not apply the same transport restriction (its production source currently has no bypass; tests intentionally use Fetch). CLI has no transport restriction. Client uses Biome and direct Fetch for browser/Next concerns without a central exception policy. The package's own lint command is broken.

Statuses describe the strongest current guarantee: `MECHANICALLY ENFORCED`, `TEST ENFORCED`, `REVIEW ENFORCED`, or `NOT ENFORCED`.

| Rule | Current enforcement | Status | Gap | Recommended mechanism |
|---|---|---|---|---|
| Non-streaming success uses runtime response schema | Descriptor requires schema; client safe-parses before return | MECHANICALLY ENFORCED | No regression tests; permissive schemas remain possible | Focused unit/real HTTP tests plus canonical-schema review |
| Stream contract frames validated | SIM/llama adapters parse frames | REVIEW ENFORCED | Raw transport stream can be consumed without validation | Adapter contract rule and stream integration tests |
| Request matches descriptor schema | Optional metadata only | NOT ENFORCED | `body: unknown`; schema unused | Derive input type and decide runtime outbound parse |
| Canonical schemas used where owned | Current backend imports canonical subpaths | REVIEW ENFORCED | No lint/architecture rule prevents local duplicates | Restricted dependency/AST rule plus inventory review |
| Domain depends on domain-owned port | Machine llama path follows it | NOT ENFORCED | Backend domains import concrete integrations/models | Architecture lint or explicitly revise claim |
| POST/PATCH non-retry by default | Descriptor helpers and method set | MECHANICALLY ENFORCED | Manual descriptor/flag can override without proof; no test | Regression test and opt-in review metadata |
| Retry attempts bounded | For-loop uses configured max | REVIEW ENFORCED | Invalid/unbounded numeric config not rejected; no tests | Validated normalized config and fake-timer tests |
| Retry delay / Retry-After bounded | Exponential delay capped only without header | NOT ENFORCED | Retry-After bypasses cap/deadline | Strict parser, cap, overall deadline tests |
| Operation total time bounded | Headers timer only | NOT ENFORCED | Auth, bodies, retry delay, streams/uploads exceed it | Explicit attempt/overall/idle deadline model |
| Caller cancellation stops all work | Fetch/active stream wired | NOT ENFORCED | Backoff/auth/body/nested health gaps | Signal composition and end-to-end cancellation tests |
| Credential redaction | Transport does not log | REVIEW ENFORCED | Raw error body/header/cause may be serialized/logged | Central safe error serializer and redaction tests |
| Cross-origin credential safety | `redirect: 'manual'` + `IntegrationRedirectBlockedError` on any 3xx (TS-001) | TEST ENFORCED | None known; policy is a blanket block, not a per-destination allowlist | Keep `client.redirect.spec.ts` current if a future consumer needs redirect-following |
| Target/SSRF policy | Application guards and IP syntax checks | REVIEW ENFORCED | No range/provenance/port policy at transport boundary | Application target policy/allowlist strategy and tests |
| TLS verification not disabled | Runtime defaults; no bypass source found | REVIEW ENFORCED | No static ban; HTTP defaults carry credentials | Ban insecure TLS flags; decide HTTPS/private-network policy |
| Header precedence/duplicates safe | Object-spread order only | NOT ENFORCED | Case-insensitive duplicates combine | Normalization, ownership allowlist, tests |
| Response memory/decompression bounded | Required `maxResponseBytes`, enforced against decoded bytes while reading (TS-004) | TEST ENFORCED | `executeStream`'s 2xx success path is intentionally still unbounded here (separate streaming concern, TR-001) | Keep `client.size-limit.spec.ts`/`pool-manager.spec.ts` current; revisit if a streaming byte cap is later wanted |
| Pool key bound to origin | First use only | NOT ENFORCED | Same key ignores later origin | Reject/rotate on mismatch and regression test |
| Pool count/connections bounded | None; shutdown closes all | NOT ENFORCED | Map and default client count unbounded | Explicit owner limits and load tests |
| Errors are actionable and safely structured | Classes/status/target/cause partly available | REVIEW ENFORCED | Missing categories, attempts, safe serialization | Discriminated code/metadata contract and tests |
| Stable endpoint observability | None | NOT ENFORCED | Descriptors lack name; retries invisible | Descriptor identity and backend-neutral hooks/spans |
| Direct Fetch/client ban | Backend ESLint only | MECHANICALLY ENFORCED | Other workspaces and exceptions differ | Shared rule with scoped test/browser exceptions |
| Package lint | Script exists | NOT ENFORCED | No flat config; script exits before linting | Package/root flat config included by CI |
| Transport behavioral tests | `test` script + `client.redirect.spec.ts`, `client.size-limit.spec.ts`, `pool-manager.spec.ts` (real local HTTP servers/Pool) | TEST ENFORCED for redirects and response-size only | Retry, timeout, header-precedence, and PoolManager's other guarantees (origin binding, concurrency, cancellation) still lack proof | Add unit and local real-HTTP suites for the remaining scenarios |
| Agent governance | `AGENTS.md`, `CLAUDE.md`, governance docs | REVIEW ENFORCED | Documentation cannot force compliance | Keep routing concise; add mechanical gates above |

## CI integration

Repository CI intends to run monorepo lint, machine-service architecture check, typecheck, build, unit/integration tests, and backend e2e tests. Turbo sees transport `lint`, `typecheck`, `build`, and now `test` scripts (the root `turbo.json` `test` task already existed; transport just had no script to run under it until TS-001's fix added one). The lint configuration failure means the intended monorepo lint gate cannot be claimed for this package until configuration is repaired.
