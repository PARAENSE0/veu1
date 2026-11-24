/**
 * Simulação autoritativa de uma partida.
 *
 * O servidor recebe apenas INTENÇÕES dos clientes (comandos de movimento a 30 Hz
 * e ações como interagir/atacar/usar habilidade) e decide tudo: posição,
 * colisão, dano, objetivos, vitória/derrota. Cada cliente recebe um snapshot
 * filtrado (a entidade não recebe sobreviventes escondidos ou fora de visão; os
 * sobreviventes não recebem a entidade atrás das paredes, só uma "ameaça").
 */
import {
  ABILITIES,
  CELL,
  CMD_BUDGET_CAP,
  DETECTOR_CHARGES,
  DETECTOR_JITTER,
  DETECTOR_RANGE,
  DT,
  ECO_MEMORY,
  ECO_RANGE,
  ENT,
  ENTITY_AUDIBLE_RADIUS,
  EVENT_SOUND_RANGE,
  FLARE_RADIUS,
  FLARE_TIME,
  INTERACT_RANGE,
  AUTO_DOOR_RANGE,
  AUTO_DOOR_CLOSE_DELAY,
  ITEM_INFO,
  MATCH_DURATION,
  MAX_QUEUED_CMDS,
  NOISE,
  PARASITA_DOOR_LOCK,
  PARASITA_FLASHLIGHT,
  PARASITA_RADIUS,
  PLAYER_RADIUS,
  RASTRO_HISTORY,
  RASTRO_RANGE,
  RECONNECT_GRACE,
  RUPTURA_MULT,
  RUPTURA_RECOVER,
  SNAPSHOT_EVERY,
  SURV,
  THREAT_RADIUS,
  VIEW_RANGE,
  type AbilityId,
  type ItemKind,
  ENTITY_HITBOX,
  ENTITY_HP_BASE,
  ENTITY_HP_PER_SURVIVOR,
  ENTITY_REGEN,
  ENTITY_REGEN_DELAY,
  FLAMER,
  GUNS,
  SUPPLY_COLLECT_TIME,
  SUPPLY_INFO,
  SUPPLY_RESPAWN,
  SUPPLY_RESPAWN_SAFE_DIST,
  WALL_H,
  WEAPON_ORDER,
  supplyCap,
  type SupplyKind,
  type WeaponId,
} from '../shared/constants';
import { getMap, type MapDef } from '../shared/map';
import { dist2, forwardVec, isOpaque, isSolid, lineOfSight, makeGrid, pickTarget, raycast, resolveCircle, stepMove, type Grid, type InputCmd, type MoveParams, type MoveState } from '../shared/physics';
import type { Loadout, Stats } from '../shared/progression';
import { PF, type EcoType, type GameEvent, type MatchIntro, type MatchResults, type PlayerResult, type PStatus, type Role, type ServerMsg, type SnapPlayer, type Snapshot, type SoundKind } from '../shared/protocol';
import { Rng } from '../shared/rng';
import { modsFor, type Mods, type UpgradeLevels } from '../shared/upgrades';
import { buildTasks, taskView, type Task } from './tasks';

export interface MatchPlayerInit {
  id: string;
  name: string;
  role: Role;
  loadout: Loadout;
  upgrades?: Partial<UpgradeLevels>;
}

type Channel = { kind: 'station'; station: string; label: string } | { kind: 'revive'; target: string; label: string } | { kind: 'heal'; label: string } | { kind: 'supply'; supply: string; label: string };

interface MPlayer extends MoveState {
  id: string;
  name: string;
  role: Role;
  loadout: Loadout;
  connected: boolean;
  disconnectedAt: number;
  loaded: boolean;
  hp: number;
  status: PStatus;
  bleed: number;
  hidden: string | null;
  hiddenFor: number;
  flashlight: boolean;
  flickerUntil: number;
  inventory: (ItemKind | null)[];
  detCharges: number;
  detectorCd: number;
  channel: Channel | null;
  channelT: number;
  interactHeld: boolean;
  queue: InputCmd[];
  budget: number;
  lastSeq: number;
  slowUntil: number;
  hasteUntil: number;
  stunUntil: number;
  // entidade
  attackPhase: 'none' | 'windup' | 'special';
  attackT: number;
  attackCd: number;
  cd: Record<AbilityId, number>;
  active: Record<AbilityId, number>;
  recoverUntil: number;
  resonance: number;
  camoT: number;
  camo: boolean;
  revealUntil: number;
  // ruído / rastro
  noiseT: number;
  trail: { x: number; z: number; t: number }[];
  trailT: number;
  stats: Partial<Stats>;
  score: number;
  outcome: PlayerResult['outcome'] | null;
  spec: string | null;
  lastSeenBy: Map<string, number>;
  // armas (sobreviventes)
  weapon: WeaponId;
  mag: { pistola: number; fuzil: number };
  reserve: { pistola: number; fuzil: number };
  fuel: number;
  reloadUntil: number;
  nextShot: number;
  trigger: boolean;
  triggerFresh: boolean;
  triggerAt: number;
  firingUntil: number;
  flaming: boolean;
  // vida da entidade
  maxHp: number;
  lastDamageAt: number;
  burnUntil: number;
  burnBy: string | null;
  hurtSoundAt: number;
  mods: Mods;
  heavy: boolean;
}

interface Supply {
  id: string;
  kind: SupplyKind;
  x: number;
  z: number;
  amount: number;
  claimedBy: string | null;
}

interface GroundItem {
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
}

export interface MatchHooks {
  send(playerId: string, msg: ServerMsg): void;
  onEnd(results: MatchResults, stats: Map<string, { role: Role; stats: Partial<Stats>; result: PlayerResult }>): void;
}

const zeroAbilities = (): Record<AbilityId, number> => ({ rastro: 0, eco: 0, ruptura: 0, parasita: 0, golpe: 0 });
const round2 = (v: number) => Math.round(v * 100) / 100;

export class Match {
  readonly map: MapDef;
  readonly grid: Grid;
  readonly rng: Rng;
  readonly players = new Map<string, MPlayer>();
  readonly entityId: string;
  time = 0;
  tick = 0;
  started = false;
  ended = false;
  readonly duration: number;
  private items = new Map<string, GroundItem>();
  private itemSeq = 0;
  tasks: Task[];
  stage = 1;
  private doorLock = new Map<number, number>();
  private doorUse = new Map<number, number>();
  private jamUntil = new Map<string, number>();
  private zoneDark = new Map<string, number>();
  private powerOn = false;
  private podsReady = new Set<string>();
  private flares: { x: number; z: number; until: number }[] = [];
  private fakeEchoes: { x: number; z: number; until: number }[] = [];
  private ecoMemory = new Map<EcoType, number>();
  private presenceSource: string | null = null;
  private supplies = new Map<string, Supply>();
  private supplySeq = 0;
  private supplyRespawnAt: number[] = [];
  private readonly supplyRespawn: number;
  private events = new Map<string, GameEvent[]>();
  private nSurv: number;

  constructor(
    readonly id: string,
    readonly mapId: string,
    readonly seed: number,
    inits: MatchPlayerInit[],
    private hooks: MatchHooks,
    opts: { duration?: number; supplyRespawn?: number } = {},
  ) {
    this.map = getMap(mapId);
    this.grid = makeGrid(this.map);
    this.rng = new Rng(seed);
    this.duration = opts.duration ?? MATCH_DURATION;
    this.supplyRespawn = opts.supplyRespawn ?? SUPPLY_RESPAWN;
    const ent = inits.filter((p) => p.role === 'entity');
    if (ent.length !== 1) throw new Error('a partida precisa de exatamente 1 entidade');
    this.entityId = ent[0].id;
    const survivors = inits.filter((p) => p.role === 'survivor');
    this.nSurv = survivors.length;
    const group = this.rng.pick(this.map.survivorSpawns);
    const espawn = this.rng.pick(this.map.entitySpawns);
    survivors.forEach((p, i) => {
      const sp = group[i % group.length];
      this.players.set(p.id, this.newPlayer(p, sp.x, sp.z));
    });
    this.players.set(ent[0].id, this.newPlayer(ent[0], espawn.x, espawn.z));
    this.tasks = buildTasks(this.rng, this.map, this.nSurv);
    // itens de apoio
    const supply: ItemKind[] = ['kit', 'kit', 'kit', 'detector', 'detector', 'sinalizador', 'sinalizador', 'sinalizador'];
    if (this.nSurv > 4) supply.push('kit', 'sinalizador');
    this.spawnItems(supply);
    this.activateStage(1, true);
    this.ecoMemory.set('passos', 0);
    // vida da entidade proporcional ao tamanho da equipe
    const e = this.entity;
    e.maxHp = e.hp = ENTITY_HP_BASE + ENTITY_HP_PER_SURVIVOR * this.nSurv;
    // suprimentos iniciais
    for (let i = 0; i < supplyCap(this.nSurv); i++) this.spawnSupply(true);
  }

  private newPlayer(p: MatchPlayerInit, x: number, z: number): MPlayer {
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      loadout: p.loadout,
      connected: true,
      disconnectedAt: 0,
      loaded: false,
      x,
      z,
      yaw: 0,
      pitch: 0,
      stamina: modsFor(p.role, p.upgrades ?? {}).staminaMax,
      exhausted: false,
      regenDelay: 0,
      crouch: false,
      sprinting: false,
      speed: 0,
      hp: SURV.hpMax,
      status: 'alive',
      bleed: 0,
      hidden: null,
      hiddenFor: 0,
      flashlight: p.role === 'survivor',
      flickerUntil: 0,
      inventory: new Array(SURV.inventorySlots).fill(null),
      detCharges: 0,
      detectorCd: 0,
      channel: null,
      channelT: 0,
      interactHeld: false,
      queue: [],
      budget: 0,
      lastSeq: -1,
      slowUntil: 0,
      hasteUntil: 0,
      stunUntil: 0,
      attackPhase: 'none',
      attackT: 0,
      attackCd: 0,
      cd: zeroAbilities(),
      active: zeroAbilities(),
      recoverUntil: 0,
      resonance: 0,
      camoT: 0,
      camo: false,
      revealUntil: 0,
      noiseT: 0,
      trail: [],
      trailT: 0,
      stats: {},
      score: 0,
      outcome: null,
      spec: null,
      lastSeenBy: new Map(),
      weapon: 'pistola',
      mag: { pistola: GUNS.pistola.startMag, fuzil: GUNS.fuzil.startMag },
      reserve: { pistola: GUNS.pistola.startReserve, fuzil: GUNS.fuzil.startReserve },
      fuel: FLAMER.startFuel,
      reloadUntil: 0,
      nextShot: 0,
      trigger: false,
      triggerFresh: false,
      triggerAt: 0,
      firingUntil: 0,
      flaming: false,
      maxHp: SURV.hpMax,
      lastDamageAt: -99,
      burnUntil: 0,
      burnBy: null,
      hurtSoundAt: 0,
      mods: modsFor(p.role, p.upgrades ?? {}),
      heavy: false,
    };
  }

  intro(forId: string): MatchIntro {
    const me = this.players.get(forId)!;
    return {
      mods: me.mods,
      matchId: this.id,
      mapId: this.mapId,
      seed: this.seed,
      you: forId,
      role: me.role,
      duration: this.duration,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, loadout: p.loadout })),
    };
  }

  get entity(): MPlayer {
    return this.players.get(this.entityId)!;
  }

  // ------------------------------------------------------------------ itens
  private freeSpots(): { x: number; z: number }[] {
    const used = new Set([...this.items.values()].map((i) => `${i.x},${i.z}`));
    return this.map.itemSpots.filter((s) => !used.has(`${s.x},${s.z}`));
  }
  private spawnItems(kinds: ItemKind[]) {
    const spots = this.rng.shuffle(this.freeSpots());
    kinds.forEach((k, i) => {
      const s = spots[i % spots.length];
      // pequena variação para não empilhar
      const id = `i${++this.itemSeq}`;
      this.items.set(id, { id, kind: k, x: s.x + this.rng.range(-0.4, 0.4), z: s.z + this.rng.range(-0.4, 0.4) });
    });
  }
  private dropItem(p: MPlayer, kind: ItemKind) {
    const id = `i${++this.itemSeq}`;
    const [x, z] = resolveCircle(this.grid, p.x + this.rng.range(-0.3, 0.3), p.z + this.rng.range(-0.3, 0.3), 0.2);
    this.items.set(id, { id, kind, x, z });
  }

  // ------------------------------------------------------------------ suprimentos
  /**
   * Cria uma caixa de suprimento num ponto livre. No início da partida qualquer
   * ponto serve; nas reposições, evita pontos a menos de 15 m de sobreviventes
   * (ninguém vê a caixa "brotar" e não dá para acampar um ponto).
   */
  private spawnSupply(initial: boolean): boolean {
    const used = new Set([...this.supplies.values()].map((s) => `${s.x},${s.z}`));
    let spots = this.map.supplySpots.filter((s) => !used.has(`${s.x},${s.z}`));
    if (!initial) {
      spots = spots.filter((s) => ![...this.players.values()].some((p) => p.role === 'survivor' && (p.status === 'alive' || p.status === 'downed') && this.near(p, s.x, s.z, SUPPLY_RESPAWN_SAFE_DIST)));
    }
    if (!spots.length) return false;
    const spot = this.rng.pick(spots);
    // sorteio ponderado do tipo
    let r = this.rng.next();
    let kind: SupplyKind = 'mun_pistola';
    for (const k of Object.keys(SUPPLY_INFO) as SupplyKind[]) {
      r -= SUPPLY_INFO[k].weight;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    const id = `s${++this.supplySeq}`;
    this.supplies.set(id, { id, kind, x: spot.x, z: spot.z, amount: SUPPLY_INFO[kind].amount, claimedBy: null });
    return true;
  }

  /** Quanto o jogador ainda pode carregar deste tipo de suprimento. */
  private supplySpace(p: MPlayer, kind: SupplyKind): number {
    if (kind === 'mun_pistola') return GUNS.pistola.maxReserve - p.reserve.pistola;
    if (kind === 'mun_fuzil') return GUNS.fuzil.maxReserve - p.reserve.fuzil;
    return FLAMER.maxFuel - p.fuel;
  }

  private startCollect(p: MPlayer, s: Supply) {
    if (s.claimedBy && s.claimedBy !== p.id) {
      this.toPlayer(p.id, { k: 'msg', text: 'Outro sobrevivente já está pegando isso.', tone: 'warn' });
      return;
    }
    if (this.supplySpace(p, s.kind) <= 0) {
      this.toPlayer(p.id, { k: 'msg', text: `${SUPPLY_INFO[s.kind].name}: você já está no limite.`, tone: 'warn' });
      return;
    }
    s.claimedBy = p.id;
    this.startChannel(p, { kind: 'supply', supply: s.id, label: `Coletando ${SUPPLY_INFO[s.kind].name.toLowerCase()}` });
  }

  /** Conclui a coleta: tudo acontece dentro de um único tick do servidor (sem duplicação). */
  private finishCollect(p: MPlayer, s: Supply) {
    const take = Math.min(s.amount, Math.max(0, this.supplySpace(p, s.kind)));
    if (take > 0) {
      if (s.kind === 'mun_pistola') p.reserve.pistola += take;
      else if (s.kind === 'mun_fuzil') p.reserve.fuzil += take;
      else p.fuel += take;
      s.amount -= take;
    }
    s.claimedBy = null;
    p.channel = null;
    if (s.amount <= 0) {
      this.supplies.delete(s.id);
      this.supplyRespawnAt.push(this.time + this.supplyRespawn);
    }
    this.broadcastNear(s.x, s.z, { k: 'supply', id: s.id, by: p.id, kind: s.kind, amount: take, x: round2(s.x), z: round2(s.z) });
    this.soundAt('coleta', s.x, s.z);
    this.toPlayer(p.id, { k: 'msg', text: `+${Math.round(take)} ${SUPPLY_INFO[s.kind].name.toLowerCase()}${s.amount > 0 ? ' (limite atingido; o resto ficou na caixa)' : ''}`, tone: 'good' });
  }

  private updateSupplies() {
    // libera caixas reservadas por quem desistiu da coleta (andou, foi atingido, caiu...)
    for (const s of this.supplies.values()) {
      if (!s.claimedBy) continue;
      const p = this.players.get(s.claimedBy);
      if (!p || p.channel?.kind !== 'supply' || p.channel.supply !== s.id) s.claimedBy = null;
    }
    // reposição controlada pelo servidor
    const due = this.supplyRespawnAt.filter((t) => t <= this.time);
    if (due.length) {
      this.supplyRespawnAt = this.supplyRespawnAt.filter((t) => t > this.time);
      for (let i = 0; i < due.length; i++) {
        if (this.supplies.size >= supplyCap(this.nSurv) || !this.spawnSupply(false)) this.supplyRespawnAt.push(this.time + 10); // tenta de novo depois
      }
    }
  }

  // ------------------------------------------------------------------ armas
  private startReload(p: MPlayer) {
    if (p.weapon === 'lanca' || p.reloadUntil > 0) return;
    const def = GUNS[p.weapon];
    if (p.mag[p.weapon] >= def.mag || p.reserve[p.weapon] <= 0) return;
    p.reloadUntil = this.time + def.reload;
    this.soundAt('recarga', p.x, p.z);
  }

  private finishReload(p: MPlayer) {
    const w = p.weapon;
    p.reloadUntil = 0;
    if (w === 'lanca') return;
    const need = GUNS[w].mag - p.mag[w];
    const take = Math.min(need, p.reserve[w]);
    p.mag[w] += take;
    p.reserve[w] -= take;
  }

  private canShoot(p: MPlayer) {
    return p.role === 'survivor' && p.status === 'alive' && !p.hidden && p.channel?.kind !== 'heal' && p.channel?.kind !== 'supply' && !p.sprinting;
  }

  private updateWeapons(p: MPlayer) {
    p.flaming = false;
    if (p.reloadUntil > 0 && this.time >= p.reloadUntil) this.finishReload(p);
    // um clique rápido (apertar e soltar no mesmo tick) ainda conta como 1 disparo,
    // mas o pedido expira em 0,25 s para não disparar "atrasado"
    if (p.triggerFresh && this.time - p.triggerAt > 0.25) p.triggerFresh = false;
    if (!this.canShoot(p)) {
      p.triggerFresh = false;
      return;
    }
    if (!p.trigger && !(p.triggerFresh && p.weapon !== 'lanca')) return;
    if (p.weapon === 'lanca') {
      if (p.fuel <= 0) {
        if (p.triggerFresh) this.toPlayer(p.id, { k: 'sound', s: 'vazio', x: round2(p.x), z: round2(p.z) });
        p.triggerFresh = false;
        return;
      }
      p.fuel = Math.max(0, p.fuel - FLAMER.fuelPerSec * DT);
      p.flaming = true;
      p.firingUntil = this.time + 0.1;
      if (p.channel?.kind === 'station') p.channel = null;
      if (this.tick % 30 === 0) this.pingEntity(p.x, p.z, 'tiro', 2);
      this.flameDamage(p);
      return;
    }
    const def = GUNS[p.weapon];
    if (p.reloadUntil > 0 || this.time < p.nextShot) return;
    if (!def.auto && !p.triggerFresh) return;
    p.triggerFresh = false;
    if (p.mag[p.weapon] <= 0) {
      if (p.reserve[p.weapon] > 0) this.startReload(p);
      else this.toPlayer(p.id, { k: 'sound', s: 'vazio', x: round2(p.x), z: round2(p.z) });
      return;
    }
    p.mag[p.weapon]--;
    p.nextShot = this.time + def.interval;
    p.firingUntil = this.time + 0.12;
    if (p.channel?.kind === 'station') p.channel = null;
    this.fireGun(p, def.id);
    if (p.mag[p.weapon] === 0 && p.reserve[p.weapon] > 0) this.startReload(p);
  }

  /** Disparo instantâneo (hitscan) calculado no servidor: paredes, chão e teto bloqueiam. */
  private fireGun(p: MPlayer, w: 'pistola' | 'fuzil') {
    const def = GUNS[w];
    const eyeY = p.crouch ? 1.0 : 1.5;
    const yaw = p.yaw + this.rng.range(-def.spread, def.spread);
    const pitch = p.pitch + this.rng.range(-def.spread, def.spread) * 0.6;
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    let maxT = def.range;
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) maxT = Math.min(maxT, raycast(this.grid, p.x, p.z, dx, dz, def.range, isOpaque));
    if (dy < -1e-4) maxT = Math.min(maxT, eyeY / -dy);
    if (dy > 1e-4) maxT = Math.min(maxT, (WALL_H - eyeY) / dy);
    const e = this.entity;
    let hitT = Infinity;
    // interseção raio x cilindro vertical (corpo da entidade)
    const ox = p.x - e.x;
    const oz = p.z - e.z;
    const a = dx * dx + dz * dz;
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - ENTITY_HITBOX.radius * ENTITY_HITBOX.radius;
    const disc = b * b - 4 * a * c;
    if (a > 1e-6 && disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t <= 0) continue;
        const y = eyeY + dy * t;
        if (y >= 0 && y <= ENTITY_HITBOX.height) {
          hitT = t;
          break;
        }
      }
    }
    const hit = hitT < maxT;
    const t = hit ? hitT : maxT;
    const ev: GameEvent = { k: 'shot', id: p.id, w, x: round2(p.x), y: round2(eyeY - 0.15), z: round2(p.z), tx: round2(p.x + dx * t), ty: round2(eyeY + dy * t), tz: round2(p.z + dz * t), hit };
    this.broadcastNear(p.x, p.z, ev);
    this.pingEntity(p.x, p.z, 'tiro', 1.5);
    if (hit) this.damageEntity(def.damage, p, { x: p.x + dx * t, y: eyeY + dy * t, z: p.z + dz * t }, true);
  }

  private flameDamage(p: MPlayer) {
    const e = this.entity;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d > FLAMER.range + ENTITY_HITBOX.radius) return;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const dot = d > 0.05 ? ((e.x - p.x) * fx + (e.z - p.z) * fz) / d : 1;
    if (dot < FLAMER.coneCos && d > 1) return;
    if (!lineOfSight(this.grid, p.x, p.z, e.x, e.z)) return;
    e.burnUntil = this.time + FLAMER.burnTime;
    e.burnBy = p.id;
    this.damageEntity(FLAMER.dps * DT, p, { x: e.x, y: 1.3, z: e.z }, this.tick % 8 === 0);
  }

  private damageEntity(amount: number, by: MPlayer, at: { x: number; y: number; z: number }, emit: boolean) {
    const e = this.entity;
    if (this.ended || e.hp <= 0) return;
    amount *= e.mods.damageTakenMult;
    e.hp = Math.max(0, e.hp - amount);
    e.lastDamageAt = this.time;
    e.camo = false;
    e.camoT = 0;
    e.revealUntil = Math.max(e.revealUntil, this.time + 1);
    by.score += amount / 10;
    if (emit) this.broadcastNear(at.x, at.z, { k: 'enthit', x: round2(at.x), y: round2(at.y), z: round2(at.z), dmg: Math.round(amount), by: by.id });
    if (this.time - e.hurtSoundAt > 0.7) {
      e.hurtSoundAt = this.time;
      this.soundAt('dor', e.x, e.z);
    }
    if (e.hp <= 0) {
      by.score += 500;
      for (const o of this.players.values()) if (o.role === 'survivor' && (o.status === 'alive' || o.status === 'downed')) o.score += 200;
      this.broadcast({ k: 'entdeath', x: round2(e.x), z: round2(e.z), by: by.id });
      this.soundAt('morte_entidade', e.x, e.z);
      this.end('survivors', `A entidade foi destruída por ${by.name}.`);
    }
  }

  // ------------------------------------------------------------------ fases
  private activateStage(stage: number, initial = false) {
    this.stage = stage;
    const tasks = this.tasks.filter((t) => t.stage === stage);
    const spawn: ItemKind[] = [];
    for (const t of tasks) if (t.item) for (let i = 0; i < t.required + 1; i++) spawn.push(t.item);
    this.spawnItems(spawn);
    if (stage === 2 && !this.powerOn) {
      this.powerOn = true;
      this.broadcast({ k: 'msg', text: 'Geradores de reserva ativados. As luzes voltaram.', tone: 'info' });
    }
    if (stage === 3) {
      const evac = tasks[0];
      const pod = evac.stations[0];
      for (const d of this.map.doors) if (d.secure && d.group === pod) this.grid.doorOpen[d.idx] = 1;
      const st = this.map.stations.find((s) => s.id === pod)!;
      this.broadcast({ k: 'sound', s: 'alarme', x: st.x, z: st.z });
    }
    if (!initial) {
      const txt = stage === 2 ? 'Fase 2: restabeleçam o contato com a superfície.' : stage === 3 ? 'Fase 3: a doca foi liberada. Preparem a evacuação!' : '';
      this.broadcast({ k: 'stage', stage, text: txt });
    }
  }

  private completeTask(t: Task, by: MPlayer | null) {
    t.done = true;
    if (t.kind === 'energia') this.powerOn = true;
    this.ecoMemory.set('alarme', this.time);
    this.broadcast({ k: 'task', id: t.id, title: t.title });
    const st = this.map.stations.find((s) => s.id === t.stations[0]);
    if (st) this.broadcast({ k: 'sound', s: 'alarme', x: st.x, z: st.z });
    // ressonância da entidade cresce quando os sobreviventes avançam (equilíbrio)
    this.entity.resonance += 1;
    if (t.kind === 'evacuacao') {
      this.podsReady.add(t.stations[0]);
      this.broadcast({ k: 'msg', text: 'A cápsula está pronta! Entrem na doca para fugir.', tone: 'good' });
    }
    const stageTasks = this.tasks.filter((x) => x.stage === this.stage);
    if (stageTasks.every((x) => x.done) && this.stage < 3) this.activateStage(this.stage + 1);
  }

  // ------------------------------------------------------------------ conexão
  setLoaded(id: string) {
    const p = this.players.get(id);
    if (p) p.loaded = true;
  }
  allLoaded() {
    return [...this.players.values()].every((p) => p.loaded || !p.connected);
  }
  start() {
    this.started = true;
  }
  onDisconnect(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = this.time;
    p.queue.length = 0;
    p.interactHeld = false;
    p.channel = null;
  }
  onReconnect(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = true;
    p.loaded = false;
  }
  /** Jogador saiu voluntariamente: conta como desistência. */
  forfeit(id: string) {
    const p = this.players.get(id);
    if (!p || this.ended) return;
    p.connected = false;
    if (p.role === 'entity') this.end('survivors', 'A entidade abandonou a partida.');
    else if (p.status === 'alive' || p.status === 'downed') this.kill(p, 'disconnect');
  }

  // ------------------------------------------------------------------ entrada
  pushInput(id: string, cmds: InputCmd[]) {
    const p = this.players.get(id);
    if (!p || !this.started || this.ended) return;
    for (const c of cmds) {
      if (c.seq <= p.lastSeq) continue; // duplicado ou fora de ordem
      if (p.queue.length && c.seq <= p.queue[p.queue.length - 1].seq) continue;
      p.queue.push(c);
    }
    // antispeedhack: nunca mais que MAX_QUEUED_CMDS aguardando
    if (p.queue.length > MAX_QUEUED_CMDS) {
      const drop = p.queue.splice(0, p.queue.length - MAX_QUEUED_CMDS);
      p.lastSeq = drop[drop.length - 1].seq;
    }
  }

  action(id: string, a: { a: string; on?: boolean; slot?: number; id?: AbilityId; variant?: EcoType }) {
    const p = this.players.get(id);
    if (!p || !this.started || this.ended) return;
    if (p.status === 'dead' || p.status === 'escaped') return;
    switch (a.a) {
      case 'interact':
        if (a.on) {
          p.interactHeld = true;
          this.tryInteract(p);
        } else {
          p.interactHeld = false;
          if (p.channel && p.channel.kind !== 'heal') p.channel = null;
        }
        break;
      case 'flashlight':
        if (p.role === 'survivor' && p.status === 'alive') {
          p.flashlight = !p.flashlight;
        }
        break;
      case 'use':
        if (a.slot !== undefined) this.useItem(p, a.slot);
        break;
      case 'drop':
        if (a.slot !== undefined && p.role === 'survivor' && p.status === 'alive' && !p.hidden) {
          const k = p.inventory[a.slot];
          if (k) {
            p.inventory[a.slot] = null;
            this.dropItem(p, k);
          }
        }
        break;
      case 'attack':
        this.tryAttack(p);
        break;
      case 'fire':
        if (p.role !== 'survivor') return;
        p.trigger = !!a.on;
        if (a.on) {
          p.triggerFresh = true;
          p.triggerAt = this.time;
        }
        break;
      case 'reload':
        if (p.role === 'survivor' && p.status === 'alive') this.startReload(p);
        break;
      case 'weapon':
        if (p.role === 'survivor' && a.slot !== undefined && a.slot < WEAPON_ORDER.length && WEAPON_ORDER[a.slot] !== p.weapon) {
          p.weapon = WEAPON_ORDER[a.slot];
          p.reloadUntil = 0;
          p.nextShot = Math.max(p.nextShot, this.time + 0.3); // tempo para sacar a arma
        }
        break;
      case 'ability':
        if (a.id) this.tryAbility(p, a.id, a.variant);
        break;
    }
  }

  spectate(id: string, dir: 1 | -1) {
    const p = this.players.get(id);
    if (!p || (p.status !== 'dead' && p.status !== 'escaped')) return;
    const alive = [...this.players.values()].filter((o) => o.role === 'survivor' && (o.status === 'alive' || o.status === 'downed'));
    if (!alive.length) return;
    const i = Math.max(0, alive.findIndex((o) => o.id === p.spec));
    p.spec = alive[(i + dir + alive.length) % alive.length].id;
  }

  // ------------------------------------------------------------------ interação
  private stationActive(id: string): { task: Task } | null {
    for (const t of this.tasks) if (t.stage === this.stage && !t.done && t.stations.includes(id) && !t.doneStations.includes(id)) return { task: t };
    return null;
  }

  private tryInteract(p: MPlayer) {
    if (p.stunUntil > this.time) return;
    if (p.role === 'survivor') {
      if (p.status !== 'alive') return;
      if (p.hidden) {
        this.leaveLocker(p);
        return;
      }
      type Cand = { x: number; z: number; prio: number; half?: number; run: () => void };
      const cands: Cand[] = [];
      for (const it of this.items.values())
        cands.push({ x: it.x, z: it.z, prio: 0.6, run: () => this.pickup(p, it) });
      for (const s of this.supplies.values()) cands.push({ x: s.x, z: s.z, prio: 0.7, run: () => this.startCollect(p, s) });
      for (const o of this.players.values())
        if (o !== p && o.role === 'survivor' && o.status === 'downed') cands.push({ x: o.x, z: o.z, prio: 1.2, run: () => this.startChannel(p, { kind: 'revive', target: o.id, label: `Resgatando ${o.name}` }) });
      // portas abrem sozinhas para humanos (ver updateDoors)
      for (const l of this.map.lockers) cands.push({ x: l.x, z: l.z, half: 1, prio: 0.1, run: () => this.enterLocker(p, l.id) });
      for (const s of this.map.stations) {
        const act = this.stationActive(s.id);
        if (!act) continue;
        cands.push({ x: s.x, z: s.z, half: 1, prio: 0.8, run: () => this.useStation(p, s.id, act.task) });
      }
      const t = pickTarget(p.x, p.z, p.yaw, INTERACT_RANGE, cands);
      t?.run();
    } else {
      type Cand = { x: number; z: number; prio: number; half?: number; run: () => void };
      const cands: Cand[] = [];
      for (const d of this.map.doors) if (!d.secure) cands.push({ x: d.x, z: d.z, half: 1, prio: 0, run: () => this.toggleDoor(p, d.idx) });
      for (const l of this.map.lockers) cands.push({ x: l.x, z: l.z, half: 1, prio: 0.2, run: () => this.searchLocker(p, l.id) });
      const t = pickTarget(p.x, p.z, p.yaw, INTERACT_RANGE + 0.3, cands);
      t?.run();
    }
  }

  private pickup(p: MPlayer, it: GroundItem) {
    if (it.kind === 'detector') {
      p.detCharges += DETECTOR_CHARGES;
      if (!p.inventory.includes('detector')) {
        const slot = p.inventory.indexOf(null);
        if (slot < 0) {
          p.detCharges -= DETECTOR_CHARGES;
          this.toPlayer(p.id, { k: 'msg', text: 'Inventário cheio.', tone: 'warn' });
          return;
        }
        p.inventory[slot] = 'detector';
      }
    } else {
      const slot = p.inventory.indexOf(null);
      if (slot < 0) {
        this.toPlayer(p.id, { k: 'msg', text: 'Inventário cheio. Solte algo (segure o número do espaço + G).', tone: 'warn' });
        return;
      }
      p.inventory[slot] = it.kind;
    }
    this.items.delete(it.id);
    this.soundAt('item', it.x, it.z);
    this.toPlayer(p.id, { k: 'msg', text: `Pegou: ${ITEM_INFO[it.kind].name}`, tone: 'info' });
  }

  private toggleDoor(p: MPlayer, idx: number) {
    if ((this.doorLock.get(idx) ?? 0) > this.time) {
      this.toPlayer(p.id, { k: 'msg', text: 'A porta está travada por uma interferência.', tone: 'warn' });
      return;
    }
    const open = this.grid.doorOpen[idx];
    if (open && this.doorOccupied(idx, 0)) return; // não fecha em cima de alguém
    this.grid.doorOpen[idx] = open ? 0 : 1;
    this.doorUse.set(idx, this.time);
    const d = this.map.doors.find((x) => x.idx === idx)!;
    this.soundAt('porta', d.x, d.z);
    if (p.role === 'survivor') {
      this.pingEntity(d.x, d.z, 'porta', 0);
      if (this.near(this.entity, d.x, d.z, 30)) this.ecoMemory.set('porta', this.time);
    }
  }

  /** Alguém (qualquer função) está no vão da porta? margin amplia a área checada. */
  private doorOccupied(idx: number, margin: number) {
    const cx = idx % this.map.w;
    const cz = Math.floor(idx / this.map.w);
    for (const o of this.players.values()) {
      if (o.status === 'dead' || o.status === 'escaped' || o.hidden) continue;
      const r = (o.role === 'entity' ? ENT.radius : PLAYER_RADIUS) + margin;
      if (o.x + r > cx * CELL && o.x - r < (cx + 1) * CELL && o.z + r > cz * CELL && o.z - r < (cz + 1) * CELL) return true;
    }
    return false;
  }

  /**
   * Portas automáticas: abrem quando um humano se aproxima e fecham sozinhas
   * 1,5 s depois que ninguém mais está perto — nunca em cima de alguém. A
   * entidade não aciona o sensor (precisa abrir com a interação). Portas de
   * segurança e portas travadas pelo Parasita mantêm suas regras.
   */
  private updateDoors() {
    for (const d of this.map.doors) {
      if (d.secure) continue;
      const idx = d.idx;
      if ((this.doorLock.get(idx) ?? 0) > this.time) continue;
      let human = false;
      for (const o of this.players.values()) {
        if (o.role !== 'survivor' || o.hidden || (o.status !== 'alive' && o.status !== 'downed') || !o.connected) continue;
        if (Math.hypot(Math.max(Math.abs(o.x - d.x) - CELL / 2, 0), Math.max(Math.abs(o.z - d.z) - CELL / 2, 0)) <= AUTO_DOOR_RANGE) {
          human = true;
          break;
        }
      }
      const open = this.grid.doorOpen[idx] === 1;
      if (human) {
        this.doorUse.set(idx, this.time);
        if (!open) {
          this.grid.doorOpen[idx] = 1;
          this.soundAt('porta', d.x, d.z);
          this.pingEntity(d.x, d.z, 'porta', 0);
          if (this.near(this.entity, d.x, d.z, 30)) this.ecoMemory.set('porta', this.time);
        }
      } else if (open && this.time - (this.doorUse.get(idx) ?? -99) >= AUTO_DOOR_CLOSE_DELAY && !this.doorOccupied(idx, 0.25)) {
        this.grid.doorOpen[idx] = 0;
        this.soundAt('porta', d.x, d.z);
      }
    }
  }

  private enterLocker(p: MPlayer, lockerId: string) {
    for (const o of this.players.values()) if (o.hidden === lockerId) return; // ocupado
    const l = this.map.lockers.find((x) => x.id === lockerId)!;
    p.hidden = lockerId;
    p.hiddenFor = 0;
    p.x = l.x;
    p.z = l.z;
    p.channel = null;
    p.flashlight = false;
    p.stats.timesHidden = (p.stats.timesHidden ?? 0) + 1;
    this.soundAt('armario', l.x, l.z);
  }
  private leaveLocker(p: MPlayer) {
    const l = this.map.lockers.find((x) => x.id === p.hidden)!;
    p.hidden = null;
    p.x = l.outX;
    p.z = l.outZ;
    p.yaw = l.facing;
    this.soundAt('armario', l.x, l.z);
  }
  private searchLocker(e: MPlayer, lockerId: string) {
    const l = this.map.lockers.find((x) => x.id === lockerId)!;
    this.soundAt('armario', l.x, l.z);
    const victim = [...this.players.values()].find((o) => o.hidden === lockerId);
    if (!victim) {
      e.stunUntil = this.time + ENT.lockerWrongStun;
      return;
    }
    victim.hidden = null;
    victim.x = l.outX;
    victim.z = l.outZ;
    this.damage(victim, e);
    e.attackCd = ENT.attackCooldownHit;
  }

  private useStation(p: MPlayer, stationId: string, task: Task) {
    if (task.item && task.deliverTo === stationId) {
      let n = 0;
      for (let i = 0; i < p.inventory.length; i++) {
        if (p.inventory[i] === task.item && task.count < task.required) {
          p.inventory[i] = null;
          task.count++;
          n++;
        }
      }
      if (!n) {
        this.toPlayer(p.id, { k: 'msg', text: `Você precisa de: ${ITEM_INFO[task.item].name}.`, tone: 'warn' });
        return;
      }
      p.stats.itemsDelivered = (p.stats.itemsDelivered ?? 0) + n;
      p.score += 60 * n;
      const st = this.map.stations.find((s) => s.id === stationId)!;
      this.soundAt('entrega', st.x, st.z);
      if (task.count >= task.required) {
        p.stats.objectives = (p.stats.objectives ?? 0) + 1;
        p.score += 150;
        this.completeTask(task, p);
      }
      return;
    }
    if (task.channelTime > 0) {
      const st = this.map.stations.find((s) => s.id === stationId)!;
      this.startChannel(p, { kind: 'station', station: stationId, label: st.label });
    }
  }

  private startChannel(p: MPlayer, ch: Channel) {
    p.channel = ch;
    p.channelT = 0;
  }

  // ------------------------------------------------------------------ itens usáveis
  private useItem(p: MPlayer, slot: number) {
    if (p.role !== 'survivor' || p.status !== 'alive' || p.hidden) return;
    const k = p.inventory[slot];
    if (!k) return;
    if (k === 'kit') {
      if (p.hp >= SURV.hpMax) {
        this.toPlayer(p.id, { k: 'msg', text: 'Você não está ferido.', tone: 'info' });
        return;
      }
      p.channel = { kind: 'heal', label: 'Aplicando kit médico' };
      p.channelT = 0;
    } else if (k === 'detector') {
      if (p.detectorCd > this.time || p.detCharges <= 0) return;
      p.detCharges--;
      p.detectorCd = this.time + 6;
      if (p.detCharges <= 0) p.inventory[slot] = null;
      const e = this.entity;
      const fakes = this.fakeEchoes.filter((f) => f.until > this.time && this.near(p, f.x, f.z, 18)).map((f) => [round2(f.x), round2(f.z)] as [number, number]);
      let ex = NaN;
      let ez = NaN;
      if (this.near(p, e.x, e.z, DETECTOR_RANGE)) {
        ex = e.x + this.rng.range(-DETECTOR_JITTER, DETECTOR_JITTER);
        ez = e.z + this.rng.range(-DETECTOR_JITTER, DETECTOR_JITTER);
        e.revealUntil = this.time + 3;
      }
      for (const o of this.players.values()) if (o.role === 'survivor') this.toPlayer(o.id, { k: 'detector', x: round2(ex), z: round2(ez), fakes, by: p.name });
      this.soundAt('detector', p.x, p.z);
    } else if (k === 'sinalizador') {
      p.inventory[slot] = null;
      this.flares.push({ x: p.x, z: p.z, until: this.time + FLARE_TIME });
      this.soundAt('sinalizador', p.x, p.z);
    }
  }

  // ------------------------------------------------------------------ entidade
  private tryAttack(e: MPlayer) {
    if (e.role !== 'entity') return;
    if (e.attackCd > 0 || e.attackPhase !== 'none' || e.active.ruptura > 0 || e.stunUntil > this.time) return;
    e.attackPhase = 'windup';
    e.attackT = ENT.attackWindup;
    e.camo = false;
    e.camoT = 0;
    this.broadcastNear(e.x, e.z, { k: 'attack', id: e.id });
    this.soundAt('ataque', e.x, e.z);
  }

  private resolveAttack(e: MPlayer) {
    const [fx, fz] = forwardVec(e.yaw);
    let best: MPlayer | null = null;
    let bestD = Infinity;
    for (const o of this.players.values()) {
      if (o.role !== 'survivor' || o.hidden || (o.status !== 'alive' && o.status !== 'downed')) continue;
      const dx = o.x - e.x;
      const dz = o.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > (e.heavy ? ENT.specialRange : ENT.attackRange) + PLAYER_RADIUS) continue;
      const dot = d > 0.05 ? (dx * fx + dz * fz) / d : 1;
      if (dot < (e.heavy ? ENT.specialArcCos : ENT.attackArcCos) && d > 0.9) continue;
      if (!lineOfSight(this.grid, e.x, e.z, o.x, o.z)) continue;
      // preferir alvos em pé
      const score = d + (o.status === 'downed' ? 1.5 : 0);
      if (score < bestD) {
        bestD = score;
        best = o;
      }
    }
    if (!best) {
      e.attackCd = ENT.attackCooldownMiss;
      return;
    }
    // um único alvo por golpe: a animação não acerta duas vezes
    this.damage(best, e);
    e.attackCd = ENT.attackCooldownHit;
  }

  private damage(o: MPlayer, e: MPlayer) {
    if (o.status === 'downed') {
      e.stats.kills = (e.stats.kills ?? 0) + 1;
      e.score += 300;
      e.resonance += 2;
      this.kill(o, 'entity');
      return;
    }
    const base = e.heavy ? ENT.specialDamage : ENT.attackDamage;
    o.hp = Math.max(0, o.hp - Math.round(base * e.mods.attackMult * o.mods.damageTakenMult * 10) / 10);
    e.stats.hits = (e.stats.hits ?? 0) + 1;
    e.score += 100;
    e.resonance += 1;
    e.slowUntil = this.time + ENT.hitSlow;
    o.channel = null;
    this.broadcastNear(o.x, o.z, { k: 'hit', target: o.id, by: e.id, x: round2(o.x), z: round2(o.z) });
    this.soundAt('grito', o.x, o.z);
    this.toPlayer(o.id, { k: 'jumpscare' });
    if (o.hp <= 0) {
      o.hp = 0;
      o.status = 'downed';
      o.bleed = SURV.bleedout;
      o.flashlight = false;
      e.stats.downs = (e.stats.downs ?? 0) + 1;
      e.score += 150;
      e.resonance += 1;
      this.broadcast({ k: 'down', target: o.id });
      this.soundAt('queda', o.x, o.z);
    } else {
      o.hasteUntil = this.time + SURV.hasteAfterHit;
    }
  }

  private kill(o: MPlayer, cause: 'entity' | 'bleed' | 'collapse' | 'disconnect') {
    o.status = 'dead';
    o.hp = 0;
    o.channel = null;
    o.hidden = null;
    o.outcome = cause === 'disconnect' ? 'disconnected' : 'dead';
    o.stats.deaths = (o.stats.deaths ?? 0) + 1;
    for (let i = 0; i < o.inventory.length; i++) {
      const k = o.inventory[i];
      if (k) this.dropItem(o, k);
      o.inventory[i] = null;
    }
    this.broadcast({ k: 'death', target: o.id, cause });
    this.spectate(o.id, 1);
  }

  private tryAbility(e: MPlayer, id: AbilityId, variant?: EcoType) {
    if (e.role !== 'entity' || e.stunUntil > this.time || e.attackPhase !== 'none') return;
    if (e.cd[id] > 0 || e.active[id] > 0) return;
    const def = ABILITIES[id];
    const lvl = this.resonanceLevel(e);
    const cdMult = ENT.levelCooldownMult[lvl - 1];
    if (id === 'golpe') {
      if (e.attackCd > 0 || e.active.ruptura > 0) return;
      e.attackPhase = 'special';
      e.attackT = ENT.specialWindup;
      e.heavy = true;
      e.camo = false;
      e.camoT = 0;
      this.broadcastNear(e.x, e.z, { k: 'attack', id: e.id });
      this.soundAt('ataque', e.x, e.z);
    }
    switch (id) {
      case 'golpe':
        break;
      case 'rastro':
        e.active.rastro = def.duration;
        break;
      case 'eco': {
        const v = variant ?? 'passos';
        const recorded = this.ecoMemory.get(v);
        if (recorded === undefined || this.time - recorded > ECO_MEMORY) return;
        if (v === 'presenca' && !this.presenceSource) return;
        const [fx, fz] = forwardVec(e.yaw);
        const t = raycast(this.grid, e.x, e.z, fx, fz, ECO_RANGE, isSolid);
        const dist = Math.max(1, t - 1);
        const x = e.x + fx * dist;
        const z = e.z + fz * dist;
        this.fakeEchoes.push({ x, z, until: this.time + 6 });
        e.stats.echoes = (e.stats.echoes ?? 0) + 1;
        if (v === 'presenca') {
          const src = this.players.get(this.presenceSource!)!;
          // a presença "olha" para o sobrevivente mais próximo
          let yaw = e.yaw;
          let bd = Infinity;
          for (const o of this.players.values())
            if (o.role === 'survivor' && o.status === 'alive') {
              const d = dist2(o.x, o.z, x, z);
              if (d < bd) {
                bd = d;
                yaw = Math.atan2(-(o.x - x), -(o.z - z));
              }
            }
          for (const o of this.players.values())
            if (o.role === 'survivor' && this.near(this.viewPos(o), x, z, VIEW_RANGE)) this.toPlayer(o.id, { k: 'presence', x: round2(x), z: round2(z), yaw: round2(yaw), loadout: src.loadout, dur: 2.5 });
          this.soundAt('passos', x, z, this.fakeDetune());
        } else {
          const s: SoundKind = v === 'passos' ? 'passos' : v === 'porta' ? 'porta' : v === 'radio' ? 'radio' : 'alarme';
          this.soundAt(s, x, z, this.fakeDetune());
        }
        e.active.eco = def.duration;
        break;
      }
      case 'ruptura':
        e.active.ruptura = def.duration;
        e.camo = false;
        e.camoT = 0;
        this.soundAt('ruptura', e.x, e.z);
        break;
      case 'parasita': {
        e.active.parasita = def.duration;
        for (const s of this.map.stations) {
          if (s.kind === 'pod' && this.podsReady.has(s.id)) continue;
          if (this.near(e, s.x, s.z, PARASITA_RADIUS)) this.jamUntil.set(s.id, this.time + def.duration);
        }
        for (const d of this.map.doors) if (!d.secure && this.near(e, d.x, d.z, PARASITA_RADIUS)) this.doorLock.set(d.idx, this.time + PARASITA_DOOR_LOCK);
        for (const zn of this.map.zones) {
          const cx = Math.max(zn.x0 * CELL, Math.min(e.x, (zn.x1 + 1) * CELL));
          const cz = Math.max(zn.z0 * CELL, Math.min(e.z, (zn.z1 + 1) * CELL));
          if (this.near(e, cx, cz, PARASITA_RADIUS)) this.zoneDark.set(zn.id, this.time + def.duration);
        }
        for (const o of this.players.values()) if (o.role === 'survivor' && this.near(e, o.x, o.z, PARASITA_RADIUS)) o.flickerUntil = this.time + PARASITA_FLASHLIGHT;
        this.broadcastNear(e.x, e.z, { k: 'parasite', x: round2(e.x), z: round2(e.z), r: PARASITA_RADIUS });
        this.soundAt('parasita', e.x, e.z);
        break;
      }
    }
    e.cd[id] = def.cooldown * cdMult * e.mods.cooldownMult;
    if (e.active[id] > 0) e.active[id] *= e.mods.durationMult;
    this.broadcastNear(e.x, e.z, { k: 'ability', id: e.id, a: id });
  }

  /** Ecos falsos têm uma afinação levemente diferente (sobrepõe-se em parte à dos sons reais). */
  private fakeDetune() {
    return round2(this.rng.next() < 0.5 ? this.rng.range(0.86, 0.97) : this.rng.range(1.03, 1.12));
  }

  resonanceLevel(e: MPlayer) {
    let lvl = 1;
    ENT.resonanceLevels.forEach((pts, i) => {
      if (e.resonance >= pts) lvl = i + 1;
    });
    return lvl;
  }

  // ------------------------------------------------------------------ eventos
  private queue(id: string, ev: GameEvent) {
    let q = this.events.get(id);
    if (!q) this.events.set(id, (q = []));
    q.push(ev);
  }
  private toPlayer(id: string, ev: GameEvent) {
    this.queue(id, ev);
  }
  private broadcast(ev: GameEvent) {
    for (const p of this.players.values()) this.queue(p.id, ev);
  }
  private broadcastNear(x: number, z: number, ev: GameEvent, range = EVENT_SOUND_RANGE) {
    for (const p of this.players.values()) {
      const v = this.viewPos(p);
      if (dist2(v.x, v.z, x, z) <= range * range) this.queue(p.id, ev);
    }
  }
  private soundAt(s: SoundKind, x: number, z: number, v?: number) {
    const ev: GameEvent = { k: 'sound', s, x: round2(x), z: round2(z) };
    if (v === undefined && s !== 'grito' && s !== 'queda') ev.v = round2(this.rng.range(0.94, 1.06));
    else if (v !== undefined) ev.v = v;
    this.broadcastNear(x, z, ev);
  }
  private pingEntity(x: number, z: number, kind: 'corrida' | 'objetivo' | 'armario' | 'porta' | 'ferido' | 'tiro', jitter: number) {
    const e = this.entity;
    if (!this.near(e, x, z, NOISE.pingRange)) return;
    this.toPlayer(e.id, { k: 'ping', x: round2(x + this.rng.range(-jitter, jitter)), z: round2(z + this.rng.range(-jitter, jitter)), kind });
  }
  private near(p: { x: number; z: number }, x: number, z: number, r: number) {
    return dist2(p.x, p.z, x, z) <= r * r;
  }
  /** Posição de onde o jogador "enxerga" (espectadores usam o alvo assistido). */
  private viewPos(p: MPlayer): { x: number; z: number } {
    if ((p.status === 'dead' || p.status === 'escaped') && p.spec) {
      const t = this.players.get(p.spec);
      if (t) return t;
    }
    return p;
  }

  // ------------------------------------------------------------------ simulação
  update() {
    if (!this.started || this.ended) return;
    this.tick++;
    this.time += DT;
    const e = this.entity;

    for (const p of this.players.values()) this.updatePlayer(p);

    // canalização (estações acumulam com vários jogadores)
    const perStation = new Map<string, MPlayer[]>();
    for (const p of this.players.values()) {
      if (!p.channel) continue;
      const ch = p.channel;
      if (ch.kind === 'station') {
        const st = this.map.stations.find((s) => s.id === ch.station)!;
        if (!this.near(p, st.x, st.z, INTERACT_RANGE + 0.4) || !this.stationActive(st.id)) {
          p.channel = null;
          continue;
        }
        let arr = perStation.get(st.id);
        if (!arr) perStation.set(st.id, (arr = []));
        arr.push(p);
      } else if (ch.kind === 'revive') {
        const t = this.players.get(ch.target);
        if (!t || t.status !== 'downed' || !this.near(p, t.x, t.z, INTERACT_RANGE + 0.4)) {
          p.channel = null;
          continue;
        }
        p.channelT += DT * p.mods.interactMult;
        if (p.channelT >= SURV.reviveTime) {
          t.status = 'alive';
          t.hp = SURV.reviveHp;
          t.bleed = 0;
          p.channel = null;
          p.stats.revives = (p.stats.revives ?? 0) + 1;
          p.score += 200;
          this.broadcast({ k: 'revive', target: t.id, by: p.id });
          this.soundAt('cura', t.x, t.z);
        }
      } else if (ch.kind === 'supply') {
        const s = this.supplies.get(ch.supply);
        if (!s || s.claimedBy !== p.id || !this.near(p, s.x, s.z, INTERACT_RANGE + 0.4)) {
          p.channel = null;
          continue;
        }
        p.channelT += DT * p.mods.interactMult;
        if (p.channelT >= SUPPLY_COLLECT_TIME) this.finishCollect(p, s);
      } else if (ch.kind === 'heal') {
        p.channelT += DT * p.mods.interactMult;
        if (p.channelT >= SURV.medkitTime) {
          const slot = p.inventory.indexOf('kit');
          if (slot >= 0) {
            p.inventory[slot] = null;
            p.hp = Math.min(SURV.hpMax, p.hp + SURV.medkitHeal);
            p.stats.heals = (p.stats.heals ?? 0) + 1;
            p.score += 50;
            this.soundAt('cura', p.x, p.z);
          }
          p.channel = null;
        }
      }
    }
    for (const [sid, ps] of perStation) {
      const act = this.stationActive(sid);
      if (!act) continue;
      const t = act.task;
      const jammed = (this.jamUntil.get(sid) ?? 0) > this.time;
      if (jammed) continue;
      const speed = ps.reduce((a, p) => a + p.mods.interactMult, 0) / ps.length;
      const rate = (1 + 0.5 * (ps.length - 1)) * speed;
      t.progress[sid] = (t.progress[sid] ?? 0) + DT * Math.min(2 * speed, rate);
      for (const p of ps) {
        p.channelT = t.progress[sid] / t.channelTime;
        if (this.tick % Math.round(NOISE.channelEvery / DT) === 0) this.pingEntity(p.x, p.z, 'objetivo', NOISE.channelJitter);
        if ((t.kind === 'transmissores' || t.kind === 'comunicacao') && this.near(e, p.x, p.z, 40)) this.ecoMemory.set('radio', this.time);
      }
      if (t.progress[sid] >= t.channelTime) {
        t.doneStations.push(sid);
        for (const p of ps) {
          p.channel = null;
          p.stats.objectives = (p.stats.objectives ?? 0) + (t.doneStations.length >= t.required ? 1 : 0);
          p.score += 120;
        }
        const st = this.map.stations.find((s) => s.id === sid)!;
        this.soundAt('entrega', st.x, st.z);
        if (t.doneStations.length >= t.required) this.completeTask(t, ps[0]);
      }
    }

    this.updateSupplies();

    // fuga
    for (const pod of this.podsReady) {
      const r = this.map.exits[pod];
      for (const p of this.players.values()) {
        if (p.role !== 'survivor' || p.status !== 'alive' || p.hidden) continue;
        if (p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1) {
          p.status = 'escaped';
          p.outcome = 'escaped';
          p.channel = null;
          p.stats.escapes = (p.stats.escapes ?? 0) + 1;
          p.score += 500;
          this.broadcast({ k: 'escape', target: p.id });
          this.soundAt('escotilha', p.x, p.z);
          this.spectate(p.id, 1);
        }
      }
    }

    // limpezas
    this.flares = this.flares.filter((f) => f.until > this.time);
    this.fakeEchoes = this.fakeEchoes.filter((f) => f.until > this.time);
    for (const [k, v] of this.ecoMemory) if (this.time - v > ECO_MEMORY && k !== 'passos') this.ecoMemory.delete(k);

    this.checkEnd();

    if (!this.ended) this.updateDoors();
    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    for (const [id, evs] of this.events) {
      if (evs.length) this.hooks.send(id, { t: 'ev', e: evs });
    }
    this.events.clear();
  }

  private moveParams(p: MPlayer): MoveParams {
    if (p.role === 'entity') {
      const lvl = this.resonanceLevel(p);
      let mult = ENT.levelSpeedMult[lvl - 1];
      if (p.active.ruptura > 0) mult *= RUPTURA_MULT;
      else if (p.recoverUntil > this.time) mult *= 0.6;
      if (p.slowUntil > this.time) mult *= ENT.hitSlowMult;
      if (p.attackPhase === 'special') mult *= 0.5;
      mult *= p.mods.speedMult;
      return { walk: ENT.speed, sprint: ENT.speed, crouch: ENT.stalkSpeed, mult, radius: ENT.radius, useStamina: false, canMove: p.stunUntil <= this.time, canSprint: false };
    }
    if (p.status === 'downed') return { walk: SURV.crawl, sprint: SURV.crawl, crouch: SURV.crawl, mult: 1, radius: PLAYER_RADIUS, useStamina: false, canMove: true, canSprint: false };
    const alive = p.status === 'alive' && !p.hidden;
    return {
      walk: SURV.walk,
      sprint: SURV.sprint,
      crouch: SURV.crouch,
      mult: (p.hasteUntil > this.time ? SURV.hasteMult : 1) * p.mods.speedMult,
      radius: PLAYER_RADIUS,
      useStamina: true,
      canMove: alive,
      canSprint: alive,
      staminaMax: p.mods.staminaMax,
      staminaRegenMult: p.mods.staminaRegenMult,
    };
  }

  private updatePlayer(p: MPlayer) {
    // desconexão prolongada
    if (!p.connected && this.time - p.disconnectedAt > RECONNECT_GRACE) {
      if (p.role === 'entity') return this.end('survivors', 'A entidade se desconectou.');
      if (p.status === 'alive' || p.status === 'downed') this.kill(p, 'disconnect');
    }
    if (p.status === 'dead' || p.status === 'escaped') {
      p.queue.length = 0;
      if (p.spec) {
        const t = this.players.get(p.spec);
        if (!t || (t.status !== 'alive' && t.status !== 'downed')) this.spectate(p.id, 1);
      }
      return;
    }

    // movimento: no máximo 1 comando por tick em média (+ rajada limitada)
    p.budget = Math.min(CMD_BUDGET_CAP, p.budget + 1);
    const params = this.moveParams(p);
    while (p.budget >= 1 && p.queue.length) {
      const cmd = p.queue.shift()!;
      p.budget -= 1;
      p.lastSeq = cmd.seq;
      if (p.hidden) {
        p.yaw = cmd.yaw;
        p.pitch = cmd.pitch;
        continue;
      }
      stepMove(this.grid, p, cmd, params);
      // mover-se cancela canalização e cura
      if (p.channel && p.speed > 0.4) p.channel = null;
    }
    if (!p.queue.length && p.budget >= 1) p.speed = 0;

    if (p.role === 'survivor') this.updateSurvivor(p);
    else this.updateEntity(p);
  }

  private updateSurvivor(p: MPlayer) {
    const e = this.entity;
    if (p.status === 'downed') {
      p.bleed -= DT;
      // ninguém resgatando? sangra; com alguém resgatando o tempo pausa
      const helped = [...this.players.values()].some((o) => o.channel?.kind === 'revive' && o.channel.target === p.id);
      if (helped) p.bleed += DT;
      if (p.bleed <= 0) this.kill(p, 'bleed');
      return;
    }
    this.updateWeapons(p);
    if (p.hidden) {
      p.hiddenFor += DT;
      if (p.hiddenFor > SURV.lockerPressure && this.tick % Math.round(NOISE.lockerEvery / DT) === 0) this.pingEntity(p.x, p.z, 'armario', NOISE.lockerJitter);
    }
    // ruído de corrida
    p.noiseT -= DT;
    if (p.sprinting && p.noiseT <= 0) {
      p.noiseT = NOISE.sprintEvery;
      this.pingEntity(p.x, p.z, 'corrida', NOISE.sprintJitter);
      if (this.near(e, p.x, p.z, 25)) this.ecoMemory.set('passos', this.time);
    }
    if (p.hp <= SURV.woundedHp && p.noiseT <= -3) {
      p.noiseT = 0;
      this.pingEntity(p.x, p.z, 'ferido', 4);
    }
    // histórico para o RASTRO (agachado não deixa rastro)
    p.trailT -= DT;
    if (p.trailT <= 0) {
      p.trailT = 0.4;
      if (!p.crouch && !p.hidden && p.speed > 0.3) p.trail.push({ x: p.x, z: p.z, t: this.time });
      while (p.trail.length && this.time - p.trail[0].t > RASTRO_HISTORY) p.trail.shift();
    }
    // a entidade "grava" a aparência de quem ela vê de perto (Eco Biológico)
    if (!p.hidden && this.near(e, p.x, p.z, 20) && this.tick % 10 === 0 && lineOfSight(this.grid, e.x, e.z, p.x, p.z)) {
      this.presenceSource = p.id;
      this.ecoMemory.set('presenca', this.time);
    }
  }

  private updateEntity(e: MPlayer) {
    // queimadura do lança-chamas e regeneração
    if (e.burnUntil > this.time) {
      const by = this.players.get(e.burnBy ?? '') ?? e;
      this.damageEntity(FLAMER.burnDps * DT, by, { x: e.x, y: 1.3, z: e.z }, false);
      if (this.ended) return;
    } else if (e.hp < e.maxHp && this.time - e.lastDamageAt > ENTITY_REGEN_DELAY) {
      e.hp = Math.min(e.maxHp, e.hp + ENTITY_REGEN * DT);
    }
    if (e.attackCd > 0) e.attackCd = Math.max(0, e.attackCd - DT);
    if (e.attackPhase !== 'none') {
      e.attackT -= DT;
      if (e.attackT <= 0) {
        e.attackPhase = 'none';
        this.resolveAttack(e);
        e.heavy = false;
      }
    }
    for (const id of Object.keys(e.cd) as AbilityId[]) {
      if (e.cd[id] > 0) e.cd[id] = Math.max(0, e.cd[id] - DT);
      if (e.active[id] > 0) {
        e.active[id] = Math.max(0, e.active[id] - DT);
        if (id === 'ruptura' && e.active[id] === 0) e.recoverUntil = this.time + RUPTURA_RECOVER;
      }
    }
    // camuflagem: parado ou espreitando por alguns segundos
    const inFlare = this.flares.some((f) => this.near(e, f.x, f.z, FLARE_RADIUS));
    if (e.speed <= ENT.camoMaxSpeed && e.attackPhase === 'none' && e.active.ruptura === 0 && !inFlare && e.revealUntil <= this.time) {
      e.camoT += DT;
      if (e.camoT >= ENT.camoDelay) e.camo = true;
    } else {
      e.camoT = 0;
      e.camo = false;
    }
  }

  private checkEnd() {
    if (this.ended) return;
    const surv = [...this.players.values()].filter((p) => p.role === 'survivor');
    if (this.time >= this.duration) {
      for (const p of surv) if (p.status === 'alive' || p.status === 'downed') this.kill(p, 'collapse');
      return this.finish('O complexo colapsou sob a pressão.');
    }
    if (surv.every((p) => p.status === 'dead' || p.status === 'escaped')) this.finish(surv.some((p) => p.status === 'escaped') ? 'Todos os sobreviventes saíram do complexo.' : 'Nenhum sobrevivente restou.');
  }

  private finish(reason: string) {
    const surv = [...this.players.values()].filter((p) => p.role === 'survivor');
    const escaped = surv.filter((p) => p.status === 'escaped').length;
    const needed = Math.ceil(surv.length / 2);
    this.end(escaped >= needed ? 'survivors' : 'entity', reason);
  }

  private end(winner: 'survivors' | 'entity', reason: string) {
    if (this.ended) return;
    this.ended = true;
    const surv = [...this.players.values()].filter((p) => p.role === 'survivor');
    const escaped = surv.filter((p) => p.status === 'escaped').length;
    const needed = Math.ceil(surv.length / 2);
    const out = new Map<string, { role: Role; stats: Partial<Stats>; result: PlayerResult }>();
    const players: PlayerResult[] = [];
    for (const p of this.players.values()) {
      const won = (p.role === 'entity') === (winner === 'entity');
      if (p.role === 'entity') {
        p.outcome = 'entity';
        if (won) p.score += 500;
        p.stats.entityMatches = 1;
        if (won) p.stats.entityWins = 1;
      } else {
        if (!p.outcome) p.outcome = p.status === 'escaped' ? 'escaped' : p.status === 'dead' ? 'dead' : 'survived';
        p.stats.survivorMatches = 1;
        if (won) p.stats.survivorWins = 1;
        p.score += Math.floor(this.time / 2);
      }
      p.stats.matches = 1;
      p.stats.playSeconds = Math.floor(this.time);
    }
    // MVP: maior pontuação entre quem ficou até o fim
    let mvp: MPlayer | null = null;
    for (const p of this.players.values()) if (p.outcome !== 'disconnected' && (!mvp || p.score > mvp.score)) mvp = p;
    for (const p of this.players.values()) {
      const won = (p.role === 'entity') === (winner === 'entity');
      const parts: { label: string; xp: number }[] = [];
      if (p.outcome !== 'disconnected') {
        parts.push({ label: 'Participação', xp: 50 });
        parts.push({ label: 'Desempenho', xp: Math.round(p.score / 5) });
        if (won) parts.push({ label: 'Vitória', xp: 100 });
        if (p.outcome === 'escaped') parts.push({ label: 'Fuga', xp: 60 });
        else if (p.outcome === 'survived') parts.push({ label: 'Sobrevivência', xp: 40 });
        if (p === mvp && p.score > 0) {
          const sub = parts.reduce((a, b) => a + b.xp, 0);
          parts.push({ label: 'MVP (+20%)', xp: Math.round(sub * 0.2) });
        }
      }
      const xp = parts.reduce((a, b) => a + b.xp, 0);
      const coins = Math.round(xp / 4);
      const r: PlayerResult = { id: p.id, name: p.name, role: p.role, outcome: p.outcome!, score: p.score, xp, coins, xpParts: parts, mvp: p === mvp && p.score > 0 };
      players.push(r);
      out.set(p.id, { role: p.role, stats: p.stats, result: r });
    }
    const results: MatchResults = { matchId: this.id, winner, reason, duration: Math.floor(this.time), escaped, needed, players };
    this.sendSnapshots();
    for (const [id, evs] of this.events) if (evs.length) this.hooks.send(id, { t: 'ev', e: evs });
    this.events.clear();
    this.hooks.onEnd(results, out);
  }

  // ------------------------------------------------------------------ snapshots
  private flags(p: MPlayer): number {
    let f = 0;
    if (p.crouch) f |= PF.CROUCH;
    if (p.sprinting) f |= PF.SPRINT;
    if (p.flashlight && p.status === 'alive') f |= PF.FLASH;
    if (p.flickerUntil > this.time) f |= PF.FLICKER;
    if (p.status === 'downed') f |= PF.DOWNED;
    if (p.hidden) f |= PF.HIDDEN;
    if (p.camo) f |= PF.CAMO;
    if (p.active.ruptura > 0) f |= PF.DASH;
    if (p.attackPhase !== 'none') f |= PF.ATTACK;
    if (p.channel && p.channel.kind !== 'heal') f |= PF.CHANNEL;
    if (p.channel?.kind === 'heal') f |= PF.HEALING;
    if (p.hp <= SURV.woundedHp && p.status === 'alive') f |= PF.WOUNDED;
    if (p.status === 'dead') f |= PF.DEAD;
    if (p.status === 'escaped') f |= PF.ESCAPED;
    if (!p.connected) f |= PF.DISCONNECTED;
    if (p.firingUntil > this.time) f |= PF.FIRE;
    if (p.role === 'survivor') {
      if (p.weapon === 'fuzil') f |= PF.WPN_RIFLE;
      if (p.weapon === 'lanca') f |= PF.WPN_FLAME;
      if (p.reloadUntil > 0) f |= PF.RELOAD;
      if (p.channel?.kind === 'supply') f |= PF.COLLECT;
    } else if (p.burnUntil > this.time) f |= PF.BURNING;
    return f;
  }

  private visibleTo(viewer: MPlayer, o: MPlayer): boolean {
    if (o === viewer) return true;
    if (o.status === 'dead' || o.status === 'escaped') return false;
    const v = this.viewPos(viewer);
    const viewerIsEntity = viewer.role === 'entity' && viewer.status !== 'dead';
    if (viewerIsEntity) {
      if (o.hidden) return false;
      const d2 = dist2(v.x, v.z, o.x, o.z);
      if (d2 < 36) return true;
      if (d2 > VIEW_RANGE * VIEW_RANGE) return false;
      return this.losCached(viewer, o, v);
    }
    // sobrevivente (ou espectador) vendo:
    if (o.role === 'survivor') return true; // aliados sempre
    const d2 = dist2(v.x, v.z, o.x, o.z);
    if (d2 < ENTITY_AUDIBLE_RADIUS * ENTITY_AUDIBLE_RADIUS) return true;
    if (d2 > VIEW_RANGE * VIEW_RANGE) return false;
    return this.losCached(viewer, o, v);
  }

  /** LOS com "memória" curta (0,4 s) para evitar piscar na borda das paredes. */
  private losCached(viewer: MPlayer, o: MPlayer, v: { x: number; z: number }) {
    if (lineOfSight(this.grid, v.x, v.z, o.x, o.z)) {
      o.lastSeenBy.set(viewer.id, this.time);
      return true;
    }
    return this.time - (o.lastSeenBy.get(viewer.id) ?? -99) < 0.4;
  }

  private sendSnapshots() {
    const e = this.entity;
    const doors: number[] = [];
    const locked: number[] = [];
    for (const d of this.map.doors) {
      if (this.grid.doorOpen[d.idx]) doors.push(d.idx);
      if ((this.doorLock.get(d.idx) ?? 0) > this.time) locked.push(d.idx);
    }
    const lights: Record<string, number> = {};
    for (const zn of this.map.zones) lights[zn.id] = (this.zoneDark.get(zn.id) ?? 0) > this.time ? 2 : this.powerOn ? 1 : 0;
    const tasks = this.tasks.filter((t) => t.stage <= this.stage).map((t) => taskView(t, this.stage));
    const jam = [...this.jamUntil.entries()].filter(([, t]) => t > this.time).map(([id]) => id);
    const flares = this.flares.map((f) => [round2(f.x), round2(f.z), round2(f.until - this.time)] as [number, number, number]);
    const pods = [...this.podsReady];
    const timeLeft = Math.max(0, this.duration - this.time);
    const now = Date.now();

    for (const viewer of this.players.values()) {
      if (!viewer.connected) continue;
      const v = this.viewPos(viewer);
      const pl: SnapPlayer[] = [];
      for (const o of this.players.values()) {
        if (!this.visibleTo(viewer, o)) continue;
        pl.push([o.id, round2(o.x), round2(o.z), round2(o.yaw), round2(o.pitch), this.flags(o), round2(o.speed)]);
      }
      const items: Snapshot['items'] = [];
      for (const it of this.items.values()) {
        const d2 = dist2(v.x, v.z, it.x, it.z);
        if (d2 < 9 || (d2 < 30 * 30 && lineOfSight(this.grid, v.x, v.z, it.x, it.z))) items.push([it.id, it.kind, round2(it.x), round2(it.z)]);
      }
      const sup: Snapshot['sup'] = [];
      for (const sp of this.supplies.values()) {
        const d2 = dist2(v.x, v.z, sp.x, sp.z);
        if (d2 < 9 || (d2 < 30 * 30 && lineOfSight(this.grid, v.x, v.z, sp.x, sp.z))) sup.push([sp.id, sp.kind, round2(sp.x), round2(sp.z), sp.claimedBy ? 1 : 0]);
      }
      let threat = 0;
      let trails: [number, number, number][] = [];
      if (viewer.role === 'survivor') {
        const d = Math.hypot(e.x - v.x, e.z - v.z);
        threat = Math.max(0, 1 - d / THREAT_RADIUS);
      } else if (viewer.active.rastro > 0) {
        for (const o of this.players.values()) {
          if (o.role !== 'survivor' || o.status === 'dead' || o.status === 'escaped') continue;
          if (!this.near(viewer, o.x, o.z, RASTRO_RANGE)) continue;
          for (const s of o.trail) trails.push([round2(s.x), round2(s.z), round2(this.time - s.t)]);
        }
      }
      const ch = viewer.channel;
      let chView: { label: string; p: number } | null = null;
      if (ch) {
        const total = ch.kind === 'revive' ? SURV.reviveTime : ch.kind === 'heal' ? SURV.medkitTime : ch.kind === 'supply' ? SUPPLY_COLLECT_TIME : 1;
        chView = { label: ch.label, p: Math.min(1, ch.kind === 'station' ? viewer.channelT : viewer.channelT / total) };
        if (ch.kind === 'station' && (this.jamUntil.get(ch.station) ?? 0) > this.time) chView.label += ' — INTERFERÊNCIA';
      }
      const params = this.moveParams(viewer);
      const snap: Snapshot = {
        t: now,
        time: round2(timeLeft),
        you: {
          x: viewer.x,
          z: viewer.z,
          ack: viewer.lastSeq,
          hp: viewer.role === 'entity' ? Math.ceil(viewer.hp) : viewer.hp,
          st: viewer.status,
          stamina: viewer.stamina,
          exh: viewer.exhausted,
          regen: viewer.regenDelay,
          inv: viewer.inventory,
          det: viewer.detCharges,
          ch: chView,
          mult: params.mult,
          canMove: params.canMove,
          canSprint: params.canSprint,
          hidden: viewer.hidden,
          bleed: round2(viewer.bleed),
          flash: viewer.flashlight,
          flicker: viewer.flickerUntil > this.time,
          spec: viewer.spec ?? undefined,
        },
        pl,
        doors,
        locked,
        items,
        tasks,
        lights,
        threat: round2(threat),
        flares,
        trails,
        jam,
        pods,
        sup,
        eh: [Math.ceil(e.hp), e.maxHp],
      };
      if (viewer.role === 'survivor') {
        snap.you.wpn = { sel: viewer.weapon, mag: { ...viewer.mag }, res: { ...viewer.reserve }, fuel: round2(viewer.fuel), reload: viewer.reloadUntil > 0 ? round2(viewer.reloadUntil - this.time) : 0 };
      }
      if (viewer.role === 'entity') {
        const lvl = this.resonanceLevel(viewer);
        snap.you.cd = { ...viewer.cd };
        snap.you.act = { ...viewer.active };
        snap.you.res = { level: lvl, points: viewer.resonance, next: ENT.resonanceLevels[lvl] ?? -1 };
        snap.you.atk = viewer.attackCd;
        snap.you.eco = [...this.ecoMemory.entries()].filter(([k, t]) => (k === 'passos' || this.time - t <= ECO_MEMORY) && (k !== 'presenca' || this.presenceSource)).map(([k]) => k);
        snap.you.camo = viewer.camo;
        snap.you.canSprint = false;
      }
      this.hooks.send(viewer.id, { t: 'snap', s: snap });
    }
  }

  /** Somente testes: altera o estado de um jogador (não acessível pela rede). */
  debugSet(id: string, patch: Partial<Pick<MPlayer, 'x' | 'z' | 'yaw' | 'pitch' | 'hp' | 'fuel' | 'weapon' | 'stamina' | 'status'>> & { reserve?: Partial<MPlayer['reserve']>; mag?: Partial<MPlayer['mag']> }) {
    const p = this.players.get(id)!;
    const { reserve, mag, ...rest } = patch;
    Object.assign(p, rest);
    if (reserve) Object.assign(p.reserve, reserve);
    if (mag) Object.assign(p.mag, mag);
  }
  /** Somente testes: coloca uma caixa de suprimento num ponto. */
  debugAddSupply(kind: SupplyKind, x: number, z: number, amount = SUPPLY_INFO[kind].amount) {
    const id = `s${++this.supplySeq}`;
    this.supplies.set(id, { id, kind, x, z, amount, claimedBy: null });
    return id;
  }

  /** Expõe estado interno para testes automatizados. */
  debugState() {
    return {
      time: this.time,
      stage: this.stage,
      tasks: this.tasks,
      items: [...this.items.values()],
      players: [...this.players.values()].map((p) => ({ id: p.id, role: p.role, x: p.x, z: p.z, hp: p.hp, maxHp: p.maxHp, status: p.status, hidden: p.hidden, inv: p.inventory, weapon: p.weapon, mag: { ...p.mag }, reserve: { ...p.reserve }, fuel: p.fuel, reloading: p.reloadUntil > 0, stamina: p.stamina, attackCd: p.attackCd, cd: { ...p.cd }, mods: { ...p.mods } })),
      supplies: [...this.supplies.values()].map((x) => ({ ...x })),
      supplyRespawnAt: [...this.supplyRespawnAt],
      podsReady: [...this.podsReady],
      doorsOpen: this.map.doors.filter((d) => this.grid.doorOpen[d.idx]).map((d) => d.idx),
    };
  }
}

