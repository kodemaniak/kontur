import type { PreviewResult } from '../../preview/src/contract';
import type { PreviewServiceResponse } from '../../preview/src/serviceContract';
import type { PreviewRequest } from './serviceProcess';

export type PreviewSessionMessage =
  | { type: 'pending'; revision: number }
  | { type: 'result'; revision: number; result: PreviewResult }
  | { type: 'host-error'; revision: number; message: string };

export type PreviewServiceClient = {
  request(request: PreviewRequest): Promise<PreviewServiceResponse>;
  dispose(): Promise<void>;
};

export type PreviewSessionOptions = {
  documentUri: string;
  readText(): string;
  createService(): PreviewServiceClient;
  post(message: PreviewSessionMessage): void;
  clock?: { setTimeout(callback: () => void, delay: number): unknown; clearTimeout(handle: unknown): void };
};

export class PreviewSession {
  private readonly clock: NonNullable<PreviewSessionOptions['clock']>;
  private service: PreviewServiceClient;
  private revision = 0;
  private pending?: { revision: number; text: string };
  private timer?: unknown;
  private debounceElapsed = false;
  private inFlight = false;
  private failed = false;
  private started = false;
  private disposed = false;

  constructor(private readonly options: PreviewSessionOptions) {
    this.clock = options.clock ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    };
    this.service = options.createService();
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.queueSnapshot(this.options.readText(), false);
  }

  documentChanged(documentUri: string, text: string): void {
    if (this.disposed || documentUri !== this.options.documentUri) return;
    this.queueSnapshot(text, true);
  }

  retry(): void {
    if (this.disposed || !this.failed) return;
    const oldService = this.service;
    void oldService.dispose();
    try {
      this.service = this.options.createService();
    } catch (error) {
      this.post({ type: 'host-error', revision: this.revision, message: this.errorMessage(error) });
      return;
    }
    this.failed = false;
    this.clearTimer();
    this.pending = undefined;
    this.queueSnapshot(this.options.readText(), false);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.pending = undefined;
    await this.service.dispose();
  }

  private queueSnapshot(text: string, debounce: boolean): void {
    const revision = ++this.revision;
    this.pending = { revision, text };
    this.debounceElapsed = !debounce;
    this.post({ type: 'pending', revision });
    this.clearTimer();
    if (debounce) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = undefined;
        this.debounceElapsed = true;
        void this.dispatch();
      }, 200);
    } else {
      void this.dispatch();
    }
  }

  private async dispatch(): Promise<void> {
    if (this.disposed || this.failed || this.inFlight || !this.pending || !this.debounceElapsed) return;
    const snapshot = this.pending;
    this.pending = undefined;
    this.debounceElapsed = false;
    this.inFlight = true;
    try {
      const response = await this.service.request({
        schemaVersion: 1,
        revision: snapshot.revision,
        documentUri: this.options.documentUri,
        text: snapshot.text,
      });
      if (!this.disposed && snapshot.revision === this.revision) {
        this.post({ type: 'result', revision: snapshot.revision, result: response.result });
      }
    } catch (error) {
      if (!this.disposed) {
        this.failed = true;
        if (snapshot.revision === this.revision) {
          this.post({ type: 'host-error', revision: snapshot.revision, message: this.errorMessage(error) });
        }
        void this.service.dispose();
      }
    } finally {
      this.inFlight = false;
      if (this.pending && this.debounceElapsed) void this.dispatch();
    }
  }

  private post(message: PreviewSessionMessage): void {
    if (!this.disposed) this.options.post(message);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
