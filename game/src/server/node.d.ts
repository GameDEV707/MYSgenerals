// Minimal Node.js type declarations for the host server (no @types/node available in sandbox).
// These are just enough to compile the server code against Node built-ins.

declare var process: { argv: string[]; env: Record<string, string | undefined>; exit(code?: number): void; on(event: string, cb: () => void): void; };
declare var console: { log(...args: any[]): void; error(...args: any[]): void; };
declare function setTimeout(cb: () => void, ms: number): any;
declare function clearTimeout(id: any): void;
declare function setInterval(cb: () => void, ms: number): any;
declare function clearInterval(id: any): void;

// Browser APIs referenced by shared code (i18n.ts) — stubs for Node context
declare var localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void; };

interface ImportMeta { url: string; }

declare class Buffer {
  static alloc(size: number): Buffer;
  static from(data: string, encoding?: string): Buffer;
  static concat(list: Buffer[]): Buffer;
  length: number;
  [index: number]: number;
  slice(start?: number, end?: number): Buffer;
  copy(target: Buffer, targetStart?: number): number;
  toString(encoding?: string): string;
  readUInt16BE(offset: number): number;
  readBigUInt64BE(offset: number): bigint;
  writeUInt16BE(value: number, offset: number): void;
  writeBigUInt64BE(value: bigint, offset: number): void;
}

declare module "node:http" {
  import { Socket } from "node:net";
  export interface IncomingMessage {
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: Socket;
  }
  export interface ServerResponse {
    writeHead(code: number, headers?: Record<string, string>): void;
    end(data?: string | Buffer): void;
  }
  interface Server {
    listen(port: number, cb?: () => void): void;
    on(event: "upgrade", cb: (req: IncomingMessage, socket: Socket, head: Buffer) => void): void;
    close(cb?: () => void): void;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
declare module "node:crypto" {
  interface Hash { update(data: string): Hash; digest(encoding: "base64"): string; }
  export function createHash(alg: string): Hash;
}
declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Buffer>;
  export function stat(path: string): Promise<{ isDirectory(): boolean }>;
}
declare module "node:path" {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
  export function normalize(p: string): string;
  export function extname(p: string): string;
  export const sep: string;
}
declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
declare module "node:os" {
  interface NetInfo { family: string; address: string; internal: boolean; }
  export function networkInterfaces(): Record<string, NetInfo[]>;
}
declare module "node:net" {
  export interface Socket {
    write(data: Buffer | string): boolean;
    end(): void;
    on(event: string, cb: (...args: any[]) => void): void;
    remoteAddress?: string;
  }
}
