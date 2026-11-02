import * as vscode from 'vscode';
import { PreviewSession, type PreviewSessionMessage } from './previewSession';
import { isSupportedHost } from './platform';
import { PreviewService } from './serviceProcess';
import { findSourceElementId, parseNavigationRequest, sourceRange, type SourceMappingDocument, type SourceRange } from './sourceMapping';
import type { ResolvedViewDto } from '../../preview/src/contract';

const PREVIEW_VIEW_TYPE = 'kontur.preview';
const PREVIEW_COMMAND = 'kontur.openPreview';

type ActiveSession = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  session: PreviewSession;
  subscriptions: vscode.Disposable[];
  ready: boolean;
  latestMessage?: PreviewSessionMessage;
  sourceMap?: { revision: number; view: ResolvedViewDto; ranges: Map<string, SourceRange> };
  latestSelection?: EditorSelectionMessage;
};

type EditorSelectionMessage = { type: 'editor-selection'; revision: number; id: string | null };

let activeSession: ActiveSession | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(PREVIEW_COMMAND, () => openPreview(context)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!activeSession || event.document.uri.toString() !== activeSession.document.uri.toString()) return;
      if (event.contentChanges.length > 0) {
        activeSession.session.documentChanged(event.document.uri.toString(), event.document.getText());
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.toString() === activeSession?.document.uri.toString()) void closeSession(activeSession, true);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const current = activeSession;
      if (current?.document.uri.toString() !== event.textEditor.document.uri.toString()) return;
      postEditorSelection(current, event.selections[0]?.active);
    }),
  );
}

export function deactivate(): Promise<void> | undefined {
  return activeSession ? closeSession(activeSession, true) : undefined;
}

async function openPreview(context: vscode.ExtensionContext): Promise<void> {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.uri.scheme !== 'file' || !document.uri.path.toLowerCase().endsWith('.dsl')) {
    void vscode.window.showInformationMessage('Open a local .dsl document to preview its architecture.');
    return;
  }
  if (!isSupportedHost()) {
    void vscode.window.showErrorMessage('Kontur preview currently supports Linux x64 only.');
    return;
  }

  if (activeSession?.document.uri.toString() === document.uri.toString()) {
    activeSession.panel.reveal(vscode.ViewColumn.Beside);
    activeSession.session.retry();
    return;
  }
  if (activeSession) await closeSession(activeSession, true);

  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel(
    PREVIEW_VIEW_TYPE,
    'Kontur Preview',
    vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [mediaRoot] },
  );
  let current: ActiveSession | undefined;
  const session = new PreviewSession({
    documentUri: document.uri.toString(),
    readText: () => document.getText(),
    createService: () => new PreviewService(context.asAbsolutePath('bin/kontur')),
    post: (message) => {
      if (!current) return;
      current.latestMessage = message;
      if (message.type === 'pending') {
        current.sourceMap = undefined;
        current.latestSelection = undefined;
      } else if (message.type === 'result') {
        if (message.result.status === 'ok') current.sourceMap = createSourceMap(message.revision, message.result.view, document);
        else current.sourceMap = undefined;
        current.latestSelection = undefined;
      } else {
        current.sourceMap = undefined;
        current.latestSelection = undefined;
      }
      if (current.ready) void panel.webview.postMessage(message);
      if (message.type === 'result' && message.result.status === 'ok') {
        postEditorSelection(current, boundEditor(current)?.selection.active);
      }
    },
  });
  current = { document, panel, session, subscriptions: [], ready: false };
  activeSession = current;
  current.subscriptions.push(panel.onDidDispose(() => { void closeSession(current, false); }));
  current.subscriptions.push(panel.webview.onDidReceiveMessage((message: unknown) => {
    if (isReadyMessage(message)) {
      current.ready = true;
      if (current.latestMessage) void panel.webview.postMessage(current.latestMessage);
      if (current.latestSelection && current.sourceMap?.revision === current.latestSelection.revision) {
        void panel.webview.postMessage(current.latestSelection);
      }
      return;
    }
    const sourceMap = current.sourceMap;
    if (!sourceMap) return;
    const id = parseNavigationRequest(message, sourceMap.revision, new Set(sourceMap.ranges.keys()));
    const range = id ? sourceMap.ranges.get(id) : undefined;
    if (!range) return;
    void navigateToSource(current, sourceMap.revision, range);
  }));
  panel.webview.html = webviewHtml(panel.webview, context.extensionUri, document.uri.toString());
  session.start();
}

async function closeSession(session: ActiveSession, closePanel: boolean): Promise<void> {
  if (activeSession === session) activeSession = undefined;
  for (const subscription of session.subscriptions.splice(0)) subscription.dispose();
  const stopping = session.session.dispose();
  if (closePanel) session.panel.dispose();
  await stopping;
}

function isReadyMessage(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as { type?: unknown }).type === 'ready';
}

function sourceDocument(document: vscode.TextDocument): SourceMappingDocument {
  return {
    documentUri: document.uri.toString(),
    lineCount: document.lineCount,
    lineAt: (line) => document.lineAt(line),
    offsetAt: ({ line, character }) => document.offsetAt(new vscode.Position(line, character)),
  };
}

function createSourceMap(
  revision: number,
  view: ResolvedViewDto,
  document: vscode.TextDocument,
): NonNullable<ActiveSession['sourceMap']> {
  const mappingDocument = sourceDocument(document);
  const ranges = new Map<string, SourceRange>();
  for (const target of [...view.elements, ...view.boundaries]) {
    if (target.source) {
      const range = sourceRange(target.source, mappingDocument);
      if (range) ranges.set(target.id, range);
    }
  }
  return { revision, view, ranges };
}

function boundEditor(session: ActiveSession): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === session.document.uri.toString(),
  );
}

function postEditorSelection(session: ActiveSession, position?: vscode.Position): void {
  const sourceMap = session.sourceMap;
  if (!sourceMap) return;
  const id = position
    ? findSourceElementId(sourceMap.view, position, sourceDocument(session.document)) ?? null
    : null;
  const message: EditorSelectionMessage = { type: 'editor-selection', revision: sourceMap.revision, id };
  session.latestSelection = message;
  if (session.ready) void session.panel.webview.postMessage(message);
}

async function navigateToSource(session: ActiveSession, revision: number, range: SourceRange): Promise<void> {
  const editor = await vscode.window.showTextDocument(session.document, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  if (activeSession !== session || session.sourceMap?.revision !== revision) return;
  const start = new vscode.Position(range.start.line, range.start.character);
  const end = new vscode.Position(range.end.line, range.end.character);
  const selection = new vscode.Range(start, end);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, documentUri: string): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'preview.css'));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="kontur-document-uri" content="${escapeHtmlAttribute(documentUri)}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource};">
  <link rel="stylesheet" href="${style}">
  <title>Kontur Preview</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${script}"></script>
</body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
