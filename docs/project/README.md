# Current Transport State

Audit snapshot: **2026-09-02**<br>
Package: `@lablm/transport` at `packages/transport`<br>
Repository: `lablm` pnpm/Turbo workspace<br>
Scope: package source, manifest, compiler/lint/build wiring, CI, tests, canonical contracts, auth provider, and repository-wide consumer/direct-HTTP search.

This directory describes what is true in this repository at the snapshot date. It is evidence, not reusable policy and not a substitute for current source search.

## Documents

- [current-architecture.md](current-architecture.md) — implemented API and behavior.
- [consumer-inventory.md](consumer-inventory.md) — targets, adapters, auth, contracts, overrides, streams, and bypasses.
- [quality-audit.md](quality-audit.md) — API, typing, URL/request/response, contract, and layering findings.
- [security-audit.md](security-audit.md) — credentials, redirects, targets, TLS, headers, response size, and pools.
- [sre-audit.md](sre-audit.md) — attempts, time budgets, cancellation, amplification, errors, observability, and lifecycle.
- [test-coverage.md](test-coverage.md) — behavioral/security/SRE proof matrix.
- [enforcement-status.md](enforcement-status.md) — documentation versus mechanical/test enforcement.

## Classification

Architecture evidence uses `CONFIRMED`, `STRONGLY INFERRED`, `UNCLEAR`, or `ARCHITECTURE DRIFT`. Findings distinguish `CONFIRMED DEFECT`, `ARCHITECTURAL RISK`, `MISSING GUARANTEE`, `UNCLEAR SEMANTICS`, and `INTENTIONAL DESIGN`.

No `CRITICAL` finding was confirmed. The highest current risks are stale-origin pool reuse, plaintext credential transport on default machine URLs, incomplete operation deadlines, and nested retry amplification. (Credential-bearing cross-origin redirects and unbounded buffered/decompressed bodies, formerly on this list, are resolved — see TS-001 and TS-004.)

## Verification snapshot

| Check | Command actually run | Result |
|---|---|---|
| Lint | `npm run lint` | **PRE-EXISTING FAILURE** — ESLint 9 cannot find `eslint.config.js/mjs/cjs` for this package. |
| Typecheck | `npm run typecheck` | Pass. |
| Build | `npm run build` | Pass. |
| Tests | `npm test` | Pass — three focused suites: `client.redirect.spec.ts` (TS-001), `client.size-limit.spec.ts` and `pool-manager.spec.ts` (TS-004). |
| Architecture check | — | No package architecture-check script. |

The preferred workspace launcher is pnpm, but `pnpm --filter @lablm/transport ...` could not reliably start in the audit sandbox because the installed global pnpm launcher/runtime and root temporary-file permissions did not match the workspace environment. Direct package scripts were therefore executed through npm without installing or changing dependencies.

This pass changes documentation only. Production transport semantics, public exports, defaults, and tooling configuration were not changed.

**Update (2026-09-02, follow-up):** TS-001 was fixed — see its entry in `security-audit.md` for the implemented control (`redirect: 'manual'` + `IntegrationRedirectBlockedError`) and `src/client.redirect.spec.ts` for the regression test. This did change production transport semantics (redirects are no longer followed) and added a package `test` script/dependency.

**Update (2026-09-02, second follow-up):** TS-004 was also fixed — see its entry in `security-audit.md` for the implemented control (required `ClientConfig.maxResponseBytes` / `StreamUploadConfig.maxResponseBytes`, enforced against decoded bytes while reading, throwing `ResponseTooLargeError`) and `src/client.size-limit.spec.ts`/`src/pool-manager.spec.ts` for the regression tests. This changed `ClientConfig`/`StreamUploadConfig` (new required field) and updated all four current call sites (`inference-integration.module.ts`, `sim-integration.module.ts`, `llama.service.ts`, `fms-integration.service.ts`) to pass it. The rest of this snapshot's findings are otherwise unchanged and still reflect current behavior.

## Final risk review

**Quality:** The public non-streaming response-validation path is sound, but the overall API/wire model is not yet production-grade because request typing/validation is incomplete, URL/response semantics are implicit, PoolManager has a different guarantee set, lint is broken, and package tests are absent.

**Security:** Yes, credentials, targets, headers, plaintext HTTP, and stale pool origins create credible risks. Redirect-based credential leakage (TS-001) and unbounded buffered/decompressed response size (TS-004) are resolved. No transport TLS-verification bypass or direct credential logging was found.

**Reliability:** POST is correctly non-retryable by default and normal retry attempts are finite, but full operations are not time-bounded; cancellation does not cover auth/body/backoff; Retry-After is uncapped; and stream-upload lifetime is not explicit. The current model cannot be called bounded and safe end to end.

**SRE:** Operators cannot reliably determine total logical-call duration, attempts/retry outcome, schema failures, or logical endpoint health from transport signals. Low-level auto-tracing and selected application logs exist, but transport has no stable endpoint identity, metrics, or lifecycle hooks.

**Testability:** Mostly no. A regression in timeout behavior, cancellation, retries, Retry-After, header precedence, or pool origin routing would not be detected by the transport package today. A redirect-following regression or a buffered-response-size regression now would be — `client.redirect.spec.ts`, `client.size-limit.spec.ts`, and `pool-manager.spec.ts` cover those.

**Architecture:** The package source is framework/domain independent (with a Node-specific upload API) and typed calls return validated wire values. Consumer ACL/port boundaries are only partially implemented, and direct-HTTP enforcement is only partial across the workspace.

**Blast radius:** TS-003, TR-001, TR-004, TR-005, TR-007, TR-008, and TO-001 can affect every typed-client consumer or any future external client. TS-001 and TS-004 (both RESOLVED) previously belonged in this list. TS-002, TR-003, and TR-006 are concentrated in FMS uploads. TR-002 spans backend, machine-service, and llama.cpp and can amplify an outage across services.

## Highest-priority remediation candidates

1. ~~Define and enforce redirect/custom-credential behavior, with a real cross-origin test.~~ DONE — TS-001, see `security-audit.md`.
2. Bind PoolManager keys to origins safely and add origin-rotation regression coverage.
3. Design an overall deadline/cancellation model covering auth, body reads, backoff, streams, and uploads.
4. ~~Add bounded success/error/decompressed response handling.~~ DONE — TS-004, see `security-audit.md`. (Streaming's 2xx success path remains intentionally unbounded — a separate concern, TR-001.)
5. Eliminate nested health retry amplification by deciding retry ownership and propagating cancellation/deadlines.

## Decisions required before remediation

1. Is machine traffic protected by HTTPS/mTLS/tunnel, or is plaintext on a trusted network an accepted deployment boundary?
2. ~~Are redirects required for authenticated service targets, and which origins/custom credentials may cross them?~~ DECIDED (TS-001): no known consumer needs redirect-following; transport now blocks all redirects outright. Revisit only if a future consumer genuinely requires it.
3. Does transport own overall deadlines and upload concurrency, or must callers supply/enforce them? (Response limits are now transport-owned, TS-004 — this decision remains open only for deadlines/concurrency.)
4. Should the backend introduce domain-owned ports for machine integrations or explicitly narrow its ACL claim?
5. Is llama.cpp's protocol internally owned/version-locked or an external contract for error-classification purposes?
6. Is PoolManager part of the main public transport contract or a separately governed upload capability?

The audit is ready for a reviewed remediation/enforcement phase: **YES**. The decisions above should precede semantic changes in their respective areas.
