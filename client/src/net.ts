/** Cliente HTTP (REST) e WebSocket com reconexão automática. */
import type { ClientMsg, Profile, ServerMsg } from '../../shared/protocol';
import { apiUrl, wsUrl } from './config';

const TOKEN_KEY = 'veu.token';

export function loadToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function saveToken(token: string | null, remember: boolean) {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    /* sem armazenamento disponível */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    msg: string,
  ) {
    super(msg);
  }
}

export async function api<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
  let r: Response;
  try {
    r = await fetch(apiUrl(path), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Não foi possível contatar o servidor.');
  }
  let data: { error?: string; msg?: string } & Record<string, unknown> = {};
  try {
    data = await r.json();
  } catch {
    /* corpo vazio */
  }
  if (!r.ok) throw new ApiError(r.status, data.error ?? 'error', data.msg ?? `Erro ${r.status}`);
  return data as T;
}

export type AuthResult = { token: string; profile: Profile };

export type NetStatus = 'offline' | 'connecting' | 'online';

export class Net {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private retry = 0;
  private manual = false;
  private pingTimer: number | null = null;
  status: NetStatus = 'offline';
  ping = 0;
  private handlers = new Set<(m: ServerMsg) => void>();
  private statusHandlers = new Set<(s: NetStatus) => void>();

  on(h: (m: ServerMsg) => void) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  onStatus(h: (s: NetStatus) => void) {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }
  private setStatus(s: NetStatus) {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  connect(token: string) {
    this.token = token;
    this.manual = false;
    this.open();
  }

  private open() {
    if (!this.token) return;
    this.ws?.close();
    this.setStatus('connecting');
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'auth', token: this.token }));
      this.setStatus('online');
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.t === 'pong') this.ping = Math.round(performance.now() - m.c);
      for (const h of this.handlers) h(m);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.ws = null;
      this.setStatus('offline');
      // 4001: sessão inválida ou aberta em outro lugar — não tenta reconectar
      if (this.manual || ev.code === 4001 || ev.code === 4003) {
        for (const h of this.handlers) h({ t: 'err', code: ev.code === 4001 ? 'session' : 'closed', msg: ev.reason || 'Conexão encerrada.' });
        return;
      }
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.manual && this.open(), delay);
    };
  }

  send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.manual = true;
    this.ws?.close();
    this.ws = null;
    this.setStatus('offline');
  }
}

export const net = new Net();
