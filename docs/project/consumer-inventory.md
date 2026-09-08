# Consumer Inventory

Repository-wide manifest/import search found two direct package consumers: `@lablm/backend` and `@lablm/machine-service`. `@lablm/s2s-auth` supplies structurally compatible auth strategies but deliberately does not depend on transport. The client and CLI do not depend on this package.

## Transport usage

| Consumer / adapter | Target and trust | Descriptors / operation | Auth | Response contract and mapping | Retry / timeout / stream | Deviations |
|---|---|---|---|---|---|---|
| Backend `SimIntegrationService` | Dynamic registered machine-service origin; `internal` | `GET /sim/system-info`; `GET /sim/telemetry` stream | Fresh S2S bearer per call/attempt; optional correlation header | Canonical `SystemInfoSchema`, `SimErrorSchema`; stream frames parsed with canonical `TelemetryEventSchema`; returns canonical wire types | Internal retry for non-stream GET, 15s header timeout; stream no retry, 15s connect timeout | Backend machine domain injects concrete integration; no domain-owned port or domain mapping. |
| Backend `InferenceIntegrationService` | Dynamic registered machine IP, caller-selectable HTTP/HTTPS port for health; `internal` | `GET /v1/health`; forwarding is an unimplemented stub | Fresh S2S bearer plus fresh 30s `x-inference-token` capability on every attempt | Canonical `InferenceHealthSchema`; mapped into a connection-check result | Internal retry, 15s header timeout | Machine health domain injects concrete integration/result model. Source comment incorrectly says stream is GET-only. |
| Backend `FmsIntegrationService` | Dynamic selected storage-machine origin; internal by architecture, but outside typed client | `PUT /fms` streamed upload through `PoolManager` | Fresh S2S bearer plus caller upload capability `x-fms-token`; arbitrary content headers | Consumer parses canonical `WriteResultSchema` and `FmsErrorSchema` | No library retry/caller cancellation/explicit deadline; explicit persistent pool; response buffered | Separate transport regime; concrete integration/model imported by NDrive domain; logs raw failed response body. |
| Machine-service `LlamaService` behind `LlamaInferenceAdapter` | Configured llama.cpp origin, default loopback HTTP; configured as `internal` | `GET /health`; JSON `POST /v1/chat/completions`; streaming POST same path | Optional API-key bearer or no-op | Local Zod schemas in `llama.mapper.ts`; adapter maps to domain models; streaming chunks locally parsed | Internal retry for GET health; POSTs one attempt; 60s header/connect timeout | Correct domain-owned `InferencePort` boundary. Request wire type aliases domain model; external-vs-internal contract ownership is unclear. |

No current descriptor opts into `idempotent: true` for POST/PATCH. No current retryable typed-client request carries a body: the only retried current calls are GETs. Stream reconnect for machine telemetry is caller-owned and scheduled no faster than the machine check interval/minimum delay.

## Dynamic target provenance

Machine IPs enter through authenticated/authorized backend controllers and are validated by class-validator `@IsIP`, then stored. The generic transport itself accepts any per-call `baseUrl`. Health/SIM URLs normally combine configured protocol/port with the stored IP; inference health additionally accepts a permitted `http|https` protocol and any positive integer port from a caller with `CHECK_MACHINE_CONNECTION`.

FMS origins are derived by machine eligibility from the same stored machine IP, cached in Redis with the upload session, and later supplied to a pool keyed by `machineId:diskName`. String-shape validation on Redis reload does not revalidate the origin or bind it cryptographically to the key.

## Layered call path

The active inference health chain is:

```text
backend transport (3 attempts, 15s header timeout)
  -> machine-service GET /v1/health
       -> InferenceService / domain port
            -> LlamaInferenceAdapter
                 -> llama transport GET /health (3 attempts, 60s header timeout)
```

The machine controller does not propagate client disconnect cancellation for its health method. During a llama outage, backend attempts can time out and retry while prior machine handlers continue their own retry loops: up to nine llama attempts per logical backend health check.

## Direct HTTP inventory

| Location group | Classification | Reason / status |
|---|---|---|
| `packages/transport/src/client.ts` global Fetch | `TRANSPORT USAGE` | Typed JSON and response-stream implementation. |
| `packages/transport/src/pool-manager.ts` Undici Pool | `TRANSPORT USAGE` | Sanctioned Node streaming-upload primitive, but with fewer guarantees. |
| `apps/client/src/shared/api/requestTool.ts`, `src/proxy.ts` | `INTENTIONAL EXCEPTION` inferred | Browser/Next authentication and API plumbing; client does not depend on the Node-oriented transport package. No central exception policy/enforcement records this. |
| `apps/client/src/app/api/.../route.ts` | `INTENTIONAL EXCEPTION` inferred | Next route proxying of status/telemetry streams. No central exception declaration. |
| `apps/client/.../shipment-route-map.tsx` | `UNKNOWN` | Direct browser Fetch of a world-atlas asset; unrelated to service transport but not documented as an exception. |
| Machine-service real-HTTP test files | `INTENTIONAL EXCEPTION` | Tests exercise actual Nest listeners/security boundaries with Fetch. |

No Axios, `node:http`, or `node:https` production imports were found outside transport by the audit search. Machine-service real-server tests use global Fetch. Backend production source has no direct low-level HTTP calls; its ESLint config bans Fetch and restricted client imports.

## Lifecycle and ownership

- Backend SIM and inference clients are Nest provider singletons, one configuration per integration family and dynamic base URL per call.
- Machine-service `LlamaService` owns one typed client for the service lifecycle.
- Backend FMS owns one `PoolManager`; a lifecycle provider closes pools at application shutdown.
- Connection reuse for typed clients belongs to Node global Fetch/Undici, not each client closure.
- There are no active external-trust clients using `EXTERNAL_RETRY_CONFIG` in the discovered consumers.
