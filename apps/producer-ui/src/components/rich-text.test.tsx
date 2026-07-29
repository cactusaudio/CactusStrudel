import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { RichText } from './rich-text';

/** Walk the produced vnode tree; no renderer dependency needed. */
function walk(node: unknown, visit: (vnode: VNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const vnode = node as VNode & { props?: { children?: unknown } };
  if (vnode.type) visit(vnode);
  walk(vnode.props?.children, visit);
}

function tags(text: string): string[] {
  const found: string[] = [];
  walk(RichText({ text }), (vnode) => {
    if (typeof vnode.type === 'string') found.push(vnode.type);
  });
  return found;
}

function texts(text: string): string[] {
  const found: string[] = [];
  walk(RichText({ text }), (vnode) => {
    const children = (vnode.props as { children?: unknown })?.children;
    const collect = (value: unknown) => {
      if (typeof value === 'string') found.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    collect(children);
  });
  return found;
}

describe('RichText (Brain answers read as prose)', () => {
  it('turns markdown into real elements instead of literal syntax', () => {
    const source = '**Brief summary:**\n- ~88 BPM, `gm_harp` bed\n- 8-bar theme';
    expect(tags(source)).toEqual(
      expect.arrayContaining(['strong', 'ul', 'li', 'code']),
    );
    const rendered = texts(source).join(' ');
    expect(rendered).toContain('Brief summary:');
    expect(rendered).toContain('gm_harp');
    // The syntax characters themselves never reach the reader.
    expect(rendered).not.toContain('**');
    expect(rendered).not.toContain('`');
  });

  it('keeps fenced code verbatim in a pre block', () => {
    expect(tags('try:\n```\ns("bd sd")\n```')).toContain('pre');
    expect(texts('try:\n```\ns("bd sd")\n```').join(' ')).toContain('s("bd sd")');
  });

  it('renders numbered lists and headings', () => {
    const source = '## Plan\n1. first\n2. second';
    expect(tags(source)).toEqual(expect.arrayContaining(['ol', 'li']));
    expect(texts(source).join(' ')).toContain('Plan');
  });

  it('passes model text through as text, never as markup', () => {
    // Vnodes carry the string as a child; it can never become an element.
    const found = texts('<img src=x onerror="alert(1)"> **bold**');
    expect(found.join(' ')).toContain('<img src=x');
    expect(tags('<img src=x onerror="alert(1)"> **bold**')).not.toContain('img');
  });

  it('leaves arithmetic asterisks alone', () => {
    expect(texts('2 * 3 = 6').join(' ')).toContain('2 * 3 = 6');
  });
});
