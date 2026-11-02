import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vsixName = readdirSync(root).find((name) => name.endsWith('.vsix'));
assert.ok(vsixName, 'expected a packaged VSIX');
const vsix = resolve(root, vsixName);
const entries = execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8' }).trim().split('\n');
const has = (path) => assert.ok(entries.includes(path), `VSIX is missing ${path}`);
const read = (path) => execFileSync('unzip', ['-p', vsix, path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

has('extension/package.json');
has('extension.vsixmanifest');
has('extension/dist/extension.cjs');
has('extension/bin/kontur');
has('extension/media/webview.js');
has('extension/media/preview.css');
has('extension/media/THIRD_PARTY_NOTICES.md');

const manifest = read('extension.vsixmanifest');
assert.match(manifest, /TargetPlatform="linux-x64"/);
const packageJson = JSON.parse(read('extension/package.json'));
assert.equal(packageJson.engines.vscode, '^1.144.0');
assert.equal(packageJson.capabilities.untrustedWorkspaces.supported, false);
assert.match(packageJson.scripts.package, /--target linux-x64/);
assert.match(read('extension/dist/extension.cjs'), /Linux x64/);
has('extension/LICENSE.txt');

const ignoreRules = readFileSync(resolve(root, '.vscodeignore'), 'utf8');
assert.match(ignoreRules, /^\*\*$/m, 'VSIX packaging must start from a deny-all allowlist');
const allowedEntries = new Set([
  '[Content_Types].xml', 'extension.vsixmanifest', 'extension/LICENSE.txt', 'extension/package.json',
  'extension/readme.md', 'extension/bin/kontur', 'extension/dist/extension.cjs',
  'extension/media/THIRD_PARTY_NOTICES.md', 'extension/media/preview.css', 'extension/media/webview.js',
]);
assert.deepEqual(new Set(entries), allowedEntries, 'VSIX must contain only the reviewed runtime files');

const zipDetails = execFileSync('unzip', ['-Z', '-v', vsix], { encoding: 'utf8' });
const binaryHeader = zipDetails.indexOf('\n  extension/bin/kontur\n');
const nextEntry = zipDetails.indexOf('Central directory entry #', binaryHeader);
const binaryEntry = binaryHeader < 0 ? '' : zipDetails.slice(binaryHeader, nextEntry < 0 ? undefined : nextEntry);
assert.ok(binaryHeader >= 0, 'could not read packaged binary metadata');
assert.match(binaryEntry, /Unix file attributes \(100755 octal\)/, 'packaged kontur binary must be executable');

const mediaEntries = entries.filter((entry) => entry.startsWith('extension/media/'));
assert.ok(mediaEntries.some((entry) => entry.endsWith('.js')), 'browser JavaScript bundle/chunks must be packaged');
assert.ok(mediaEntries.some((entry) => entry.endsWith('.css')), 'browser stylesheets must be packaged');
assert.ok(!entries.some((entry) => /(^|\/)(node_modules|scripts|test|test-results|playwright-report)\//.test(entry)),
  'development tools and browser-test artifacts must not be packaged');
assert.ok(!entries.some((entry) => /(^|\/)(vite\.config|devBridge|dev\.mjs)/.test(entry)),
  'the retired development server must not be packaged');
assert.ok(!entries.some((entry) => entry.endsWith('.map') || entry.endsWith('.ts')),
  'source maps and TypeScript sources must not be packaged');

const notices = read('extension/media/THIRD_PARTY_NOTICES.md');
assert.match(notices, /mermaid@12\.2\.0/);
assert.match(notices, /elkjs@0\.9\.3/);
assert.match(notices, /Eclipse Public License/i);
assert.ok(notices.includes('Rust CLI dependency licenses'), 'Rust dependency licenses are missing');
assert.ok(notices.includes('serde_json@1.0.149'), 'locked serde_json license is missing');
assert.ok(notices.includes('unicode-ident@1.0.27'), 'locked unicode-ident license is missing');
assert.ok(notices.includes('Unicode-3.0'), 'Unicode license text is missing');
console.log(`Package contract passed: ${vsixName}`);
