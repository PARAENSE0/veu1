/**
 * Constantes de jogo e balanceamento.
 * Todos os valores que afetam a jogabilidade ficam aqui para facilitar ajustes
 * (e para que cliente e servidor usem exatamente os mesmos números).
 */

export const PROTOCOL_VERSION = 2;

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
  inventorySlots: 4,
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

// ---- Armas dos sobreviventes (nomes originais) ----
export type WeaponId = 'pistola' | 'fuzil' | 'lanca';
export const WEAPON_ORDER: WeaponId[] = ['pistola', 'fuzil', 'lanca'];

export interface GunDef {
  id: 'pistola' | 'fuzil';
  name: string;
  short: string;
  damage: number;
  interval: number; // segundos entre disparos
  auto: boolean; // dispara enquanto o gatilho estiver pressionado
  mag: number;
  reload: number;
  range: number;
  spread: number; // radianos (desvio máximo)
  maxReserve: number;
  startMag: number;
  startReserve: number;
}

export const GUNS: Record<'pistola' | 'fuzil', GunDef> = {
  pistola: { id: 'pistola', name: 'Pistola P-50 “Âncora”', short: 'P-50', damage: 40, interval: 0.38, auto: false, mag: 8, reload: 1.5, range: 32, spread: 0.012, maxReserve: 32, startMag: 8, startReserve: 8 },
  fuzil: { id: 'fuzil', name: 'Fuzil FR-9 “Maré”', short: 'FR-9', damage: 15, interval: 0.1, auto: true, mag: 30, reload: 2.3, range: 40, spread: 0.03, maxReserve: 90, startMag: 0, startReserve: 0 },
};

export const FLAMER = {
  id: 'lanca' as const,
  name: 'Lança-chamas LC-3 “Fornalha”',
  short: 'LC-3',
  dps: 60,
  range: 6.5,
  coneCos: Math.cos((18 * Math.PI) / 180),
  fuelPerSec: 12,
  maxFuel: 100,
  startFuel: 0,
  burnTime: 3,
  burnDps: 12,
};

export const WEAPON_NAMES: Record<WeaponId, string> = { pistola: GUNS.pistola.name, fuzil: GUNS.fuzil.name, lanca: FLAMER.name };

/** Vida da entidade escala com o número de sobreviventes. */
export const ENTITY_HP_BASE = 600;
export const ENTITY_HP_PER_SURVIVOR = 300;
export const ENTITY_REGEN = 12; // por segundo
export const ENTITY_REGEN_DELAY = 6; // segundos sem sofrer dano
export const ENTITY_HITBOX = { radius: 0.55, height: 2.6 };

// ---- Suprimentos no mapa ----
export type SupplyKind = 'mun_pistola' | 'mun_fuzil' | 'combustivel';
export const SUPPLY_INFO: Record<SupplyKind, { name: string; amount: number; weight: number; color: [number, number, number] }> = {
  mun_pistola: { name: 'Munição de pistola', amount: 12, weight: 0.45, color: [0.95, 0.78, 0.25] },
  mun_fuzil: { name: 'Munição de fuzil', amount: 30, weight: 0.35, color: [0.45, 0.85, 0.35] },
  combustivel: { name: 'Combustível', amount: 35, weight: 0.2, color: [1, 0.3, 0.15] },
};
export const SUPPLY_COLLECT_TIME = 0.8; // canalização curta (animação de coleta)
export const SUPPLY_RESPAWN = 90; // segundos para repor uma caixa coletada
export const SUPPLY_RESPAWN_SAFE_DIST = 15; // não reaparece perto de sobreviventes
/** Quantidade de caixas ativas ao mesmo tempo. */
export const supplyCap = (nSurv: number) => 2 + nSurv;

/** Portas automáticas (humanos): distância (m) do sensor até a borda do vão e atraso para fechar. */
export const AUTO_DOOR_RANGE = 0.9;
export const AUTO_DOOR_CLOSE_DELAY = 1.5;
