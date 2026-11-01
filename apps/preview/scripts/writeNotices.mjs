import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirs = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable', '--silent'], {
  cwd: appRoot,
  encoding: 'utf8',
}).trim().split('\n').slice(1).filter((path) => path.includes('node_modules')).sort();

const entries = packageDirs.map((packageDir) => {
  const metadata = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const licenses = readdirSync(packageDir)
    .filter((name) => /^(license|licence|copying|notice)(\..*)?$/i.test(name))
    .map((name) => join(packageDir, name))
    .filter((path) => statSync(path).isFile());

  if (licenses.length === 0) throw new Error(`No third-party license file found for ${metadata.name}@${metadata.version}.`);
  const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
  const source = repository ? `\nSource: ${repository}` : '';
  const texts = licenses.map((path) => `#### ${path.split(/[\\/]/).at(-1)}\n\n\`\`\`text\n${readFileSync(path, 'utf8').trim()}\n\`\`\``).join('\n\n');

  return `### ${metadata.name}@${metadata.version} — ${metadata.license ?? 'license identifier not declared'}${source}\n\n${texts}`;
});

const notice = [
  '# Preview third-party notices',
  '',
  'Generated from the locked production dependency tree by `scripts/writeNotices.mjs`. This list includes the browser bundle and its production dependencies; development-only tools are excluded. Each package’s license and notice text is reproduced below.',
  '',
  'The bundle includes unmodified `elkjs@0.9.3` under EPL-2.0. Its corresponding source is available in the [upstream repository](https://github.com/kieler/elkjs) and the versioned npm package (`npm pack elkjs@0.9.3`). Kontur distributes no ELK modifications.',
  '',
  ...entries,
  '',
].join('\n');

if (!notice.includes('mermaid@12.2.0') || !notice.includes('elkjs@0.9.3') || !notice.includes('Eclipse Public License')) {
  throw new Error('Generated preview notices are missing Mermaid or ELK license information.');
}

writeFileSync(join(appRoot, 'THIRD_PARTY_NOTICES.md'), notice);
writeFileSync(join(appRoot, 'dist', 'THIRD_PARTY_NOTICES.md'), notice);
