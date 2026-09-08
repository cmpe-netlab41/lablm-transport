import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { createTransportClient } from './client';
import { get, streamGet } from './descriptors';
import { IntegrationRedirectBlockedError } from './errors';
import type { ClientConfig } from './types';

/**
 * TS-001 regression: fetch must never auto-follow a redirect. A redirect target
 * that differs from the request origin would otherwise receive every credential
 * header the auth strategy attaches (Undici only strips Authorization/cookie
 * cross-origin, not custom capability headers like x-inference-token).
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

function baseConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    authStrategy: async () => ({ Authorization: 'Bearer s2s-token', 'x-inference-token': 'SECRET-CAPABILITY' }),
    retry: { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 2, maxDelayMs: 10, jitterFactor: 0, respectRetryAfter: false },
    timeoutMs: 2000,
    maxResponseBytes: 10 * 1024 * 1024,
    trust: 'internal',
    targetService: 'test-service',
    ...overrides,
  };
}

const HEALTH = get({ path: () => '/health', responseSchema: z.object({ ok: z.boolean() }) });
const HEALTH_STREAM = streamGet({ path: () => '/health' });

describe('TS-001: redirects are never followed', () => {
  test('a cross-origin redirect is blocked and the target never receives credentials', async () => {
    const targetHits: unknown[] = [];
    const { server: target, url: targetUrl } = await listen((req, res) => {
      targetHits.push(req.headers);
      res.end('should never be reached');
    });

    const { server: origin, url: originUrl } = await listen((req, res) => {
      res.writeHead(302, { Location: `${targetUrl}/health` });
      res.end();
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: originUrl }));
      await expect(client.call(HEALTH, {})).rejects.toThrow(IntegrationRedirectBlockedError);
      expect(targetHits).toHaveLength(0);
    } finally {
      origin.close();
      target.close();
    }
  });

  test('a normal 200 response still resolves (no regression)', async () => {
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

  test('a blocked redirect is not retried, even for an idempotent GET', async () => {
    let hitCount = 0;
    const { server, url } = await listen((req, res) => {
      hitCount++;
      res.writeHead(302, { Location: 'http://127.0.0.1:1/unreachable' });
      res.end();
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: url }));
      await expect(client.call(HEALTH, {})).rejects.toThrow(IntegrationRedirectBlockedError);
      expect(hitCount).toBe(1);
    } finally {
      server.close();
    }
  });

  test('the streaming path also blocks redirects and never contacts the target', async () => {
    const targetHits: unknown[] = [];
    const { server: target, url: targetUrl } = await listen((req, res) => {
      targetHits.push(req.headers);
      res.end('should never be reached');
    });

    const { server: origin, url: originUrl } = await listen((req, res) => {
      res.writeHead(307, { Location: `${targetUrl}/health` });
      res.end();
    });

    try {
      const client = createTransportClient(baseConfig({ baseUrl: originUrl }));
      await expect(client.stream(HEALTH_STREAM, {})).rejects.toThrow(IntegrationRedirectBlockedError);
      expect(targetHits).toHaveLength(0);
    } finally {
      origin.close();
      target.close();
    }
  });
});
