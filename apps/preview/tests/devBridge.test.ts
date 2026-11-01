import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { expect, it } from 'vitest';
import { konturDevBridge, type DevBridgeOptions } from '../scripts/devBridge';

type Middleware = (request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void) => void;

async function startBridge(options: Omit<DevBridgeOptions, 'port'>) {
  let middleware: Middleware | undefined;
  const server = createServer((request, response) => {
    middleware?.(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  const configure = konturDevBridge({ ...options, port: address.port }).configureServer as (server: ViteDevServer) => void;
  configure({
    middlewares: { use: (handler: Middleware) => { middleware = handler; } },
  } as unknown as ViteDevServer);
  return {
    url: `http://127.0.0.1:${address.port}/api/view`,
    async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}

function fakeCli(dir: string, logPath: string): string {
  const path = join(dir, 'fake-cli');
  writeFileSync(path, `#!/usr/bin/env node\nconst fs=require('node:fs');\nfs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2))+'\\n');\nprocess.stdout.write(${JSON.stringify('{"schemaVersion":1,"status":"error","diagnostics":[{"code":"syntax","severity":"error","message":"bad source","location":null}]}')});\n`);
  chmodSync(path, 0o755);
  return path;
}

it('runs the configured CLI with literal argv and starts a fresh process for every reload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kontur-bridge-'));
  const log = join(dir, 'args.jsonl');
  const cliPath = fakeCli(dir, log);
  const dslPath = join(dir, 'a file; $(touch not-a-command).dsl');
  const viewKey = 'orders; echo injected';
  const bridge = await startBridge({ cliPath, dslPath, viewKey });
  try {
    for (let i = 0; i < 2; i++) {
      const response = await fetch(bridge.url, { headers: { Origin: new URL(bridge.url).origin } });
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe('error');
    }
    expect(readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      ['view', dslPath, '--view', viewKey],
      ['view', dslPath, '--view', viewKey],
    ]);
  } finally {
    await bridge.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function requestWithHost(url: string, host: string, origin: string): Promise<number> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      headers: { Host: host, Origin: origin },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
    request.end();
  });
}

it('rejects untrusted host/origin, methods, and browser-supplied path overrides', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kontur-bridge-'));
  const log = join(dir, 'args.jsonl');
  const bridge = await startBridge({ cliPath: fakeCli(dir, log), dslPath: join(dir, 'fixed.dsl'), viewKey: 'fixed' });
  try {
    const origin = new URL(bridge.url).origin;
    expect(await requestWithHost(bridge.url, 'attacker.example', origin)).toBe(403);
    const deniedOrigin = await fetch(bridge.url, { headers: { Origin: 'https://attacker.example' } });
    expect(deniedOrigin.status).toBe(403);
    const deniedMethod = await fetch(bridge.url, { method: 'POST', headers: { Origin: origin } });
    expect(deniedMethod.status).toBe(405);
    const deniedQuery = await fetch(`${bridge.url}?file=/etc/passwd&view=x`, { headers: { Origin: origin } });
    expect(deniedQuery.status).toBe(400);
    expect(() => readFileSync(log, 'utf8')).toThrow();
  } finally {
    await bridge.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('returns a structured host diagnostic when the configured CLI cannot start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kontur-bridge-'));
  const bridge = await startBridge({ cliPath: join(dir, 'missing'), dslPath: join(dir, 'fixed.dsl'), viewKey: 'fixed' });
  try {
    const response = await fetch(bridge.url, { headers: { Origin: new URL(bridge.url).origin } });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.status).toBe('error');
    expect(body.diagnostics[0].code).toBe('host');
  } finally {
    await bridge.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
