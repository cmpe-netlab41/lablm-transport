# Transport Principles

## Boundary and contracts

- **TRANSPORT-LAYER-001** — Transport MUST remain independent of application frameworks and domain/application implementation code.
- **TRANSPORT-LAYER-002** — Application/domain code MUST depend on domain-owned ports rather than transport details when the architecture requires a domain boundary.
- **TRANSPORT-WIRE-001** — A non-streaming typed call MUST return a value successfully parsed by its runtime response schema, never a domain model or unchecked cast.
- **TRANSPORT-WIRE-002** — Domain-to-wire and wire-to-domain mapping MUST remain outside the transport primitive, normally in pure adapter/anti-corruption-layer functions.
- **TRANSPORT-CONTRACT-001** — Wire payloads MUST anchor to canonical runtime contracts where such contracts exist. A transport library MUST NOT invent business schemas.
- **TRANSPORT-DESC-001** — Endpoint descriptors MUST describe protocol behavior and SHOULD expose a stable logical identity. They MUST NOT own domain mapping, business rules, persistence, UI, or orchestration.

## Security

- **TRANSPORT-AUTH-001** — Credentials and sensitive payloads MUST NOT appear in logs, telemetry attributes, normalized errors, or serialized debug output.
- **TRANSPORT-AUTH-002** — Header ownership, normalization, duplication, and precedence MUST be explicit. Security-sensitive headers MUST NOT be silently replaced or combined.
- **TRANSPORT-REDIRECT-001** — Redirect following and cross-origin credential behavior MUST be explicit and consistent with target trust boundaries.
- **TRANSPORT-TARGET-001** — Target influence over scheme, host, port, path, and redirects MUST be documented and constrained according to the client trust model.
- **TRANSPORT-TLS-001** — Transport MUST NOT silently weaken certificate verification. Plain HTTP or custom trust roots require an explicit deployment decision.
- **TRANSPORT-MEMORY-001** — Buffered and decompressed response size MUST be bounded or explicitly delegated with documented risk.

## Resilience

- **TRANSPORT-RETRY-001** — Retry policy MUST distinguish HTTP method safety, business idempotency, request-body replayability, and failure retryability.
- **TRANSPORT-RETRY-002** — Non-idempotent operations MUST NOT be retried by default. An override MUST represent an explicit business guarantee, not merely a replayable byte sequence.
- **TRANSPORT-RETRY-003** — Attempts, computed backoff, jitter, and server-directed delay MUST be bounded and testable.
- **TRANSPORT-TIMEOUT-001** — Remote operations MUST have bounded time or a documented owner for the deadline. Attempt timeout, overall deadline, body/idle timeout, backoff, and caller cancellation MUST be distinct concepts.
- **TRANSPORT-CANCEL-001** — When cancellation is supported, caller cancellation MUST stop the in-flight attempt, pending backoff, auth preparation where possible, and future retries; resources and listeners MUST be released.
- **TRANSPORT-RESOURCE-001** — Connection count, pool count, queueing, memory, and downstream attempt amplification MUST be bounded or intentionally owned elsewhere.

## Errors and operations

- **TRANSPORT-ERROR-001** — Structured failures MUST let callers distinguish actionable categories without exposing secrets.
- **TRANSPORT-ERROR-002** — Error metadata SHOULD preserve target identity, status, attempt/retry outcome, request/trace identifiers where safe, and the original cause; raw bodies and headers MUST NOT be retained indiscriminately.
- **TRANSPORT-OBS-001** — Observability SHOULD use stable target, logical endpoint, method, status class, error category, and retry outcome. High-cardinality or sensitive dimensions MUST be excluded by default.
- **TRANSPORT-TEST-001** — Major success and failure semantics MUST have executable tests, including real HTTP-boundary tests where mocks cannot prove behavior.
- **TRANSPORT-HTTP-001** — Direct low-level HTTP outside approved boundaries SHOULD be mechanically prevented when the architecture requires central transport guarantees. Exceptions MUST be narrow and documented.

Circuit breakers, bulkheads, rate limits, and transport-owned metrics are not universal requirements. Add them only when failure analysis establishes need and ownership.
