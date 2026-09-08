import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { createTransportClient } from './client';
import { get, streamGet } from './descriptors';
import { ResponseTooLargeError } from './errors';
import type { ClientConfig } from './types';

/**
 * TS-004 regression: buffered response bodies must never grow past their
 * configured cap, even when the wire (compressed) size looks small. fetch
 * decompresses transparently, so Content-Length alone cannot be trusted —
 * the running byte count must be taken from the decoded bytes as they arrive.
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

function baseConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    authStrategy: async () => ({}),
    retry: { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 2, maxDelayMs: 10, jitterFactor: 0, respectRetryAfter: false },
    timeoutMs: 2000,
    maxResponseBytes: MAX_BYTES,
    trust: 'internal',
    targetService: 'test-service',
    ...overrides,
  };
}

const HEALTH = get({ path: () => '/health', responseSchema: z.object({ ok: z.boolean() }) });
const HEALTH_STREAM = streamGet({ path: () => '/health' });
const WITH_ERROR_SCHEMA = get({
  path: () => '/health',
  responseSchema: z.object({ ok: z.boolean() }),
  errorSchema: z.object({ message: z.string() }),
});

describe('TS-004: buffered responses are size-bounded', () => {
  test('an oversized success body is rejected before it fully materializes', async () => {
    const { server, url } = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, padding: 'x'.repeat(MAX_BYTES * 5) }));
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: url }));
      await expect(client.call(HEALTH, {})).rejects.toThrow(ResponseTooLargeError);
    } finally {
      server.close();
    }
  });

  test('a small compressed body that decodes over the cap is still caught (not fooled by Content-Length)', async () => {
    const decoded = 'A'.repeat(MAX_BYTES * 50);
    const compressed = gzipSync(decoded);
    expect(compressed.length).toBeLessThan(MAX_BYTES); // wire size looks fine

    const { server, url } = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.length) });
      res.end(compressed);
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: url }));
      await expect(client.call(HEALTH, {})).rejects.toThrow(ResponseTooLargeError);
    } finally {
      server.close();
    }
  });

  test('an oversized error body (with errorSchema) is rejected before schema parsing', async () => {
    const { server, url } = await listen((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'x'.repeat(MAX_BYTES * 5) }));
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: url }));
      await expect(client.call(WITH_ERROR_SCHEMA, {})).rejects.toThrow(ResponseTooLargeError);
    } finally {
      server.close();
    }
  });

  test('the streaming path also rejects an oversized non-2xx error body', async () => {
    const { server, url } = await listen((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'x'.repeat(MAX_BYTES * 5) }));
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: url }));
      await expect(client.stream(HEALTH_STREAM, {})).rejects.toThrow(ResponseTooLargeError);
    } finally {
      server.close();
    }
  });

  test('a response under the cap still resolves normally (no regression)', async () => {
    const { server, url } = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: url }));
      const result = await client.call(HEALTH, {});
      expect(result.data).toEqual({ ok: true });
    } finally {
      server.close();
    }
  });

  test('a blocked oversized response is not retried, even for an idempotent GET', async () => {
    let hitCount = 0;
    const { server, url } = await listen((req, res) => {
      hitCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, padding: 'x'.repeat(MAX_BYTES * 5) }));
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: url }));
      await expect(client.call(HEALTH, {})).rejects.toThrow(ResponseTooLargeError);
      expect(hitCount).toBe(1);
    } finally {
      server.close();
    }
  });
});
