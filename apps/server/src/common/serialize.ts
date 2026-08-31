/** JSON não serializa BigInt; permissões trafegam como string decimal. */
export function bigIntToString(value: bigint): string {
  return value.toString();
}

export function installBigIntJson(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function toJSON(this: bigint): string {
    return this.toString();
  };
}
