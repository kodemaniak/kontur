import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const previewNotices = readFileSync(resolve(root, '../preview/dist/THIRD_PARTY_NOTICES.md'), 'utf8').trimEnd();
const metadata = JSON.parse(execFileSync('cargo', [
  'metadata', '--locked', '--format-version', '1', '--manifest-path', resolve(repoRoot, 'Cargo.toml'),
], { cwd: repoRoot, encoding: 'utf8' }));
const cli = metadata.packages.find((pkg) => pkg.name === 'kontur-cli');
if (!cli) throw new Error('Could not find kontur-cli in Cargo metadata.');

const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const included = new Set();
function visit(id) {
  if (included.has(id)) return;
  included.add(id);
  for (const dependency of nodes.get(id)?.deps ?? []) visit(dependency.pkg);
}
visit(cli.id);

const packages = metadata.packages
  .filter((pkg) => included.has(pkg.id) && pkg.source !== null)
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
const rustNotices = packages.map((pkg) => {
  const directory = dirname(pkg.manifest_path);
  const files = readdirSync(directory)
    .filter((name) => /^(unlicense|license|licence|copying|notice)([._-].*)?$/i.test(name))
    .sort()
    .map((name) => ({ name, path: resolve(directory, name) }));
  if (pkg.license_file) {
    const path = resolve(directory, pkg.license_file);
    if (!files.some((file) => file.path === path)) files.push({ name: basename(path), path });
  }
  if (files.length === 0) throw new Error(`No license/notice file found for ${pkg.name}@${pkg.version}.`);

  const texts = files.map(({ name, path }) =>
    `#### ${name}\n\n\`\`\`text\n${readFileSync(path, 'utf8').trim()}\n\`\`\``).join('\n\n');
  const source = pkg.repository ?? `https://crates.io/crates/${pkg.name}/${pkg.version}`;
  return `### ${pkg.name}@${pkg.version} — ${pkg.license ?? 'license identifier not declared'}\nSource: ${source}\n\n${texts}`;
});

if (!packages.some((pkg) => pkg.name === 'serde_json' && pkg.version === '1.0.149')) {
  throw new Error('Locked Rust dependency closure omitted serde_json@1.0.149.');
}
if (!rustNotices.join('\n').includes('Unicode-3.0')) {
  throw new Error('Rust dependency license texts omitted Unicode-3.0.');
}

const contents = [
  previewNotices,
  '',
  '## Rust CLI dependency licenses',
  '',
  'Generated from the locked `kontur-cli` dependency closure with `cargo metadata --locked`. Kontur\'s own MIT license is included separately as `LICENSE.txt`.',
  '',
  ...rustNotices,
  '',
].join('\n');
writeFileSync(resolve(root, 'media/THIRD_PARTY_NOTICES.md'), contents);
