import { Fragment, type ReactNode } from 'react';
import {
  parseLiteMarkdown,
  type MdBlock,
  type MdInline,
  type MdList,
} from '../../../../../packages/types/src/common/markdown-lite';

/**
 * Chat message body with markdown shown as formatting (PLN-261008): bold,
 * italic, `code`, lists and links instead of the raw markers AI replies used
 * to show. Built from parsed data as React elements only — message text can
 * never become markup. Links open http(s) in a new tab.
 */
function inline(nodes: MdInline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'strong':
        return <strong key={k} className="font-semibold">{inline(n.c, `${k}-`)}</strong>;
      case 'em':
        return <em key={k}>{inline(n.c, `${k}-`)}</em>;
      case 'code':
        return (
          <code key={k} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">
            {n.v}
          </code>
        );
      case 'link':
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" className="break-all underline">
            {n.v}
          </a>
        );
      default:
        return <Fragment key={k}>{n.v}</Fragment>;
    }
  });
}

function list(l: MdList, key: string): ReactNode {
  const items = l.items.map((it, i) => (
    <li key={`${key}-${i}`}>
      {inline(it.c, `${key}-${i}-`)}
      {it.children ? list(it.children, `${key}-${i}c`) : null}
    </li>
  ));
  return l.ordered ? (
    <ol key={key} start={l.start} className="my-1 list-decimal space-y-0.5 pl-5">
      {items}
    </ol>
  ) : (
    <ul key={key} className="my-1 list-disc space-y-0.5 pl-5">
      {items}
    </ul>
  );
}

function block(b: MdBlock, i: number): ReactNode {
  if (b.t === 'list') return list(b, `b${i}`);
  return (
    <p key={`b${i}`} className="[&:not(:first-child)]:mt-2">
      {b.lines.map((line, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          {inline(line, `b${i}-${j}-`)}
        </Fragment>
      ))}
    </p>
  );
}

export function RichText({ text }: { text: string }) {
  return <>{parseLiteMarkdown(text).map(block)}</>;
}
