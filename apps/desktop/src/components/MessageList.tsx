import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { DirectMessage, Message } from '@nexus/shared';
import { Avatar } from './Avatar';
import { ExpiryBadge } from './ExpiryBadge';
import { Icon } from './Icon';
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
      className="flex min-h-0 flex-1 flex-col overflow-y-auto py-4"
      onScroll={(event) => {
        const el = event.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (el.scrollTop < 120) onLoadOlder();
      }}
    >
      {/* Empurra o histórico curto para baixo: conversa se lê de baixo para
          cima, e uma lista de três mensagens colada no topo parece um erro. */}
      <div className="flex-1" />

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
              <div className="flex items-center gap-2.5 px-[18px] pb-2 pt-3.5">
                <div className="h-px flex-1 bg-ink-800" />
                <span className="text-[10.5px] font-bold tracking-[0.07em] text-mist-500">
                  {formatDay(message.createdAt).toUpperCase()}
                </span>
                <div className="h-px flex-1 bg-ink-800" />
              </div>
            )}

            <div
              className={`group relative px-[18px] hover:bg-ink-900/70 ${grouped ? 'py-0.5' : 'pb-1 pt-2'}`}
            >
              <div className="flex gap-3.5">
                <div className="flex w-10 shrink-0 justify-center">
                  {grouped ? (
                    <span className="pt-[3px] text-[10px] tabular-nums text-mist-500 opacity-0 group-hover:opacity-100">
                      {formatTime(message.createdAt)}
                    </span>
                  ) : (
                    <Avatar
                      name={message.author.displayName}
                      url={message.author.avatarUrl}
                      size={40}
                    />
                  )}
                </div>

              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div className="flex flex-wrap items-baseline gap-2 leading-tight">
                    <span className="text-[14.5px] font-semibold text-mist-50">
                      {message.author.displayName}
                    </span>
                    <span className="text-[11px] text-mist-500">
                      {formatTime(message.createdAt)}
                    </span>
                    {message.editedAt && (
                      <span className="text-[11px] text-mist-500">(editada)</span>
                    )}
                    {message.expiresAt && <ExpiryBadge expiresAt={message.expiresAt} />}
                  </div>
                )}

                {message.decryptionFailed ? (
                  <div className="mt-1 flex w-fit items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-mist-400">
                    <Icon name="lock" size={13} strokeWidth={2.2} />
                    Não foi possível abrir esta mensagem: ela foi enviada antes deste
                    computador entrar na conversa.
                  </div>
                ) : (
                  <div className="text-[14.5px] leading-[1.45] text-mist-200 [word-break:break-word]">
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
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {message.reactions.map((reaction) => (
                      <button
                        key={reaction.emoji}
                        onClick={() => void react(message.id, reaction.emoji, !reaction.me)}
                        className={`flex h-[23px] items-center gap-1.5 rounded-[7px] border px-[7px] text-[12.5px] font-semibold transition-colors ${
                          reaction.me
                            ? 'border-pulse-500 bg-pulse-500/20 text-pulse-300'
                            : 'border-ink-700 bg-ink-850 text-mist-200 hover:border-ink-600'
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

              </div>

              {message.author.id === me?.id && (
                <button
                  onClick={() => void deleteMessage(message.id)}
                  title="Apagar mensagem"
                  aria-label="Apagar mensagem"
                  className="absolute right-3 top-1 hidden rounded-md border border-ink-700 bg-ink-850 p-1.5 text-mist-400 transition-colors hover:text-alert-500 group-hover:block"
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {pending.map((item) => (
        <div key={item.clientMessageId} className="flex gap-3.5 px-[18px] pt-2 opacity-60">
          <div className="w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] leading-[1.45] text-mist-200">{item.content}</div>
            <span
              className={`text-[11px] ${item.status === 'failed' ? 'text-alert-500' : 'text-mist-500'}`}
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
      <span className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-mist-500">
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
      className="mt-1.5 max-w-xs overflow-hidden rounded-lg border border-ink-700 bg-ink-850 text-left transition-colors hover:border-ink-600"
    >
      {isImage ? (
        <LazyImage attachment={attachment} onFail={() => setFailed(true)} />
      ) : (
        <span className="flex items-center gap-2.5 px-3 py-2.5">
          <Icon name="file" size={20} strokeWidth={1.8} className="shrink-0 text-pulse-300" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] text-pulse-300">{attachment.fileName}</span>
            <span className="block text-[11px] text-mist-500">{formatSize(attachment.size)}</span>
          </span>
          <Icon name="download" size={17} className="shrink-0 text-mist-400" />
        </span>
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

/** Tamanho legível de arquivo: uma casa decimal só quando ela informa algo. */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
