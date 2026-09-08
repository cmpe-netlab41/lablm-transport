# Error Governance

Transport failures need enough structure for a caller to choose retry, fallback, status mapping, or alerting without parsing message text.

The conceptual taxonomy SHOULD distinguish:

| Category | Meaning |
|---|---|
| timeout | A declared transport budget expired |
| cancellation | The caller intentionally stopped work |
| network | Connection, DNS, socket, or similar I/O failure |
| TLS | Certificate or secure-channel establishment failure, if operationally useful |
| HTTP failure | A non-success status without a more specific category |
| rate limit | A throttling response with safe retry metadata |
| invalid response | Malformed framing, encoding, JSON, or media type |
| schema validation | A syntactically readable response violates its runtime contract |
| authentication | Local credential preparation or remote authorization failure |
| configuration/programming | Invalid descriptor, URL, serializer, or client policy |
| unexpected | A transport invariant or implementation bug failed |

This taxonomy need not become a large class hierarchy. A discriminated error code or a small set of classes is sufficient if machine-readable and stable.

## Metadata

Useful fields include target service, stable endpoint identity, status, attempts made, retryable/retry outcome, bounded retry delay, request/trace ID, safe upstream code, and `cause`. Dangerous fields include auth headers, cookies, signed tokens, request bodies, full dynamic URLs/query strings, raw response headers, and unbounded/raw response bodies.

Redaction MUST survive `JSON.stringify`, structured logging, error cause chains, inspection, and telemetry recording. Prefer an explicit safe serializer over relying on `Error` enumerability.

## Error bodies

An optional endpoint error schema MAY parse a bounded non-success body. Parse failure SHOULD preserve a safe diagnostic category, not arbitrary body content. HTML, text, invalid JSON, empty bodies, and oversized bodies MUST have defined outcomes. Transport MUST NOT invent business error meaning; adapters map a validated upstream error into domain outcomes where appropriate.

Schema-validation failures are not network failures and SHOULD NOT be retried by default. A local configuration/auth-strategy exception is also not automatically a remote failure.
