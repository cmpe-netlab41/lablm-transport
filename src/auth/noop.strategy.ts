import type { AuthStrategy } from '../types';

/** No-op strategy — returns no headers. Use in tests and in-process calls. */
export const noopAuthStrategy: AuthStrategy = async () => ({});
