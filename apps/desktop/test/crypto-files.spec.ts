import { describe, expect, it } from 'vitest';
import { decryptAttachment, encryptAttachment } from '../src/lib/crypto-files';

/**
 * Criptografia real dos anexos de conversa privada (AES-256-GCM da WebCrypto).
 * Usamos um PDF em vez de imagem para não depender de canvas no ambiente de
 * teste — o caminho de miniatura é o mesmo, só com um blob a mais.
 */
function fileOf(content: string, name = 'contrato.pdf', type = 'application/pdf'): File {
  return new File([content], name, { type });
}

const SEGREDO = 'combinado: sexta as 20h, leve o carregador';

describe('anexos cifrados de conversa privada', () => {
  it('o que sobe para o servidor não contém o conteúdo original', async () => {
    const encrypted = await encryptAttachment(fileOf(SEGREDO));
    const asText = Buffer.from(encrypted.file.data).toString('utf8');

    expect(asText).not.toContain(SEGREDO);
    expect(asText).not.toContain('carregador');
    // O texto cifrado é maior que o original: GCM acrescenta a tag de autenticação.
    expect(encrypted.file.data.byteLength).toBeGreaterThan(SEGREDO.length);
  });

  it('decifra de volta exatamente o mesmo conteúdo', async () => {
    const encrypted = await encryptAttachment(fileOf(SEGREDO));
    const blob = await decryptAttachment(
      encrypted.file.data,
      encrypted.key,
      encrypted.file.iv,
      encrypted.mimeType,
    );

    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe(SEGREDO);
  });

  it('preserva nome e tipo reais fora do servidor', async () => {
    const encrypted = await encryptAttachment(fileOf(SEGREDO, 'foto-da-viagem.pdf'));
    // Estes campos viajam dentro do envelope Megolm, nunca em claro.
    expect(encrypted.fileName).toBe('foto-da-viagem.pdf');
    expect(encrypted.mimeType).toBe('application/pdf');
  });

  it('cada anexo recebe chave e IV próprios', async () => {
    const [a, b] = await Promise.all([
      encryptAttachment(fileOf(SEGREDO)),
      encryptAttachment(fileOf(SEGREDO)),
    ]);

    expect(a.key).not.toBe(b.key);
    expect(a.file.iv).not.toBe(b.file.iv);
    // Mesmo conteúdo, chaves diferentes: os blobs não podem sair iguais.
    expect(Buffer.from(a.file.data).equals(Buffer.from(b.file.data))).toBe(false);
  });

  it('chave errada não abre o anexo', async () => {
    const encrypted = await encryptAttachment(fileOf(SEGREDO));
    const outra = await encryptAttachment(fileOf('outro arquivo'));

    const blob = await decryptAttachment(
      encrypted.file.data,
      outra.key,
      encrypted.file.iv,
      encrypted.mimeType,
    );
    expect(blob).toBeNull();
  });

  it('blob adulterado no servidor é rejeitado, não exibido corrompido', async () => {
    const encrypted = await encryptAttachment(fileOf(SEGREDO));

    // Um servidor malicioso virando um bit no meio do arquivo.
    const tampered = new Uint8Array(encrypted.file.data.slice(0));
    tampered[10] = (tampered[10] as number) ^ 0xff;

    const blob = await decryptAttachment(
      tampered.buffer,
      encrypted.key,
      encrypted.file.iv,
      encrypted.mimeType,
    );
    // GCM é autenticado: a verificação falha em vez de devolver bytes errados.
    expect(blob).toBeNull();
  });

  it('IV trocado não abre o anexo', async () => {
    const encrypted = await encryptAttachment(fileOf(SEGREDO));
    const outro = await encryptAttachment(fileOf(SEGREDO));

    const blob = await decryptAttachment(
      encrypted.file.data,
      encrypted.key,
      outro.file.iv,
      encrypted.mimeType,
    );
    expect(blob).toBeNull();
  });
});
