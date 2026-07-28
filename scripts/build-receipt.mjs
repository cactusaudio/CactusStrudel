#!/usr/bin/env node

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const RECEIPT_NAME = 'cactus-build-receipt.json';
export const RECEIPT_SCHEMA_VERSION = 2;
const INTENT_SCHEMA_VERSION = 1;
const BUILD_PROTOCOL = 'cactus-controlled-vite-build-v1';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const SURFACES = Object.freeze({
  'producer-ui': {
    packageDir: 'apps/producer-ui',
    outputDir: 'runtime/app',
    task: 'pnpm --filter @cactus/producer-ui build',
    buildCommand: ['pnpm', 'exec', 'vite', 'build'],
    servedPrefix: '/runtime/app/',
    entryAliases: ['/studio'],
  },
  'renderer-page': {
    packageDir: 'apps/renderer-page',
    outputDir: 'apps/renderer-page/dist',
    task: 'pnpm --filter @cactus/renderer-page build',
    buildCommand: ['pnpm', 'exec', 'vite', 'build'],
    servedPrefix: '/',
    entryAliases: [],
  },
});

function portable(value) {
  return value.split(path.sep).join('/');
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function walkFiles(directory) {
  if (!await exists(directory)) return [];
  const found = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await walkFiles(candidate));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      found.push(candidate);
    }
  }
  return found;
}

function taskInputSymlinkError(repoRoot, filePath) {
  const relativePath = portable(path.relative(repoRoot, filePath)) || '.';
  return new Error(`symlink task input is not allowed: ${relativePath}`);
}

async function declaredTaskInputMetadata(repoRoot, filePath) {
  const relativePath = path.relative(repoRoot, filePath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`declared task input escapes the repository: ${portable(relativePath)}`);
  }
  let current = repoRoot;
  let metadata = await fs.lstat(repoRoot);
  for (const component of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      metadata = await fs.lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw taskInputSymlinkError(repoRoot, current);
  }
  return metadata;
}

async function walkTaskInputFiles(directory, repoRoot) {
  const rootMetadata = await declaredTaskInputMetadata(repoRoot, directory);
  if (!rootMetadata) return [];
  if (!rootMetadata.isDirectory()) {
    throw new Error(`declared task-input directory is not a directory: ${portable(path.relative(repoRoot, directory))}`);
  }
  const found = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = path.join(directory, entry.name);
    const metadata = await fs.lstat(candidate);
    if (metadata.isSymbolicLink()) throw taskInputSymlinkError(repoRoot, candidate);
    if (metadata.isDirectory()) {
      found.push(...await walkTaskInputFiles(candidate, repoRoot));
    } else if (metadata.isFile()) {
      found.push(candidate);
    }
  }
  return found;
}

async function fileEntry(relativeRoot, filePath, role = 'receipt entry') {
  const relativePath = portable(path.relative(relativeRoot, filePath));
  const metadata = await fs.lstat(filePath);
  if (metadata.isSymbolicLink()) {
    if (role === 'task input') throw taskInputSymlinkError(relativeRoot, filePath);
    throw new Error(`${role} must be a regular file: ${relativePath}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`${role} must be a regular file: ${relativePath}`);
  }
  const data = await fs.readFile(filePath);
  return {
    path: relativePath,
    type: 'file',
    bytes: data.length,
    sha256: sha256(data),
  };
}

function aggregateFiles(entries) {
  const digest = createHash('sha256');
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(entry.path, 'utf8');
    digest.update('\0');
    digest.update(entry.type, 'ascii');
    digest.update('\0');
    digest.update(String(entry.bytes), 'ascii');
    digest.update('\0');
    digest.update(entry.sha256, 'ascii');
    digest.update('\0');
  }
  return digest.digest('hex');
}

function surfaceConfig(surface) {
  const config = SURFACES[surface];
  if (!config) {
    throw new Error(`unknown build surface ${JSON.stringify(surface)}; choose ${Object.keys(SURFACES).join(', ')}`);
  }
  return config;
}

async function taskInputPaths(surface, repoRoot = ROOT) {
  const config = surfaceConfig(surface);
  const packageRoot = path.join(repoRoot, config.packageDir);
  const required = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'scripts/build-receipt.mjs',
    'scripts/build-receipt.d.mts',
    'scripts/repo_fingerprint.py',
    `${config.packageDir}/index.html`,
    `${config.packageDir}/package.json`,
    `${config.packageDir}/tsconfig.json`,
    `${config.packageDir}/vite.config.ts`,
  ];
  const optional = ['.npmrc', '.pnpmfile.cjs'];
  const paths = new Set();
  for (const relativePath of required) {
    const candidate = path.join(repoRoot, relativePath);
    const metadata = await declaredTaskInputMetadata(repoRoot, candidate);
    if (!metadata) {
      throw new Error(`required ${surface} build input is missing: ${relativePath}`);
    }
    if (!metadata.isFile()) {
      throw new Error(`required ${surface} build input is not a regular file: ${relativePath}`);
    }
    paths.add(candidate);
  }
  for (const relativePath of optional) {
    const candidate = path.join(repoRoot, relativePath);
    const metadata = await declaredTaskInputMetadata(repoRoot, candidate);
    if (metadata?.isFile()) paths.add(candidate);
    else if (metadata) throw new Error(`optional ${surface} build input is not a regular file: ${relativePath}`);
  }
  for (const directory of [path.join(packageRoot, 'src'), path.join(packageRoot, 'public')]) {
    for (const candidate of await walkTaskInputFiles(directory, repoRoot)) paths.add(candidate);
  }
  for (const directory of [repoRoot, packageRoot]) {
    const directoryMetadata = await declaredTaskInputMetadata(repoRoot, directory);
    if (!directoryMetadata) continue;
    if (!directoryMetadata.isDirectory()) {
      throw new Error(`declared task-input directory is not a directory: ${portable(path.relative(repoRoot, directory)) || '.'}`);
    }
    for (const name of await fs.readdir(directory)) {
      if (name === '.env' || name.startsWith('.env.')) {
        const candidate = path.join(directory, name);
        const metadata = await declaredTaskInputMetadata(repoRoot, candidate);
        if (metadata?.isFile()) paths.add(candidate);
        else if (metadata) throw new Error(`environment task input is not a regular file: ${portable(path.relative(repoRoot, candidate))}`);
      }
    }
  }
  return [...paths].sort((left, right) => portable(path.relative(repoRoot, left)).localeCompare(portable(path.relative(repoRoot, right))));
}

async function taskInputs(surface, repoRoot = ROOT) {
  const entries = [];
  for (const filePath of await taskInputPaths(surface, repoRoot)) {
    entries.push(await fileEntry(repoRoot, filePath, 'task input'));
  }
  return { sha256: aggregateFiles(entries), files: entries };
}

async function outputFiles(surface, repoRoot = ROOT) {
  const config = surfaceConfig(surface);
  const outputRoot = path.join(repoRoot, config.outputDir);
  const indexPath = path.join(outputRoot, 'index.html');
  if (!await exists(indexPath)) {
    throw new Error(`${config.outputDir}/index.html is missing after the controlled build`);
  }
  const entries = [];
  for (const filePath of await walkFiles(outputRoot)) {
    if (path.basename(filePath) === RECEIPT_NAME) continue;
    const entry = await fileEntry(outputRoot, filePath);
    if (entry.type !== 'file') {
      throw new Error(`generated output must be a regular file: ${entry.path}`);
    }
    entries.push(entry);
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { root: config.outputDir, sha256: aggregateFiles(entries), files: entries };
}

function environmentIdentity(environment) {
  const keys = Object.keys(environment)
    .filter((key) => key === 'NODE_ENV' || key === 'CI' || key === 'CACTUS_API_TARGET' || key.startsWith('VITE_'))
    .sort();
  const digest = createHash('sha256');
  for (const key of keys) {
    digest.update(key, 'utf8');
    digest.update('=');
    digest.update(environment[key] ?? '', 'utf8');
    digest.update('\0');
  }
  return { keys, sha256: digest.digest('hex') };
}

function commandVersion(command, args, environment) {
  const completed = spawnSync(command, args, { encoding: 'utf8', env: environment });
  if (completed.status !== 0) return null;
  return String(completed.stdout || completed.stderr || '').trim() || null;
}

function packageVersion(packageRoot, packageName) {
  try {
    const require = createRequire(path.join(packageRoot, 'package.json'));
    const packagePath = require.resolve(`${packageName}/package.json`);
    const loaded = require(packagePath);
    return typeof loaded?.version === 'string' ? loaded.version : null;
  } catch {
    return null;
  }
}

async function builderIdentity(surface, repoRoot, environment) {
  const rootManifest = await readJson(path.join(repoRoot, 'package.json'));
  const packageRoot = path.join(repoRoot, surfaceConfig(surface).packageDir);
  const identity = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    package_manager_declared: rootManifest.packageManager ?? null,
    package_manager_executed: commandVersion('pnpm', ['--version'], environment),
    package_manager_user_agent: environment.npm_config_user_agent ?? null,
    lifecycle_script: environment.npm_lifecycle_script ?? null,
    vite: packageVersion(packageRoot, 'vite'),
    esbuild: packageVersion(packageRoot, 'esbuild'),
    environment: environmentIdentity(environment),
  };
  return {
    ...identity,
    sha256: sha256(Buffer.from(stableJson(identity), 'utf8')),
  };
}

export function sourceIdentity(repoRoot = ROOT, environment = process.env) {
  const script = path.join(repoRoot, 'scripts', 'repo_fingerprint.py');
  const completed = spawnSync(
    environment.PYTHON ?? 'python3',
    [script, '--root', repoRoot],
    { cwd: repoRoot, encoding: 'utf8', env: environment, maxBuffer: 16 * 1024 * 1024 },
  );
  if (completed.status !== 0) {
    throw new Error(`source fingerprint failed: ${String(completed.stderr || completed.stdout || '').trim()}`);
  }
  const value = JSON.parse(completed.stdout);
  if (!value?.available || typeof value.working_tree_sha256 !== 'string') {
    throw new Error('source fingerprint did not return an available working tree');
  }
  return {
    schema_version: value.schema_version,
    observed_head: value.head,
    branch: value.branch,
    working_tree_sha256: value.working_tree_sha256,
    landing_state_sha256: value.landing_state_sha256,
    effective_tree_sha256: value.effective_tree_sha256,
    tracked_worktree_sha256: value.tracked_worktree_sha256,
    index_tree_sha256: value.index_tree_sha256,
    index_flags_sha256: value.index_flags_sha256,
    untracked_tree_sha256: value.untracked_tree_sha256,
    staged_state_sha256: value.staged_state_sha256,
    unstaged_state_sha256: value.unstaged_state_sha256,
    staged_changes: value.staged_changes,
    unstaged_changes: value.unstaged_changes,
    untracked_files: value.untracked_files,
    dirty_entries: value.dirty_entries,
  };
}

async function packageBuildScript(surface, repoRoot = ROOT) {
  const config = surfaceConfig(surface);
  const manifest = await readJson(path.join(repoRoot, config.packageDir, 'package.json'));
  const value = manifest?.scripts?.build;
  if (typeof value !== 'string' || !value) {
    throw new Error(`${config.packageDir}/package.json has no build script`);
  }
  return value;
}

function receiptPath(surface, repoRoot = ROOT) {
  return path.join(repoRoot, surfaceConfig(surface).outputDir, RECEIPT_NAME);
}

function outputPath(surface, repoRoot = ROOT) {
  return path.join(repoRoot, surfaceConfig(surface).outputDir);
}

async function atomicWrite(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporary, text, 'utf8');
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function gitIntentPath(surface, repoRoot) {
  const completed = spawnSync(
    'git',
    ['rev-parse', '--git-path', `cactus-build-intents/${surface}.json`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (completed.status !== 0) {
    throw new Error(`cannot locate Git build-intent storage: ${String(completed.stderr || completed.stdout || '').trim()}`);
  }
  const value = String(completed.stdout).trim();
  if (!value) throw new Error('git rev-parse returned an empty build-intent path');
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function tokenMatches(expectedSha256, token) {
  if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha256)) return false;
  const observed = sha256(Buffer.from(token, 'utf8'));
  return timingSafeEqual(Buffer.from(expectedSha256, 'hex'), Buffer.from(observed, 'hex'));
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function writeIntentExclusively(intentFile, intent) {
  await fs.mkdir(path.dirname(intentFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle;
    try {
      handle = await fs.open(intentFile, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, 'utf8');
      await handle.sync();
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt > 0) throw error;
      let previous = null;
      try { previous = await readJson(intentFile); } catch { /* stale/unreadable */ }
      if (previous && processIsAlive(previous.owner_pid)) {
        throw new Error(`${intent.surface} build already has a live intent owned by pid ${previous.owner_pid}`);
      }
      await fs.rm(intentFile, { force: true });
    } finally {
      await handle?.close();
    }
  }
}

async function createBuildIntent(surface, repoRoot, environment) {
  const config = surfaceConfig(surface);
  const realRoot = await fs.realpath(repoRoot);
  const token = randomBytes(32).toString('hex');
  const intent = {
    schema_version: INTENT_SCHEMA_VERSION,
    protocol: BUILD_PROTOCOL,
    surface,
    repo_root: realRoot,
    owner_pid: process.pid,
    token_sha256: sha256(Buffer.from(token, 'utf8')),
    state: 'prepared',
    task: {
      command: config.task,
      package_script: await packageBuildScript(surface, repoRoot),
      executed: config.buildCommand,
    },
    source: sourceIdentity(repoRoot, environment),
    builder: await builderIdentity(surface, repoRoot, environment),
    inputs: await taskInputs(surface, repoRoot),
  };
  const intentFile = gitIntentPath(surface, repoRoot);
  await writeIntentExclusively(intentFile, intent);
  return { token, intent, intentFile };
}

async function readMatchingIntent(surface, token, repoRoot, expectedState) {
  const intentFile = gitIntentPath(surface, repoRoot);
  let intent;
  try {
    intent = await readJson(intentFile);
  } catch (error) {
    throw new Error(`${surface} finalize requires a matching unconsumed build intent: ${error instanceof Error ? error.message : String(error)}`);
  }
  const realRoot = await fs.realpath(repoRoot);
  if (
    intent?.schema_version !== INTENT_SCHEMA_VERSION
    || intent?.protocol !== BUILD_PROTOCOL
    || intent?.surface !== surface
    || intent?.repo_root !== realRoot
    || intent?.owner_pid !== process.pid
    || intent?.state !== expectedState
    || !tokenMatches(intent?.token_sha256, token)
  ) {
    throw new Error(`${surface} finalize requires a matching unconsumed ${expectedState} build intent`);
  }
  return { intent, intentFile };
}

async function markBuildSucceeded(surface, token, repoRoot) {
  const { intent, intentFile } = await readMatchingIntent(surface, token, repoRoot, 'prepared');
  // A task-input symlink introduced while Vite was running must be rejected
  // before the one-time intent advances from prepared to built.
  await taskInputPaths(surface, repoRoot);
  await atomicWrite(intentFile, `${JSON.stringify({ ...intent, state: 'built', build_exit_code: 0 }, null, 2)}\n`);
}

async function claimBuiltIntent(surface, token, repoRoot) {
  const { intent, intentFile } = await readMatchingIntent(surface, token, repoRoot, 'built');
  const claimedFile = `${intentFile}.consumed-${intent.token_sha256.slice(0, 16)}`;
  try {
    await fs.rename(intentFile, claimedFile);
  } catch (error) {
    throw new Error(`${surface} finalize requires a matching unconsumed built intent: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { intent, claimedFile };
}

async function cleanupIntent(surface, token, repoRoot) {
  const intentFile = gitIntentPath(surface, repoRoot);
  let intent;
  try { intent = await readJson(intentFile); } catch { return; }
  if (intent?.owner_pid === process.pid && tokenMatches(intent?.token_sha256, token)) {
    await fs.rm(intentFile, { force: true });
  }
}

function sameFileSet(left, right) {
  return left?.sha256 === right?.sha256 && stableJson(left?.files) === stableJson(right?.files);
}

function sameSourceIdentity(left, right) {
  return stableJson(left) === stableJson(right);
}

async function finalizeBuildReceipt(surface, intentToken, repoRoot = ROOT, environment = process.env) {
  if (typeof intentToken !== 'string' || intentToken.length < 32) {
    throw new Error(`${surface} finalize requires a matching unconsumed built intent`);
  }
  const { intent, claimedFile } = await claimBuiltIntent(surface, intentToken, repoRoot);
  try {
    const currentInputs = await taskInputs(surface, repoRoot);
    const currentSource = sourceIdentity(repoRoot, environment);
    const currentPackageScript = await packageBuildScript(surface, repoRoot);
    const currentBuilder = await builderIdentity(surface, repoRoot, environment);
    const drift = [];
    if (!sameFileSet(intent.inputs, currentInputs)) {
      drift.push('task inputs or lock bytes changed while Vite was running');
    }
    if (!sameSourceIdentity(intent.source, currentSource)) {
      drift.push('working/index/untracked source identity changed while Vite was running');
    }
    if (intent.task.package_script !== currentPackageScript) {
      drift.push('package build task changed while Vite was running');
    }
    if (stableJson(intent.builder) !== stableJson(currentBuilder)) {
      drift.push('builder identity changed while Vite was running');
    }
    if (drift.length) {
      throw new Error(`${surface} build attribution refused: ${drift.join('; ')}`);
    }

    const outputs = await outputFiles(surface, repoRoot);
    const lock = intent.inputs.files.find((entry) => entry.path === 'pnpm-lock.yaml');
    if (!lock) throw new Error('pnpm-lock.yaml was not included in task inputs');
    const receipt = {
      schema_version: RECEIPT_SCHEMA_VERSION,
      protocol: {
        name: BUILD_PROTOCOL,
        intent_sha256: intent.token_sha256,
      },
      surface,
      task: intent.task,
      source: intent.source,
      builder: intent.builder,
      lock: {
        path: lock.path,
        sha256: lock.sha256,
      },
      inputs: intent.inputs,
      outputs,
    };
    const text = `${JSON.stringify(receipt, null, 2)}\n`;
    await atomicWrite(receiptPath(surface, repoRoot), text);
    return { receipt, receipt_sha256: sha256(Buffer.from(text, 'utf8')) };
  } finally {
    await fs.rm(claimedFile, { force: true });
  }
}

export async function runBuild(surface, repoRoot = ROOT, options = {}) {
  const config = surfaceConfig(surface);
  const environment = { ...process.env, ...(options.environment ?? {}) };
  const { token } = await createBuildIntent(surface, repoRoot, environment);
  try {
    // The old output tree is deleted before Vite starts. A successful no-op or a
    // standalone finalizer therefore cannot re-label stale bytes as current.
    await fs.rm(outputPath(surface, repoRoot), { recursive: true, force: true });
    const completed = spawnSync(config.buildCommand[0], config.buildCommand.slice(1), {
      cwd: path.join(repoRoot, config.packageDir),
      env: environment,
      stdio: options.stdio ?? 'inherit',
    });
    if (completed.error) {
      throw new Error(`${surface} build could not start: ${completed.error.message}`);
    }
    if (completed.status !== 0) {
      throw new Error(`${surface} build failed with ${completed.signal ? `signal ${completed.signal}` : `exit ${completed.status}`}`);
    }
    await markBuildSucceeded(surface, token, repoRoot);
    return await finalizeBuildReceipt(surface, token, repoRoot, environment);
  } finally {
    await cleanupIntent(surface, token, repoRoot);
  }
}

export async function clearBuildReceipt(surface, repoRoot = ROOT) {
  await fs.rm(receiptPath(surface, repoRoot), { force: true });
  return { surface, cleared: true };
}

function validFileEntry(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.path === 'string'
    && value.type === 'file'
    && Number.isSafeInteger(value.bytes)
    && value.bytes >= 0
    && typeof value.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.sha256),
  );
}

function validFileSet(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.sha256)
    && Array.isArray(value.files)
    && value.files.every(validFileEntry),
  );
}

function validBuilderIdentity(value) {
  if (!value || typeof value !== 'object') return false;
  const { sha256: expected, ...identity } = value;
  return Boolean(
    typeof expected === 'string'
    && /^[0-9a-f]{64}$/.test(expected)
    && expected === sha256(Buffer.from(stableJson(identity), 'utf8')),
  );
}

function validSourceIdentity(value) {
  if (!value || typeof value !== 'object' || value.schema_version !== 2) return false;
  const hashFields = [
    'working_tree_sha256',
    'landing_state_sha256',
    'effective_tree_sha256',
    'tracked_worktree_sha256',
    'index_tree_sha256',
    'index_flags_sha256',
    'untracked_tree_sha256',
    'staged_state_sha256',
    'unstaged_state_sha256',
  ];
  const countFields = ['staged_changes', 'unstaged_changes', 'untracked_files', 'dirty_entries'];
  return hashFields.every((key) => typeof value[key] === 'string' && /^[0-9a-f]{64}$/.test(value[key]))
    && countFields.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function validReceipt(value, surface) {
  const config = surfaceConfig(surface);
  return Boolean(
    value
    && typeof value === 'object'
    && value.schema_version === RECEIPT_SCHEMA_VERSION
    && value.protocol?.name === BUILD_PROTOCOL
    && typeof value.protocol?.intent_sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.protocol.intent_sha256)
    && value.surface === surface
    && value.task?.command === config.task
    && typeof value.task?.package_script === 'string'
    && Array.isArray(value.task?.executed)
    && stableJson(value.task.executed) === stableJson(config.buildCommand)
    && validSourceIdentity(value.source)
    && typeof value.builder?.node === 'string'
    && validBuilderIdentity(value.builder)
    && value.lock?.path === 'pnpm-lock.yaml'
    && typeof value.lock?.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.lock.sha256)
    && validFileSet(value.inputs)
    && validFileSet(value.outputs)
    && value.outputs.root === config.outputDir,
  );
}

export async function checkBuildReceipt(surface, repoRoot = ROOT) {
  const reasons = [];
  const currentSource = (() => {
    try { return sourceIdentity(repoRoot); } catch { return null; }
  })();
  const sourceStatus = {
    source_working_tree_sha256_current: currentSource?.working_tree_sha256 ?? null,
  };
  let raw;
  let receipt;
  try {
    raw = await fs.readFile(receiptPath(surface, repoRoot));
    receipt = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    return {
      valid: false,
      surface,
      reasons: [`build receipt missing or unreadable: ${error instanceof Error ? error.message : String(error)}`],
      ...sourceStatus,
    };
  }
  if (!validReceipt(receipt, surface)) {
    return {
      valid: false,
      surface,
      receipt_sha256: sha256(raw),
      receipt_json: raw.toString('utf8'),
      reasons: ['build receipt schema or surface contract is invalid'],
      ...sourceStatus,
    };
  }

  let currentInputs;
  let currentOutputs;
  try {
    currentInputs = await taskInputs(surface, repoRoot);
    currentOutputs = await outputFiles(surface, repoRoot);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  if (currentInputs && !sameFileSet(receipt.inputs, currentInputs)) {
    reasons.push('task inputs or lock bytes changed after build');
  }
  if (currentOutputs && !sameFileSet(receipt.outputs, currentOutputs)) {
    reasons.push('generated output bytes changed after receipt creation');
  }
  const currentLock = currentInputs?.files.find((entry) => entry.path === 'pnpm-lock.yaml');
  if (currentLock && receipt.lock.sha256 !== currentLock.sha256) {
    reasons.push('lockfile hash does not match receipt');
  }
  const currentPackageScript = await packageBuildScript(surface, repoRoot).catch(() => null);
  if (currentPackageScript !== receipt.task.package_script) {
    reasons.push('package build task changed after receipt creation');
  }
  return {
    valid: reasons.length === 0,
    surface,
    reasons,
    receipt_sha256: sha256(raw),
    receipt_json: raw.toString('utf8'),
    input_sha256: currentInputs?.sha256 ?? null,
    output_sha256: currentOutputs?.sha256 ?? null,
    receipt,
    source_working_tree_sha256_current: currentSource?.working_tree_sha256 ?? null,
    source_working_tree_matches_receipt: currentSource
      ? currentSource.working_tree_sha256 === receipt.source.working_tree_sha256
      : null,
  };
}

function servedUrl(baseUrl, pathname, cacheKey) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(pathname.replace(/^\//, ''), base);
  url.searchParams.set('cactus_receipt', cacheKey);
  return url;
}

async function fetchBytes(url, timeoutMs) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: '*/*' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url.pathname}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function verifyServedBuild(surface, baseUrl, repoRoot = ROOT, timeoutMs = 2500) {
  const build = await checkBuildReceipt(surface, repoRoot);
  if (!build.valid || !build.receipt || !build.receipt_sha256) {
    return {
      valid: false,
      surface,
      build,
      reasons: ['local build receipt is not valid; served bytes cannot be attributed'],
    };
  }
  const config = surfaceConfig(surface);
  const reasons = [];
  const cacheKey = build.receipt_sha256.slice(0, 16);
  try {
    const remoteReceipt = await fetchBytes(
      servedUrl(baseUrl, `${config.servedPrefix}${RECEIPT_NAME}`, cacheKey),
      timeoutMs,
    );
    if (sha256(remoteReceipt) !== build.receipt_sha256) {
      reasons.push('served receipt bytes differ from the local build receipt');
    }
  } catch (error) {
    reasons.push(`served receipt fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const servedEntries = [];
  for (const expected of build.receipt.outputs.files) {
    const encodedPath = expected.path.split('/').map(encodeURIComponent).join('/');
    try {
      const body = await fetchBytes(
        servedUrl(baseUrl, `${config.servedPrefix}${encodedPath}`, cacheKey),
        timeoutMs,
      );
      const observed = {
        path: expected.path,
        type: expected.type,
        bytes: body.length,
        sha256: sha256(body),
      };
      servedEntries.push(observed);
      if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) {
        reasons.push(`served output mismatch: ${expected.path}`);
      }
    } catch (error) {
      reasons.push(`served output fetch failed for ${expected.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const servedOutputSha256 = aggregateFiles(servedEntries);
  if (servedEntries.length === build.receipt.outputs.files.length && servedOutputSha256 !== build.receipt.outputs.sha256) {
    reasons.push('served output aggregate differs from generated build output aggregate');
  }

  const index = build.receipt.outputs.files.find((entry) => entry.path === 'index.html');
  if (index) {
    for (const alias of config.entryAliases) {
      try {
        const body = await fetchBytes(servedUrl(baseUrl, alias, cacheKey), timeoutMs);
        if (body.length !== index.bytes || sha256(body) !== index.sha256) {
          reasons.push(`served entry alias mismatch: ${alias}`);
        }
      } catch (error) {
        reasons.push(`served entry alias fetch failed for ${alias}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return {
    valid: reasons.length === 0,
    surface,
    reasons,
    build,
    served_output_sha256: servedEntries.length === build.receipt.outputs.files.length ? servedOutputSha256 : null,
  };
}

function parseCli(argv) {
  const [command, surface, ...rest] = argv;
  const json = rest.includes('--json');
  const baseIndex = rest.indexOf('--base-url');
  const baseUrl = baseIndex >= 0 ? rest[baseIndex + 1] : null;
  return { command, surface, json, baseUrl };
}

async function main() {
  const { command, surface, json, baseUrl } = parseCli(process.argv.slice(2));
  if (!command || !surface) {
    throw new Error('usage: build-receipt.mjs <run|check|verify-served|clear> <surface> [--base-url URL] [--json]');
  }
  let result;
  if (command === 'run') {
    result = await runBuild(surface);
  } else if (command === 'clear') {
    result = await clearBuildReceipt(surface);
  } else if (command === 'check') {
    result = await checkBuildReceipt(surface);
  } else if (command === 'verify-served') {
    if (!baseUrl) throw new Error('verify-served requires --base-url URL');
    result = await verifyServedBuild(surface, baseUrl);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === 'run') {
    process.stdout.write(`${surface} build receipt ${result.receipt_sha256}\n`);
  } else if (command === 'clear') {
    process.stdout.write(`${surface} build receipt cleared\n`);
  } else if (result.valid) {
    const output = result.output_sha256 ?? result.served_output_sha256 ?? result.build?.output_sha256;
    process.stdout.write(`${surface} ${command} ✓${output ? ` output=${output}` : ''}\n`);
  } else {
    process.stderr.write(`${surface} ${command} failed: ${(result.reasons ?? []).join('; ')}\n`);
  }
  if ((command === 'check' || command === 'verify-served') && !result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
