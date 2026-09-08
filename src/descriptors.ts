import type { ZodTypeAny } from 'zod';
import type { EndpointDescriptor, ReqInput, StreamEndpointDescriptor } from './types';

type DescriptorInit<
  ReqSchema extends ZodTypeAny | undefined,
  ResSchema extends ZodTypeAny,
  ErrSchema extends ZodTypeAny | undefined,
> = Omit<EndpointDescriptor<ReqSchema, ResSchema, ErrSchema>, 'method'>;

/** GET — always idempotent; retried by default. No request body. */
export function get<
  ResSchema extends ZodTypeAny,
  ErrSchema extends ZodTypeAny | undefined = undefined,
>(
  options: DescriptorInit<undefined, ResSchema, ErrSchema>,
): EndpointDescriptor<undefined, ResSchema, ErrSchema> {
  return { ...options, method: 'GET' };
}

/** POST — non-idempotent by default; never retried unless idempotent is explicitly set to true. */
export function post<
  ReqSchema extends ZodTypeAny | undefined = undefined,
  ResSchema extends ZodTypeAny = ZodTypeAny,
  ErrSchema extends ZodTypeAny | undefined = undefined,
>(
  options: DescriptorInit<ReqSchema, ResSchema, ErrSchema>,
): EndpointDescriptor<ReqSchema, ResSchema, ErrSchema> {
  return { idempotent: false, ...options, method: 'POST' };
}

/** PUT — idempotent by default; retried automatically. */
export function put<
  ReqSchema extends ZodTypeAny | undefined = undefined,
  ResSchema extends ZodTypeAny = ZodTypeAny,
  ErrSchema extends ZodTypeAny | undefined = undefined,
>(
  options: DescriptorInit<ReqSchema, ResSchema, ErrSchema>,
): EndpointDescriptor<ReqSchema, ResSchema, ErrSchema> {
  return { idempotent: true, ...options, method: 'PUT' };
}

/** PATCH — non-idempotent by default; pass idempotent: true when a key is included. */
export function patch<
  ReqSchema extends ZodTypeAny | undefined = undefined,
  ResSchema extends ZodTypeAny = ZodTypeAny,
  ErrSchema extends ZodTypeAny | undefined = undefined,
>(
  options: DescriptorInit<ReqSchema, ResSchema, ErrSchema>,
): EndpointDescriptor<ReqSchema, ResSchema, ErrSchema> {
  return { idempotent: false, ...options, method: 'PATCH' };
}

/** DELETE — always idempotent; retried by default. */
export function del<
  ResSchema extends ZodTypeAny,
  ErrSchema extends ZodTypeAny | undefined = undefined,
>(
  options: DescriptorInit<undefined, ResSchema, ErrSchema>,
): EndpointDescriptor<undefined, ResSchema, ErrSchema> {
  return { ...options, method: 'DELETE' };
}

/** GET streaming endpoint — hands back a raw ReadableStream (e.g. for SSE).
 *  No request/response/error schema: transport doesn't parse stream contents. */
export function streamGet(options: { path: (input: ReqInput) => string }): StreamEndpointDescriptor {
  return { ...options, method: 'GET' };
}

/** POST streaming endpoint — intended for SSE APIs whose request is JSON
 *  (for example OpenAI-compatible inference with `stream: true`). */
export function streamPost(options: { path: (input: ReqInput) => string }): StreamEndpointDescriptor {
  return { ...options, method: 'POST' };
}

/** Convenience: build a path string with typed params from the input record.
 *  Usage: path: endpoint('/machines/:id/health', ['id'])
 *  The adapter's ReqInput.params must contain all listed keys. */
export function endpoint(
  template: string,
  paramKeys: string[] = [],
): (input: ReqInput) => string {
  return (input: ReqInput) => {
    let result = template;
    for (const key of paramKeys) {
      const value = input.params?.[key];
      if (value === undefined) throw new Error(`Missing path param: ${key}`);
      result = result.replace(`:${key}`, String(value));
    }
    return result;
  };
}
