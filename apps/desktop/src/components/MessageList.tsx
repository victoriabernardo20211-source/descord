import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { DirectMessage, Message } from '@nexus/shared';
import { Avatar } from './Avatar';
import { ExpiryBadge } from './ExpiryBadge';
import { renderMarkdown } from '../lib/markdown';
import { formatDay, formatTime } from '../lib/time';
import { decryptAttachment } from '../lib/crypto-files';
import { useApp, type DecryptedAttachment, type PendingMessage } from '../store/app';

type AnyMessage = Omit<Message | DirectMessage, 'attachments'> & {
  attachments: DecryptedAttachment[];
  expiresAt?: string;
  channelId?: string;
  /** DM cifrada que este dispositivo não tem chave para abrir. */
  decryptionFailed?: boolean;
};

interface Props {
  messages: AnyMessage[];
  pending: PendingMessage[];
  onLoadOlder: () => void;
}

/** Agrupa mensagens seguidas do mesmo autor dentro de 5 minutos. */
function isGrouped(previous: AnyMessage | undefined, current: AnyMessage): boolean {
  if (!previous || previous.author.id !== current.author.id) return false;
  const gap = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap < 5 * 60 * 1000;
}

export function MessageList({ messages, pending, onLoadOlder }: Props): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const deleteMessage = useApp((s) => s.deleteMessage);
  const react = useApp((s) => s.react);
  const me = useApp((s) => s.me);
  const members = useApp((s) => s.serverDetail?.members);

  // Só rola sozinho se o usuário já estava no fim — não sequestra a leitura.
  useEffect(() => {
    if (atBottom.current) {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    }
  }, [messages.length, pending.length]);

  const resolveMention = (id: string): string | undefined =>
    members?.find((m) => m.userId === id)?.user.displayName;

  return (
    <div
      ref={scroller}
      className="flex-1 overflow-y-auto px-4 py-4"
      onScroll={(event) => {
        const el = event.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (el.scrollTop < 120) onLoadOlder();
      }}
    >
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const grouped = isGrouped(previous, message);
        const newDay =
          !previous ||
          new Date(previous.createdAt).toDateString() !==
            new Date(message.createdAt).toDateString();

        return (
          <div key={message.id}>
            {newDay && (
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-ink-700" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-mist-400">
                  {formatDay(message.createdAt)}
                </span>
                <div className="h-px flex-1 bg-ink-700" />
              </div>
            )}

            <div
              className={`group relative flex gap-3 rounded px-2 hover:bg-ink-850/60 ${grouped ? 'py-0.5' : 'mt-3 py-1'}`}
            >
              {grouped ? (
                <span className="w-10 shrink-0 pt-1 text-right text-[10px] text-mist-400 opacity-0 group-hover:opacity-100">
                  {formatTime(message.createdAt)}
                </span>
              ) : (
                <Avatar name={message.author.displayName} url={message.author.avatarUrl} />
              )}

              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold text-mist-50">
                      {message.author.displayName}
                    </span>
                    <span className="text-[11px] text-mist-400">
                      {formatTime(message.createdAt)}
                    </span>
                    {message.editedAt && (
                      <span className="text-[11px] text-mist-400">(editada)</span>
                    )}
                    {message.expiresAt && <ExpiryBadge expiresAt={message.expiresAt} />}
                  </div>
                )}

                {message.decryptionFailed ? (
                  <div className="flex items-center gap-2 rounded-md border border-ink-600 bg-ink-850 px-3 py-2 text-xs text-mist-400">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                      <rect x="4" y="10" width="16" height="11" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
                    </svg>
                    Não foi possível abrir esta mensagem: ela foi enviada antes deste
                    computador entrar na conversa.
                  </div>
                ) : (
                  <div className="text-mist-200">
                    {renderMarkdown(message.content, resolveMention)}
                  </div>
                )}

                {message.attachments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {message.attachments.map((attachment) => (
                      <AttachmentPreview key={attachment.id} attachment={attachment} />
                    ))}
                  </div>
                )}

                {message.reactions.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {message.reactions.map((reaction) => (
                      <button
                        key={reaction.emoji}
                        onClick={() => void react(message.id, reaction.emoji, !reaction.me)}
                        className={`rounded-md border px-1.5 py-0.5 text-xs transition-colors ${
                          reaction.me
                            ? 'border-pulse-500 bg-pulse-500/20 text-pulse-300'
                            : 'border-ink-600 bg-ink-800 text-mist-200 hover:border-ink-500'
                        }`}
                      >
                        {reaction.emoji} {reaction.count}
                      </button>
                    ))}
                  </div>
                )}

                {grouped && message.expiresAt && (
                  <div className="mt-0.5">
                    <ExpiryBadge expiresAt={message.expiresAt} />
                  </div>
                )}
              </div>

              {message.author.id === me?.id && (
                <button
                  onClick={() => void deleteMessage(message.id)}
                  aria-label="Apagar mensagem"
                  className="absolute right-2 top-1 hidden rounded p-1 text-mist-400 hover:bg-ink-700 hover:text-alert-500 group-hover:block"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}

      {pending.map((item) => (
        <div key={item.clientMessageId} className="mt-3 flex gap-3 px-2 opacity-60">
          <div className="w-10" />
          <div className="min-w-0 flex-1">
            <div className="text-mist-200">{item.content}</div>
            <span
              className={`text-[11px] ${item.status === 'failed' ? 'text-alert-500' : 'text-mist-400'}`}
            >
              {item.status === 'failed' ? 'Falha ao enviar' : 'Enviando…'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Resolve um anexo para uma URL exibível.
 *
 * Anexo de conversa privada chega cifrado: baixamos os bytes e deciframos aqui,
 * com a chave que veio dentro do envelope da mensagem. Anexo de canal é servido
 * como está — só o download já exige autorização.
 */
async function resolveObjectUrl(
  api: NonNullable<ReturnType<typeof useApp.getState>['api']>,
  url: string,
  mimeType: string,
  key?: string,
  iv?: string,
): Promise<string | null> {
  if (!key || !iv) return api.fetchAttachment(url);
  const bytes = await api.fetchAttachmentBytes(url);
  const blob = await decryptAttachment(bytes, key, iv, mimeType);
  return blob ? URL.createObjectURL(blob) : null;
}

function AttachmentPreview({ attachment }: { attachment: DecryptedAttachment }): JSX.Element {
  const api = useApp((s) => s.api);
  const [failed, setFailed] = useState(false);
  const isImage = attachment.mimeType.startsWith('image/');

  if (failed) {
    return (
      <span className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-mist-400">
        Não foi possível abrir {attachment.fileName}
      </span>
    );
  }

  return (
    <button
      onClick={async () => {
        if (!api) return;
        const url = await resolveObjectUrl(
          api,
          attachment.url,
          attachment.mimeType,
          attachment.key,
          attachment.iv,
        ).catch(() => null);
        if (url) window.open(url, '_blank', 'noopener');
        else setFailed(true);
      }}
      title={attachment.fileName}
      className="max-w-xs overflow-hidden rounded-lg border border-ink-700 bg-ink-850 text-left transition-colors hover:border-ink-500"
    >
      {isImage ? (
        <LazyImage attachment={attachment} onFail={() => setFailed(true)} />
      ) : (
        <span className="block px-3 py-2 text-xs text-mist-200">📎 {attachment.fileName}</span>
      )}
    </button>
  );
}

function LazyImage({
  attachment,
  onFail,
}: {
  attachment: DecryptedAttachment;
  onFail: () => void;
}): JSX.Element {
  const api = useApp((s) => s.api);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      if (!api) return;
      // Prefere a miniatura: ela também é cifrada, com a mesma chave e IV próprio.
      const useThumb = Boolean(attachment.thumbnailUrl);
      const url = useThumb ? (attachment.thumbnailUrl as string) : attachment.url;
      const iv = useThumb ? (attachment.thumbnailIv ?? attachment.iv) : attachment.iv;
      const mime = useThumb ? 'image/webp' : attachment.mimeType;

      const resolved = await resolveObjectUrl(api, url, mime, attachment.key, iv).catch(
        () => null,
      );
      if (cancelled) {
        if (resolved) URL.revokeObjectURL(resolved);
        return;
      }
      if (!resolved) {
        onFail();
        return;
      }
      objectUrl = resolved;
      setSrc(resolved);
    })();

    return () => {
      cancelled = true;
      // Sem isto, cada rolagem do histórico vaza um blob na memória.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, api, onFail]);

  if (!src) {
    return (
      <span
        className="block animate-pulse bg-ink-800"
        style={{ width: 220, height: attachment.height && attachment.width
          ? Math.round((attachment.height / attachment.width) * 220)
          : 140 }}
      />
    );
  }

  return <img src={src} alt={attachment.fileName} className="max-h-64 w-full object-cover" />;
}
