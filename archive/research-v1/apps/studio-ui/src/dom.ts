// G11A: tiny DOM helper. Avoids React for one-shot inspector; keeps the
// templating ergonomic without taking on a framework.

type Child = string | number | Node | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | number | boolean | EventListener | null | undefined>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (typeof v === 'boolean') el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
}

/** Render a node tree into a host element (clears existing children). */
export function render(host: HTMLElement, ...nodes: Child[]): void {
  host.innerHTML = '';
  appendChildren(host, nodes);
}

/** Format a number with N decimals; "—" for null/undefined/NaN. */
export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(decimals);
}

export function pill(text: string, kind: 'ok' | 'warn' | 'fail' | 'skip' | 'info' | 'muted' = 'muted'): HTMLElement {
  return h('span', { class: `pill ${kind}` }, text);
}

export function metric(label: string, value: string | number, sub?: string): HTMLElement {
  return h('div', { class: 'metric' },
    h('div', { class: 'lbl' }, label),
    h('div', { class: 'val' }, String(value)),
    sub ? h('div', { class: 'sub' }, sub) : null,
  );
}

export function missingEvidence(what: string, command: string): HTMLElement {
  return h('div', { class: 'missing-evidence' },
    h('span', { class: 'lbl' }, 'MISSING EVIDENCE — '),
    `${what}. Run `,
    h('code', {}, command),
    ' to generate it.',
  );
}
