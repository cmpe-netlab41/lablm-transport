# Transport Governance

This directory is a portable, implementation-independent policy for a typed HTTP transport library. It says what a safe transport boundary must guarantee. It deliberately contains no current repository names, paths, consumers, endpoints, credentials, default numbers, commands, or findings.

Normative terms `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are used as requirement levels. Rule IDs are stable references; detailed documents explain how to apply them without forcing a particular HTTP client or framework.

## Reading routes

| Concern | Read |
|---|---|
| First principles and rule index | [transport-principles.md](transport-principles.md) |
| Dependency direction and ACLs | [layering.md](layering.md) |
| Descriptor and URL/request shape | [endpoint-descriptors.md](endpoint-descriptors.md) |
| Credentials, targets, redirects, TLS, headers, size | [security.md](security.md) |
| Retry, idempotency, deadlines, cancellation, pools | [resilience.md](resilience.md) |
| Failure taxonomy and safe metadata | [errors.md](errors.md) |
| Logs, traces, metrics, endpoint identity | [observability.md](observability.md) |
| Behavioral, security, and SRE proof | [testing.md](testing.md) |

## Evidence model

Governance is the desired constraint, source code is implemented behavior, tests are executable evidence, and project documentation is a dated audit. When they disagree, record the discrepancy and its risk before remediation. Do not silently change production semantics while documenting them.

Recommended evidence classifications are `CONFIRMED`, `STRONGLY INFERRED`, `UNCLEAR`, and `ARCHITECTURE DRIFT`. Recommended finding kinds are `CONFIRMED DEFECT`, `ARCHITECTURAL RISK`, `MISSING GUARANTEE`, `UNCLEAR SEMANTICS`, and `INTENTIONAL DESIGN`.
