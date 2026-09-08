export class IntegrationTimeoutError extends Error {
  readonly name = 'IntegrationTimeoutError';
  constructor(
    readonly targetService: string,
    readonly path: string,
    readonly timeoutMs: number,
  ) {
    super(`Request to ${targetService}${path} timed out after ${timeoutMs}ms`);
  }
}

export class IntegrationNetworkError extends Error {
  readonly name = 'IntegrationNetworkError';
  constructor(
    readonly targetService: string,
    readonly path: string,
    readonly cause?: Error,
  ) {
    super(`Network error calling ${targetService}${path}`);
  }
}

export class IntegrationUnauthorizedError extends Error {
  readonly name = 'IntegrationUnauthorizedError';
  constructor(
    readonly targetService: string,
    readonly path: string,
    readonly statusCode: 401 | 403,
  ) {
    super(`Unauthorized (${statusCode}) calling ${targetService}${path}`);
  }
}

/** Non-2xx response whose body was parsed via errorSchema. */
export class UpstreamError extends Error {
  readonly name = 'UpstreamError';
  constructor(
    readonly targetService: string,
    readonly path: string,
    readonly statusCode: number,
    readonly body: unknown,
    readonly retryAfterHeader?: string,
  ) {
    super(`Upstream error ${statusCode} from ${targetService}${path}`);
  }
}

/** Response from an EXTERNAL service failed responseSchema parse.
 *  They broke the contract; this is a runtime-resilience concern, not our bug. */
export class UpstreamContractError extends Error {
  readonly name = 'UpstreamContractError';
  constructor(
    readonly targetService: string,
    readonly path: string,
    readonly parseError: unknown,
  ) {
    super(
      `Contract violation from external service ${targetService}${path}: response did not match schema`,
    );
  }
}

/** Response from an INTERNALLY-OWNED service failed responseSchema parse.
 *  This is OUR bug — the schema or the service is wrong. Should be loud/fatal in dev/test. */
export class IntegrationContractViolationError extends Error {
  readonly name = 'IntegrationContractViolationError';
  constructor(
    readonly targetService: string,
    readonly path: string,
    readonly parseError: unknown,
  ) {
    super(
      `INTERNAL BUG: Response from ${targetService}${path} failed schema parse — ` +
        `this is our contract; fix the schema or the service producer.`,
    );
  }
}

/** Fetch was told never to follow redirects (see TS-001); the server tried one anyway.
 *  Deliberately excludes the raw Location header — it's attacker/server-controlled. */
export class IntegrationRedirectBlockedError extends Error {
  readonly name = 'IntegrationRedirectBlockedError';
  constructor(
    readonly targetService: string,
    readonly path: string,
    readonly statusCode: number,
  ) {
    super(`Blocked redirect (${statusCode}) from ${targetService}${path} — transport does not follow redirects`);
  }
}

/** A buffered response exceeded its configured byte cap (see TS-004); the read was
 *  aborted before the full body materialized. Shared by the typed client and PoolManager. */
export class ResponseTooLargeError extends Error {
  readonly name = 'ResponseTooLargeError';
  constructor(
    readonly target: string,
    readonly path: string,
    readonly maxBytes: number,
  ) {
    super(`Response from ${target}${path} exceeded the ${maxBytes}-byte limit and was aborted`);
  }
}
