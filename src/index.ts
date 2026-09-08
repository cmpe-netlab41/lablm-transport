export { createTransportClient } from './client';
export { get, post, put, patch, del, endpoint, streamGet, streamPost } from './descriptors';
export { noopAuthStrategy } from './auth/noop.strategy';
export type { TransportClient } from './types';
export type {
  HttpMethod,
  QueryValue,
  ReqInput,
  EndpointDescriptor,
  StreamEndpointDescriptor,
  CallContext,
  AuthStrategy,
  RetryConfig,
  ClientConfig,
  ResponseMeta,
  TransportResponse,
} from './types';
export {
  IntegrationTimeoutError,
  IntegrationNetworkError,
  IntegrationUnauthorizedError,
  UpstreamError,
  UpstreamContractError,
  IntegrationContractViolationError,
  IntegrationRedirectBlockedError,
  ResponseTooLargeError,
} from './errors';
export { withRetry } from './retry';
export { INTERNAL_RETRY_CONFIG, EXTERNAL_RETRY_CONFIG, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RESPONSE_BYTES } from './defaults';
export { PoolManager, type StreamUploadConfig, type StreamUploadResult } from './pool-manager';
