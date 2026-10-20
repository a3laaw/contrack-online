declare module "pizzip" {
  interface PizZipFile {
    name: string;
    dir: boolean;
    asText(): string;
    asNodeBuffer(): Buffer;
  }
  export default class PizZip {
    constructor(data?: Buffer | Uint8Array | ArrayBuffer | string);
    file(name: string): PizZipFile | null;
    file(name: string, data: string | Buffer | Uint8Array, opts?: Record<string, unknown>): PizZip;
    file(filter: RegExp): PizZipFile[];
    files: Record<string, PizZipFile>;
    generate(opts?: { type?: string; compression?: string }): Buffer | string | Uint8Array | ArrayBuffer;
  }
}
