# Transport Testing

Use deterministic unit tests for pure URL, parsing, classification, retry-delay, and redaction logic. Use fake timers and injected randomness/clocks for bounded retry/deadline proof. Also use a local real HTTP server where behavior depends on redirects, headers, body streaming, abort propagation, connection reuse, or the runtime HTTP client.

## Minimum behavioral matrix

Tests SHOULD cover:

- validated success and transformed schema output;
- schema-invalid success, invalid JSON, text, empty body, `204`, and `205`;
- representative `4xx`, `5xx`, auth failure, rate limit, and error-schema failure;
- DNS/network failure, timeout, caller abort, and cause preservation;
- retryable failure then success, exhaustion, exact attempt bound, and non-retryable failure;
- non-idempotent default, explicit business-idempotent opt-in, and body replayability;
- backoff bounds, jitter bounds, `Retry-After` delta/date/malformed/negative/oversized cases;
- cancellation during auth, fetch, body read, and backoff with timer/listener cleanup;
- auth injection, case-insensitive header precedence, and duplicate-header rejection;
- base/path joining, path encoding/traversal, query encoding, arrays, empty and null values;
- streaming connect failure, non-success body, mid-stream abort, early consumer stop, and cleanup;
- pooled origin identity, pool lifecycle, concurrency bounds, upload abort, and response limits.

## Security matrix

Where applicable, prove credential redaction; same- and cross-origin redirects; custom credential stripping; absolute URL and target escape policy; loopback/link-local/metadata policy; TLS verification behavior; authorization override attempts; oversized and compressed responses; and malformed auth metadata.

## SRE matrix

Prove maximum attempts, maximum backoff, overall wall-clock bound, timeout category, cancellation stopping future attempts, `Retry-After` cap, non-replayable-body handling, pool/queue limits, and nested retry-budget propagation.

Tests that mock `fetch` are valuable for deterministic branching but cannot alone prove real header normalization, redirect behavior, decompression, abort semantics, or connection lifecycle. Conversely, real-server tests should not replace focused unit proof of every policy branch.

Every high-risk behavior change MUST add or update a focused regression test. Record uncovered scenarios in project-specific state; documentation is not enforcement.
