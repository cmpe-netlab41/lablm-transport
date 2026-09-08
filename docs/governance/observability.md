# Observability

Transport observability should answer: which dependency and logical endpoint was called, how long it took, how many attempts occurred, whether a timeout/retry/rate limit happened, and why the final outcome failed.

Recommended stable dimensions are:

```text
target service
logical endpoint
HTTP method
status class
error category
retry outcome
```

Do not use user/resource IDs, full dynamic URLs, query strings, request IDs, raw error messages, bodies, tokens, or unbounded upstream codes as metric labels. Traces and structured logs may carry more context only after redaction and cardinality review.

Descriptors SHOULD have a stable logical name so an operation such as `GET /resources/:id` is not recorded as a separate metric series per resource. Target service and descriptor identity SHOULD be passed to hooks directly rather than reconstructed from a URL.

## Ownership

A framework-independent library SHOULD offer backend-neutral events/hooks or interoperable tracing rather than require one logger or metrics system. Application auto-instrumentation MAY provide HTTP spans, but it does not prove transport-level retry count, schema failures, logical endpoint identity, or safe labels.

Transport SHOULD NOT log every error if an adapter, service boundary, or global handler will also log it. Choose one primary logging layer and enrich errors/events elsewhere. Retry and timeout events can be emitted without logging full request context.

At minimum, evaluate request count, final success/failure, latency, timeout, retry attempts/exhaustion, rate limits, schema failures, and target errors. Decide explicitly whether transport or callers own each signal.
