import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Frame } from 'playwright-core';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('kontur.kontur-vscode-preview');
  assert.ok(extension, 'expected the packaged Kontur extension to be installed');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('kontur.openPreview'), 'expected Kontur: Open Preview to be registered');
  const directory = mkdtempSync(join(tmpdir(), 'kontur-session-test-'));
  const firstPath = join(directory, 'first.dsl');
  const secondPath = join(directory, 'second.dsl');
  const unrelatedPath = join(directory, 'notes.txt');
  const workspace = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspace, 'expected the test workspace to be open');
  assert.equal(vscode.workspace.isTrusted, true, 'the VSIX smoke requires its workspace to be trusted');
  const initialText = readFileSync(join(workspace.uri.fsPath, 'examples/orders-payments/workspace.dsl'), 'utf8');
  writeFileSync(firstPath, initialText);
  writeFileSync(secondPath, initialText);
  writeFileSync(unrelatedPath, 'unrelated');

  const webviewTabs = () => vscode.window.tabGroups.all.flatMap(({ tabs }) => tabs)
    .filter(({ input }) => input instanceof vscode.TabInputWebview);
  const waitForWebview = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const tabs = webviewTabs();
      if (tabs.length > 0) return tabs;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return webviewTabs();
  };
  let browser: Browser | undefined;
  let cdp: WebviewHandle | undefined;
  try {
    const first = await vscode.workspace.openTextDocument(vscode.Uri.file(firstPath));
    const firstEditor = await vscode.window.showTextDocument(first, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('kontur.openPreview');
    assert.equal((await waitForWebview()).length, 1, 'expected exactly one preview panel');
    assert.ok(
      webviewTabs()[0].group.viewColumn > (firstEditor.viewColumn ?? 0),
      'expected the preview beside the bound DSL editor',
    );

    await vscode.commands.executeCommand('kontur.openPreview');
    assert.equal(webviewTabs().length, 1, 'reopening the bound document must reuse its preview');

    const unrelated = await vscode.workspace.openTextDocument(vscode.Uri.file(unrelatedPath));
    await vscode.window.showTextDocument(unrelated, vscode.ViewColumn.One);
    assert.equal(webviewTabs().length, 1, 'editor focus alone must not retarget or close the preview');
    await vscode.commands.executeCommand('kontur.openPreview');
    assert.equal(webviewTabs().length, 1, 'unsupported input must not create another preview');

    const second = await vscode.workspace.openTextDocument(vscode.Uri.file(secondPath));
    const secondEditor = await vscode.window.showTextDocument(second, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('kontur.openPreview');
    await waitUntil(() => webviewTabs().length === 1, 'the replacement preview panel to be created');
    assert.equal(webviewTabs().length, 1, 'selecting another DSL document must replace the preview');
    assert.ok(webviewTabs()[0].group.viewColumn > (secondEditor.viewColumn ?? 0));

    const editor = secondEditor;
    await vscode.commands.executeCommand('workbench.action.focusRightGroup');
    await waitUntil(() => webviewTabs()[0]?.isActive === true, 'the preview webview tab to become active');
    const originalLabel = 'Requests authorization with customer and currency context';
    const changedLabel = 'Unsaved authorization relationship';
    assert.ok(initialText.includes(originalLabel), 'expected the example relationship fixture');
    const changedText = initialText.replace(originalLabel, changedLabel);

    const debugPort = process.env.KONTUR_VSCODE_DEBUG_PORT;
    assert.ok(debugPort, 'expected the VS Code smoke harness to provide its local debug port');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    cdp = await connectToWebview(browser, second.uri.toString());
    await waitForBrowser(cdp, 'document.querySelector("#diagram svg")?.dataset.elementCount ?? null',
      (value) => value !== null, 'the bundled Rust service should render the example diagram');
    assert.equal(await cdp.evaluate('document.querySelector("#diagram svg")?.dataset.elementCount'), '6');

    await cdp.evaluate('document.querySelector("#zoom-in").click()');
    const beforeEdit = await readViewBox(cdp);
    await replaceDocument(editor, changedText);
    assert.equal(second.isDirty, true, 'preview updates must not require saving the document');
    assert.equal(readFileSync(secondPath, 'utf8'), initialText, 'the extension must not save or rewrite source');
    await waitForBrowser(cdp, 'document.querySelector("#diagram")?.textContent ?? ""',
      (value) => String(value).includes(changedLabel), 'the unsaved relationship edit should reach the preview');
    await waitForBrowser(cdp, 'document.querySelector("#status")?.dataset.stale',
      (value) => value === 'false', 'the unsaved preview result should become current');
    const afterEdit = await readViewBox(cdp);
    assert.ok(afterEdit.width < beforeEdit.width * 1.5, 'the edit should retain a zoomed viewport rather than Fit');
    await cdp.evaluate('document.querySelector("#fit").click()');
    const fitBox = await readViewBox(cdp);
    assert.ok(afterEdit.width < fitBox.width, 'the panned/zoomed view should remain zoomed after the edit');
    await cdp.evaluate('document.querySelector("#zoom-in").click()');

    const lastValidSvg = await cdp.evaluate('document.querySelector("#diagram svg").outerHTML') as string;
    await replaceDocument(editor, 'workspace {');
    await waitForBrowser(cdp, 'document.querySelector("#diagnostics")?.textContent ?? ""',
      (value) => String(value).includes('syntax'), 'invalid DSL should display Rust diagnostics');
    assert.equal(await cdp.evaluate('document.querySelector("#status")?.dataset.stale'), 'true');
    assert.equal(await cdp.evaluate('document.querySelector("#diagram svg")?.outerHTML'), lastValidSvg,
      'invalid DSL must retain the last valid SVG');

    await replaceDocument(editor, changedText);
    await waitForBrowser(cdp, 'document.querySelector("#status")?.dataset.stale',
      (value) => value === 'false', 'a valid edit should recover the preview');
    await waitForBrowser(cdp, 'document.querySelector("#diagram")?.textContent ?? ""',
      (value) => String(value).includes(changedLabel), 'the recovered diagram should show the latest relationship');

    const hostileLabel = '<img src=x onerror=window.__konturPwned=1>';
    await replaceDocument(editor, changedText.replace(changedLabel, hostileLabel));
    await waitForBrowser(cdp, 'document.querySelector("#diagram")?.textContent ?? ""',
      (value) => String(value).includes('<img src=x'), 'the hostile label should render as text');
    assert.equal(await cdp.evaluate('document.querySelector("#diagram img, #diagram [onerror]") !== null'), false,
      'hostile DSL labels must not create active HTML');
    assert.equal(await cdp.evaluate('window.__konturPwned ?? null'), null);

    const viewportBeforeReload = await readViewBox(cdp);
    await vscode.window.showTextDocument(second, vscode.ViewColumn.Two);
    await waitUntil(() => cdp!.frame.isDetached(), 'VS Code to dispose the hidden webview document');
    await vscode.window.showTextDocument(second, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('kontur.openPreview');
    await waitUntil(() => webviewTabs()[0]?.isActive === true, 'the preview panel to be revealed again');
    cdp = await connectToWebview(browser, second.uri.toString());
    await waitForBrowser(cdp, 'document.querySelector("#diagram svg")?.getAttribute("viewBox") ?? null',
      (value) => value !== null, 'the recreated webview should restore its last valid diagram');
    assert.deepEqual(await readViewBox(cdp), viewportBeforeReload,
      'the recreated webview should restore the last-valid viewport');
    await waitForBrowser(cdp, 'document.querySelector("#diagram")?.textContent ?? ""',
      (value) => String(value).includes('<img src=x'), 'the recreated view should retain the latest valid source');
    assert.equal(readFileSync(secondPath, 'utf8'), initialText, 'the extension must never save the source');

    const otherDsl = await vscode.workspace.openTextDocument(vscode.Uri.file(firstPath));
    const otherEditor = await vscode.window.showTextDocument(otherDsl, vscode.ViewColumn.One);
    await otherEditor.edit((edit) => edit.insert(otherDsl.positionAt(0), '// unrelated edit\n'));
    assert.equal(webviewTabs().length, 1, 'unrelated document edits must not open another preview');

    const servicePid = await waitForServiceProcess();
    await vscode.window.tabGroups.close(webviewTabs());
    await waitUntil(() => !processExists(servicePid), 'the preview child should stop when its panel closes');
  } finally {
    await browser?.close();
    if (webviewTabs().length > 0) await vscode.window.tabGroups.close(webviewTabs());
    rmSync(directory, { recursive: true, force: true });
  }
}

type WebviewHandle = {
  frame: Frame;
  evaluate(expression: string): Promise<unknown>;
};

async function connectToWebview(browser: Browser, documentUri: string): Promise<WebviewHandle> {
  let lastFrames: { page: string; url: string }[] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    lastFrames = [];
    for (const page of pages) {
      for (const frame of page.frames()) {
        lastFrames.push({ page: page.url(), url: frame.url() });
        if (!frame.url().startsWith('vscode-webview://')) continue;
        try {
          const uri = await frame.evaluate(() => document.querySelector<HTMLMetaElement>(
            'meta[name="kontur-document-uri"]',
          )?.content);
          if (uri === documentUri) {
            return {
              frame,
              evaluate: (expression) => frame.evaluate(expression),
            };
          }
        } catch { /* The webview may be navigating while VS Code recreates its frame. */ }
      }
    }
    await delay(50);
  }
  throw new Error(`Could not attach to the packaged Kontur webview: ${JSON.stringify(lastFrames)}`);
}

async function replaceDocument(editor: vscode.TextEditor, text: string): Promise<void> {
  const document = editor.document;
  await editor.edit((edit) => edit.replace(
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text,
  ));
}

async function readViewBox(cdp: WebviewHandle): Promise<{ x: number; y: number; width: number; height: number }> {
  const values = await cdp.evaluate('document.querySelector("#diagram svg").getAttribute("viewBox").split(/\\s+/).map(Number)') as number[];
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

async function waitForBrowser(
  cdp: WebviewHandle,
  expression: string,
  predicate: (value: unknown) => boolean,
  message: string,
): Promise<unknown> {
  let lastValue: unknown;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      lastValue = await cdp.evaluate(expression);
      if (predicate(lastValue)) return lastValue;
    } catch {
      // The document execution context is briefly unavailable during a webview reload.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${message}; last value: ${String(lastValue)}`);
}

async function waitForServiceProcess(): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pid = findServiceProcess();
    if (pid !== undefined) return pid;
    await delay(50);
  }
  throw new Error('The packaged preview-service process was not running.');
}

function findServiceProcess(): number | undefined {
  const processes = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' });
  for (const line of processes.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match && Number(match[2]) === process.pid && match[3].includes('/bin/kontur preview-service')) {
      return Number(match[1]);
    }
  }
  return undefined;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${message}.`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
