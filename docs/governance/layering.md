# Layering and Wire Boundaries

## Canonical dependency flow

```text
domain/orchestration
    -> domain-owned port
        <- adapter implements port
             domain value -> pure toRequest() -> wire request
             wire response -> pure toModel()  -> domain value
             -> transport -> remote protocol
```

The adapter is the only component that may know both domain and wire shapes. Transport knows protocol configuration and runtime schemas; it does not know business entities, framework controllers, queues, persistence, or UI state.

For response-bearing calls the data flow is:

```text
Domain Model
    -> toRequest()
    -> validated/typed Wire Request
    -> Transport
    -> runtime-validated Wire Response
    -> toModel()
    -> Domain Model
```

Streaming may return protocol bytes or frames when validating an unbounded stream is deliberately assigned to the adapter. That exception MUST be explicit, and the adapter MUST validate each contract-bearing frame before exposing domain values.

## Dependency rules

- Transport MUST NOT import application or domain code.
- Domain code MUST NOT import transport error classes, descriptors, wire contracts, or concrete adapters when a port boundary is claimed.
- Adapters MAY import transport APIs, canonical wire schemas, and domain-owned ports/models.
- Canonical contract packages MUST remain independent of transport execution.
- Auth providers SHOULD use structural or narrow interfaces so they do not create reverse dependencies on transport.

Returning a canonical wire DTO directly from an adapter is acceptable only when the consumer deliberately has no domain-isolation claim. Otherwise it is architecture drift even if TypeScript types line up.

## Change review

Before changing transport behavior, search every consumer and identify domain-port boundaries, direct concrete dependencies, local schema copies, custom retry/timeout/auth settings, and nested remote calls. A compile-clean change can still break latency budgets, duplicate side effects, alter trust boundaries, or change error handling.
