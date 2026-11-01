import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { resolveRevealTarget } from './protocol.js';

interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

interface Fixture {
  elements: Array<{ id: string; source: SourceLocation }>;
}

interface NavigationTarget {
  file: string;
  range: vscode.Range;
}

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('kontur.openVisualization', () => openVisualization(context));
  context.subscriptions.push(command);
}

export function deactivate(): void {}

async function openVisualization(context: vscode.ExtensionContext): Promise<void> {
  const fixtures = await loadFixtures(context.extensionPath);
  const targetById = new Map<string, NavigationTarget>();
  const targetByFile = new Map<string, Array<{ id: string; range: vscode.Range }>>();

  for (const fixture of fixtures) {
    for (const element of fixture.elements) {
      const file = path.resolve(context.extensionPath, element.source.file);
      const range = sourceRange(element.source);
      targetById.set(element.id, { file, range });
      targetByFile.set(file, [...(targetByFile.get(file) ?? []), { id: element.id, range }]);
    }
  }

  const panel = vscode.window.createWebviewPanel(
    'konturVisualizationSpike',
    'Kontur Visualization Spike',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(context.extensionUri, 'fixtures'),
      ],
    },
  );
  panel.webview.html = await webviewHtml(context, panel.webview);

  const reveal = async (id: unknown) => {
    if (typeof id !== 'string') return;
    const target = targetById.get(id);
    if (!target) return;
    const uri = vscode.Uri.file(target.file);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One, false);
    editor.selection = new vscode.Selection(target.range.start, target.range.end);
    editor.revealRange(target.range, vscode.TextEditorRevealType.InCenter);
  };

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    const target = resolveRevealTarget(message, targetById);
    if (target) await reveal(target[0]);
  }, undefined, context.subscriptions);

  let lastEditorSelection = '';
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
    const file = path.resolve(event.textEditor.document.uri.fsPath);
    const entries = targetByFile.get(file);
    if (!entries) return;
    const position = event.selections[0]?.active;
    const match = position && entries.find(({ range }) => range.contains(position));
    if (!match || match.id === lastEditorSelection) return;
    lastEditorSelection = match.id;
    void panel.webview.postMessage({ type: 'editor-selection', id: match.id });
  }));
}

async function loadFixtures(extensionPath: string): Promise<Fixture[]> {
  const files = ['small.json', 'large.json'];
  return Promise.all(files.map(async (name) => {
    const contents = await readFile(path.join(extensionPath, 'fixtures', name), 'utf8');
    return JSON.parse(contents) as Fixture;
  }));
}

function sourceRange(source: SourceLocation): vscode.Range {
  return new vscode.Range(
    Math.max(0, source.line - 1),
    Math.max(0, source.column - 1),
    Math.max(0, source.endLine - 1),
    Math.max(0, source.endColumn - 1),
  );
}

async function webviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<string> {
  const output = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const html = await readFile(path.join(context.extensionPath, 'dist', 'webview', 'index.html'), 'utf8');
  const scriptPath = html.match(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/)?.[1];
  const stylePath = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/)?.[1];
  if (!scriptPath) throw new Error('Built viewer script is missing');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(output, scriptPath.replace(/^\.\//, '')));
  const styleUri = stylePath ? webview.asWebviewUri(vscode.Uri.joinPath(output, stylePath.replace(/^\.\//, ''))) : undefined;
  const workerUri = webview.asWebviewUri(vscode.Uri.joinPath(output, 'layout-worker.js'));
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    'worker-src blob:',
    `connect-src ${webview.cspSource}`,
  ].join('; ');

  return `<!doctype html><html lang="en" data-worker-url="${workerUri}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Kontur visualization spike</title>${styleUri ? `<link rel="stylesheet" href="${styleUri}">` : ''}</head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
}

function getNonce(): string {
  return randomBytes(16).toString('base64');
}
