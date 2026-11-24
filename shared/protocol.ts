/**
 * Protocolo de rede (WebSocket, JSON). Tipos compartilhados entre cliente e servidor.
 * As mensagens recebidas pelo servidor são validadas com zod (server/validate.ts).
 */
import type { AbilityId, ItemKind, SupplyKind, WeaponId } from './constants';
import type { InputCmd } from './physics';
import type { Loadout, Stats } from './progression';

export type Role = 'survivor' | 'entity';
export type RolePref = 'any' | 'survivor' | 'entity';
export type PStatus = 'alive' | 'downed' | 'dead' | 'escaped';
export type RoomState = 'lobby' | 'countdown' | 'loading' | 'playing' | 'results';

export interface RoomPlayerInfo {
  id: string;
  name: string;
  level: number;
  host: boolean;
  ready: boolean;
  pref: RolePref;
  connected: boolean;
  guest: boolean;
  loadout: Loadout;
}

export interface ChatLine {
  from: string;
  text: string;
  t: number;
  system?: boolean;
}

export interface RoomInfo {
  code: string;
  name: string;
  public: boolean;
  hostId: string;
  state: RoomState;
  mapId: string;
  players: RoomPlayerInfo[];
  countdown: number;
  maxPlayers: number;
  chat: ChatLine[];
}

export interface RoomListEntry {
  code: string;
  name: string;
  players: number;
  max: number;
  state: RoomState;
  map: string;
}

export type TaskKind = 'energia' | 'amostras' | 'documentos' | 'transmissores' | 'comunicacao' | 'cartoes' | 'evacuacao';

export interface TaskView {
  id: string;
  kind: TaskKind;
  title: string;
  desc: string;
  stage: number;
  done: boolean;
  /** 0..1 */
  progress: number;
  count: number;
  required: number;
  /** estações ativas desta tarefa (para marcadores no HUD) */
  stations: string[];
  /** estações já concluídas */
  doneStations: string[];
  item?: ItemKind;
  active: boolean;
}

export interface MatchPlayerInfo {
  id: string;
  name: string;
  role: Role;
  loadout: Loadout;
}

export interface MatchIntro {
  /** modificadores das melhorias do próprio jogador (usados na predição) */
  mods: import('./upgrades').Mods;
  matchId: string;
  mapId: string;
  seed: number;
  you: string;
  role: Role;
  players: MatchPlayerInfo[];
  duration: number;
}

/** Bits de estado de jogadores no snapshot. */
export const PF = {
  CROUCH: 1,
  SPRINT: 2,
  FLASH: 4,
  DOWNED: 8,
  HIDDEN: 16,
  CAMO: 32,
  DASH: 64,
  ATTACK: 128,
  CHANNEL: 256,
  WOUNDED: 512,
  DEAD: 1024,
  ESCAPED: 2048,
  FLICKER: 4096,
  DISCONNECTED: 8192,
  HEALING: 16384,
  FIRE: 32768,
  WPN_RIFLE: 65536,
  WPN_FLAME: 131072,
  RELOAD: 262144,
  BURNING: 524288,
  COLLECT: 1048576,
} as const;

/** [id, x, z, yaw, pitch, flags, speed] */
export type SnapPlayer = [string, number, number, number, number, number, number];

export interface YouState {
  x: number;
  z: number;
  ack: number;
  hp: number;
  st: PStatus;
  stamina: number;
  exh: boolean;
  regen: number;
  inv: (ItemKind | null)[];
  det: number;
  ch: { label: string; p: number } | null;
  mult: number;
  canMove: boolean;
  canSprint: boolean;
  hidden: string | null;
  bleed: number;
  flash: boolean;
  flicker: boolean;
  // entidade
  cd?: Record<AbilityId, number>;
  act?: Record<AbilityId, number>;
  res?: { level: number; points: number; next: number };
  atk?: number;
  eco?: string[];
  camo?: boolean;
  /** id do jogador sendo assistido (espectador) */
  spec?: string;
  /** armas do sobrevivente */
  wpn?: WeaponState;
}

export interface WeaponState {
  sel: WeaponId;
  mag: { pistola: number; fuzil: number };
  res: { pistola: number; fuzil: number };
  fuel: number;
  /** segundos restantes de recarga (0 = não está recarregando) */
  reload: number;
}

export interface Snapshot {
  t: number;
  time: number;
  you: YouState;
  pl: SnapPlayer[];
  doors: number[];
  locked: number[];
  items: [string, ItemKind, number, number][];
  tasks: TaskView[];
  /** estado de luz por zona: 0 emergência, 1 ligada, 2 apagada (parasita) */
  lights: Record<string, number>;
  threat: number;
  flares: [number, number, number][];
  trails: [number, number, number][];
  jam: string[];
  pods: string[];
  /** suprimentos visíveis: [id, tipo, x, z, sendo coletado (0/1)] */
  sup: [string, SupplyKind, number, number, number][];
  /** vida da entidade [atual, máxima] */
  eh: [number, number];
}

export type SoundKind = 'passos' | 'porta' | 'radio' | 'alarme' | 'grito' | 'impacto' | 'queda' | 'item' | 'cura' | 'escotilha' | 'metal' | 'ruptura' | 'parasita' | 'rastro' | 'ataque' | 'entrega' | 'armario' | 'sinalizador' | 'detector' | 'recarga' | 'vazio' | 'coleta' | 'dor' | 'morte_entidade';

export type EcoType = 'passos' | 'porta' | 'radio' | 'alarme' | 'presenca';

export type GameEvent =
  | { k: 'sound'; s: SoundKind; x: number; z: number; v?: number; id?: string }
  | { k: 'hit'; target: string; by: string; x: number; z: number }
  | { k: 'down'; target: string }
  | { k: 'death'; target: string; cause: 'entity' | 'bleed' | 'collapse' | 'disconnect' }
  | { k: 'revive'; target: string; by: string }
  | { k: 'escape'; target: string }
  | { k: 'task'; id: string; title: string }
  | { k: 'stage'; stage: number; text: string }
  | { k: 'ping'; x: number; z: number; kind: 'corrida' | 'objetivo' | 'armario' | 'porta' | 'ferido' | 'tiro' }
  | { k: 'presence'; x: number; z: number; yaw: number; loadout: Loadout; dur: number }
  | { k: 'parasite'; x: number; z: number; r: number }
  | { k: 'detector'; x: number; z: number; fakes: [number, number][]; by: string }
  | { k: 'attack'; id: string }
  | { k: 'ability'; id: string; a: AbilityId }
  | { k: 'msg'; text: string; tone?: 'info' | 'warn' | 'good' }
  | { k: 'jumpscare' }
  | { k: 'shot'; id: string; w: 'pistola' | 'fuzil'; x: number; y: number; z: number; tx: number; ty: number; tz: number; hit: boolean }
  | { k: 'enthit'; x: number; y: number; z: number; dmg: number; by: string }
  | { k: 'supply'; id: string; by: string; kind: SupplyKind; amount: number; x: number; z: number }
  | { k: 'entdeath'; x: number; z: number; by: string };

export interface PlayerResult {
  id: string;
  name: string;
  role: Role;
  outcome: 'escaped' | 'dead' | 'survived' | 'disconnected' | 'entity';
  score: number;
  xp: number;
  coins: number;
  /** composição do XP (participação, desempenho, vitória, fuga, MVP) */
  xpParts?: { label: string; xp: number }[];
  mvp?: boolean;
}

export interface Rewards {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  achievements: string[];
  seasonTiers: number[];
  masteryXp: number;
}

export interface MatchResults {
  matchId: string;
  winner: 'survivors' | 'entity';
  reason: string;
  duration: number;
  escaped: number;
  needed: number;
  players: PlayerResult[];
  rewards?: Rewards;
}

export interface MatchHistoryEntry {
  matchId: string;
  date: string;
  map: string;
  role: Role;
  outcome: PlayerResult['outcome'];
  winner: 'survivors' | 'entity';
  duration: number;
  xp: number;
  coins: number;
  score: number;
}

export interface Profile {
  id: string;
  username: string;
  guest: boolean;
  totalXp: number;
  level: number;
  levelInto: number;
  levelNeed: number;
  coins: number;
  owned: string[];
  loadout: Loadout;
  stats: Stats;
  achievements: string[];
  season: { id: string; xp: number; claimed: number[] };
  masteryXp: number;
  maxLevel: boolean;
  upgrades: import('./upgrades').UpgradeLevels;
  redeemedCodes: string[];
  rewardLog: RewardLogEntryView[];
  friendRequests: number;
}

export interface RewardLogEntryView {
  date: string;
  source: string;
  desc: string;
  xp: number;
  coins: number;
}

export interface RankingEntry {
  pos: number;
  id: string;
  username: string;
  level: number;
  totalXp: number;
  wins: number;
  matches: number;
}

export type FriendStatus = 'offline' | 'menu' | 'lobby' | 'partida';

export interface FriendInfo {
  id: string;
  username: string;
  level: number;
  status: FriendStatus;
  lastSeen: string;
  /** código da sala do amigo, se ela estiver aberta para entrar (lobby) */
  roomCode?: string;
}

export interface Notice {
  kind: 'friend_request' | 'friend_accept' | 'invite';
  from: { id: string; username: string };
  code?: string;
  roomName?: string;
}

export type ClientMsg =
  | { t: 'auth'; token: string }
  | { t: 'room:create'; name: string; public: boolean; map: string }
  | { t: 'room:join'; code: string }
  | { t: 'room:quick' }
  | { t: 'room:leave' }
  | { t: 'room:list' }
  | { t: 'room:ready'; ready: boolean }
  | { t: 'room:pref'; pref: RolePref }
  | { t: 'room:settings'; public?: boolean; map?: string; name?: string }
  | { t: 'room:start' }
  | { t: 'room:kick'; id: string }
  | { t: 'room:chat'; text: string }
  | { t: 'match:loaded' }
  | { t: 'in'; cmds: InputCmd[] }
  | { t: 'act'; a: 'interact'; on: boolean }
  | { t: 'act'; a: 'flashlight' }
  | { t: 'act'; a: 'use'; slot: number }
  | { t: 'act'; a: 'drop'; slot: number }
  | { t: 'act'; a: 'attack' }
  | { t: 'act'; a: 'ability'; id: AbilityId; variant?: EcoType }
  | { t: 'act'; a: 'fire'; on: boolean }
  | { t: 'act'; a: 'reload' }
  | { t: 'act'; a: 'weapon'; slot: number }
  | { t: 'spectate'; dir: 1 | -1 }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'hello'; profile: Profile }
  | { t: 'err'; code: string; msg: string }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'rooms'; list: RoomListEntry[] }
  | { t: 'match:load'; intro: MatchIntro }
  | { t: 'match:start' }
  | { t: 'snap'; s: Snapshot }
  | { t: 'ev'; e: GameEvent[] }
  | { t: 'match:end'; results: MatchResults }
  | { t: 'profile'; profile: Profile }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'pong'; c: number; s: number }
  | { t: 'notice'; n: Notice };
