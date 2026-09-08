import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { PoolManager, type StreamUploadConfig } from './pool-manager';
import { ResponseTooLargeError } from './errors';

/**
 * TS-004 regression: PoolManager.streamUpload must never buffer a response past
 * its configured cap, matching the typed client's bounded-read guarantee.
 */

function listen(handler: RequestListener) {
  const server = createServer(handler);
  return new Promise<{ server: ReturnType<typeof createServer>; url: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const MAX_BYTES = 1000;

function baseConfig(overrides: Partial<StreamUploadConfig> = {}): StreamUploadConfig {
  return {
    poolKey: 'test-pool',
    origin: 'http://placeholder',
    path: '/upload',
    headers: {},
    maxResponseBytes: MAX_BYTES,
    ...overrides,
  };
}

describe('TS-004: PoolManager response buffering is size-bounded', () => {
  test('an oversized response is rejected before it fully materializes', async () => {
    const { server, url } = await listen((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('x'.repeat(MAX_BYTES * 5));
      });
    });

    const manager = new PoolManager();
    try {
      await expect(
        manager.streamUpload(baseConfig({ origin: url }), Readable.from(['upload body'])),
      ).rejects.toThrow(ResponseTooLargeError);
    } finally {
      await manager.closeAll();
      server.close();
    }
  });

  test('a response under the cap still resolves normally (no regression)', async () => {
    const { server, url } = await listen((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ size: 11, checksum: 'abc123' }));
      });
    });

    const manager = new PoolManager();
    try {
      const result = await manager.streamUpload(baseConfig({ origin: url }), Readable.from(['upload body']));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ size: 11, checksum: 'abc123' });
    } finally {
      await manager.closeAll();
      server.close();
    }
  });
});
