/**
 * Salas, lobby, distribuição de funções e ciclo de vida das partidas.
 * Estados: lobby -> countdown -> loading -> playing -> (resultados) -> lobby.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { COUNTDOWN, LOAD_TIMEOUT, RECONNECT_GRACE, LOBBY_DISCONNECT_GRACE, MAX_PLAYERS, MIN_PLAYERS, TICK_RATE } from '../shared/constants';
import { MAPS } from '../shared/map';
import type { ChatLine, MatchResults, RolePref, RoomInfo, RoomListEntry, RoomState, ServerMsg } from '../shared/protocol';
import type { Loadout } from '../shared/progression';
import { levelFromXp } from '../shared/progression';
import type { UpgradeLevels } from '../shared/upgrades';
import type { Accounts } from './accounts';
import { Match } from './match';
import type { Store, UserRecord } from './store';
import { cleanText } from './validate';

export interface Conn {
  userId: string;
  send(msg: ServerMsg): void;
  close(code: number, reason: string): void;
}

interface Member {
  id: string;
  name: string;
  guest: boolean;
  level: number;
  loadout: Loadout;
  ready: boolean;
  pref: RolePref;
  connected: boolean;
  leftAt: number;
  entityTurns: number;
  upgrades: UpgradeLevels;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I

export class Room {
  members = new Map<string, Member>();
  state: RoomState = 'lobby';
  countdown = 0;
  loadTimer = 0;
  match: Match | null = null;
  chat: ChatLine[] = [];
  lastResults: MatchResults | null = null;

  constructor(
    readonly code: string,
    public name: string,
    public isPublic: boolean,
    public hostId: string,
    public mapId: string,
    private mgr: RoomManager,
  ) {}

  info(): RoomInfo {
    return {
      code: this.code,
      name: this.name,
      public: this.isPublic,
      hostId: this.hostId,
      state: this.state,
      mapId: this.mapId,
      countdown: Math.ceil(this.countdown),
      maxPlayers: MAX_PLAYERS,
      chat: this.chat.slice(-40),
      players: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        level: m.level,
        host: m.id === this.hostId,
        ready: m.ready,
        pref: m.pref,
        connected: m.connected,
        guest: m.guest,
        loadout: m.loadout,
      })),
    };
  }

  listEntry(): RoomListEntry {
    return { code: this.code, name: this.name, players: this.members.size, max: MAX_PLAYERS, state: this.state, map: this.mapId };
  }

  broadcastState() {
    const info = this.info();
    for (const m of this.members.values()) this.mgr.sendTo(m.id, { t: 'room', room: info });
  }

  system(text: string) {
    this.chat.push({ from: '', text, t: Date.now(), system: true });
    if (this.chat.length > 80) this.chat.splice(0, this.chat.length - 80);
  }

  addMember(u: UserRecord) {
    this.members.set(u.id, {
      id: u.id,
      name: u.username,
      guest: u.guest,
      level: levelFromXp(u.totalXp).level,
      loadout: { ...u.loadout },
      ready: false,
      pref: 'any',
      connected: true,
      leftAt: 0,
      entityTurns: 0,
      upgrades: { ...u.upgrades },
    });
    this.system(`${u.username} entrou na sala.`);
  }

  removeMember(id: string, reason = 'saiu da sala') {
    const m = this.members.get(id);
    if (!m) return;
    if (this.match && !this.match.ended) this.match.forfeit(id);
    this.members.delete(id);
    this.system(`${m.name} ${reason}.`);
    if (this.hostId === id) {
      const next = [...this.members.values()].find((x) => x.connected) ?? [...this.members.values()][0];
      if (next) {
        this.hostId = next.id;
        this.system(`${next.name} agora é o anfitrião.`);
      }
    }
    if (this.state === 'countdown' && this.members.size < MIN_PLAYERS) {
      this.state = 'lobby';
      this.system('Contagem cancelada: jogadores insuficientes.');
    }
  }

  beginCountdown() {
    this.state = 'countdown';
    this.countdown = this.mgr.opts.countdown ?? COUNTDOWN;
    this.system('A partida começará em instantes.');
    this.broadcastState();
  }

  canStart(byId: string): string | null {
    if (byId !== this.hostId) return 'Apenas o anfitrião pode iniciar.';
    if (this.state !== 'lobby') return 'A sala não está no lobby.';
    const ms = [...this.members.values()].filter((m) => m.connected);
    if (ms.length < MIN_PLAYERS) return `São necessários pelo menos ${MIN_PLAYERS} jogadores.`;
    const notReady = ms.filter((m) => m.id !== this.hostId && !m.ready);
    if (notReady.length) return `Aguardando: ${notReady.map((m) => m.name).join(', ')}.`;
    return null;
  }

  /** Escolhe a entidade: prioriza quem pediu "Entidade", depois "Qualquer"; entre esses, quem foi entidade menos vezes. */
  pickEntity(): Member {
    const ms = [...this.members.values()].filter((m) => m.connected);
    const tier = (p: RolePref) => ms.filter((m) => m.pref === p);
    const pool = tier('entity').length ? tier('entity') : tier('any').length ? tier('any') : ms;
    const minTurns = Math.min(...pool.map((m) => m.entityTurns));
    const cands = pool.filter((m) => m.entityTurns === minTurns);
    return cands[randomInt(cands.length)];
  }

  startMatch() {
    const ent = this.pickEntity();
    ent.entityTurns++;
    const inits = [...this.members.values()]
      .filter((m) => m.connected)
      .map((m) => ({ id: m.id, name: m.name, role: m.id === ent.id ? ('entity' as const) : ('survivor' as const), loadout: m.loadout, upgrades: m.upgrades }));
    const matchId = randomUUID();
    this.match = new Match(matchId, this.mapId, randomInt(2 ** 31), inits, {
      send: (id, msg) => this.mgr.sendTo(id, msg),
      onEnd: (results, stats) => void this.mgr.finishMatch(this, results, stats),
    }, { duration: this.mgr.opts.matchDuration, supplyRespawn: this.mgr.opts.supplyRespawn });
    this.state = 'loading';
    this.loadTimer = LOAD_TIMEOUT;
    for (const p of inits) this.mgr.sendTo(p.id, { t: 'match:load', intro: this.match.intro(p.id) });
    this.system(`Partida iniciada. ${ent.name} será a entidade.`);
  }

  tick(dt: number) {
    // remove desconectados do lobby após um tempo
    if (this.state === 'lobby' || this.state === 'countdown') {
      for (const m of [...this.members.values()]) if (!m.connected && Date.now() - m.leftAt > LOBBY_DISCONNECT_GRACE * 1000) {
        this.removeMember(m.id, 'desconectou');
        this.mgr.playerRoom.delete(m.id);
        this.broadcastState();
      }
    }
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (this.countdown <= 0) {
        if ([...this.members.values()].filter((m) => m.connected).length < MIN_PLAYERS) {
          this.state = 'lobby';
        } else this.startMatch();
        this.broadcastState();
      } else if (Math.ceil(this.countdown) !== before) this.broadcastState();
    } else if (this.state === 'loading' && this.match) {
      this.loadTimer -= dt;
      if (this.match.allLoaded() || this.loadTimer <= 0) {
        this.match.start();
        this.state = 'playing';
        for (const m of this.members.values()) this.mgr.sendTo(m.id, { t: 'match:start' });
        this.broadcastState();
      }
    } else if (this.state === 'playing' && this.match) {
      this.match.update();
    }
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  playerRoom = new Map<string, string>();
  conns = new Map<string, Conn>();
  private timer: NodeJS.Timeout | null = null;
  private last = performance.now();
  private acc = 0;

  constructor(
    readonly accounts: Accounts,
    readonly store: Store,
    readonly opts: { matchDuration?: number; countdown?: number; supplyRespawn?: number } = {},
  ) {}

  startLoop() {
    // passo fixo de 1/TICK_RATE com acumulador (robusto a atrasos do setInterval)
    const step = 1 / TICK_RATE;
    this.timer = setInterval(() => {
      const now = performance.now();
      this.acc += Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      while (this.acc >= step) {
        this.acc -= step;
        for (const r of this.rooms.values()) {
          try {
            r.tick(step);
          } catch (err) {
            console.error(`[sala ${r.code}] erro no tick:`, err);
          }
        }
      }
    }, 1000 / TICK_RATE / 2);
  }
  stopLoop() {
    if (this.timer) clearInterval(this.timer);
  }

  sendTo(id: string, msg: ServerMsg) {
    this.conns.get(id)?.send(msg);
  }

  newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  roomOf(id: string): Room | null {
    const c = this.playerRoom.get(id);
    return c ? (this.rooms.get(c) ?? null) : null;
  }

  // ---------------------------------------------------------------- conexão
  attach(conn: Conn, user: UserRecord) {
    const old = this.conns.get(user.id);
    if (old && old !== conn) old.close(4001, 'Sessão aberta em outro lugar.');
    this.conns.set(user.id, conn);
    conn.send({ t: 'hello', profile: this.accounts.profile(user) });
    const room = this.roomOf(user.id);
    if (room) {
      const m = room.members.get(user.id);
      if (m) {
        m.connected = true;
        if (room.match && !room.match.ended && room.match.players.has(user.id) && (room.state === 'playing' || room.state === 'loading')) {
          room.match.onReconnect(user.id);
          conn.send({ t: 'match:load', intro: room.match.intro(user.id) });
          if (room.state === 'playing') conn.send({ t: 'match:start' });
        }
        room.broadcastState();
      }
    }
  }

  detach(conn: Conn) {
    if (this.conns.get(conn.userId) !== conn) return;
    this.conns.delete(conn.userId);
    const room = this.roomOf(conn.userId);
    if (!room) return;
    const m = room.members.get(conn.userId);
    if (m) {
      m.connected = false;
      m.leftAt = Date.now();
    }
    if (room.match && !room.match.ended) room.match.onDisconnect(conn.userId);
    room.broadcastState();
    this.cleanupRoom(room);
  }

  private cleanupRoom(room: Room) {
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if ([...room.members.values()].some((m) => m.connected)) return;
    // ninguém conectado: mantém a sala por um tempo para permitir reconexão
    setTimeout(() => {
      const r = this.rooms.get(room.code);
      if (r && ![...r.members.values()].some((m) => m.connected)) {
        for (const id of r.members.keys()) if (this.playerRoom.get(id) === r.code) this.playerRoom.delete(id);
        this.rooms.delete(r.code);
      }
    }, (RECONNECT_GRACE + 10) * 1000).unref();
  }

  // ---------------------------------------------------------------- ações de sala
  create(user: UserRecord, name: string, isPublic: boolean, mapId: string): Room | string {
    if (this.roomOf(user.id)) this.leave(user.id);
    if (!MAPS[mapId]) return 'Mapa indisponível.';
    const code = this.newCode();
    const clean = cleanText(name, 32) || `Sala de ${user.username}`;
    const room = new Room(code, clean, isPublic, user.id, mapId, this);
    this.rooms.set(code, room);
    room.addMember(user);
    this.playerRoom.set(user.id, code);
    room.broadcastState();
    return room;
  }

  join(user: UserRecord, codeRaw: string): Room | string {
    const code = codeRaw.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return 'Sala não encontrada. Confira o código.';
    if (room.members.has(user.id)) {
      room.broadcastState();
      return room;
    }
    if (room.state !== 'lobby' && room.state !== 'countdown') return 'A partida desta sala já começou.';
    if (room.members.size >= MAX_PLAYERS) return 'A sala está cheia.';
    if (this.roomOf(user.id)) this.leave(user.id);
    room.addMember(user);
    this.playerRoom.set(user.id, code);
    room.broadcastState();
    return room;
  }

  quick(user: UserRecord): Room | string {
    const open = [...this.rooms.values()].filter((r) => r.isPublic && r.state === 'lobby' && r.members.size < MAX_PLAYERS).sort((a, b) => b.members.size - a.members.size);
    if (open.length) return this.join(user, open[0].code);
    return this.create(user, `Partida rápida de ${user.username}`, true, 'abissal');
  }

  leave(userId: string) {
    const room = this.roomOf(userId);
    this.playerRoom.delete(userId);
    if (!room) return;
    room.removeMember(userId);
    this.sendTo(userId, { t: 'room', room: null });
    room.broadcastState();
    this.cleanupRoom(room);
  }

  list(): RoomListEntry[] {
    return [...this.rooms.values()].filter((r) => r.isPublic && r.members.size > 0).map((r) => r.listEntry());
  }

  async finishMatch(room: Room, results: MatchResults, stats: Map<string, { role: 'survivor' | 'entity'; stats: object; result: import('../shared/protocol').PlayerResult }>) {
    room.state = 'lobby';
    room.lastResults = results;
    for (const m of room.members.values()) m.ready = false;
    room.system(results.winner === 'survivors' ? 'Vitória dos sobreviventes.' : 'Vitória da entidade.');
    for (const [id, s] of stats) {
      const user = await this.store.getUser(id);
      let rewards;
      if (user) {
        rewards = await this.accounts.applyMatch(user, s.result, s.stats, { matchId: results.matchId, map: room.mapId, winner: results.winner, duration: results.duration, role: s.role });
        const m = room.members.get(id);
        if (m) m.level = levelFromXp(user.totalXp).level;
        this.sendTo(id, { t: 'profile', profile: this.accounts.profile(user) });
      }
      this.sendTo(id, { t: 'match:end', results: { ...results, rewards } });
    }
    room.match = null;
    room.broadcastState();
  }
}
