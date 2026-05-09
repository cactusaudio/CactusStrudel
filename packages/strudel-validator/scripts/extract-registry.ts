#!/usr/bin/env tsx
// Extract function/control names from installed @strudel/* packages and rewrite
// packages/strudel-validator/src/registry.ts. Run after upgrading Strudel.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const REGISTRY_FILE = path.join(HERE, '..', 'src', 'registry.ts');

const cmd = `find ${path.join(ROOT, 'node_modules', '.pnpm')} -path '*@strudel*' -name '*.mjs' -print0 2>/dev/null | xargs -0 grep -hE 'register(MultiControl|Control)?\\\s*\\\\(' 2>/dev/null | grep -oE "['\\"][a-zA-Z_][a-zA-Z0-9_]*['\\"]" | tr -d "'\\""`;
const out = execSync(cmd, { shell: '/bin/bash' }).toString();
const names = Array.from(new Set(out.split('\n').filter(Boolean))).sort();
console.log(`extracted ${names.length} names from installed @strudel/* packages`);

const today = new Date().toISOString().slice(0, 10);

const file = readFileSync(REGISTRY_FILE, 'utf8');

const newList = names
  .map((n) => `'${n}'`)
  .reduce<string[]>((acc, item) => {
    if (acc.length === 0 || acc[acc.length - 1]!.length + item.length + 2 > 110) {
      acc.push(item);
    } else {
      acc[acc.length - 1] = acc[acc.length - 1] + ',' + item;
    }
    return acc;
  }, [])
  .map((line) => `  ${line},`)
  .join('\n');

const updated = file
  .replace(/STRUDEL_REGISTRY_GENERATED_AT = '[^']+'/, `STRUDEL_REGISTRY_GENERATED_AT = '${today}'`)
  .replace(
    /const REGISTRY_LIST: ReadonlyArray<string> = \[[\s\S]*?\];\n/,
    `const REGISTRY_LIST: ReadonlyArray<string> = [\n${newList}\n];\n`,
  );

writeFileSync(REGISTRY_FILE, updated);
console.log(`wrote ${REGISTRY_FILE}`);
