// The part of node:buffer (nodejs_compat) the Worker uses: fast base64 for frames of up to a few MB.
declare module 'node:buffer' {
  interface NodeBuffer extends Uint8Array {
    toString(encoding: 'base64' | 'utf8' | 'hex'): string;
  }
  export const Buffer: {
    from(data: ArrayBufferLike, byteOffset?: number, length?: number): NodeBuffer;
    from(data: string, encoding: 'base64' | 'utf8' | 'hex'): NodeBuffer;
  };
}
