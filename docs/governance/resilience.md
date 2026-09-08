# Resilience and SRE

Every remote call consumes time, memory, connections, downstream capacity, and retry budget. Each resource MUST be bounded or deliberately delegated to an identified owner.

## Retry decision model

Retries are safe only after evaluating four independent properties:

| Property | Question |
|---|---|
| HTTP method safety | Is the method defined as read-only/safe? |
| Business idempotency | Will repeated execution produce one intended effect? |
| Body replayability | Can identical request content be reproduced after an attempt? |
| Failure retryability | Is another attempt likely to help and allowed by policy? |

No one property implies the others. A `POST` may be business-idempotent with a durable idempotency key; a nominally idempotent method may still trigger unsafe application behavior; a stream may be non-replayable; and a schema or auth failure is not made transient by method safety.

Non-idempotent operations MUST default to one attempt. An opt-in SHOULD cite the business guarantee and idempotency-key ownership. Transport MUST NOT invent a new key unless its durability, scope, collision, propagation, and server behavior are designed end to end.

Retry policy MUST define retryable methods/operations, status codes, network/timeout categories, maximum attempts, initial and maximum delay, multiplier, jitter, and `Retry-After`. Jitter SHOULD prevent coordinated retries. Server-directed delay MUST parse delta-seconds and HTTP dates strictly, reject malformed/negative values, and obey an explicit cap and overall deadline.

## Time model

Keep these separate:

- **attempt timeout** — budget for one attempt, with a declared start and end;
- **overall deadline** — budget across auth, attempts, bodies, parsing, and backoff;
- **body/idle timeout** — permitted inactivity while reading or writing;
- **caller cancellation** — caller no longer wants the result;
- **retry backoff** — scheduled delay before a later attempt.

The maximum wall-clock duration MUST be calculable for normal policy. If `N` attempts each consume `T` plus bounded delays `D`, the nominal maximum is `N*T + sum(D)`, but only if auth, body consumption, parsing, and cancellation are inside the stated budget. A headers-only timeout is not an operation deadline.

## Cancellation and cleanup

Caller cancellation SHOULD abort the active HTTP operation, interrupt backoff, prevent auth/token work and later attempts, cancel or release bodies, and remove timers/listeners. Timeout and caller cancellation SHOULD remain distinguishable to callers. Streaming APIs MUST define what happens when the consumer stops early, releases a reader, or never drains the body.

## Pools, concurrency, and amplification

Connection reuse is desirable, but a pool key MUST remain bound to the intended origin and changes MUST be handled explicitly. Bound or deliberately own pool count, connections per origin, pending queue depth, and lifecycle closure.

Layered retries multiply. If one service retries a dependency whose handler retries another dependency, a logical call can create the product of both attempt counts, including abandoned downstream work when cancellation is not propagated. Systems SHOULD pass deadlines/cancellation and define where retry ownership lives.

Circuit breakers, bulkheads, rate limits, and hedging are not defaults. Record `CURRENT: present/none` and `NEED: not demonstrated/potentially useful/required`; introduce stateful resilience only for an evidenced failure mode.
