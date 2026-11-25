/**
 * Constantes de jogo e balanceamento.
 * Todos os valores que afetam a jogabilidade ficam aqui para facilitar ajustes
 * (e para que cliente e servidor usem exatamente os mesmos números).
 */

export const PROTOCOL_VERSION = 3;

// ---- Simulação ----
export const TICK_RATE = 30; // ticks do servidor por segundo
export const DT = 1 / TICK_RATE; // cada comando de entrada vale exatamente 1 tick
export const SNAPSHOT_EVERY = 2; // 15 snapshots/s
export const INTERP_DELAY_MS = 110; // atraso de interpolação de jogadores remotos
export const MAX_QUEUED_CMDS = 8; // comandos acima disso são descartados (antispeedhack)
export const CMD_BUDGET_CAP = 4; // rajada máxima processada após atraso de rede

// ---- Mundo ----
export const CELL = 2; // metros por célula do grid
export const WALL_H = 3.2;
export const PLAYER_RADIUS = 0.35;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE = 1.0;
export const DOWNED_EYE = 0.45;
export const ENTITY_EYE = 2.25;

// ---- Sobreviventes ----
export const SURV = {
  walk: 3.4,
  sprint: 5.5,
  crouch: 1.7,
  crawl: 0.75,
  staminaMax: 100,
  staminaDrain: 21, // por segundo correndo
  staminaRegen: 15,
  staminaRegenDelay: 1.0,
  exhaustedUntil: 30, // fica exausto ao zerar até recuperar este valor
  hpMax: 100,
  /** abaixo disso o sobrevivente fica "ferido" (deixa rastro de sangue, gera ruído) */
  woundedHp: 40,
  bleedout: 60, // segundos caído até morrer
  reviveTime: 4,
  reviveHp: 40,
  medkitTime: 4,
  medkitHeal: 50,
  hasteAfterHit: 1.4, // adrenalina após ser atingido
  hasteMult: 1.2,
  staminaStillMult: 1.6, // recupera mais rápido parado
  inventorySlots: 5,
  lockerPressure: 20, // após X s escondido o coração denuncia
} as const;

// ---- Entidade (O Reverberante) ----
export const ENT = {
  speed: 4.85,
  stalkSpeed: 1.8,
  radius: 0.45,
  attackRange: 2.4,
  attackArcCos: Math.cos((55 * Math.PI) / 180),
  attackWindup: 0.35,
  /** dano do ataque comum: 18% da vida de um humano (nunca derruba com 2 golpes) */
  attackDamage: 18,
  /** golpe especial (botão direito): mais forte, mais lento e com recarga */
  specialDamage: 34,
  specialWindup: 0.8,
  specialRange: 2.9,
  specialArcCos: Math.cos((65 * Math.PI) / 180),
  attackCooldownHit: 1.25,
  attackCooldownMiss: 0.9,
  hitSlow: 0.9, // segundos lento após acertar
  hitSlowMult: 0.6,
  camoDelay: 2.0, // parado/espreitando por X s => camuflado
  camoMaxSpeed: 1.9,
  lockerWrongStun: 1.2,
  // evolução (Ressonância)
  resonanceLevels: [0, 4, 9], // pontos para níveis 1,2,3
  levelCooldownMult: [1, 0.85, 0.75],
  levelSpeedMult: [1, 1, 1.04],
} as const;

export type AbilityId = 'rastro' | 'eco' | 'ruptura' | 'parasita' | 'golpe';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  desc: string;
  cooldown: number;
  duration: number;
  limit: string;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  rastro: {
    id: 'rastro',
    name: 'RASTRO',
    desc: 'Revela os caminhos percorridos pelos sobreviventes nos últimos 12 s.',
    cooldown: 22,
    duration: 7,
    limit: 'Mostra só sobreviventes a até 45 m; quem está agachado deixa rastro fraco.',
  },
  eco: {
    id: 'eco',
    name: 'ECO FALSO',
    desc: 'Reproduz um som que você registrou (passos, porta, rádio, alarme ou presença) no ponto mirado.',
    cooldown: 16,
    duration: 3,
    limit: 'Só imita o que ouviu nos últimos 90 s. Ecos têm leve distorção e o Detector os denuncia.',
  },
  ruptura: {
    id: 'ruptura',
    name: 'RUPTURA',
    desc: 'Avanço veloz por um curto período.',
    cooldown: 24,
    duration: 2.2,
    limit: 'Não pode atacar durante o avanço; fica lento por 0,9 s ao terminar.',
  },
  golpe: {
    id: 'golpe',
    name: 'GOLPE BRUTAL',
    desc: 'Ataque especial com as duas garras: mais dano e alcance maior.',
    cooldown: 12,
    duration: 0,
    limit: 'Preparação de 0,8 s (fica lento e dá para fugir); 34% da vida, longe de um abate instantâneo.',
  },
  parasita: {
    id: 'parasita',
    name: 'PARASITA',
    desc: 'Infecta equipamentos num raio de 12 m: trava objetivos, portas, luzes e lanternas.',
    cooldown: 30,
    duration: 9,
    limit: 'Portas travam por 6 s. Não afeta cápsulas de evacuação já preparadas.',
  },
};

export const RASTRO_HISTORY = 12; // segundos
export const RASTRO_RANGE = 45;
export const ECO_RANGE = 28;
export const ECO_MEMORY = 90;
export const RUPTURA_MULT = 1.9;
export const RUPTURA_RECOVER = 0.9;
export const PARASITA_RADIUS = 12;
export const PARASITA_DOOR_LOCK = 6;
export const PARASITA_FLASHLIGHT = 3;

// ---- Itens ----
export type ItemKind = 'fusivel' | 'amostra' | 'documento' | 'cartao' | 'kit' | 'detector' | 'sinalizador';

export const ITEM_INFO: Record<ItemKind, { name: string; desc: string; usable: boolean; color: [number, number, number] }> = {
  fusivel: { name: 'Fusível', desc: 'Leve à Sala de Energia.', usable: false, color: [1, 0.75, 0.2] },
  amostra: { name: 'Amostra biológica', desc: 'Leve ao analisador do Laboratório.', usable: false, color: [0.3, 1, 0.55] },
  documento: { name: 'Documento sigiloso', desc: 'Leve ao terminal de arquivo do Centro de Controle.', usable: false, color: [0.9, 0.9, 0.95] },
  cartao: { name: 'Cartão de acesso', desc: 'Leve ao painel de segurança do Centro de Controle.', usable: false, color: [0.3, 0.7, 1] },
  kit: { name: 'Kit médico', desc: 'Cura 50 de vida (4 s, imóvel).', usable: true, color: [1, 0.3, 0.3] },
  detector: { name: 'Detector de ressonância', desc: 'Indica a posição aproximada da entidade e expõe ecos falsos próximos.', usable: true, color: [0.6, 0.4, 1] },
  sinalizador: { name: 'Sinalizador', desc: 'Luz forte por 25 s. Anula a camuflagem da entidade por perto.', usable: true, color: [1, 0.45, 0.15] },
};

export const DETECTOR_RANGE = 40;
export const DETECTOR_JITTER = 5;
export const DETECTOR_CHARGES = 3;
export const FLARE_TIME = 25;
export const FLARE_RADIUS = 7;

// ---- Partida ----
export const MATCH_DURATION = 15 * 60;
export const COUNTDOWN = 5;
export const LOAD_TIMEOUT = 20;
export const RECONNECT_GRACE = 60;
export const LOBBY_DISCONNECT_GRACE = 15;
export const INTERACT_RANGE = 2.3;
export const MAX_PLAYERS = 9;
export const MIN_PLAYERS = 2;

export const NOISE = {
  sprintEvery: 1.2,
  sprintJitter: 1.5,
  channelEvery: 3,
  channelJitter: 3,
  lockerEvery: 3,
  lockerJitter: 2.5,
  pingRange: 60,
} as const;

/** Raio (m) em que a entidade é enviada aos sobreviventes mesmo sem linha de visão (ouvida). */
export const ENTITY_AUDIBLE_RADIUS = 14;
export const VIEW_RANGE = 45;
export const THREAT_RADIUS = 26;
export const EVENT_SOUND_RANGE = 45;

// ---- Armas dos sobreviventes ----
// Ninguém começa armado: as armas aparecem em pontos do mapa (ver WEAPON_COUNTS).
export type WeaponId = 'pistola' | 'fuzil' | 'escopeta' | 'lanca';
export type GunId = 'pistola' | 'fuzil' | 'escopeta';
export const WEAPON_ORDER: WeaponId[] = ['pistola', 'fuzil', 'escopeta', 'lanca'];
export const GUN_IDS: GunId[] = ['pistola', 'fuzil', 'escopeta'];

export interface GunDef {
  id: GunId;
  name: string;
  short: string;
  /** dano por projétil (a escopeta dispara vários) */
  damage: number;
  /** projéteis por disparo */
  pellets: number;
  interval: number; // segundos entre disparos
  auto: boolean; // dispara enquanto o gatilho estiver pressionado
  mag: number;
  reload: number;
  range: number;
  spread: number; // radianos (desvio máximo)
  /** abertura extra por disparo seguido (recuo), até spread × 2 */
  recoil: number;
  /** queda de dano: integral até falloffStart, cai até falloffMin em range */
  falloffStart: number;
  falloffMin: number;
  maxReserve: number;
  /** munição que vem na arma quando ela é encontrada no mapa */
  pickupMag: number;
}

/**
 * Balanceamento (vida base da entidade = ENTITY_HP_BASE = 1.200):
 *  - pistola: 50 por tiro × 8 no pente → 3 pentes (24 tiros) derrubam;
 *  - AK-47: 40 por tiro × 30 no pente → 1 pente derruba;
 *  - escopeta: 8 chumbos × 30 = 240 de perto (até 5 m); com "Poder de fogo"
 *    no máximo (+25%) = 300 → 4 tiros bem acertados derrubam. De longe o dano
 *    cai (até 30% em 18 m) e a dispersão faz chumbos errarem.
 */
export const GUNS: Record<GunId, GunDef> = {
  pistola: { id: 'pistola', name: 'Pistola P-50', short: 'PISTOLA', damage: 50, pellets: 1, interval: 0.38, auto: false, mag: 8, reload: 1.5, range: 32, spread: 0.012, recoil: 0, falloffStart: 32, falloffMin: 1, maxReserve: 40, pickupMag: 8 },
  fuzil: { id: 'fuzil', name: 'AK-47', short: 'AK-47', damage: 40, interval: 0.1, pellets: 1, auto: true, mag: 30, reload: 2.4, range: 40, spread: 0.018, recoil: 0.002, falloffStart: 40, falloffMin: 1, maxReserve: 120, pickupMag: 30 },
  escopeta: { id: 'escopeta', name: 'Escopeta calibre 12', short: 'ESCOPETA', damage: 30, pellets: 8, interval: 0.85, auto: false, mag: 6, reload: 2.6, range: 18, spread: 0.06, recoil: 0, falloffStart: 5, falloffMin: 0.3, maxReserve: 24, pickupMag: 6 },
};

export const FLAMER = {
  id: 'lanca' as const,
  name: 'Lança-chamas',
  short: 'LANÇA-CHAMAS',
  dps: 100,
  range: 6.5,
  coneCos: Math.cos((18 * Math.PI) / 180),
  fuelPerSec: 10,
  maxFuel: 100,
  /** combustível que vem no tanque quando a arma é encontrada */
  pickupFuel: 60,
  burnTime: 3,
  burnDps: 15,
};

export const WEAPON_NAMES: Record<WeaponId, string> = { pistola: GUNS.pistola.name, fuzil: GUNS.fuzil.name, escopeta: GUNS.escopeta.name, lanca: FLAMER.name };

/** Quantas armas de cada tipo aparecem no mapa por partida (conforme o nº de sobreviventes). */
export function weaponCounts(nSurv: number): Record<WeaponId, number> {
  return {
    pistola: Math.min(6, Math.max(2, Math.ceil(nSurv / 2) + 1)),
    fuzil: nSurv >= 4 ? 2 : 1,
    escopeta: nSurv >= 4 ? 2 : 1,
    lanca: 1,
  };
}

/** Vida da entidade (fixa; aumenta só com a melhoria "Vida máxima"). Ela NÃO se regenera sozinha. */
export const ENTITY_HP_BASE = 1200;
/** Ao chegar a 0 de vida (sem ser pelo fogo), a entidade cai e levanta com a vida cheia depois disto. */
export const ENTITY_DOWN_TIME = 20;
export const ENTITY_HITBOX = { radius: 0.55, height: 2.6 };

// ---- Caixa Médica (uso ilimitado, para todos) ----
/** segurar a interação por este tempo cura MEDBOX_HEAL × vida máxima; pode repetir na hora */
export const MEDBOX_TIME = 1.5;
export const MEDBOX_HEAL = 0.35;
export const MEDBOX_RANGE = 2.2;

// ---- Inventário ----
/** limite de unidades por espaço; cada tipo de item ocupa um único espaço */
export const ITEM_STACK: Record<ItemKind, number> = { kit: 2, fusivel: 2, documento: 2, amostra: 2, cartao: 1, detector: 1, sinalizador: 2 };

// ---- Suprimentos no mapa ----
export type SupplyKind = 'mun_pistola' | 'mun_fuzil' | 'mun_escopeta' | 'combustivel';
export const SUPPLY_INFO: Record<SupplyKind, { name: string; amount: number; weight: number; color: [number, number, number] }> = {
  mun_pistola: { name: 'Munição de pistola', amount: 16, weight: 0.32, color: [0.95, 0.78, 0.25] },
  mun_fuzil: { name: 'Munição de AK-47', amount: 30, weight: 0.26, color: [0.45, 0.85, 0.35] },
  mun_escopeta: { name: 'Cartuchos de escopeta', amount: 6, weight: 0.24, color: [0.95, 0.35, 0.3] },
  combustivel: { name: 'Combustível', amount: 40, weight: 0.18, color: [1, 0.55, 0.1] },
};
export const SUPPLY_COLLECT_TIME = 0.8; // canalização curta (animação de coleta)
export const SUPPLY_RESPAWN = 90; // segundos para repor uma caixa coletada
export const SUPPLY_RESPAWN_SAFE_DIST = 15; // não reaparece perto de sobreviventes
/** Quantidade de caixas ativas ao mesmo tempo. */
export const supplyCap = (nSurv: number) => 5 + nSurv;

/** Portas automáticas (humanos): distância (m) do sensor até a borda do vão e atraso para fechar. */
export const AUTO_DOOR_RANGE = 0.9;
export const AUTO_DOOR_CLOSE_DELAY = 1.5;
