export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`JSON pointer must start with '/' or be empty: ${pointer}`);
  }
  const tokens = pointer.slice(1).split('/').map(unescapePointerToken);
  assertNoPrototypeTokens(tokens, pointer);
  return tokens;
}

export function getByPointer(obj: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = t === '-' ? cur.length : Number(t);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[t];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function applyPatch<T>(target: T, ops: ReadonlyArray<{ op: string; path: string; value?: unknown; from?: string }>): T {
  let out = target as unknown;
  for (const op of ops) {
    out = applyImmutable(out, op);
  }
  return out as T;
}

function applyImmutable(root: unknown, op: { op: string; path: string; value?: unknown; from?: string }): unknown {
  const tokens = parsePointer(op.path);
  if (tokens.length === 0) {
    throw new Error('Replacing root via JSON Patch not supported');
  }
  switch (op.op) {
    case 'add':
      return applyAtPath(root, tokens, (parent, last) => addOnParent(parent, last, structuredClone(op.value)));
    case 'replace':
      return applyAtPath(root, tokens, (parent, last) => replaceOnParent(parent, last, structuredClone(op.value)));
    case 'remove':
      return applyAtPath(root, tokens, removeOnParent);
    case 'move':
      if (op.from === undefined) throw new Error("'move' requires 'from'");
      return moveOp(root, op.from, op.path);
    case 'copy':
      if (op.from === undefined) throw new Error("'copy' requires 'from'");
      return copyOp(root, op.from, op.path);
    case 'test':
      {
      const last = tokens[tokens.length - 1]!;
      const parent = walkToParent(root, tokens);
      if (JSON.stringify(getOnParent(parent, last)) !== JSON.stringify(op.value)) {
        throw new Error(`Patch test failed at ${op.path}`);
      }
      return root;
      }
    default:
      throw new Error(`Unsupported op: ${op.op}`);
  }
}

function applyAtPath(
  root: unknown,
  tokens: string[],
  mutator: (parent: unknown, key: string) => void,
): unknown {
  const clonedRoot = cloneContainer(root);
  let src: unknown = root;
  let dst: unknown = clonedRoot;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!;
    const child = childAt(src, token);
    const childClone = cloneContainer(child);
    setExistingChild(dst, token, childClone);
    src = child;
    dst = childClone;
  }
  mutator(dst, tokens[tokens.length - 1]!);
  return clonedRoot;
}

function cloneContainer(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice();
  if (typeof value === 'object' && value != null) return { ...(value as Record<string, unknown>) };
  throw new Error('Cannot patch non-object root/path');
}

function childAt(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) return parent[parseArrayIndex(key, parent.length, 'read')];
  if (typeof parent === 'object' && parent != null) return (parent as Record<string, unknown>)[key];
  throw new Error(`Cannot walk to ${key} on non-object`);
}

function setExistingChild(parent: unknown, key: string, child: unknown): void {
  if (Array.isArray(parent)) {
    parent[parseArrayIndex(key, parent.length, 'read')] = child;
  } else if (typeof parent === 'object' && parent != null) {
    (parent as Record<string, unknown>)[key] = child;
  } else {
    throw new Error(`Cannot walk to ${key} on non-object`);
  }
}

function walkToParent(root: unknown, tokens: string[]): unknown {
  let cur: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    if (Array.isArray(cur)) {
      cur = cur[parseArrayIndex(t, cur.length, 'read')];
    } else if (typeof cur === 'object' && cur != null) {
      cur = (cur as Record<string, unknown>)[t];
    } else {
      throw new Error(`Cannot walk to ${t} on non-object`);
    }
  }
  return cur;
}

function addOnParent(parent: unknown, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    const idx = parseArrayIndex(key, parent.length, 'add');
    parent.splice(idx, 0, value);
  } else if (typeof parent === 'object' && parent != null) {
    (parent as Record<string, unknown>)[key] = value;
  } else {
    throw new Error(`Cannot add ${key} on non-object`);
  }
}

function replaceOnParent(parent: unknown, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    parent[parseArrayIndex(key, parent.length, 'read')] = value;
  } else if (typeof parent === 'object' && parent != null) {
    const record = parent as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`Cannot replace missing key: ${key}`);
    }
    record[key] = value;
  } else {
    throw new Error(`Cannot replace ${key} on non-object`);
  }
}

function getOnParent(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) return parent[parseArrayIndex(key, parent.length, 'read')];
  if (typeof parent === 'object' && parent != null) return (parent as Record<string, unknown>)[key];
  return undefined;
}

function removeOnParent(parent: unknown, key: string): void {
  if (Array.isArray(parent)) {
    parent.splice(parseArrayIndex(key, parent.length, 'read'), 1);
  } else if (typeof parent === 'object' && parent != null) {
    delete (parent as Record<string, unknown>)[key];
  }
}

function moveOp(root: unknown, fromPath: string, toPath: string): unknown {
  const fromTokens = parsePointer(fromPath);
  const fromParent = walkToParent(root, fromTokens);
  const fromKey = fromTokens[fromTokens.length - 1]!;
  const value = getOnParent(fromParent, fromKey);
  const removed = applyAtPath(root, fromTokens, removeOnParent);
  return applyAtPath(removed, parsePointer(toPath), (parent, key) => addOnParent(parent, key, value));
}

function copyOp(root: unknown, fromPath: string, toPath: string): unknown {
  const value = getByPointer(root, fromPath);
  return applyAtPath(root, parsePointer(toPath), (parent, key) => addOnParent(parent, key, structuredClone(value)));
}

function assertNoPrototypeTokens(tokens: string[], pointer: string): void {
  for (const token of tokens) {
    if (token === '__proto__' || token === 'constructor' || token === 'prototype') {
      throw new Error(`JSON pointer contains forbidden prototype token "${token}": ${pointer}`);
    }
  }
}

function parseArrayIndex(token: string, length: number, mode: 'add' | 'read'): number {
  if (token === '-') {
    if (mode === 'add') return length;
    throw new Error('"-" array index is only valid for add');
  }
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new Error(`Invalid array index: ${token}`);
  }
  const idx = Number(token);
  if (mode === 'add') {
    if (idx > length) throw new Error(`Array add index out of bounds: ${token}`);
  } else if (idx >= length) {
    throw new Error(`Array index out of bounds: ${token}`);
  }
  return idx;
}
