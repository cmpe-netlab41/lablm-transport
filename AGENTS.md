# Typed HTTP Transport — Agent Instructions

## Purpose and authority

This package is a security-sensitive transport primitive. A small change can alter authentication, retries, deadlines, parsing, or failure behavior for every consumer. Existing implementation is evidence of current behavior, not automatic authority for future behavior.

Authority is deliberately separated:

```text
docs/governance/   normative, reusable transport rules
docs/project/      repository-specific evidence and current state
package source     behavior actually implemented today
```

Read [docs/governance/README.md](docs/governance/README.md) before a non-trivial change. Load only the concern-specific governance documents, then inspect the corresponding project state.

## Project-state validation and bootstrap

Treat `docs/project/` as a dated inventory, not live truth. Before relying on it, verify that its manifest, exports, source paths, consumers, schemas, auth strategies, defaults, tests, and commands still exist.

If `docs/project/` is absent, stale, empty, or clearly describes another repository, regenerate it before changing public behavior:

1. Locate the package and repository root.
2. Inspect the manifest, exports, compiler/linter configuration, source, tests, scripts, CI, and workspace configuration.
3. Search the whole repository for package imports, client factories, descriptors, client types, auth strategies, and direct HTTP primitives.
4. Inventory consumers, targets, trust classes, schemas, mappings, overrides, streaming, and bypasses.
5. Establish exact URL, request, response, retry, timeout, cancellation, redirect, TLS, error, memory, and observability behavior.
6. Run a quality, security, resilience/SRE, architecture, and test audit.
7. Recreate `docs/project/` from evidence and record verification results.

Do not edit reusable governance during bootstrap merely because a new repository is organized differently. Change it only to correct a general transport-governance defect.

## Context protocol

Before a non-trivial change, write down:

```text
Concern being changed:
Public API impact:
Retry/idempotency impact:
Timeout/deadline/cancellation impact:
Authentication/header impact:
Error/observability impact:
Response-validation impact:
Affected consumers:
Compatibility and failure-mode impact:
Verification:
```

Then load only the relevant documents:

| Change | Governance | Project evidence |
|---|---|---|
| Layering, public API, descriptor | `layering.md`, `endpoint-descriptors.md` | architecture, consumers, quality audit |
| Auth, target, redirect, TLS, headers | `security.md` | security audit, consumers |
| Retry, timeout, cancellation, streaming | `resilience.md` | SRE audit, consumers, tests |
| Parsing or normalized errors | `errors.md`, `transport-principles.md` | architecture, quality/security audit |
| Logging, tracing, metrics | `observability.md` | architecture, SRE audit |
| Tests or enforcement | `testing.md` | test coverage, enforcement status |

## Consumer-impact protocol

Before changing existing public transport behavior:

1. Search all consumers and direct HTTP bypasses.
2. Identify per-client, per-endpoint, and per-call overrides.
3. Determine assumptions about wire values, retries, latency, auth, redirects, errors, and streams.
4. Classify source, binary, semantic, operational, and security compatibility.
5. Model both the success path and failure amplification.
6. Change behavior only after the effect is understood.
7. Verify the package and every affected consumer.

Compilation does not prove transport compatibility. A different retry, redirect, timeout, parsing, or error outcome can be breaking without changing a type.

## High-risk changes

Treat these as high risk: default retry count; retryable failures or status codes; non-idempotent retry behavior; backoff, jitter, or `Retry-After`; attempt or overall deadlines; cancellation; redirect and target control; TLS; auth/header precedence; error taxonomy or metadata; response parsing and unknown-field behavior; response-size limits; stream lifetime; connection pooling; and the underlying HTTP implementation.

Do not modify any of them while fixing an unrelated issue. Require focused tests and consumer review.

## Required boundaries

- Transport returns protocol/wire values. Domain mapping stays in an adapter.
- Domain/application code depends on a domain-owned port where the architecture requires isolation.
- Endpoint descriptors describe protocol behavior, not business use cases.
- Runtime schemas validate untrusted responses; a cast is never validation.
- Auth remains pluggable and secrets never enter logs or normalized errors.
- Retryability, HTTP safety, business idempotency, and body replayability are separate decisions.
- Remote-call time, attempts, memory, connections, and downstream capacity are bounded or explicitly delegated.
- Direct low-level HTTP is used only at an approved boundary with equivalent governance.

## Forbidden agent behaviors

- Removing schema parsing or replacing it with a cast.
- Widening output to `any` or `unknown` merely to make code compile.
- Retrying every failure or marking every write idempotent.
- Increasing timeouts/retries until a test passes without analyzing the failure mode.
- Swallowing caller cancellation or starting work after cancellation.
- Logging raw request/response data, headers, tokens, cookies, or signed capabilities for debugging.
- Disabling TLS verification or allowing arbitrary targets/absolute URLs for convenience.
- Changing header precedence, redirects, parsing, or error classes incidentally.
- Adding circuit breakers, bulkheads, or rate limits without an evidenced failure mode and ownership decision.
- Trusting stale project documentation or a README claim without repository search.

## Documentation and definition of done

Update `docs/project/` when implementation, consumers, risks, tests, enforcement, or verification changes. Update `docs/governance/` only for reusable policy.

A non-trivial change is done only when behavior and maximum failure cost are understandable; relevant consumers are checked; schemas, auth, error, and observability guarantees remain sound; focused tests cover the changed failure semantics; verification passes or existing failures are reported; and project state is synchronized.

## Portable unit

The reusable copy unit is exactly `AGENTS.md`, `CLAUDE.md`, and `docs/governance/`. `docs/project/` must be rediscovered for each repository.
