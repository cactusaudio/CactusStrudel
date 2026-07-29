import type { JSX } from 'preact';

/** Minimal, safe Markdown for Brain answers.
 *
 * Brain writes Markdown; rendering it as raw text made answers read like
 * machine output (literal `**` and backticks). This builds vnodes only —
 * never innerHTML — so model text can never inject markup. Deliberately
 * small: paragraphs, headings, bullet/number lists, fenced code, inline
 * code, bold and italic. Anything else stays literal text.
 */

type Inline = JSX.Element | string;

function renderInline(text: string, keyPrefix: string): Inline[] {
  const nodes: Inline[] = [];
  // One pass over the three inline forms; the first match wins so a code
  // span containing asterisks is not mangled by the bold rule.
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let cursor = 0;
  let match = pattern.exec(text);
  let index = 0;
  while (match) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
    index += 1;
    match = pattern.exec(text);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function RichText({ text }: { text: string }): JSX.Element {
  const lines = String(text ?? '').split('\n');
  const blocks: JSX.Element[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let fence: { language: string; lines: string[] } | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p${blocks.length}`;
    blocks.push(<p key={key}>{renderInline(paragraph.join(' '), key)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    const items = list.items.map((item, position) => (
      <li key={`${key}-${position}`}>{renderInline(item, `${key}-${position}`)}</li>
    ));
    blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    list = undefined;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (fence) {
      if (line.trim().startsWith('```')) {
        const key = `c${blocks.length}`;
        blocks.push(
          <pre key={key} class="rich-code">
            <code>{fence.lines.join('\n')}</code>
          </pre>,
        );
        fence = undefined;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      fence = { language: line.trim().slice(3), lines: [] };
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const key = `h${blocks.length}`;
      blocks.push(<strong key={key} class="rich-heading">{renderInline(heading[2]!, key)}</strong>);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const item = (bullet ? bullet[1] : numbered![1])!;
      if (list && list.ordered !== ordered) flushList();
      list = list || { ordered, items: [] };
      list.items.push(item);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  if (fence) {
    const key = `c${blocks.length}`;
    blocks.push(
      <pre key={key} class="rich-code"><code>{fence.lines.join('\n')}</code></pre>,
    );
  }
  flushParagraph();
  flushList();

  return <div class="rich-text">{blocks}</div>;
}
