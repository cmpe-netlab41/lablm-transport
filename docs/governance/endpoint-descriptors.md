# Endpoint Descriptors

An endpoint descriptor is a stable protocol description consumed by transport. It MAY own:

- stable logical name;
- HTTP method and relative path template;
- path/query/request/response/error runtime schemas;
- protocol-level content negotiation and serialization;
- explicit retry eligibility and business-idempotency evidence;
- endpoint-specific attempt/deadline policy;
- safe observability metadata.

It MUST NOT own domain mapping, business authorization decisions, orchestration, database semantics, UI concerns, or framework handlers.

## Type and validation integrity

Request schema types SHOULD flow into the call input, and response schema output MUST flow into the result. An unused request generic or `body: unknown` breaks end-to-end request safety. Runtime response parsing MUST occur before success is returned. If outbound validation is intentionally compile-time-only, that limitation MUST be documented and tested at adapter boundaries.

Schemas SHOULD be imported from the canonical contract owner. Local schemas are appropriate for a boundary whose contract has no shared canonical owner; they belong with the adapter, not in generic transport.

## URL semantics

A transport MUST specify and test:

- whether base URLs may contain a path prefix or trailing slash;
- whether descriptor paths are relative or may be absolute;
- path joining and duplicate slash behavior;
- path-parameter encoding, missing/repeated placeholders, Unicode, reserved characters, `..`, `/`, `?`, and `#`;
- query key/value encoding, `null`, empty strings, arrays, objects, booleans, numbers, and repeated keys;
- behavior when a descriptor path already contains query or fragment text;
- whether per-call target overrides are permitted.

Use URL-aware construction rather than relying on accidental string concatenation. Do not apply generic encoding blindly to an already structured path; distinguish templates from encoded components.

## Request and response semantics

Descriptors and transport MUST make body eligibility, serialization, `Content-Type`, `Accept`, empty bodies, `204`/`205`, invalid JSON, content-type mismatch, and error-body parsing explicit. Streaming descriptors MUST state whether only response headers or also frames are validated, how cancellation works, and whether reconnect/retry belongs to transport or the caller.
