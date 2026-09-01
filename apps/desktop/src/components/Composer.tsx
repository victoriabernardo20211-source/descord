import { useRef, useState } from 'react';
import type { EncryptedFile } from '@nexus/shared';
import { encryptAttachment } from '../lib/crypto-files';
import type { JSX } from 'react';
import { useApp } from '../store/app';

interface Props {
  placeholder: string;
  disabled?: boolean;
}

/** Caixa de envio: texto, anexos por seleção, arrastar-soltar e colar imagem. */
export function Composer({ placeholder, disabled }: Props): JSX.Element {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const api = useApp((s) => s.api);
  const isDm = useApp((s) => s.view.kind === 'dm');
  const sendMessage = useApp((s) => s.sendMessage);
  const notifyTyping = useApp((s) => s.notifyTyping);
  const lastTyping = useRef(0);

  async function submit(): Promise<void> {
    if (disabled || uploading) return;
    if (!value.trim() && files.length === 0) return;

    let attachmentIds: string[] = [];
    let dmFiles: EncryptedFile[] | undefined;

    if (files.length > 0 && api) {
      setUploading(true);
      try {
        if (isDm) {
          // Em conversa privada o arquivo é cifrado AQUI. O servidor recebe
          // bytes opacos, e a chave vai dentro do envelope da mensagem.
          dmFiles = [];
          for (const file of files) {
            const encrypted = await encryptAttachment(file);
            const uploaded = await api.uploadEncrypted(encrypted.file.data);
            attachmentIds.push(uploaded.id);

            let thumbnailUploadId: string | undefined;
            if (encrypted.thumbnail) {
              const thumb = await api.uploadEncrypted(encrypted.thumbnail.data);
              attachmentIds.push(thumb.id);
              thumbnailUploadId = thumb.id;
            }

            dmFiles.push({
              uploadId: uploaded.id,
              key: encrypted.key,
              iv: encrypted.file.iv,
              ...(thumbnailUploadId
                ? { thumbnailUploadId, thumbnailIv: encrypted.thumbnail?.iv }
                : {}),
              fileName: encrypted.fileName,
              mimeType: encrypted.mimeType,
              size: encrypted.size,
              width: encrypted.width,
              height: encrypted.height,
            });
          }
        } else {
          attachmentIds = (await Promise.all(files.map((file) => api.upload(file)))).map(
            (r) => r.id,
          );
        }
      } catch {
        useApp.getState().setError('Falha ao enviar o anexo.');
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const content = value;
    setValue('');
    setFiles([]);
    await sendMessage(content, attachmentIds, dmFiles);
  }

  return (
    <div className="px-4 pb-5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          setFiles((current) => [...current, ...Array.from(event.dataTransfer.files)].slice(0, 10));
        }}
        className={`rounded-xl border bg-ink-800 transition-colors ${
          dragging ? 'border-pulse-400 bg-pulse-500/5' : 'border-ink-700'
        }`}
      >
        {dragging && (
          <div className="px-4 py-3 text-sm text-pulse-300">Solte para enviar</div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {files.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded-md bg-ink-700 px-2 py-1 text-xs text-mist-200"
              >
                {file.name}
                <button
                  aria-label={`Remover ${file.name}`}
                  onClick={() => setFiles((c) => c.filter((_, i) => i !== index))}
                  className="text-mist-400 hover:text-alert-500"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 px-3 py-2">
          <button
            aria-label="Anexar arquivo"
            onClick={() => inputRef.current?.click()}
            className="rounded-md p-2 text-mist-400 transition-colors hover:bg-ink-700 hover:text-mist-50"
          >
            +
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              setFiles((current) =>
                [...current, ...Array.from(event.target.files ?? [])].slice(0, 10),
              );
              event.target.value = '';
            }}
          />

          <textarea
            value={value}
            disabled={disabled}
            rows={1}
            placeholder={placeholder}
            aria-label="Mensagem"
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-mist-50 placeholder:text-mist-400 focus:outline-none"
            onChange={(event) => {
              setValue(event.target.value);
              event.target.style.height = 'auto';
              event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
              // Um evento de digitação a cada 3s basta; é efêmero de qualquer forma.
              if (Date.now() - lastTyping.current > 3000) {
                lastTyping.current = Date.now();
                notifyTyping();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            onPaste={(event) => {
              // Ctrl+V com print na área de transferência vira anexo.
              const pasted = Array.from(event.clipboardData.files);
              if (pasted.length > 0) {
                event.preventDefault();
                setFiles((current) => [...current, ...pasted].slice(0, 10));
              }
            }}
          />

          <button
            onClick={() => void submit()}
            disabled={disabled || uploading}
            className="rounded-md bg-pulse-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pulse-400 disabled:opacity-40"
          >
            {uploading ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
