// Declarações mínimas usadas APENAS para checagem de tipos offline (sem @types/ws).
// Em um ambiente com npm, `npm install` traz @types/ws e este arquivo não é usado.
declare module 'ws' {
  import type { Server as HttpServer, IncomingMessage } from 'node:http';
  import { EventEmitter } from 'node:events';
  export class WebSocket extends EventEmitter {
    constructor(url: string, opts?: unknown);
    static readonly OPEN: number;
    readonly OPEN: number;
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    on(ev: 'message', cb: (data: { toString(): string }, isBinary: boolean) => void): this;
    on(ev: 'close', cb: (code: number, reason: Buffer) => void): this;
    on(ev: 'open', cb: () => void): this;
    on(ev: 'error', cb: (e: Error) => void): this;
  }
  export class WebSocketServer extends EventEmitter {
    constructor(opts: { server: HttpServer; path?: string; maxPayload?: number });
    clients: Set<WebSocket>;
    close(cb?: () => void): void;
    on(ev: 'connection', cb: (ws: WebSocket, req: IncomingMessage) => void): this;
  }
  export default WebSocket;
}
