import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { parsePreviewResponse, type PreviewServiceResponse } from '../../preview/src/serviceContract';

const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

export type PreviewRequest = {
  schemaVersion: 1;
  revision: number;
  documentUri: string;
  text: string;
};

export type PreviewServiceOptions = { responseTimeoutMs?: number };

type PendingRequest = {
  request: PreviewRequest;
  resolve(response: PreviewServiceResponse): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

export class PreviewService {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: PendingRequest;
  private stdout = Buffer.alloc(0);
  private stderrBytes = Buffer.alloc(0);
  private failure?: Error;
  private disposed = false;

  constructor(
    private readonly executable: string,
    private readonly options: PreviewServiceOptions = {},
  ) {}

  get stderr(): string {
    return this.stderrBytes.toString('utf8');
  }

  request(request: PreviewRequest): Promise<PreviewServiceResponse> {
    if (this.disposed) return Promise.reject(new Error('Preview service is disposed.'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) return Promise.reject(new Error('Preview service already has a request in flight.'));
    if (request.schemaVersion !== 1 || !Number.isSafeInteger(request.revision) || request.revision < 1
      || typeof request.documentUri !== 'string' || request.documentUri.length === 0
      || typeof request.text !== 'string') {
      return Promise.reject(new Error('Invalid preview service request.'));
    }

    const frame = Buffer.from(`${JSON.stringify(request)}\n`, 'utf8');
    if (frame.byteLength > MAX_FRAME_BYTES) {
      return Promise.reject(new Error('Preview service request exceeds the 5 MiB frame limit.'));
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.start();
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Preview service response timed out.')), this.options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS);
      this.pending = { request, resolve, reject, timer };
      child.stdin.write(frame, (error) => {
        if (error) this.fail(new Error(`Could not write to preview service: ${error.message}`));
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pending) this.rejectPending(new Error('Preview service is shutting down.'));
    const child = this.child;
    if (!child || hasExited(child)) return;

    child.stdin.end();
    if (await waitForExit(child, 1_000)) return;
    child.kill('SIGTERM');
    if (await waitForExit(child, 1_000)) return;
    child.kill('SIGKILL');
    await waitForExit(child, 1_000);
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.executable, ['preview-service'], { stdio: 'pipe', windowsHide: true });
    } catch (error) {
      this.failure = new Error(`Could not start preview service: ${error instanceof Error ? error.message : String(error)}`);
      throw this.failure;
    }
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBytes = Buffer.concat([this.stderrBytes, chunk]).subarray(-MAX_STDERR_BYTES);
    });
    child.stdin.on('error', (error) => this.fail(new Error(`Preview service input failed: ${error.message}`)));
    child.on('error', (error) => this.fail(new Error(`Could not start preview service: ${error.message}`)));
    child.on('exit', (code, signal) => {
      if (!this.disposed) this.fail(new Error(`Preview service exited unexpectedly (${signal ?? code ?? 'unknown'}).`), false);
    });
    return child;
  }

  private receive(chunk: Buffer): void {
    if (this.stdout.byteLength + chunk.byteLength > MAX_FRAME_BYTES) {
      this.fail(new Error('Preview service response exceeds the 5 MiB frame limit.'));
      return;
    }
    this.stdout = Buffer.concat([this.stdout, chunk]);
    for (;;) {
      const newline = this.stdout.indexOf(0x0a);
      if (newline < 0) {
        if (this.stdout.byteLength > MAX_FRAME_BYTES) this.fail(new Error('Preview service response exceeds the 5 MiB frame limit.'));
        return;
      }
      if (newline + 1 > MAX_FRAME_BYTES) {
        this.fail(new Error('Preview service response exceeds the 5 MiB frame limit.'));
        return;
      }
      const frame = this.stdout.subarray(0, newline);
      this.stdout = this.stdout.subarray(newline + 1);
      const pending = this.pending;
      if (!pending) {
        this.fail(new Error('Preview service sent an unsolicited response.'));
        return;
      }
      try {
        const response = parsePreviewResponse(frame.toString('utf8'), {
          revision: pending.request.revision,
          documentUri: pending.request.documentUri,
        });
        this.pending = undefined;
        clearTimeout(pending.timer);
        pending.resolve(response);
      } catch (error) {
        this.fail(new Error(`Preview service protocol error: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      if (this.stdout.byteLength > 0) {
        this.fail(new Error('Preview service sent an unsolicited response.'));
        return;
      }
    }
  }

  private fail(error: Error, terminate = true): void {
    if (this.failure) return;
    this.failure = error;
    if (this.pending) this.rejectPending(error);
    if (terminate && this.child && !hasExited(this.child)) this.child.kill('SIGTERM');
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onClose = () => finish(true);
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.off('close', onClose);
      resolve(exited);
    };
    child.once('close', onClose);
  });
}
