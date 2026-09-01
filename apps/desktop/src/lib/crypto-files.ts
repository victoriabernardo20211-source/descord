/**
 * Criptografia dos anexos de conversa privada.
 *
 * O arquivo é cifrado no dispositivo com **AES-256-GCM** antes de subir. A chave
 * nunca vai para o servidor por fora: ela viaja dentro do envelope Megolm da
 * própria mensagem, então quem não consegue ler a mensagem também não consegue
 * abrir o anexo.
 *
 * Usamos a WebCrypto do próprio runtime — nenhuma primitiva é escrita aqui.
 * GCM é modo autenticado: um blob adulterado no servidor falha ao decifrar em
 * vez de devolver bytes corrompidos silenciosamente.
 */

const ALGORITHM = 'AES-GCM';
const KEY_BITS = 256;
const IV_BYTES = 12;
const THUMBNAIL_MAX = 400;

export interface EncryptedBlob {
  data: ArrayBuffer;
  iv: string;
}

export interface EncryptedAttachment {
  key: string;
  file: EncryptedBlob;
  thumbnail: EncryptedBlob | null;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.byteLength; i += 1) binary += String.fromCharCode(view[i] as number);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

async function encryptBytes(key: CryptoKey, bytes: ArrayBuffer): Promise<EncryptedBlob> {
  // IV novo a cada blob. Reutilizar IV com a mesma chave quebra o GCM.
  const ivBuffer = new ArrayBuffer(IV_BYTES);
  const iv = crypto.getRandomValues(new Uint8Array(ivBuffer));
  const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, bytes);
  return { data, iv: toBase64(ivBuffer) };
}

/**
 * Miniatura gerada ANTES de cifrar — o servidor não teria como gerá-la depois,
 * já que para ele o anexo é ruído. Sem isso, ver uma foto no chat exigiria
 * baixar o arquivo inteiro.
 */
export async function makeThumbnail(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;

  const scale = Math.min(1, THUMBNAIL_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.8),
  );
}

/** Dimensões originais, para o chat reservar o espaço certo antes de decifrar. */
async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export async function encryptAttachment(file: File): Promise<EncryptedAttachment> {
  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ]);

  const [encryptedFile, thumbnailBlob, size] = await Promise.all([
    file.arrayBuffer().then((bytes) => encryptBytes(key, bytes)),
    makeThumbnail(file),
    imageSize(file),
  ]);

  // A miniatura usa a MESMA chave (com IV próprio): quem abre o anexo abre a
  // miniatura, e não precisamos guardar duas chaves na mensagem.
  const encryptedThumbnail = thumbnailBlob
    ? await encryptBytes(key, await thumbnailBlob.arrayBuffer())
    : null;

  return {
    key: toBase64(await crypto.subtle.exportKey('raw', key)),
    file: encryptedFile,
    thumbnail: encryptedThumbnail,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

/**
 * Decifra um blob recebido. Devolve null quando a autenticação do GCM falha —
 * chave errada ou conteúdo adulterado. A UI mostra isso como anexo indisponível
 * em vez de tentar exibir lixo.
 */
export async function decryptAttachment(
  bytes: ArrayBuffer,
  keyB64: string,
  ivB64: string,
  mimeType: string,
): Promise<Blob | null> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      fromBase64(keyB64),
      { name: ALGORITHM },
      false,
      ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: fromBase64(ivB64) },
      key,
      bytes,
    );
    return new Blob([plain], { type: mimeType });
  } catch {
    return null;
  }
}
