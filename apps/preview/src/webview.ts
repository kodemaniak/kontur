import { parsePreviewJson } from './contract';
import {
  mountPreview,
  type PreviewPresenter,
  type PreviewPresenterState,
  type PreviewViewport,
} from './presenter';

type HostStateMessage =
  | { type: 'pending'; revision: number }
  | { type: 'result'; revision: number; result: unknown }
  | { type: 'host-error'; revision: number; message: string };
type EditorSelectionMessage = { type: 'editor-selection'; revision: number; id: string | null };
type HostMessage = HostStateMessage | EditorSelectionMessage;

type PersistedState = PreviewPresenterState & {
  schemaVersion: 1;
  documentUri: string;
};

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: PersistedState): unknown;
};

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Preview root element #app is missing.');
const vscode = acquireVsCodeApi();
const documentUri = document.querySelector<HTMLMetaElement>('meta[name="kontur-document-uri"]')?.content;
let presenter: PreviewPresenter;
let latestRevision = 0;
let ready = false;
let queuedMessage: HostStateMessage | undefined;
let queuedSelection: EditorSelectionMessage | undefined;

function persist(): void {
  const state = presenter.getState();
  if (!state || !documentUri) return;
  try {
    vscode.setState({ schemaVersion: 1, documentUri, ...state });
  } catch {
    // Persistence is best-effort; storage failures must not invalidate a rendered diagram.
  }
}

presenter = mountPreview(root, undefined, {
  onStateChange: persist,
  onNavigate: (id, revision) => vscode.postMessage({ type: 'navigate-to-source', id, revision }),
});

window.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
  if (!isHostMessage(data) || data.revision < latestRevision) return;
  if (data.type === 'editor-selection') {
    if (data.revision !== latestRevision) return;
    if (!ready) queuedSelection = data;
    else presenter.setSourceSelection(data.revision, data.id);
    return;
  }
  latestRevision = data.revision;
  if (!ready) {
    queuedMessage = data;
    return;
  }
  applyHostMessage(data);
});

window.addEventListener('unload', () => presenter.dispose(), { once: true });
void (async () => {
  let state: PreviewPresenterState | undefined;
  try {
    state = readPersistedState(vscode.getState(), documentUri);
  } catch {
    state = undefined;
  }
  if (state) await presenter.restore(state);
  if (queuedMessage) applyHostMessage(queuedMessage);
  if (queuedSelection) presenter.setSourceSelection(queuedSelection.revision, queuedSelection.id);
  ready = true;
  vscode.postMessage({ type: 'ready' });
})();

function applyHostMessage(message: HostStateMessage): void {
  if (message.type === 'pending') {
    presenter.markPending(message.revision);
  } else if (message.type === 'host-error') {
    presenter.showHostError(message.revision, message.message);
  } else {
    try {
      void presenter.applyResult(message.revision, parsePreviewJson(JSON.stringify(message.result))).then(persist);
    } catch (error) {
      presenter.showHostError(message.revision, error instanceof Error ? error.message : String(error));
    }
  }
}

function readPersistedState(value: unknown, expectedDocumentUri: string | undefined): PreviewPresenterState | undefined {
  if (!expectedDocumentUri || !isRecord(value)) return undefined;
  if (!hasExactKeys(value, ['schemaVersion', 'documentUri', 'revision', 'result', 'viewport'])
    || value.schemaVersion !== 1 || value.documentUri !== expectedDocumentUri
    || !isPositiveRevision(value.revision) || !isViewport(value.viewport)) return undefined;
  try {
    const result = parsePreviewJson(JSON.stringify(value.result));
    if (result.status !== 'ok') return undefined;
    return { revision: value.revision, result, viewport: value.viewport };
  } catch {
    return undefined;
  }
}

function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (!isPositiveRevision(message.revision)) return false;
  if (message.type === 'pending') return hasExactKeys(message, ['type', 'revision']);
  if (message.type === 'result') return hasExactKeys(message, ['type', 'revision', 'result']);
  if (message.type === 'editor-selection') return hasExactKeys(message, ['type', 'revision', 'id'])
    && (message.id === null || (typeof message.id === 'string' && message.id.length > 0));
  return message.type === 'host-error' && hasExactKeys(message, ['type', 'revision', 'message'])
    && typeof message.message === 'string' && message.message.length > 0;
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const prototype = Object.getPrototypeOf(value);
  const ownKeys = Object.keys(value);
  return (prototype === Object.prototype || prototype === null)
    && ownKeys.length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
    && ownKeys.every((key) => keys.includes(key));
}

function isViewport(value: unknown): value is PreviewViewport {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'y', 'width', 'height'])) return false;
  const { x, y, width, height } = value;
  return [x, y, width, height].every((number) => typeof number === 'number' && Number.isFinite(number))
    && Math.abs(x as number) <= 1_000_000_000
    && Math.abs(y as number) <= 1_000_000_000
    && (width as number) > 0 && (width as number) <= 1_000_000
    && (height as number) > 0 && (height as number) <= 1_000_000;
}
