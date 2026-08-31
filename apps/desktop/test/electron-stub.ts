/**
 * Stub do módulo `electron` para os testes de criptografia rodarem em Node puro.
 * `userDataPath` é trocado entre os testes para simular dois computadores.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const state = { userDataPath: mkdtempSync(join(tmpdir(), 'nexus-e2ee-')) };

export const app = {
  getPath: (name: string): string =>
    name === 'userData' ? state.userDataPath : state.userDataPath,
};

/**
 * Sem DPAPI aqui. O próprio CryptoStore trata este caso: grava a chave com
 * permissão 600 e sinaliza que a proteção em repouso é mais fraca.
 */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (value: string): Buffer => Buffer.from(value, 'utf8'),
  decryptString: (value: Buffer): string => value.toString('utf8'),
};

export default { app, safeStorage };
