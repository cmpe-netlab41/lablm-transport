# Transport Security

## Authentication and header ownership

Authentication SHOULD be an explicit, injectable strategy with the smallest context needed to scope credentials. Its lifecycle—per client, target, request, or attempt—MUST be documented because retries can mint or replay credentials.

Define one case-insensitive precedence model among transport defaults, auth, descriptors, and callers. Reject or deliberately replace duplicate security headers; do not rely on object-spread casing. Auth code MUST NOT be able to change payload framing headers accidentally unless the API explicitly grants that responsibility.

Credentials include `Authorization`, cookies, API keys, signed capabilities, custom token headers, URL userinfo, and sensitive request bodies. They MUST be redacted centrally from errors, logs, debug output, telemetry, and serialized objects. Error response bodies and response headers are untrusted and MAY also contain secrets.

## Redirect trust boundaries

Redirect mode, maximum hops, permitted schemes, and permitted origin changes MUST be explicit. Before following a redirect, determine which headers the underlying client strips. Standard clients may strip `Authorization` and cookies while forwarding custom credential headers.

Cross-origin redirects SHOULD be rejected for authenticated fixed-target clients unless an allowlist and credential policy justify them. If redirects are needed, every credential-bearing header—not only standard names—MUST be removed or recomputed for the destination. Method rewriting and body replay across `301`, `302`, `303`, `307`, and `308` MUST also be understood.

## Target control and SSRF

Classify each client as:

```text
fixed service target
dynamic internal target
approved external target set
arbitrary URL client
```

Then identify who can influence scheme, host, port, base path, path parameters, query, and redirect destination. Dynamic internal targets often legitimately include private ranges; a universal public-IP-only blocker is therefore wrong. The owning application SHOULD validate target provenance and deny unintended loopback, link-local, metadata, private-network, port, or protocol destinations according to its deployment model.

Relative endpoint data MUST NOT be able to escape a fixed target through absolute URLs, path traversal, reserved characters, or URL-parser normalization.

## TLS

Certificate verification MUST remain enabled by default. A custom CA, mTLS, proxy, or plain-HTTP private network is an explicit deployment policy and SHOULD be visible in configuration and threat modeling. Never introduce `rejectUnauthorized: false`, a global TLS-disable switch, or silent downgrade as a debugging fix.

## Size and decompression

Assume non-streaming helpers buffer the entire body and HTTP clients may decompress automatically. Define limits for successful bodies, error bodies, and any buffered stream result, ideally before or during decompression. If limits are delegated to a proxy or caller, record that guarantee and test the boundary. Timeouts alone do not bound memory amplification.

## Safe diagnostics

Errors SHOULD expose a stable target and logical endpoint, status, category, and safe request/trace ID. They SHOULD NOT expose raw headers, credentials, query strings, request bodies, or arbitrary response bodies. Logging belongs at the layer that can add operational context and avoid duplicates; transport SHOULD emit structured hooks rather than log every failure unconditionally.
