import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PreviewSession, type PreviewSessionMessage, type PreviewServiceClient } from '../previewSession';
import { isSupportedHost } from '../platform';
import { PreviewService } from '../serviceProcess';

const validRequest = (revision: number) => ({
  schemaVersion: 1 as const,
  revision,
  documentUri: 'file:///service test.dsl',
  text: 'unsaved source',
});

const fakeCliSource = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const mode = process.env.KONTUR_TEST_MODE || 'echo';
if (process.env.KONTUR_TEST_PID_FILE) fs.appendFileSync(process.env.KONTUR_TEST_PID_FILE, String(process.pid) + '\n');
if (mode === 'stderr') process.stderr.write('x'.repeat(100000));
if (mode === 'crash') process.exit(42);
process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
  for (;;) {
    const newline = input.indexOf('\n');
    if (newline < 0) break;
    const request = JSON.parse(input.slice(0, newline));
    input = input.slice(newline + 1);
    if (mode === 'timeout') continue;
    if (mode === 'malformed') { process.stdout.write('not-json\n'); continue; }
    if (mode === 'oversized') { process.stdout.write('x'.repeat(5 * 1024 * 1024 + 1) + '\n'); continue; }
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      revision: request.revision,
      documentUri: request.documentUri,
      result: { schemaVersion: 1, status: 'error', diagnostics: [
        { code: 'syntax', severity: 'error', message: request.text, location: null }
      ] }
    }) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`;

describe('supported extension host', () => {
  it('accepts only Linux x64', () => {
    assert.equal(isSupportedHost('linux', 'x64'), true);
    assert.equal(isSupportedHost('linux', 'arm64'), false);
    assert.equal(isSupportedHost('darwin', 'x64'), false);
    assert.equal(isSupportedHost('win32', 'x64'), false);
  });
});

function fakeCli(mode = 'echo') {
  const directory = mkdtempSync(join(tmpdir(), 'kontur service fake-'));
  const executable = join(directory, 'kontur fake');
  writeFileSync(executable, fakeCliSource.replace(
    "const mode = process.env.KONTUR_TEST_MODE || 'echo';",
    `const mode = ${JSON.stringify(mode)};`,
  ));
  chmodSync(executable, 0o755);
  return { directory, executable, mode };
}

describe('preview service child process', () => {
  it('sends snapshots as framed JSON to one persistent process and correlates responses', async () => {
    const fake = fakeCli();
    const pidFile = join(fake.directory, 'pids');
    const previous = process.env.KONTUR_TEST_PID_FILE;
    process.env.KONTUR_TEST_PID_FILE = pidFile;
    const service = new PreviewService(fake.executable);
    try {
      const first = await service.request(validRequest(1));
      const second = await service.request(validRequest(2));
      assert.equal(first.revision, 1);
      assert.equal(second.revision, 2);
      assert.equal(second.result.status, 'error');
      assert.equal(new Set(readFileSync(pidFile, 'utf8').trim().split('\n')).size, 1);
    } finally {
      await service.dispose();
      if (previous === undefined) delete process.env.KONTUR_TEST_PID_FILE;
      else process.env.KONTUR_TEST_PID_FILE = previous;
      rmSync(fake.directory, { recursive: true, force: true });
    }
  });

  it('reports spawn and unexpected child-exit failures', async () => {
    const missing = new PreviewService('/no/such/kontur');
    await assert.rejects(missing.request(validRequest(1)), /spawn|could not start/i);
    await missing.dispose();

    const fake = fakeCli('crash');
    const crashed = new PreviewService(fake.executable);
    try {
      await assert.rejects(crashed.request(validRequest(1)), /exited|closed unexpectedly|terminated/i);
    } finally {
      await crashed.dispose();
      rmSync(fake.directory, { recursive: true, force: true });
    }
  });

  it('fails closed on malformed and oversized output and bounds captured stderr', async () => {
    for (const mode of ['malformed', 'oversized', 'stderr']) {
      const fake = fakeCli(mode);
      const service = new PreviewService(fake.executable);
      try {
        if (mode === 'stderr') {
          const response = await service.request(validRequest(1));
          assert.equal(response.revision, 1);
          assert.ok(Buffer.byteLength(service.stderr) <= 64 * 1024);
        } else {
          await assert.rejects(service.request(validRequest(1)), /protocol|JSON|frame|response/i);
        }
      } finally {
        await service.dispose();
        rmSync(fake.directory, { recursive: true, force: true });
      }
    }
  });

  it('times out and terminates a service that does not answer', async () => {
    const fake = fakeCli('timeout');
    const service = new PreviewService(fake.executable, { responseTimeoutMs: 50 });
    try {
      await assert.rejects(service.request(validRequest(1)), /timed out|timeout/i);
    } finally {
      await service.dispose();
      rmSync(fake.directory, { recursive: true, force: true });
    }
  });

  it('closes stdin and waits for graceful child shutdown', async () => {
    const fake = fakeCli();
    const service = new PreviewService(fake.executable);
    await service.request(validRequest(1));
    await service.dispose();
    await service.dispose();
    rmSync(fake.directory, { recursive: true, force: true });
  });
});

describe('preview session snapshots', () => {
  it('ignores unrelated documents and marks bound dirty edits pending immediately before the fixed debounce', async () => {
    const uri = 'file:///bound.dsl';
    const requests: string[] = [];
    const messages: PreviewSessionMessage[] = [];
    const clock = new FakeClock();
    const service: PreviewServiceClient = {
      async request(request) {
        requests.push(request.text);
        return {
          schemaVersion: 1,
          revision: request.revision,
          documentUri: request.documentUri,
          result: {
            schemaVersion: 1,
            status: 'error',
            diagnostics: [{ code: 'syntax', severity: 'error', message: request.text, location: null }],
          },
        };
      },
      async dispose() {},
    };
    let text = 'initial';
    const session = new PreviewSession({
      documentUri: uri,
      readText: () => text,
      createService: () => service,
      post: (message) => messages.push(message),
      clock,
    });

    session.start();
    await settle();
    assert.deepEqual(requests, ['initial']);
    session.documentChanged('file:///unrelated.dsl', 'unrelated');
    clock.advance(500);
    await settle();
    assert.deepEqual(requests, ['initial']);

    text = 'unsaved buffer';
    session.documentChanged(uri, text);
    assert.deepEqual(messages.at(-1), { type: 'pending', revision: 2 });
    clock.advance(199);
    await settle();
    assert.deepEqual(requests, ['initial']);
    clock.advance(1);
    await settle();
    assert.deepEqual(requests, ['initial', 'unsaved buffer']);
    assert.equal(messages.at(-1)?.type, 'result');
    session.dispose();
  });

  it('discards a superseded response that arrives before the next debounced request', async () => {
    const clock = new FakeClock();
    const posts: PreviewSessionMessage[] = [];
    const calls = deferredClient();
    const session = new PreviewSession({
      documentUri: 'file:///bound.dsl',
      readText: () => 'latest',
      createService: () => calls.client,
      post: (message) => posts.push(message),
      clock,
    });

    session.start();
    session.documentChanged('file:///bound.dsl', 'new buffer');
    calls.requests[0].resolve(responseFor(calls.requests[0].request));
    await settle();
    assert.equal(posts.some((message) => message.type === 'result'), false);
    assert.equal(calls.requests.length, 1);

    clock.advance(200);
    assert.equal(calls.requests[1].request.text, 'new buffer');
    calls.requests[1].resolve(responseFor(calls.requests[1].request));
    await settle();
    assert.deepEqual(posts.filter((message) => message.type === 'result').map(({ revision }) => revision), [2]);
    await session.dispose();
  });

  it('allows one in-flight request and sends only the newest pending snapshot', async () => {
    const clock = new FakeClock();
    const posts: PreviewSessionMessage[] = [];
    const calls = deferredClient();
    const session = new PreviewSession({
      documentUri: 'file:///bound.dsl',
      readText: () => 'initial',
      createService: () => calls.client,
      post: (message) => posts.push(message),
      clock,
    });

    session.start();
    session.documentChanged('file:///bound.dsl', 'middle edit');
    clock.advance(200);
    assert.equal(calls.requests.length, 1, 'a second request must wait for the in-flight response');
    session.documentChanged('file:///bound.dsl', 'newest edit');
    clock.advance(200);
    assert.equal(calls.requests.length, 1, 'edits must not create parallel requests');
    calls.requests[0].resolve(responseFor(calls.requests[0].request));
    await settle();
    assert.equal(calls.requests.length, 2);
    assert.equal(calls.requests[1].request.text, 'newest edit');
    calls.requests[1].resolve(responseFor(calls.requests[1].request));
    await settle();
    assert.deepEqual(posts.filter((message) => message.type === 'result').map(({ revision }) => revision), [3]);
    await session.dispose();
  });

  it('ignores a stale failure and suppresses callbacks after disposal', async () => {
    const clock = new FakeClock();
    const posts: PreviewSessionMessage[] = [];
    const calls = deferredClient();
    const session = new PreviewSession({
      documentUri: 'file:///bound.dsl',
      readText: () => 'latest',
      createService: () => calls.client,
      post: (message) => posts.push(message),
      clock,
    });
    session.start();
    session.documentChanged('file:///bound.dsl', 'newer');
    calls.requests[0].reject(new Error('old child failure'));
    await settle();
    assert.equal(posts.some((message) => message.type === 'host-error'), false);

    const disposedCalls = deferredClient();
    const disposedPosts: PreviewSessionMessage[] = [];
    const disposedSession = new PreviewSession({
      documentUri: 'file:///disposed.dsl',
      readText: () => 'source',
      createService: () => disposedCalls.client,
      post: (message) => disposedPosts.push(message),
      clock: new FakeClock(),
    });
    disposedSession.start();
    await disposedSession.dispose();
    disposedCalls.requests[0].resolve(responseFor(disposedCalls.requests[0].request));
    await settle();
    assert.equal(disposedPosts.some((message) => message.type === 'result' || message.type === 'host-error'), false);
    await session.dispose();
  });

  it('restarts the failed service only after an explicit retry and compiles the current text', async () => {
    const posts: PreviewSessionMessage[] = [];
    const failed = deferredClient();
    const replacement = deferredClient();
    let text = 'initial';
    let serviceNumber = 0;
    const session = new PreviewSession({
      documentUri: 'file:///bound.dsl',
      readText: () => text,
      createService: () => (++serviceNumber === 1 ? failed.client : replacement.client),
      post: (message) => posts.push(message),
      clock: new FakeClock(),
    });
    session.start();
    failed.requests[0].reject(new Error('service stopped'));
    await settle();
    assert.equal(posts.at(-1)?.type, 'host-error');
    text = 'latest unsaved text';
    session.retry();
    assert.equal(replacement.requests[0].request.text, 'latest unsaved text');
    assert.equal(replacement.requests[0].request.revision, 2);
    replacement.requests[0].resolve(responseFor(replacement.requests[0].request));
    await settle();
    assert.equal(posts.at(-1)?.type, 'result');
    await session.dispose();
  });
});

class FakeClock {
  private now = 0;
  private nextId = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, delay: number): number => {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => { this.timers.delete(handle as number); };

  advance(milliseconds: number): void {
    this.now += milliseconds;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at > this.now) continue;
      this.timers.delete(id);
      timer.callback();
    }
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function deferredClient() {
  const requests: { request: import('../serviceProcess').PreviewRequest;
    resolve(response: import('../../../preview/src/serviceContract').PreviewServiceResponse): void;
    reject(error: Error): void }[] = [];
  const client: PreviewServiceClient = {
    request(request) {
      const operation = deferred<import('../../../preview/src/serviceContract').PreviewServiceResponse>();
      requests.push({ request, resolve: operation.resolve, reject: operation.reject });
      return operation.promise;
    },
    async dispose() {},
  };
  return { client, requests };
}

function responseFor(request: import('../serviceProcess').PreviewRequest) {
  return {
    schemaVersion: 1 as const,
    revision: request.revision,
    documentUri: request.documentUri,
    result: {
      schemaVersion: 1 as const,
      status: 'error' as const,
      diagnostics: [{ code: 'syntax', severity: 'error' as const, message: request.text, location: null }],
    },
  };
}
