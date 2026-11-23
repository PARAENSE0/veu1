/**
 * Monta o servidor HTTP + WebSocket. Exportado separadamente de index.ts para
 * que os testes automatizados possam subir instâncias isoladas.
 */
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants';
import type { ServerMsg } from '../shared/protocol';
import { Accounts } from './accounts';
import { makeHttpHandler } from './http';
import { RoomManager, type Conn } from './rooms';
import { FileStore, type Store, type UserRecord } from './store';
import { cleanText, parseClientMsg } from './validate';

export interface AppOptions {
  port: number;
  host?: string;
  dataFile: string | null;
  publicDir: string;
  trustProxy?: boolean;
  allowedOrigins?: string[];
  matchDuration?: number;
  countdown?: number;
  supplyRespawn?: number;
  log?: boolean;
  /** servidores STUN/TURN entregues ao cliente para a voz (WebRTC) */
  iceServers?: unknown[];
  /** conteúdo de /.well-known/assetlinks.json (app Android) */
  assetLinks?: string;
}

export interface App {
  server: Server;
  rooms: RoomManager;
  accounts: Accounts;
  store: Store;
  close(): Promise<void>;
}

export async function createApp(o: AppOptions): Promise<App> {
  const store = new FileStore(o.dataFile);
  await store.init();
  const accounts = new Accounts(store);
  const rooms = new RoomManager(accounts, store, { matchDuration: o.matchDuration, countdown: o.countdown, supplyRespawn: o.supplyRespawn });
  const server = createServer(makeHttpHandler({ accounts, rooms, publicDir: o.publicDir, trustProxy: !!o.trustProxy, allowedOrigins: o.allowedOrigins, assetLinks: o.assetLinks, iceServers: o.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }] }));
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  const log = (...a: unknown[]) => o.log !== false && console.log(...a);

  wss.on('connection', (ws: WebSocket, req) => {
    const origin = req.headers.origin;
    if (o.allowedOrigins?.length && origin && !o.allowedOrigins.includes(origin)) {
      ws.close(4003, 'Origem não permitida.');
      return;
    }
    let user: UserRecord | null = null;
    let conn: Conn | null = null;
    // limite de mensagens: balde de fichas (90/s, rajada 150)
    let tokens = 150;
    let last = Date.now();
    let violations = 0;
    const authTimer = setTimeout(() => !user && ws.close(4000, 'Autenticação expirou.'), 8000);

    const send = (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const err = (code: string, msg: string) => send({ t: 'err', code, msg });

    ws.on('message', async (raw, isBinary) => {
      const now = Date.now();
      tokens = Math.min(150, tokens + ((now - last) / 1000) * 90);
      last = now;
      if (tokens < 1) {
        if (++violations > 300) ws.close(4008, 'Excesso de mensagens.');
        return;
      }
      tokens -= 1;
      if (isBinary) return;
      const msg = parseClientMsg(raw.toString());
      if (!msg) {
        if (++violations > 300) ws.close(4008, 'Mensagens inválidas.');
        return err('bad_msg', 'Mensagem inválida.');
      }
      try {
        if (!user) {
          if (msg.t !== 'auth') return err('auth_required', 'Autentique-se primeiro.');
          const u = await accounts.fromToken(msg.token);
          if (!u) {
            err('unauthorized', 'Sessão inválida ou expirada.');
            return ws.close(4001, 'unauthorized');
          }
          user = u;
          clearTimeout(authTimer);
          conn = { userId: u.id, send, close: (c, r) => ws.close(c, r) };
          rooms.attach(conn, u);
          return;
        }
        handle(user, msg);
      } catch (e) {
        console.error('[ws] erro ao processar mensagem', e);
        err('internal', 'Erro interno.');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (conn) rooms.detach(conn);
    });

    function handle(u: UserRecord, msg: NonNullable<ReturnType<typeof parseClientMsg>>) {
      const room = rooms.roomOf(u.id);
      switch (msg.t) {
        case 'auth':
          return;
        case 'ping':
          return send({ t: 'pong', c: msg.c, s: Date.now() });
        case 'room:list':
          return send({ t: 'rooms', list: rooms.list() });
        case 'room:create': {
          const r = rooms.create(u, msg.name, msg.public, msg.map);
          if (typeof r === 'string') err('room', r);
          return;
        }
        case 'room:join': {
          const r = rooms.join(u, msg.code);
          if (typeof r === 'string') err('room', r);
          return;
        }
        case 'room:quick': {
          const r = rooms.quick(u);
          if (typeof r === 'string') err('room', r);
          return;
        }
        case 'room:leave':
          return rooms.leave(u.id);
      }
      if (!room) return err('no_room', 'Você não está em uma sala.');
      const me = room.members.get(u.id);
      if (!me) return;
      switch (msg.t) {
        case 'room:ready':
          if (room.state !== 'lobby') return;
          me.ready = msg.ready;
          return room.broadcastState();
        case 'room:pref':
          if (room.state !== 'lobby') return;
          me.pref = msg.pref;
          return room.broadcastState();
        case 'room:settings':
          if (u.id !== room.hostId || room.state !== 'lobby') return err('room', 'Apenas o anfitrião altera a sala.');
          if (msg.public !== undefined) room.isPublic = msg.public;
          if (msg.name !== undefined) room.name = cleanText(msg.name, 32) || room.name;
          if (msg.map !== undefined) {
            if (msg.map !== 'abissal') return err('room', 'Mapa indisponível nesta versão.');
            room.mapId = msg.map;
          }
          return room.broadcastState();
        case 'room:kick': {
          if (u.id !== room.hostId || msg.id === u.id || room.state !== 'lobby') return;
          if (!room.members.has(msg.id)) return;
          rooms.leave(msg.id);
          rooms.sendTo(msg.id, { t: 'err', code: 'kicked', msg: 'Você foi removido da sala pelo anfitrião.' });
          return;
        }
        case 'room:chat': {
          const text = cleanText(msg.text, 200);
          if (!text) return;
          room.chat.push({ from: u.username, text, t: Date.now() });
          if (room.chat.length > 80) room.chat.splice(0, room.chat.length - 80);
          return room.broadcastState();
        }
        case 'room:start': {
          const why = room.canStart(u.id);
          if (why) return err('room', why);
          return room.beginCountdown();
        }
        case 'match:loaded':
          room.match?.setLoaded(u.id);
          return;
        case 'in':
          room.match?.pushInput(u.id, msg.cmds);
          return;
        case 'act':
          room.match?.action(u.id, msg);
          return;
        case 'spectate':
          room.match?.spectate(u.id, msg.dir);
          return;
        case 'rtc': {
          // sinalização WebRTC: só entre membros da mesma sala e, durante a
          // partida, só entre sobreviventes (a entidade não ouve nem é ouvida)
          if (!room.members.has(msg.to) || msg.to === u.id) return;
          if (JSON.stringify(msg.data ?? null).length > 16000) return;
          const m = room.match;
          if (m && !m.ended && (room.state === 'playing' || room.state === 'loading')) {
            const a = m.players.get(u.id);
            const b = m.players.get(msg.to);
            if (!a || !b || a.role !== 'survivor' || b.role !== 'survivor') return;
          }
          rooms.sendTo(msg.to, { t: 'rtc', from: u.id, data: msg.data });
          return;
        }
      }
    }
  });

  rooms.startLoop();
  await new Promise<void>((resolve) => server.listen(o.port, o.host ?? '0.0.0.0', resolve));
  const addr = server.address();
  log(`[véu] servidor v${PROTOCOL_VERSION} ouvindo em ${typeof addr === 'object' && addr ? addr.port : o.port}`);

  return {
    server,
    rooms,
    accounts,
    store,
    async close() {
      rooms.stopLoop();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      await store.flush();
    },
  };
}
