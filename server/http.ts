/**
 * API REST (contas, perfil, loja, histórico) + arquivos estáticos do cliente.
 * Inclui cabeçalhos de segurança, limite de corpo e limite de requisições por IP.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { AuthError, type Accounts } from './accounts';
import type { FriendInfo, FriendStatus } from '../shared/protocol';
import type { RoomManager } from './rooms';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob: mediastream:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

/** Janela deslizante simples por chave (IP + rota). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  allow(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10000) this.hits.clear();
    return true;
  }
}

const authLimiter = new RateLimiter(20, 60_000);
const apiLimiter = new RateLimiter(240, 60_000);

const credentials = z.object({ username: z.string().max(32), password: z.string().max(200) });
const guestBody = z.object({ name: z.string().max(32).optional() });
const loadoutBody = z.object({ loadout: z.record(z.string().max(32), z.string().max(48)) });
const buyBody = z.object({ id: z.string().max(48) });
const idBody = z.object({ id: z.string().min(1).max(64) });
const codeBody = z.object({ code: z.string().max(40) });
const adminCodeBody = z.object({ code: z.string().max(40), coins: z.number().int().min(0).max(1_000_000).optional(), xp: z.number().int().min(0).max(10_000_000).optional(), maxLevel: z.boolean().optional(), maxUses: z.number().int().min(1).nullable().optional(), expires: z.string().max(40).nullable().optional() });
const codeLimiter = new RateLimiter(10, 60_000);

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string') return xf.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '?';
}

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(data);
}

async function readJson(req: IncomingMessage, limit = 8 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new AuthError('too_large', 'Requisição muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new AuthError('bad_json', 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

export function makeHttpHandler(opts: { accounts: Accounts; rooms: RoomManager; publicDir: string; trustProxy: boolean; iceServers: unknown[]; allowedOrigins?: string[]; assetLinks?: string; adminToken?: string }) {
  const { accounts, rooms, publicDir } = opts;

  /** Lista de amigos com presença (online, no lobby, em partida) e solicitações. */
  async function friendsView(user: Awaited<ReturnType<Accounts['fromToken']>> & object) {
    const status = (id: string): { status: FriendStatus; roomCode?: string } => {
      if (!rooms.conns.has(id)) return { status: 'offline' };
      const room = rooms.roomOf(id);
      if (!room) return { status: 'menu' };
      if (room.state === 'lobby' || room.state === 'countdown') return { status: 'lobby', roomCode: room.isPublic ? room.code : undefined };
      return { status: 'partida' };
    };
    const brief = async (ids: string[]) => (await Promise.all(ids.map((i) => accounts.userBrief(i)))).filter((x): x is NonNullable<typeof x> => !!x);
    const friends: FriendInfo[] = (await brief(user.friends)).map((f) => ({ ...f, ...status(f.id) }));
    const order: Record<FriendStatus, number> = { partida: 0, lobby: 1, menu: 2, offline: 3 };
    friends.sort((a, b) => order[a.status] - order[b.status] || a.username.localeCompare(b.username));
    return { friends, incoming: await brief(user.friendIn), outgoing: await brief(user.friendOut) };
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const ip = clientIp(req, opts.trustProxy);
    if (!apiLimiter.allow(ip)) return send(res, 429, { error: 'rate_limited', msg: 'Muitas requisições. Aguarde um pouco.' });
    const method = req.method ?? 'GET';
    try {
      if (method === 'POST' && (path === '/api/register' || path === '/api/login' || path === '/api/guest')) {
        if (!authLimiter.allow(ip)) return send(res, 429, { error: 'rate_limited', msg: 'Muitas tentativas. Aguarde um minuto.' });
        const body = await readJson(req);
        let r;
        if (path === '/api/guest') {
          const b = guestBody.parse(body);
          r = await accounts.guest(b.name);
        } else {
          const b = credentials.parse(body);
          r = path === '/api/register' ? await accounts.register(b.username, b.password) : await accounts.login(b.username, b.password);
        }
        return send(res, 200, { token: r.token, profile: accounts.profile(r.user) });
      }
      if (path === '/api/config') return send(res, 200, { iceServers: opts.iceServers });
      if (method === 'GET' && path === '/api/ranking') {
        const q = new URL(req.url ?? '', 'http://x').searchParams.get('by');
        const by = q === 'vitorias' ? 'vitorias' : q === 'xp' ? 'xp' : 'semanal';
        const viewer = await accounts.fromToken(bearer(req));
        return send(res, 200, await accounts.ranking(by, viewer && !viewer.guest ? viewer : null));
      }
      if (method === 'GET' && path === '/api/ranking/history') return send(res, 200, { weeks: await accounts.weekHistory() });
      // administração de códigos de presente (exige ADMIN_TOKEN no servidor)
      if (path === '/api/admin/codes') {
        const tok = String(req.headers['x-admin-token'] ?? '');
        if (!opts.adminToken || tok.length !== opts.adminToken.length || !timingSafeEqual(Buffer.from(tok), Buffer.from(opts.adminToken))) return send(res, 403, { error: 'forbidden', msg: 'Acesso negado.' });
        if (method === 'GET') return send(res, 200, { codes: await accounts.listCodes() });
        if (method === 'POST') {
          const b = adminCodeBody.parse(await readJson(req));
          return send(res, 200, { code: await accounts.createCode(b) });
        }
      }
      if (path === '/api/health') return send(res, 200, { ok: true, rooms: rooms.rooms.size, players: rooms.conns.size });

      // rotas autenticadas
      const token = bearer(req);
      const user = await accounts.fromToken(token);
      if (!user) return send(res, 401, { error: 'unauthorized', msg: 'Sessão expirada. Entre novamente.' });

      if (method === 'GET' && path === '/api/me') return send(res, 200, { profile: accounts.profile(user) });
      if (method === 'POST' && path === '/api/logout') {
        await accounts.logout(token);
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && path === '/api/loadout') {
        const b = loadoutBody.parse(await readJson(req));
        await accounts.setLoadout(user, b.loadout);
        const room = rooms.roomOf(user.id);
        const m = room?.members.get(user.id);
        if (room && m && room.state === 'lobby') {
          m.loadout = { ...user.loadout };
          room.broadcastState();
        }
        return send(res, 200, { profile: accounts.profile(user) });
      }
      if (method === 'POST' && path === '/api/shop/buy') {
        const b = buyBody.parse(await readJson(req));
        await accounts.buy(user, b.id);
        return send(res, 200, { profile: accounts.profile(user) });
      }
      if (method === 'GET' && path === '/api/history') return send(res, 200, { history: user.history });
      if (method === 'POST' && path === '/api/upgrades/buy') {
        const b = buyBody.parse(await readJson(req));
        await accounts.buyUpgrade(user, b.id);
        const m = rooms.roomOf(user.id)?.members.get(user.id);
        if (m) m.upgrades = { ...user.upgrades };
        return send(res, 200, { profile: accounts.profile(user) });
      }
      if (method === 'POST' && path === '/api/codes/redeem') {
        if (!codeLimiter.allow(user.id)) return send(res, 429, { error: 'rate_limited', msg: 'Muitas tentativas. Aguarde um minuto.' });
        const b = codeBody.parse(await readJson(req));
        const r = await accounts.redeemCode(user, b.code);
        const room = rooms.roomOf(user.id);
        const m = room?.members.get(user.id);
        if (room && m) {
          m.level = r.levelAfter;
          room.broadcastState();
        }
        return send(res, 200, { reward: r, profile: accounts.profile(user) });
      }
      if (method === 'GET' && path === '/api/users/search') {
        const q = new URL(req.url ?? '', 'http://x').searchParams.get('q') ?? '';
        return send(res, 200, { users: await accounts.search(q, user) });
      }
      if (method === 'GET' && path === '/api/friends') return send(res, 200, await friendsView(user));
      if (method === 'POST' && path.startsWith('/api/friends/')) {
        const action = path.slice('/api/friends/'.length);
        const { id } = idBody.parse(await readJson(req));
        const me = { id: user.id, username: user.username };
        if (action === 'request') {
          const r = await accounts.friendRequest(user, id);
          rooms.sendTo(r.other.id, { t: 'notice', n: { kind: r.result === 'accepted' ? 'friend_accept' : 'friend_request', from: me } });
          return send(res, 200, { result: r.result, ...(await friendsView(user)) });
        }
        if (action === 'accept') {
          const o = await accounts.friendAccept(user, id);
          rooms.sendTo(o.id, { t: 'notice', n: { kind: 'friend_accept', from: me } });
        } else if (action === 'reject') await accounts.friendReject(user, id);
        else if (action === 'cancel') await accounts.friendCancel(user, id);
        else if (action === 'remove') await accounts.friendRemove(user, id);
        else if (action === 'invite') {
          if (!user.friends.includes(id)) throw new AuthError('not_friend', 'Só é possível convidar amigos.');
          const room = rooms.roomOf(user.id);
          if (!room || (room.state !== 'lobby' && room.state !== 'countdown')) throw new AuthError('no_room', 'Entre em uma sala (lobby) antes de convidar.');
          if (!rooms.conns.has(id)) throw new AuthError('offline', 'Seu amigo está offline.');
          rooms.sendTo(id, { t: 'notice', n: { kind: 'invite', from: me, code: room.code, roomName: room.name } });
          return send(res, 200, { ok: true });
        } else return send(res, 404, { error: 'not_found', msg: 'Ação inexistente.' });
        return send(res, 200, await friendsView(user));
      }
      return send(res, 404, { error: 'not_found', msg: 'Rota inexistente.' });
    } catch (err) {
      if (err instanceof AuthError) return send(res, 400, { error: err.code, msg: err.message });
      if (err instanceof z.ZodError) return send(res, 400, { error: 'bad_request', msg: 'Dados inválidos.' });
      console.error('[api] erro inesperado', err);
      return send(res, 500, { error: 'internal', msg: 'Erro interno do servidor.' });
    }
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    let rel = decodeURIComponent(path);
    if (rel === '/' || !extname(rel)) rel = '/index.html'; // SPA
    const full = normalize(join(publicDir, rel));
    if (!full.startsWith(normalize(publicDir) + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404, SECURITY_HEADERS).end('404');
      return;
    }
    const ext = extname(full);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' || rel === '/sw.js' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=300',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(full).pipe(res);
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // CORS apenas para origens explicitamente liberadas (ex.: app Capacitor)
    const origin = req.headers.origin;
    if (url.pathname.startsWith('/api/') && origin && opts.allowedOrigins?.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
    }
    if (url.pathname === '/.well-known/assetlinks.json' && opts.assetLinks) {
      // vínculo do app Android (TWA gerado pelo PWABuilder) com este domínio
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
      res.end(opts.assetLinks);
      return;
    }
    if (url.pathname.startsWith('/api/')) void api(req, res, url.pathname);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url.pathname);
    else res.writeHead(405).end();
  };
}
