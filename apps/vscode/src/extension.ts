import * as vscode from 'vscode';
import { PreviewSession, type PreviewSessionMessage } from './previewSession';
import { isSupportedHost } from './platform';
import { PreviewService } from './serviceProcess';

const PREVIEW_VIEW_TYPE = 'kontur.preview';
const PREVIEW_COMMAND = 'kontur.openPreview';

type ActiveSession = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  session: PreviewSession;
  subscriptions: vscode.Disposable[];
  ready: boolean;
  latestMessage?: PreviewSessionMessage;
};

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
      if (current.ready) void panel.webview.postMessage(message);
    },
  });
  current = { document, panel, session, subscriptions: [], ready: false };
  activeSession = current;
  current.subscriptions.push(panel.onDidDispose(() => { void closeSession(current, false); }));
  current.subscriptions.push(panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isReadyMessage(message)) return;
    current.ready = true;
    if (current.latestMessage) void panel.webview.postMessage(current.latestMessage);
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
