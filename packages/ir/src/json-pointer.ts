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
  return pointer.slice(1).split('/').map(unescapePointerToken);
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
  const out = structuredClone(target) as T;
  for (const op of ops) {
    apply(out as unknown as Record<string, unknown>, op);
  }
  return out;
}

function apply(root: unknown, op: { op: string; path: string; value?: unknown; from?: string }): void {
  const tokens = parsePointer(op.path);
  if (tokens.length === 0) {
    throw new Error('Replacing root via JSON Patch not supported');
  }
  const last = tokens[tokens.length - 1]!;
  const parent = walkToParent(root, tokens);
  switch (op.op) {
    case 'add':
    case 'replace':
      setOnParent(parent, last, op.value);
      break;
    case 'remove':
      removeOnParent(parent, last);
      break;
    case 'move':
      if (op.from === undefined) throw new Error("'move' requires 'from'");
      moveOp(root, op.from, op.path);
      break;
    case 'copy':
      if (op.from === undefined) throw new Error("'copy' requires 'from'");
      copyOp(root, op.from, op.path);
      break;
    case 'test':
      if (JSON.stringify(getOnParent(parent, last)) !== JSON.stringify(op.value)) {
        throw new Error(`Patch test failed at ${op.path}`);
      }
      break;
    default:
      throw new Error(`Unsupported op: ${op.op}`);
  }
}

function walkToParent(root: unknown, tokens: string[]): unknown {
  let cur: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    if (Array.isArray(cur)) {
      cur = cur[Number(t)];
    } else if (typeof cur === 'object' && cur != null) {
      cur = (cur as Record<string, unknown>)[t];
    } else {
      throw new Error(`Cannot walk to ${t} on non-object`);
    }
  }
  return cur;
}

function setOnParent(parent: unknown, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    const idx = key === '-' ? parent.length : Number(key);
    parent.splice(idx, 0, value);
  } else if (typeof parent === 'object' && parent != null) {
    (parent as Record<string, unknown>)[key] = value;
  } else {
    throw new Error(`Cannot set ${key} on non-object`);
  }
}

function getOnParent(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) return parent[Number(key)];
  if (typeof parent === 'object' && parent != null) return (parent as Record<string, unknown>)[key];
  return undefined;
}

function removeOnParent(parent: unknown, key: string): void {
  if (Array.isArray(parent)) {
    parent.splice(Number(key), 1);
  } else if (typeof parent === 'object' && parent != null) {
    delete (parent as Record<string, unknown>)[key];
  }
}

function moveOp(root: unknown, fromPath: string, toPath: string): void {
  const fromTokens = parsePointer(fromPath);
  const fromParent = walkToParent(root, fromTokens);
  const fromKey = fromTokens[fromTokens.length - 1]!;
  const value = getOnParent(fromParent, fromKey);
  removeOnParent(fromParent, fromKey);
  const toTokens = parsePointer(toPath);
  const toParent = walkToParent(root, toTokens);
  const toKey = toTokens[toTokens.length - 1]!;
  setOnParent(toParent, toKey, value);
}

function copyOp(root: unknown, fromPath: string, toPath: string): void {
  const value = getByPointer(root, fromPath);
  const tokens = parsePointer(toPath);
  const parent = walkToParent(root, tokens);
  const last = tokens[tokens.length - 1]!;
  setOnParent(parent, last, structuredClone(value));
}
