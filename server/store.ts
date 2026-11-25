/**
 * Persistência.
 *
 * `Store` é a interface usada pelo restante do servidor. A implementação atual,
 * `FileStore`, mantém tudo em memória e grava um JSON de forma atômica
 * (arquivo temporário + rename) com debounce. Contas de convidado ficam só em
 * memória.
 *
 * Para produção com PostgreSQL: o schema está em server/db/schema.sql. Um
 * `PgStore` precisa implementar esta mesma interface usando o pacote `pg`
 * (não incluído nesta versão — ver docs/ARQUITETURA.md, seção Persistência).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MatchHistoryEntry, WeekHistory } from '../shared/protocol';
import { EMPTY_STATS, type Loadout, type Stats } from '../shared/progression';
import { EMPTY_UPGRADES, type UpgradeLevels } from '../shared/upgrades';

export interface UserRecord {
  id: string;
  username: string;
  usernameLower: string;
  guest: boolean;
  passHash: string;
  salt: string;
  createdAt: string;
  totalXp: number;
  coins: number;
  purchased: string[];
  loadout: Loadout;
  stats: Stats;
  achievements: string[];
  season: { id: string; xp: number; claimed: number[] };
  masteryXp: number;
  history: MatchHistoryEntry[];
  /** melhorias permanentes compradas */
  upgrades: UpgradeLevels;
  /** amizades confirmadas e solicitações pendentes (ids de conta) */
  friends: string[];
  friendIn: string[];
  friendOut: string[];
  /** códigos de presente já resgatados (maiúsculas) */
  redeemedCodes: string[];
  /** histórico de recompensas (mais recentes primeiro) */
  rewardLog: RewardLogEntry[];
  /** partidas já recompensadas (impede XP/moedas em dobro) */
  rewardedMatches: string[];
  lastSeen: string;
  /** pontuação da semana atual do ranking semanal (zera na virada da semana) */
  week: { id: string; xp: number; wins: number };
}

export interface RewardLogEntry {
  date: string;
  source: 'partida' | 'conquista' | 'temporada' | 'nivel' | 'codigo' | 'melhoria' | 'loja';
  desc: string;
  xp: number;
  coins: number;
}

export interface GiftCode {
  code: string;
  rewards: { coins?: number; xp?: number; maxLevel?: boolean };
  /** null = ilimitado */
  maxUses: number | null;
  uses: number;
  expires: string | null;
  active: boolean;
  createdAt: string;
}

/** Preenche campos ausentes (contas criadas por versões anteriores). */
export function normalizeUser(u: UserRecord): UserRecord {
  u.upgrades = { ...EMPTY_UPGRADES, ...(u.upgrades ?? {}) };
  u.friends ??= [];
  u.friendIn ??= [];
  u.friendOut ??= [];
  u.redeemedCodes ??= [];
  u.rewardLog ??= [];
  u.rewardedMatches ??= [];
  u.stats = { ...EMPTY_STATS, ...(u.stats ?? {}) };
  u.lastSeen ??= u.createdAt;
  u.week ??= { id: '', xp: 0, wins: 0 };
  return u;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  expires: number;
}

export interface Store {
  init(): Promise<void>;
  getUser(id: string): Promise<UserRecord | null>;
  getUserByName(usernameLower: string): Promise<UserRecord | null>;
  createUser(u: UserRecord): Promise<void>;
  saveUser(u: UserRecord): Promise<void>;
  createSession(s: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** contas cadastradas (sem convidados) — ranking e busca */
  listUsers(): Promise<UserRecord[]>;
  getCode(code: string): Promise<GiftCode | null>;
  saveCode(c: GiftCode): Promise<void>;
  listCodes(): Promise<GiftCode[]>;
  /** semanas encerradas do ranking (mais recentes primeiro) */
  listWeeks(): Promise<WeekHistory[]>;
  saveWeek(w: WeekHistory): Promise<void>;
  flush(): Promise<void>;
}

interface DbFile {
  version: 1;
  users: UserRecord[];
  sessions: SessionRecord[];
  codes?: GiftCode[];
  weeks?: WeekHistory[];
}

export class FileStore implements Store {
  private users = new Map<string, UserRecord>();
  private byName = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private codes = new Map<string, GiftCode>();
  private weeks = new Map<string, WeekHistory>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private path: string | null) {}

  async init() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existsSync(this.path)) return;
    const raw = JSON.parse(readFileSync(this.path, 'utf8')) as DbFile;
    for (const c of raw.codes ?? []) this.codes.set(c.code, c);
    for (const w of raw.weeks ?? []) this.weeks.set(w.id, w);
    for (const u of raw.users) {
      normalizeUser(u);
      this.users.set(u.id, u);
      this.byName.set(u.usernameLower, u.id);
    }
    const now = Date.now();
    for (const s of raw.sessions) if (s.expires > now) this.sessions.set(s.tokenHash, s);
  }

  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async getUserByName(n: string) {
    const id = this.byName.get(n);
    return id ? (this.users.get(id) ?? null) : null;
  }
  async listUsers() {
    return [...this.users.values()].filter((u) => !u.guest);
  }
  async getCode(code: string) {
    return this.codes.get(code) ?? null;
  }
  async saveCode(c: GiftCode) {
    this.codes.set(c.code, c);
    this.schedule();
  }
  async listCodes() {
    return [...this.codes.values()];
  }
  async listWeeks() {
    return [...this.weeks.values()].sort((a, b) => b.id.localeCompare(a.id));
  }
  async saveWeek(w: WeekHistory) {
    this.weeks.set(w.id, w);
    this.schedule();
  }
  async createUser(u: UserRecord) {
    if (this.byName.has(u.usernameLower)) throw new Error('username_taken');
    this.users.set(u.id, u);
    this.byName.set(u.usernameLower, u.id);
    this.schedule();
  }
  async saveUser(u: UserRecord) {
    this.users.set(u.id, u);
    this.schedule();
  }
  async createSession(s: SessionRecord) {
    this.sessions.set(s.tokenHash, s);
    this.schedule();
  }
  async getSession(h: string) {
    const s = this.sessions.get(h);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.sessions.delete(h);
      return null;
    }
    return s;
  }
  async deleteSession(h: string) {
    this.sessions.delete(h);
    this.schedule();
  }

  private schedule() {
    if (!this.path || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writeNow();
    }, 500);
  }

  private writeNow() {
    if (!this.path) return;
    const now = Date.now();
    const users = [...this.users.values()].filter((u) => !u.guest);
    const guestIds = new Set([...this.users.values()].filter((u) => u.guest).map((u) => u.id));
    const data: DbFile = {
      version: 1,
      users,
      sessions: [...this.sessions.values()].filter((s) => s.expires > now && !guestIds.has(s.userId)),
      codes: [...this.codes.values()],
      weeks: [...this.weeks.values()],
    };
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writeNow();
  }
}
