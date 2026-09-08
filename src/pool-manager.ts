import { Pool } from 'undici';
import type { Readable } from 'stream';
import { ResponseTooLargeError } from './errors';

export interface StreamUploadConfig {
  /** Groups requests into the same connection pool — one pool per distinct target
   *  (e.g. a storageTargetId), not one pool for the whole process. */
  poolKey: string;
  /** Origin the pool connects to, e.g. `http://10.0.0.4:8090`. */
  origin: string;
  path: string;
  headers: Record<string, string>;
  /** HTTP method for the streamed request. Defaults to 'POST' for backward compatibility. */
  method?: 'POST' | 'PUT';
  /** Hard cap on buffered response body bytes (see TS-004). Exceeding it throws
   *  ResponseTooLargeError instead of buffering further. */
  maxResponseBytes: number;
}

export interface StreamUploadResult {
  statusCode: number;
  body: string;
}

/**
 * Owns one undici Pool per poolKey (never a single shared Pool — different targets
 * have different origins and independent connection budgets) and streams request
 * bodies through it via Pool.request(), which accepts a Node.js Readable/async
 * iterable natively. This is the sanctioned home for pooled HTTP — consumers call
 * streamUpload()/closeAll() only, never reach for undici/http/https directly
 * (enforced by the no-restricted-imports rule in the backend eslint config).
 */
export class PoolManager {
  private readonly pools = new Map<string, Pool>();

  async streamUpload(config: StreamUploadConfig, source: Readable): Promise<StreamUploadResult> {
    const pool = this.getOrCreatePool(config.poolKey, config.origin);

    const response = await pool.request({
      method: config.method ?? 'POST',
      path: config.path,
      headers: config.headers,
      body: source,
    });

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > config.maxResponseBytes) {
        throw new ResponseTooLargeError(config.origin, config.path, config.maxResponseBytes);
      }
      chunks.push(chunk);
    }

    return { statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.close()));
    this.pools.clear();
  }

  private getOrCreatePool(poolKey: string, origin: string): Pool {
    let pool = this.pools.get(poolKey);

    if (!pool) {
      pool = new Pool(origin);
      this.pools.set(poolKey, pool);
    }

    return pool;
  }
}
