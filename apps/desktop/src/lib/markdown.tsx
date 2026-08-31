import { Fragment, type ReactNode } from 'react';
import { bridge } from './bridge';

/**
 * Markdown mínimo renderizado como elementos React.
 *
 * Nunca usamos dangerouslySetInnerHTML: o conteúdo recebido de outro usuário
 * jamais vira HTML. Isso elimina XSS por construção.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|~~[^~]+~~|`[^`]+`|<@[a-z0-9]{20,32}>|https?:\/\/\S+)/gi;

export function renderMarkdown(
  content: string,
  resolveMention?: (id: string) => string | undefined,
): ReactNode {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let codeBuffer: string[] | null = null;

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (codeBuffer) {
        blocks.push(
          <pre
            key={`code-${index}`}
            className="my-1 overflow-x-auto rounded-md bg-ink-950 p-3 text-[13px] text-mist-200"
          >
            <code>{codeBuffer.join('\n')}</code>
          </pre>,
        );
        codeBuffer = null;
      } else {
        codeBuffer = [];
      }
      return;
    }
    if (codeBuffer) {
      codeBuffer.push(line);
      return;
    }
    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="my-0.5 border-l-2 border-ink-500 pl-3 text-mist-200"
        >
          {renderInline(line.slice(2), resolveMention)}
        </blockquote>,
      );
      return;
    }
    blocks.push(
      <p key={`line-${index}`} className="whitespace-pre-wrap break-words leading-relaxed">
        {renderInline(line, resolveMention)}
      </p>,
    );
  });

  // Bloco de código aberto sem fechamento: mostra o que veio, sem quebrar a tela.
  if (codeBuffer) {
    blocks.push(
      <pre key="code-open" className="my-1 overflow-x-auto rounded-md bg-ink-950 p-3 text-[13px]">
        <code>{(codeBuffer as string[]).join('\n')}</code>
      </pre>,
    );
  }
  return <>{blocks}</>;
}

function renderInline(text: string, resolveMention?: (id: string) => string | undefined): ReactNode {
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    if (!part) return null;
    const key = `${i}-${part.slice(0, 8)}`;

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('__') && part.endsWith('__')) {
      return (
        <u key={key} className="underline">
          {part.slice(2, -2)}
        </u>
      );
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return (
        <s key={key} className="line-through opacity-70">
          {part.slice(2, -2)}
        </s>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-ink-950 px-1.5 py-0.5 text-[13px] text-pulse-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('<@')) {
      const id = part.slice(2, -1);
      return (
        <span key={key} className="rounded bg-pulse-500/20 px-1 font-medium text-pulse-300">
          @{resolveMention?.(id) ?? 'alguém'}
        </span>
      );
    }
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={key}
          href={part}
          className="text-pulse-300 hover:underline"
          onClick={(event) => {
            // Link sempre abre no navegador do sistema, nunca dentro do app.
            event.preventDefault();
            void bridge.openExternal(part);
          }}
        >
          {part}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}
