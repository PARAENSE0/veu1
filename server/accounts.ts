/**
 * Contas, sessões, perfis, posse de cosméticos e recompensas.
 * Senhas: scrypt com sal aleatório; comparação em tempo constante.
 * Tokens de sessão: 32 bytes aleatórios; o banco guarda apenas o SHA-256.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeUser, type GiftCode, type RewardLogEntry, type Store, type UserRecord } from './store';
import { weekById, weekOf } from './weekly';
import { MAX_UPGRADE_LEVEL, UPGRADES, UPGRADE_COSTS, type UpgradeId } from '../shared/upgrades';
import {
  ACHIEVEMENTS,
  COSMETICS,
  COSMETIC_BY_ID,
  DEFAULT_LOADOUT,
  EMPTY_STATS,
  currentSeason,
  levelFromXp,
  masteryFromXp,
  MAX_LEVEL,
  XP_FOR_MAX,
  type Loadout,
  type Slot,
  type Stats,
} from '../shared/progression';
import type { MatchHistoryEntry, PlayerResult, Profile, RankingEntry, Rewards, Role } from '../shared/protocol';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 14;

export class AuthError extends Error {
  constructor(
    readonly code: string,
    msg: string,
  ) {
    super(msg);
  }
}

export const USERNAME_RE = /^[A-Za-z0-9_À-ÖØ-öø-ÿ.-]{3,16}$/;

export function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

async function hashPassword(pw: string, salt: Buffer) {
  return (await scrypt(pw, salt, 64)).toString('hex');
}

export class Accounts {
  constructor(private store: Store) {}
  /** relógio (substituível nos testes para simular a virada da semana) */
  now: () => number = () => Date.now();

  /** Zera a pontuação semanal quando a conta pertence a uma semana anterior. */
  private rollWeek(u: UserRecord) {
    const w = weekOf(this.now());
    if (u.week.id !== w.id) u.week = { id: w.id, xp: 0, wins: 0 };
  }

  /**
   * Arquiva as semanas encerradas (top 10) a partir das pontuações guardadas
   * nas contas. Roda na inicialização, a cada minuto e antes de cada consulta;
   * não depende de haver alguém online na virada.
   */
  async archiveWeeks() {
    const cur = weekOf(this.now()).id;
    const done = new Set((await this.store.listWeeks()).map((w) => w.id));
    const byWeek = new Map<string, UserRecord[]>();
    for (const u of await this.store.listUsers()) {
      if (!u.week.id || u.week.id >= cur || u.week.xp <= 0 || done.has(u.week.id)) continue;
      let arr = byWeek.get(u.week.id);
      if (!arr) byWeek.set(u.week.id, (arr = []));
      arr.push(u);
    }
    for (const [id, us] of byWeek) {
      us.sort((a, b) => b.week.xp - a.week.xp || a.createdAt.localeCompare(b.createdAt));
      const info = weekById(id);
      await this.store.saveWeek({
        id,
        start: new Date(info.start).toISOString(),
        end: new Date(info.end).toISOString(),
        players: us.length,
        top: us.slice(0, 10).map((u, i) => ({ pos: i + 1, username: u.username, weekXp: u.week.xp })),
      });
    }
    if (byWeek.size) this.rankCache = null;
  }
  async weekHistory(limit = 12) {
    await this.archiveWeeks();
    return (await this.store.listWeeks()).slice(0, limit);
  }

  private newUser(username: string, guest: boolean, passHash = '', salt = ''): UserRecord {
    const season = currentSeason();
    return normalizeUser({
      id: randomUUID(),
      username,
      usernameLower: username.toLowerCase(),
      guest,
      passHash,
      salt,
      createdAt: new Date().toISOString(),
      totalXp: 0,
      coins: 150,
      purchased: [],
      loadout: { ...DEFAULT_LOADOUT },
      stats: { ...EMPTY_STATS },
      achievements: [],
      season: { id: season.id, xp: 0, claimed: [] },
      masteryXp: 0,
      history: [],
    } as unknown as UserRecord);
  }

  async register(username: string, password: string) {
    if (!USERNAME_RE.test(username)) throw new AuthError('bad_username', 'Nome deve ter 3 a 16 caracteres (letras, números, _ . -).');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AuthError('bad_password', 'A senha deve ter entre 8 e 128 caracteres.');
    if (await this.store.getUserByName(username.toLowerCase())) throw new AuthError('username_taken', 'Este nome já está em uso.');
    this.rankCache = null;
    const salt = randomBytes(16);
    const user = this.newUser(username, false, await hashPassword(password, salt), salt.toString('hex'));
    await this.store.createUser(user);
    return { user, token: await this.createSession(user.id) };
  }

  async login(username: string, password: string) {
    const user = await this.store.getUserByName(String(username).toLowerCase());
    // calcula hash mesmo se o usuário não existir (evita enumeração por tempo)
    const salt = user ? Buffer.from(user.salt, 'hex') : randomBytes(16);
    const h = await hashPassword(String(password), salt);
    if (!user || user.guest || !timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(user.passHash, 'hex'))) {
      throw new AuthError('bad_credentials', 'Usuário ou senha incorretos.');
    }
    return { user, token: await this.createSession(user.id) };
  }

  async guest(name?: string) {
    let base = (name && USERNAME_RE.test(name) ? name : 'Convidado').slice(0, 11);
    let username = '';
    for (let i = 0; i < 20; i++) {
      username = `${base}#${Math.floor(1000 + Math.random() * 9000)}`;
      if (!(await this.store.getUserByName(username.toLowerCase()))) break;
    }
    const user = this.newUser(username, true);
    await this.store.createUser(user);
    return { user, token: await this.createSession(user.id) };
  }

  private async createSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    await this.store.createSession({ tokenHash: sha256(token), userId, expires: Date.now() + SESSION_DAYS * 86400_000 });
    return token;
  }

  async fromToken(token: unknown): Promise<UserRecord | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const s = await this.store.getSession(sha256(token));
    if (!s) return null;
    return this.store.getUser(s.userId);
  }

  async logout(token: string) {
    await this.store.deleteSession(sha256(token));
  }

  // ---- Cosméticos ----
  isOwned(u: UserRecord, id: string): boolean {
    const c = COSMETIC_BY_ID[id];
    if (!c) return false;
    const un = c.unlock;
    switch (un.type) {
      case 'default':
        return true;
      case 'shop':
        return u.purchased.includes(id);
      case 'level':
        return levelFromXp(u.totalXp).level >= un.level;
      case 'achievement':
        return u.achievements.includes(un.id);
      case 'season':
        return u.season.id === un.season ? u.season.claimed.includes(un.tier) : u.purchased.includes(id);
      case 'mastery':
        return masteryFromXp(u.masteryXp).level >= un.level;
    }
  }

  ownedList(u: UserRecord) {
    return COSMETICS.filter((c) => this.isOwned(u, c.id)).map((c) => c.id);
  }

  async setLoadout(u: UserRecord, loadout: Partial<Loadout>) {
    const next = { ...u.loadout };
    for (const [slot, id] of Object.entries(loadout) as [Slot, string][]) {
      const c = COSMETIC_BY_ID[id];
      if (!c || c.slot !== slot) throw new AuthError('bad_cosmetic', `Item inválido para ${slot}.`);
      if (!this.isOwned(u, id)) throw new AuthError('not_owned', `Você ainda não desbloqueou "${c.name}".`);
      next[slot] = id;
    }
    u.loadout = next;
    await this.store.saveUser(u);
  }

  async buy(u: UserRecord, id: string) {
    const c = COSMETIC_BY_ID[id];
    if (!c || c.unlock.type !== 'shop') throw new AuthError('not_for_sale', 'Item não está à venda.');
    if (u.purchased.includes(id)) throw new AuthError('already_owned', 'Você já possui este item.');
    if (u.coins < c.unlock.price) throw new AuthError('no_coins', 'Fragmentos insuficientes.');
    u.coins -= c.unlock.price;
    u.purchased.push(id);
    this.log(u, { source: 'loja', desc: `Loja: ${c.name}`, xp: 0, coins: -c.unlock.price });
    await this.store.saveUser(u);
  }

  profile(u: UserRecord): Profile {
    const lv = levelFromXp(u.totalXp);
    this.rollSeason(u);
    return {
      id: u.id,
      username: u.username,
      guest: u.guest,
      totalXp: u.totalXp,
      level: lv.level,
      levelInto: lv.into,
      levelNeed: lv.need,
      coins: u.coins,
      owned: this.ownedList(u),
      loadout: u.loadout,
      stats: u.stats,
      achievements: u.achievements,
      season: u.season,
      masteryXp: u.masteryXp,
      maxLevel: lv.max,
      upgrades: { ...u.upgrades },
      redeemedCodes: [...u.redeemedCodes],
      rewardLog: u.rewardLog.slice(0, 30),
      friendRequests: u.friendIn.length,
      weekXp: u.week.id === weekOf(this.now()).id ? u.week.xp : 0,
      weekEndsAt: new Date(weekOf(this.now()).end).toISOString(),
    };
  }

  // ---- XP com teto no nível 50 e registro de recompensas ----
  private addXp(u: UserRecord, xp: number) {
    this.rankCache = null;
    // sem teto: o XP acumula para sempre (o NÍVEL para no 50, ver levelFromXp)
    u.totalXp = u.totalXp + Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  }
  private log(u: UserRecord, e: Omit<RewardLogEntry, 'date'>) {
    u.rewardLog.unshift({ date: new Date().toISOString(), ...e });
    if (u.rewardLog.length > 100) u.rewardLog.length = 100;
  }

  // ---- Melhorias ----
  async buyUpgrade(u: UserRecord, id: string) {
    const def = UPGRADES[id as UpgradeId];
    if (!def) throw new AuthError('bad_upgrade', 'Melhoria inexistente.');
    if (u.guest) throw new AuthError('guest', 'Crie uma conta para comprar melhorias permanentes.');
    const lvl = u.upgrades[def.id] ?? 0;
    if (lvl >= MAX_UPGRADE_LEVEL) throw new AuthError('max_upgrade', 'Esta melhoria já está no nível máximo.');
    const cost = UPGRADE_COSTS[lvl];
    if (u.coins < cost) throw new AuthError('no_coins', 'Fragmentos insuficientes.');
    // verificação e débito acontecem juntos, sem pausa (sem compra em dobro)
    u.coins -= cost;
    u.upgrades[def.id] = lvl + 1;
    this.log(u, { source: 'melhoria', desc: `${def.side === 'humano' ? 'Humano' : 'Monstro'}: ${def.name} nível ${lvl + 1}`, xp: 0, coins: -cost });
    await this.store.saveUser(u);
  }

  // ---- Códigos de presente ----
  static normalizeCode(code: string) {
    return String(code ?? '').trim().toUpperCase();
  }

  /** Garante os códigos padrão (o PARAENSE01 é criado na primeira inicialização). */
  async seedCodes() {
    if (!(await this.store.getCode('PARAENSE01'))) {
      await this.store.saveCode({ code: 'PARAENSE01', rewards: { coins: 20000, maxLevel: true }, maxUses: null, uses: 0, expires: null, active: true, createdAt: new Date().toISOString() });
    }
    for (const [code, coins] of [
      ['1MPARAENSE', 1_000_000],
      ['2MPARAENSE', 2_000_000],
    ] as const)
      if (!(await this.store.getCode(code))) await this.store.saveCode({ code, rewards: { coins }, maxUses: null, uses: 0, expires: null, active: true, createdAt: new Date().toISOString() });
  }

  async listCodes() {
    return this.store.listCodes();
  }

  async createCode(c: { code: string; coins?: number; xp?: number; maxLevel?: boolean; maxUses?: number | null; expires?: string | null }) {
    const code = Accounts.normalizeCode(c.code);
    if (!/^[A-Z0-9_-]{4,24}$/.test(code)) throw new AuthError('bad_code', 'Código deve ter 4 a 24 letras/números.');
    if (await this.store.getCode(code)) throw new AuthError('code_exists', 'Esse código já existe.');
    const gc: GiftCode = { code, rewards: { coins: c.coins ?? 0, xp: c.xp ?? 0, maxLevel: !!c.maxLevel }, maxUses: c.maxUses ?? null, uses: 0, expires: c.expires ?? null, active: true, createdAt: new Date().toISOString() };
    await this.store.saveCode(gc);
    return gc;
  }

  async redeemCode(u: UserRecord, raw: string) {
    const code = Accounts.normalizeCode(raw);
    if (u.guest) throw new AuthError('guest', 'Crie uma conta para resgatar códigos (convidados não guardam progresso).');
    const gc = code ? await this.store.getCode(code) : null;
    // a partir daqui: verificação e aplicação sem nenhum "await" no meio
    if (!gc || !gc.active || (gc.expires && gc.expires < new Date().toISOString())) throw new AuthError('invalid_code', 'Código inválido.');
    if (u.redeemedCodes.includes(code)) throw new AuthError('code_used', 'Você já resgatou este código.');
    if (gc.maxUses !== null && gc.uses >= gc.maxUses) throw new AuthError('code_exhausted', 'Este código atingiu o limite de usos.');
    u.redeemedCodes.push(code);
    gc.uses++;
    const before = levelFromXp(u.totalXp).level;
    const xpBefore = u.totalXp;
    this.rankCache = null;
    // nível máximo: garante o XP do nível 50 sem tirar XP de quem já passou disso
    if (gc.rewards.maxLevel) u.totalXp = Math.max(u.totalXp, XP_FOR_MAX);
    else this.addXp(u, gc.rewards.xp ?? 0);
    u.coins += gc.rewards.coins ?? 0;
    const after = levelFromXp(u.totalXp).level;
    this.log(u, { source: 'codigo', desc: `Código ${code}${after > before ? ` — nível ${after}` : ''}`, xp: u.totalXp - xpBefore, coins: gc.rewards.coins ?? 0 });
    await this.store.saveCode(gc);
    await this.store.saveUser(u);
    return { coins: gc.rewards.coins ?? 0, xp: u.totalXp - xpBefore, levelBefore: before, levelAfter: after };
  }

  // ---- Ranking ----
  private rankCache: { at: number; by: string; list: UserRecord[] } | null = null;
  async ranking(by: 'semanal' | 'xp' | 'vitorias', me: UserRecord | null, limit = 100): Promise<{ list: RankingEntry[]; me: RankingEntry | null; total: number; updated: string; week: { id: string; start: string; end: string; msLeft: number } }> {
    await this.archiveWeeks();
    const wk = weekOf(this.now());
    const weekXp = (u: UserRecord) => (u.week.id === wk.id ? u.week.xp : 0);
    let sorted: UserRecord[];
    if (this.rankCache && this.rankCache.by === by && this.now() - this.rankCache.at < 3000) sorted = this.rankCache.list;
    else {
      const all = await this.store.listUsers();
      const wins = (u: UserRecord) => (u.stats.survivorWins ?? 0) + (u.stats.entityWins ?? 0);
      const pool = by === 'semanal' ? all.filter((u) => weekXp(u) > 0) : all;
      sorted = pool.sort((a, b) => (by === 'semanal' ? weekXp(b) - weekXp(a) : by === 'xp' ? b.totalXp - a.totalXp || wins(b) - wins(a) : wins(b) - wins(a) || b.totalXp - a.totalXp) || a.createdAt.localeCompare(b.createdAt));
      this.rankCache = { at: this.now(), by, list: sorted };
    }
    const entry = (u: UserRecord, i: number): RankingEntry => ({ pos: i + 1, id: u.id, username: u.username, level: levelFromXp(u.totalXp).level, totalXp: u.totalXp, wins: (u.stats.survivorWins ?? 0) + (u.stats.entityWins ?? 0), matches: u.stats.matches ?? 0, weekXp: weekXp(u) });
    const idx = me ? sorted.findIndex((u) => u.id === me.id) : -1;
    return {
      list: sorted.slice(0, limit).map(entry),
      me: idx >= 0 ? entry(sorted[idx], idx) : null,
      total: sorted.length,
      updated: new Date(this.now()).toISOString(),
      week: { id: wk.id, start: new Date(wk.start).toISOString(), end: new Date(wk.end).toISOString(), msLeft: wk.end - this.now() },
    };
  }

  async search(q: string, me: UserRecord) {
    const s = String(q ?? '').trim().toLowerCase();
    if (s.length < 2) return [];
    const all = await this.store.listUsers();
    return all
      .filter((u) => u.id !== me.id && (u.usernameLower.startsWith(s) || u.usernameLower.includes(s) || u.id === s))
      .sort((a, b) => Number(b.usernameLower.startsWith(s)) - Number(a.usernameLower.startsWith(s)) || a.usernameLower.localeCompare(b.usernameLower))
      .slice(0, 10)
      .map((u) => ({ id: u.id, username: u.username, level: levelFromXp(u.totalXp).level }));
  }

  // ---- Amigos ----
  private async other(id: string): Promise<UserRecord> {
    const o = await this.store.getUser(String(id));
    if (!o || o.guest) throw new AuthError('no_user', 'Jogador não encontrado.');
    return o;
  }
  /** Envia solicitação (ou aceita direto, se a outra pessoa já tinha pedido). Retorna 'sent' | 'accepted'. */
  async friendRequest(u: UserRecord, targetId: string): Promise<{ result: 'sent' | 'accepted'; other: UserRecord }> {
    if (u.guest) throw new AuthError('guest', 'Crie uma conta para adicionar amigos.');
    const o = await this.other(targetId);
    if (o.id === u.id) throw new AuthError('self', 'Você não pode adicionar a si mesmo.');
    if (u.friends.includes(o.id)) throw new AuthError('already', 'Vocês já são amigos.');
    if (u.friendIn.includes(o.id)) {
      this.link(u, o);
      await this.store.saveUser(u);
      await this.store.saveUser(o);
      return { result: 'accepted', other: o };
    }
    if (u.friendOut.includes(o.id)) throw new AuthError('pending', 'Solicitação já enviada.');
    if (u.friends.length >= 200 || u.friendOut.length >= 50) throw new AuthError('limit', 'Limite de amigos/solicitações atingido.');
    u.friendOut.push(o.id);
    o.friendIn.push(u.id);
    await this.store.saveUser(u);
    await this.store.saveUser(o);
    return { result: 'sent', other: o };
  }
  private link(u: UserRecord, o: UserRecord) {
    u.friendIn = u.friendIn.filter((x) => x !== o.id);
    u.friendOut = u.friendOut.filter((x) => x !== o.id);
    o.friendIn = o.friendIn.filter((x) => x !== u.id);
    o.friendOut = o.friendOut.filter((x) => x !== u.id);
    if (!u.friends.includes(o.id)) u.friends.push(o.id);
    if (!o.friends.includes(u.id)) o.friends.push(u.id);
  }
  async friendAccept(u: UserRecord, fromId: string) {
    if (!u.friendIn.includes(fromId)) throw new AuthError('no_request', 'Não há solicitação deste jogador.');
    const o = await this.other(fromId);
    this.link(u, o);
    await this.store.saveUser(u);
    await this.store.saveUser(o);
    return o;
  }
  async friendReject(u: UserRecord, fromId: string) {
    if (!u.friendIn.includes(fromId)) throw new AuthError('no_request', 'Não há solicitação deste jogador.');
    u.friendIn = u.friendIn.filter((x) => x !== fromId);
    const o = await this.store.getUser(fromId);
    if (o) {
      o.friendOut = o.friendOut.filter((x) => x !== u.id);
      await this.store.saveUser(o);
    }
    await this.store.saveUser(u);
  }
  async friendCancel(u: UserRecord, toId: string) {
    if (!u.friendOut.includes(toId)) throw new AuthError('no_request', 'Não há solicitação enviada para este jogador.');
    u.friendOut = u.friendOut.filter((x) => x !== toId);
    const o = await this.store.getUser(toId);
    if (o) {
      o.friendIn = o.friendIn.filter((x) => x !== u.id);
      await this.store.saveUser(o);
    }
    await this.store.saveUser(u);
  }
  async friendRemove(u: UserRecord, id: string) {
    if (!u.friends.includes(id)) throw new AuthError('not_friend', 'Este jogador não está na sua lista.');
    u.friends = u.friends.filter((x) => x !== id);
    const o = await this.store.getUser(id);
    if (o) {
      o.friends = o.friends.filter((x) => x !== u.id);
      await this.store.saveUser(o);
    }
    await this.store.saveUser(u);
  }
  async userBrief(id: string) {
    const o = await this.store.getUser(id);
    if (!o) return null;
    return { id: o.id, username: o.username, level: levelFromXp(o.totalXp).level, lastSeen: o.lastSeen };
  }
  async touch(u: UserRecord) {
    u.lastSeen = new Date().toISOString();
    await this.store.saveUser(u);
  }

  private rollSeason(u: UserRecord) {
    const s = currentSeason();
    if (u.season.id !== s.id) u.season = { id: s.id, xp: 0, claimed: [] };
  }

  /** Aplica o resultado de uma partida à conta. Retorna as recompensas obtidas. */
  async applyMatch(u: UserRecord, pr: PlayerResult, delta: Partial<Stats>, info: { matchId: string; map: string; winner: 'survivors' | 'entity'; duration: number; role: Role }): Promise<Rewards> {
    this.rollSeason(u);
    const levelBefore = levelFromXp(u.totalXp).level;
    // a mesma partida nunca recompensa duas vezes
    if (u.rewardedMatches.includes(info.matchId)) return { xp: 0, coins: 0, levelBefore, levelAfter: levelBefore, achievements: [], seasonTiers: [], masteryXp: 0 };
    u.rewardedMatches.unshift(info.matchId);
    if (u.rewardedMatches.length > 300) u.rewardedMatches.length = 300;
    for (const [k, v] of Object.entries(delta) as [keyof Stats, number][]) u.stats[k] = (u.stats[k] ?? 0) + v;
    const xpBefore = u.totalXp;
    this.addXp(u, pr.xp);
    u.coins += pr.coins;
    // ranking semanal: só o XP ganho jogando conta (códigos não entram)
    this.rollWeek(u);
    u.week.xp += Math.max(0, Math.floor(pr.xp));
    if (info.winner === (info.role === 'entity' ? 'entity' : 'survivors')) u.week.wins += 1;
    this.log(u, { source: 'partida', desc: `Partida (${info.role === 'entity' ? 'entidade' : 'sobrevivente'}) — ${pr.outcome === 'escaped' ? 'fugiu' : pr.outcome === 'dead' ? 'eliminado' : pr.outcome === 'entity' ? (info.winner === 'entity' ? 'vitória' : 'derrota') : pr.outcome}`, xp: u.totalXp - xpBefore, coins: pr.coins });
    let masteryXp = 0;
    if (info.role === 'entity') {
      masteryXp = pr.xp;
      u.masteryXp += masteryXp;
    }
    // conquistas
    const newAch: string[] = [];
    for (const a of ACHIEVEMENTS) {
      if (!u.achievements.includes(a.id) && a.check(u.stats)) {
        u.achievements.push(a.id);
        u.coins += a.coins;
        newAch.push(a.id);
        this.log(u, { source: 'conquista', desc: `Conquista: ${a.name}`, xp: 0, coins: a.coins });
      }
    }
    // temporada
    const season = currentSeason();
    u.season.xp += pr.xp;
    const tiers: number[] = [];
    for (const t of season.tiers) {
      if (u.season.xp >= t.xp && !u.season.claimed.includes(t.tier)) {
        u.season.claimed.push(t.tier);
        if (t.reward.coins) u.coins += t.reward.coins;
        tiers.push(t.tier);
        this.log(u, { source: 'temporada', desc: `Temporada: nível ${t.tier}`, xp: 0, coins: t.reward.coins ?? 0 });
      }
    }
    const levelAfter = levelFromXp(u.totalXp).level;
    if (levelAfter > levelBefore) {
      u.coins += (levelAfter - levelBefore) * 50; // bônus por nível
      this.log(u, { source: 'nivel', desc: `Subiu para o nível ${levelAfter}${levelAfter >= MAX_LEVEL ? ' (máximo)' : ''}`, xp: 0, coins: (levelAfter - levelBefore) * 50 });
    }
    const entry: MatchHistoryEntry = {
      matchId: info.matchId,
      date: new Date().toISOString(),
      map: info.map,
      role: info.role,
      outcome: pr.outcome,
      winner: info.winner,
      duration: info.duration,
      xp: pr.xp,
      coins: pr.coins,
      score: pr.score,
    };
    u.history.unshift(entry);
    u.history.length = Math.min(u.history.length, 50);
    await this.store.saveUser(u);
    return { xp: u.totalXp - xpBefore, coins: pr.coins, levelBefore, levelAfter, achievements: newAch, seasonTiers: tiers, masteryXp };
  }
}
