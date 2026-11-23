/**
 * Contas, sessões, perfis, posse de cosméticos e recompensas.
 * Senhas: scrypt com sal aleatório; comparação em tempo constante.
 * Tokens de sessão: 32 bytes aleatórios; o banco guarda apenas o SHA-256.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Store, UserRecord } from './store';
import {
  ACHIEVEMENTS,
  COSMETICS,
  COSMETIC_BY_ID,
  DEFAULT_LOADOUT,
  EMPTY_STATS,
  currentSeason,
  levelFromXp,
  masteryFromXp,
  type Loadout,
  type Slot,
  type Stats,
} from '../shared/progression';
import type { MatchHistoryEntry, PlayerResult, Profile, Rewards, Role } from '../shared/protocol';

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

  private newUser(username: string, guest: boolean, passHash = '', salt = ''): UserRecord {
    const season = currentSeason();
    return {
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
    };
  }

  async register(username: string, password: string) {
    if (!USERNAME_RE.test(username)) throw new AuthError('bad_username', 'Nome deve ter 3 a 16 caracteres (letras, números, _ . -).');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AuthError('bad_password', 'A senha deve ter entre 8 e 128 caracteres.');
    if (await this.store.getUserByName(username.toLowerCase())) throw new AuthError('username_taken', 'Este nome já está em uso.');
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
    };
  }

  private rollSeason(u: UserRecord) {
    const s = currentSeason();
    if (u.season.id !== s.id) u.season = { id: s.id, xp: 0, claimed: [] };
  }

  /** Aplica o resultado de uma partida à conta. Retorna as recompensas obtidas. */
  async applyMatch(u: UserRecord, pr: PlayerResult, delta: Partial<Stats>, info: { matchId: string; map: string; winner: 'survivors' | 'entity'; duration: number; role: Role }): Promise<Rewards> {
    this.rollSeason(u);
    const levelBefore = levelFromXp(u.totalXp).level;
    for (const [k, v] of Object.entries(delta) as [keyof Stats, number][]) u.stats[k] = (u.stats[k] ?? 0) + v;
    u.totalXp += pr.xp;
    u.coins += pr.coins;
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
      }
    }
    const levelAfter = levelFromXp(u.totalXp).level;
    u.coins += (levelAfter - levelBefore) * 50; // bônus por nível
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
    return { xp: pr.xp, coins: pr.coins, levelBefore, levelAfter, achievements: newAch, seasonTiers: tiers, masteryXp };
  }
}
