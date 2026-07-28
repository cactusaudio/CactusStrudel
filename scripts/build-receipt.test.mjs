import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import * as receiptModule from './build-receipt.mjs';

const {
  RECEIPT_NAME,
  checkBuildReceipt,
  runBuild,
  verifyServedBuild,
} = receiptModule;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD_SCRIPT = path.join(HERE, 'build-receipt.mjs');
const SOURCE_FINGERPRINT = path.join(HERE, 'repo_fingerprint.py');
const TYPE_DECLARATION = path.join(HERE, 'build-receipt.d.mts');
const temporaryRoots = [];
const servers = [];

async function write(root, relativePath, value, mode = undefined) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, value);
  if (mode !== undefined) await fs.chmod(target, mode);
  return target;
}

function git(root, ...args) {
  const completed = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(
    completed.status,
    0,
    `git ${args.join(' ')} failed: ${completed.stderr || completed.stdout}`,
  );
  return String(completed.stdout).trim();
}

function packageDir(surface) {
  return surface === 'producer-ui' ? 'apps/producer-ui' : 'apps/renderer-page';
}

function outputDir(surface) {
  return surface === 'producer-ui' ? 'runtime/app' : 'apps/renderer-page/dist';
}

function buildScript(surface) {
  return `node ../../scripts/build-receipt.mjs run ${surface}`;
}

async function fixture(surface = 'producer-ui') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cactus-build-receipt-'));
  temporaryRoots.push(root);
  const packageRoot = packageDir(surface);
  const outputRoot = outputDir(surface);
  const [implementation, fingerprint, declaration] = await Promise.all([
    fs.readFile(BUILD_SCRIPT, 'utf8'),
    fs.readFile(SOURCE_FINGERPRINT, 'utf8'),
    fs.readFile(TYPE_DECLARATION, 'utf8'),
  ]);
  const files = {
    '.gitignore': 'runtime/app/\napps/renderer-page/dist/\n',
    'package.json': `${JSON.stringify({ packageManager: 'pnpm@11.0.9' }, null, 2)}\n`,
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'pnpm-workspace.yaml': 'packages: []\n',
    'tsconfig.base.json': '{}\n',
    'scripts/build-receipt.mjs': implementation,
    'scripts/build-receipt.d.mts': declaration,
    'scripts/repo_fingerprint.py': fingerprint,
    [`${packageRoot}/index.html`]: '<main>source shell</main>\n',
    [`${packageRoot}/package.json`]: `${JSON.stringify({ scripts: { build: buildScript(surface) } }, null, 2)}\n`,
    [`${packageRoot}/tsconfig.json`]: '{}\n',
    [`${packageRoot}/vite.config.ts`]: 'export default {};\n',
    [`${packageRoot}/src/main.ts`]: 'export const marker = "MARKER_ONE";\n',
  };
  for (const [relativePath, value] of Object.entries(files)) {
    await write(root, relativePath, value);
  }

  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Cactus Receipt Test');
  git(root, 'config', 'user.email', 'receipt@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');

  // Deliberately stale bytes exist before every controlled build. The wrapper
  // must delete this tree before invoking Vite.
  await write(root, `${outputRoot}/index.html`, '<main>STALE_DIST</main>\n');
  await write(root, `${outputRoot}/assets/main.js`, 'console.log("STALE_DIST");\n');
  await write(root, `${outputRoot}/stale-only.txt`, 'must disappear\n');

  const binDir = path.join(root, '.git', 'cactus-test-bin');
  const fakePnpm = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('11.0.9-test\\n');
  process.exit(0);
}
if (args.join(' ') !== 'exec vite build') {
  process.stderr.write('unexpected fake pnpm command: ' + args.join(' ') + '\\n');
  process.exit(64);
}
const mode = process.env.CACTUS_TEST_BUILD_MODE || 'normal';
if (mode === 'fail') process.exit(23);
if (mode === 'noop') process.exit(0);
const cwd = process.cwd();
const surface = path.basename(cwd) === 'producer-ui' ? 'producer-ui' : 'renderer-page';
const sourcePath = path.join(cwd, 'src', 'main.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const marker = /MARKER_[A-Z0-9_]+/.exec(source)?.[0] || 'MARKER_MISSING';
const out = surface === 'producer-ui'
  ? path.resolve(cwd, '..', '..', 'runtime', 'app')
  : path.join(cwd, 'dist');
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), '<main>' + marker + '</main>\\n');
fs.writeFileSync(path.join(out, 'assets', 'main.js'), 'console.log(' + JSON.stringify(marker) + ');\\n');
if (mode === 'mutate-input') {
  fs.writeFileSync(sourcePath, source + '// changed while Vite was running\\n');
}
`;
  await write(root, '.git/cactus-test-bin/pnpm', fakePnpm, 0o755);
  const environment = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  return { root, packageRoot, outputRoot, environment };
}

async function controlledBuild(surface, fixtureValue, mode = 'normal') {
  return await runBuild(surface, fixtureValue.root, {
    environment: {
      ...fixtureValue.environment,
      CACTUS_TEST_BUILD_MODE: mode,
    },
    stdio: 'pipe',
  });
}

async function startStaticServer(root, surface, mutate = () => null) {
  const outputRoot = outputDir(surface);
  const prefix = surface === 'producer-ui' ? '/runtime/app/' : '/';
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    let relativePath;
    if (surface === 'producer-ui' && pathname === '/studio') {
      relativePath = 'index.html';
    } else if (pathname.startsWith(prefix)) {
      relativePath = decodeURIComponent(pathname.slice(prefix.length));
    }
    if (!relativePath) {
      response.writeHead(404).end();
      return;
    }
    const replacement = mutate(relativePath);
    if (replacement !== null) {
      const body = Buffer.from(replacement);
      response.writeHead(200, { 'Content-Length': String(body.length) });
      response.end(body);
      return;
    }
    try {
      const body = await fs.readFile(path.join(root, outputRoot, relativePath));
      response.writeHead(200, { 'Content-Length': String(body.length) });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  assert(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function readOutput(root, surface, relativePath) {
  return await fs.readFile(path.join(root, outputDir(surface), relativePath), 'utf8');
}

async function intentFiles(root) {
  const directory = path.join(root, '.git', 'cactus-build-intents');
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test('only the controlled run protocol is public; arbitrary write/finalize commands fail', async () => {
  assert.equal('writeBuildReceipt' in receiptModule, false);
  assert.equal('finalizeBuildReceipt' in receiptModule, false);
  for (const command of ['write', 'finalize']) {
    const completed = spawnSync(process.execPath, [BUILD_SCRIPT, command, 'producer-ui'], {
      encoding: 'utf8',
    });
    assert.notEqual(completed.status, 0);
    assert.match(completed.stderr, new RegExp(`unknown command: ${command}`));
  }
});

test('controlled build records task, builder, lock, exact inputs and generated outputs', async () => {
  const value = await fixture('producer-ui');
  const written = await controlledBuild('producer-ui', value);
  const checked = await checkBuildReceipt('producer-ui', value.root);

  assert.equal(checked.valid, true);
  assert.equal(checked.receipt_sha256, written.receipt_sha256);
  assert.equal(checked.receipt.task.command, 'pnpm --filter @cactus/producer-ui build');
  assert.equal(checked.receipt.task.package_script, buildScript('producer-ui'));
  assert.deepEqual(checked.receipt.task.executed, ['pnpm', 'exec', 'vite', 'build']);
  assert.equal(
    checked.receipt.lock.sha256,
    checked.receipt.inputs.files.find((entry) => entry.path === 'pnpm-lock.yaml').sha256,
  );
  assert.match(checked.receipt.builder.node, /^v\d+/);
  assert.match(checked.receipt.builder.sha256, /^[0-9a-f]{64}$/);
  assert.equal(checked.receipt.builder.package_manager_executed, '11.0.9-test');
  assert.equal(checked.receipt.outputs.files.some((entry) => entry.path === RECEIPT_NAME), false);
  assert.equal(await readOutput(value.root, 'producer-ui', 'index.html'), '<main>MARKER_ONE</main>\n');
  await assert.rejects(fs.stat(path.join(value.root, value.outputRoot, 'stale-only.txt')), /ENOENT/);
  assert.deepEqual(await intentFiles(value.root), []);
});

test('task-input file and directory symlinks fail before intent/output mutation; regular files still build', async () => {
  const value = await fixture('producer-ui');
  const styleRelative = `${value.packageRoot}/src/style.css`;
  const stylePath = await write(value.root, styleRelative, 'body { --marker: MARKER_ONE; }\n');
  await controlledBuild('producer-ui', value);

  const receiptFile = path.join(value.root, value.outputRoot, RECEIPT_NAME);
  const before = {
    receipt: await fs.readFile(receiptFile),
    index: await fs.readFile(path.join(value.root, value.outputRoot, 'index.html')),
    asset: await fs.readFile(path.join(value.root, value.outputRoot, 'assets/main.js')),
  };
  const intentDirectory = path.join(value.root, '.git', 'cactus-build-intents');
  await fs.rm(intentDirectory, { recursive: true, force: true });

  const externalRoot = await fs.mkdtemp(path.join(path.dirname(value.root), 'cactus-build-external-'));
  temporaryRoots.push(externalRoot);
  const externalStyle = await write(externalRoot, 'style.css', 'body { --marker: EXTERNAL_BYTES; }\n');
  await fs.rm(stylePath);
  await fs.symlink(externalStyle, stylePath);

  await assert.rejects(
    controlledBuild('producer-ui', value),
    /symlink task input is not allowed: apps\/producer-ui\/src\/style\.css/,
  );
  assert.deepEqual(await fs.readFile(receiptFile), before.receipt);
  assert.deepEqual(await fs.readFile(path.join(value.root, value.outputRoot, 'index.html')), before.index);
  assert.deepEqual(await fs.readFile(path.join(value.root, value.outputRoot, 'assets/main.js')), before.asset);
  await assert.rejects(fs.stat(intentDirectory), /ENOENT/);
  let checked = await checkBuildReceipt('producer-ui', value.root);
  assert.equal(checked.valid, false);
  assert(checked.reasons.includes('symlink task input is not allowed: apps/producer-ui/src/style.css'));

  await fs.rm(stylePath);
  await write(value.root, styleRelative, 'body { --marker: MARKER_ONE; }\n');
  const sourceDirectory = path.join(value.root, value.packageRoot, 'src');
  const externalSourceDirectory = path.join(externalRoot, 'source');
  await fs.rename(sourceDirectory, externalSourceDirectory);
  await fs.symlink(externalSourceDirectory, sourceDirectory, 'dir');

  await assert.rejects(
    controlledBuild('producer-ui', value),
    /symlink task input is not allowed: apps\/producer-ui\/src/,
  );
  assert.deepEqual(await fs.readFile(receiptFile), before.receipt);
  assert.deepEqual(await fs.readFile(path.join(value.root, value.outputRoot, 'index.html')), before.index);
  assert.deepEqual(await fs.readFile(path.join(value.root, value.outputRoot, 'assets/main.js')), before.asset);
  await assert.rejects(fs.stat(intentDirectory), /ENOENT/);

  await fs.rm(sourceDirectory);
  await fs.rename(externalSourceDirectory, sourceDirectory);
  await controlledBuild('producer-ui', value);
  checked = await checkBuildReceipt('producer-ui', value.root);
  assert.equal(checked.valid, true);
  assert.deepEqual(await intentFiles(value.root), []);
});

for (const surface of ['producer-ui', 'renderer-page']) {
  test(`${surface}: source change plus old dist cannot be blessed; controlled rebuild emits current marker`, async () => {
    const value = await fixture(surface);
    await controlledBuild(surface, value);
    const oldIndex = await readOutput(value.root, surface, 'index.html');
    const oldAsset = await readOutput(value.root, surface, 'assets/main.js');
    assert.match(oldIndex, /MARKER_ONE/);

    await write(value.root, `${value.packageRoot}/src/main.ts`, 'export const marker = "MARKER_TWO";\n');
    // Keep the old output and old receipt exactly in place: input drift alone
    // must make the build invalid.
    await write(value.root, `${value.outputRoot}/index.html`, oldIndex);
    await write(value.root, `${value.outputRoot}/assets/main.js`, oldAsset);
    const stale = await checkBuildReceipt(surface, value.root);
    assert.equal(stale.valid, false);
    assert(stale.reasons.includes('task inputs or lock bytes changed after build'));

    // There is no public re-attestation command capable of pairing the new
    // input identity with those old bytes.
    const directWrite = spawnSync(process.execPath, [BUILD_SCRIPT, 'write', surface], { encoding: 'utf8' });
    assert.notEqual(directWrite.status, 0);

    await write(value.root, `${value.outputRoot}/stale-only.txt`, 'old tree residue\n');
    await controlledBuild(surface, value);
    const current = await checkBuildReceipt(surface, value.root);
    assert.equal(current.valid, true);
    assert.match(await readOutput(value.root, surface, 'index.html'), /MARKER_TWO/);
    assert.match(await readOutput(value.root, surface, 'assets/main.js'), /MARKER_TWO/);
    await assert.rejects(fs.stat(path.join(value.root, value.outputRoot, 'stale-only.txt')), /ENOENT/);
  });
}

test('successful no-op build cannot preserve or attest the deleted stale output tree', async () => {
  const value = await fixture('producer-ui');
  await assert.rejects(
    controlledBuild('producer-ui', value, 'noop'),
    /index\.html is missing after the controlled build/,
  );
  await assert.rejects(fs.stat(path.join(value.root, value.outputRoot, RECEIPT_NAME)), /ENOENT/);
  await assert.rejects(fs.stat(path.join(value.root, value.outputRoot, 'stale-only.txt')), /ENOENT/);
  assert.deepEqual(await intentFiles(value.root), []);
});

test('input mutation during Vite causes attribution refusal and leaves no receipt', async () => {
  const value = await fixture('renderer-page');
  await assert.rejects(
    controlledBuild('renderer-page', value, 'mutate-input'),
    /build attribution refused: .*changed while Vite was running/,
  );
  await assert.rejects(fs.stat(path.join(value.root, value.outputRoot, RECEIPT_NAME)), /ENOENT/);
  assert.deepEqual(await intentFiles(value.root), []);
});

test('failed Vite build cannot leave a prior receipt or stale tree valid', async () => {
  const value = await fixture('producer-ui');
  await controlledBuild('producer-ui', value);
  await assert.rejects(controlledBuild('producer-ui', value, 'fail'), /build failed with exit 23/);
  const checked = await checkBuildReceipt('producer-ui', value.root);
  assert.equal(checked.valid, false);
  assert.match(checked.reasons[0], /build receipt missing or unreadable/);
  assert.deepEqual(await intentFiles(value.root), []);
});

test('changed task input or lock invalidates generated bytes without changing them', async () => {
  const value = await fixture('renderer-page');
  await controlledBuild('renderer-page', value);
  await write(value.root, `${value.packageRoot}/src/new-module.ts`, 'export const added = true;\n');
  let changed = await checkBuildReceipt('renderer-page', value.root);
  assert.equal(changed.valid, false);
  assert(changed.reasons.includes('task inputs or lock bytes changed after build'));

  await controlledBuild('renderer-page', value);
  await write(value.root, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n# changed\n');
  changed = await checkBuildReceipt('renderer-page', value.root);
  assert.equal(changed.valid, false);
  assert(changed.reasons.includes('task inputs or lock bytes changed after build'));
  assert(changed.reasons.includes('lockfile hash does not match receipt'));
});

test('unrelated repo source drift is reported separately from build-input validity', async () => {
  const value = await fixture('producer-ui');
  await controlledBuild('producer-ui', value);
  await write(value.root, 'packages/unrelated/src/index.ts', 'export const unrelated = true;\n');
  const checked = await checkBuildReceipt('producer-ui', value.root);
  assert.equal(checked.valid, true);
  assert.equal(checked.source_working_tree_matches_receipt, false);
});

test('mutated, extra or missing generated files invalidate output identity', async () => {
  const value = await fixture('producer-ui');
  await controlledBuild('producer-ui', value);

  await write(value.root, `${value.outputRoot}/assets/main.js`, 'changed output\n');
  let checked = await checkBuildReceipt('producer-ui', value.root);
  assert.equal(checked.valid, false);
  assert(checked.reasons.includes('generated output bytes changed after receipt creation'));

  await controlledBuild('producer-ui', value);
  await write(value.root, `${value.outputRoot}/unexpected.txt`, 'stale\n');
  checked = await checkBuildReceipt('producer-ui', value.root);
  assert.equal(checked.valid, false);
  assert(checked.reasons.includes('generated output bytes changed after receipt creation'));
});

test('served verification proves receipt, generated output bytes and SPA entry separately', async () => {
  const value = await fixture('producer-ui');
  await controlledBuild('producer-ui', value);
  const baseUrl = await startStaticServer(value.root, 'producer-ui');
  const served = await verifyServedBuild('producer-ui', baseUrl, value.root);
  assert.equal(served.valid, true);
  assert.equal(served.served_output_sha256, served.build.output_sha256);
});

test('served verification rejects bytes that differ from generated output', async () => {
  const value = await fixture('renderer-page');
  await controlledBuild('renderer-page', value);
  const baseUrl = await startStaticServer(
    value.root,
    'renderer-page',
    (relativePath) => relativePath === 'assets/main.js' ? 'served drift\n' : null,
  );
  const served = await verifyServedBuild('renderer-page', baseUrl, value.root);
  assert.equal(served.valid, false);
  assert(served.reasons.some((reason) => reason.includes('served output mismatch: assets/main.js')));
});
