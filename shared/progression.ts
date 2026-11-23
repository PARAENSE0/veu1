/**
 * Catálogo de cosméticos, conquistas, níveis e temporadas.
 * Cosméticos são puramente visuais: o renderizador limita a luminância das
 * roupas (nenhuma roupa "invisível no escuro") e a visão da entidade ignora cores.
 */

export type Slot = 'rosto' | 'cabelo' | 'roupa' | 'calcado' | 'acessorio' | 'uniforme' | 'entidade';

export const SLOT_NAMES: Record<Slot, string> = {
  rosto: 'Rosto',
  cabelo: 'Cabelo',
  roupa: 'Roupa',
  calcado: 'Calçados',
  acessorio: 'Acessórios',
  uniforme: 'Uniformes',
  entidade: 'Entidade',
};

export type RGB = [number, number, number];

export interface CosmeticData {
  skin?: RGB;
  beard?: boolean;
  scar?: boolean;
  hairStyle?: 'nenhum' | 'raspado' | 'curto' | 'coque' | 'longo' | 'moicano';
  hairColor?: RGB;
  torso?: RGB;
  legs?: RGB;
  coat?: boolean;
  shoeColor?: RGB;
  boots?: boolean;
  acc?: 'nenhum' | 'capacete' | 'oculos' | 'fone' | 'mascara' | 'cachecol';
  accColor?: RGB;
  stripe?: RGB;
  /** cores do Reverberante */
  body?: RGB;
  glow?: RGB;
}

export interface Cosmetic {
  id: string;
  slot: Slot;
  name: string;
  /** como desbloquear */
  unlock: { type: 'default' } | { type: 'shop'; price: number } | { type: 'level'; level: number } | { type: 'achievement'; id: string } | { type: 'season'; season: string; tier: number } | { type: 'mastery'; level: number };
  data: CosmeticData;
}

const c = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255];

export const COSMETICS: Cosmetic[] = [
  // Rostos
  { id: 'rosto_a', slot: 'rosto', name: 'Técnica Ana', unlock: { type: 'default' }, data: { skin: c(224, 182, 150) } },
  { id: 'rosto_b', slot: 'rosto', name: 'Engenheiro Davi', unlock: { type: 'default' }, data: { skin: c(141, 96, 66), beard: true } },
  { id: 'rosto_c', slot: 'rosto', name: 'Bióloga Iara', unlock: { type: 'default' }, data: { skin: c(186, 132, 96) } },
  { id: 'rosto_d', slot: 'rosto', name: 'Mergulhador Kofi', unlock: { type: 'default' }, data: { skin: c(92, 62, 44) } },
  { id: 'rosto_e', slot: 'rosto', name: 'Vigia Hana', unlock: { type: 'level', level: 3 }, data: { skin: c(238, 206, 178), scar: true } },
  { id: 'rosto_f', slot: 'rosto', name: 'Veterano Lúcio', unlock: { type: 'shop', price: 250 }, data: { skin: c(200, 150, 120), beard: true, scar: true } },
  // Cabelos
  { id: 'cab_curto', slot: 'cabelo', name: 'Curto', unlock: { type: 'default' }, data: { hairStyle: 'curto', hairColor: c(40, 28, 20) } },
  { id: 'cab_raspado', slot: 'cabelo', name: 'Raspado', unlock: { type: 'default' }, data: { hairStyle: 'raspado', hairColor: c(30, 22, 18) } },
  { id: 'cab_coque', slot: 'cabelo', name: 'Coque', unlock: { type: 'default' }, data: { hairStyle: 'coque', hairColor: c(70, 40, 25) } },
  { id: 'cab_longo', slot: 'cabelo', name: 'Longo', unlock: { type: 'level', level: 2 }, data: { hairStyle: 'longo', hairColor: c(110, 70, 40) } },
  { id: 'cab_moicano', slot: 'cabelo', name: 'Moicano ciano', unlock: { type: 'shop', price: 150 }, data: { hairStyle: 'moicano', hairColor: c(40, 190, 200) } },
  { id: 'cab_grisalho', slot: 'cabelo', name: 'Grisalho', unlock: { type: 'achievement', id: 'sobrevivente_nato' }, data: { hairStyle: 'curto', hairColor: c(170, 170, 165) } },
  { id: 'cab_nenhum', slot: 'cabelo', name: 'Careca', unlock: { type: 'default' }, data: { hairStyle: 'nenhum' } },
  // Roupas
  { id: 'roupa_macacao', slot: 'roupa', name: 'Macacão de manutenção', unlock: { type: 'default' }, data: { torso: c(200, 110, 40), legs: c(170, 95, 35) } },
  { id: 'roupa_jaleco', slot: 'roupa', name: 'Jaleco de pesquisa', unlock: { type: 'default' }, data: { torso: c(215, 220, 225), legs: c(70, 80, 95), coat: true } },
  { id: 'roupa_jaqueta', slot: 'roupa', name: 'Jaqueta térmica', unlock: { type: 'default' }, data: { torso: c(60, 110, 150), legs: c(60, 60, 70) } },
  { id: 'roupa_seguranca', slot: 'roupa', name: 'Colete de segurança', unlock: { type: 'level', level: 4 }, data: { torso: c(220, 200, 40), legs: c(60, 70, 60) } },
  { id: 'roupa_vinho', slot: 'roupa', name: 'Uniforme de convés', unlock: { type: 'shop', price: 200 }, data: { torso: c(140, 40, 55), legs: c(55, 50, 60) } },
  // Calçados
  { id: 'calc_bota', slot: 'calcado', name: 'Botas de aço', unlock: { type: 'default' }, data: { shoeColor: c(60, 50, 40), boots: true } },
  { id: 'calc_tenis', slot: 'calcado', name: 'Tênis antiderrapante', unlock: { type: 'default' }, data: { shoeColor: c(200, 200, 205) } },
  { id: 'calc_galocha', slot: 'calcado', name: 'Galochas amarelas', unlock: { type: 'shop', price: 120 }, data: { shoeColor: c(230, 190, 30), boots: true } },
  // Acessórios
  { id: 'acc_nenhum', slot: 'acessorio', name: 'Nenhum', unlock: { type: 'default' }, data: { acc: 'nenhum' } },
  { id: 'acc_capacete', slot: 'acessorio', name: 'Capacete de obra', unlock: { type: 'default' }, data: { acc: 'capacete', accColor: c(230, 200, 40) } },
  { id: 'acc_oculos', slot: 'acessorio', name: 'Óculos de proteção', unlock: { type: 'default' }, data: { acc: 'oculos', accColor: c(120, 200, 220) } },
  { id: 'acc_fone', slot: 'acessorio', name: 'Fone de rádio', unlock: { type: 'level', level: 5 }, data: { acc: 'fone', accColor: c(50, 50, 55) } },
  { id: 'acc_mascara', slot: 'acessorio', name: 'Máscara respiratória', unlock: { type: 'shop', price: 300 }, data: { acc: 'mascara', accColor: c(90, 95, 100) } },
  { id: 'acc_cachecol', slot: 'acessorio', name: 'Cachecol vermelho', unlock: { type: 'season', season: 's1', tier: 3 }, data: { acc: 'cachecol', accColor: c(190, 40, 40) } },
  // Uniformes (substituem roupa e calçado)
  { id: 'uni_nenhum', slot: 'uniforme', name: 'Nenhum', unlock: { type: 'default' }, data: {} },
  { id: 'uni_mergulho', slot: 'uniforme', name: 'Traje de mergulho', unlock: { type: 'level', level: 6 }, data: { torso: c(40, 70, 90), legs: c(40, 70, 90), shoeColor: c(30, 40, 50), boots: true, stripe: c(240, 180, 40) } },
  { id: 'uni_abissal', slot: 'uniforme', name: 'Equipe Abissal', unlock: { type: 'season', season: 's1', tier: 6 }, data: { torso: c(30, 120, 130), legs: c(40, 60, 70), shoeColor: c(40, 40, 45), boots: true, stripe: c(120, 255, 230) } },
  { id: 'uni_resgate', slot: 'uniforme', name: 'Equipe de resgate', unlock: { type: 'achievement', id: 'anjo_da_guarda' }, data: { torso: c(230, 90, 30), legs: c(230, 90, 30), shoeColor: c(50, 50, 50), boots: true, stripe: c(240, 240, 240) } },
  { id: 'uni_quarentena', slot: 'uniforme', name: 'Traje de quarentena', unlock: { type: 'shop', price: 500 }, data: { torso: c(210, 210, 90), legs: c(210, 210, 90), shoeColor: c(60, 60, 60), boots: true, stripe: c(30, 30, 30) } },
  // Entidade
  { id: 'ent_padrao', slot: 'entidade', name: 'Reverberante — Abissal', unlock: { type: 'default' }, data: { body: c(36, 34, 44), glow: c(255, 60, 40) } },
  { id: 'ent_palido', slot: 'entidade', name: 'Reverberante — Pálido', unlock: { type: 'mastery', level: 3 }, data: { body: c(150, 150, 160), glow: c(120, 220, 255) } },
  { id: 'ent_coral', slot: 'entidade', name: 'Reverberante — Coral', unlock: { type: 'mastery', level: 6 }, data: { body: c(90, 40, 50), glow: c(255, 170, 60) } },
  { id: 'ent_vazio', slot: 'entidade', name: 'Reverberante — Vazio', unlock: { type: 'shop', price: 600 }, data: { body: c(20, 20, 24), glow: c(170, 80, 255) } },
];

export const COSMETIC_BY_ID: Record<string, Cosmetic> = Object.fromEntries(COSMETICS.map((x) => [x.id, x]));

export type Loadout = Record<Slot, string>;

export const DEFAULT_LOADOUT: Loadout = {
  rosto: 'rosto_a',
  cabelo: 'cab_curto',
  roupa: 'roupa_macacao',
  calcado: 'calc_bota',
  acessorio: 'acc_nenhum',
  uniforme: 'uni_nenhum',
  entidade: 'ent_padrao',
};

/** Aparência resolvida a partir do loadout (usada pelo renderizador). */
export interface Appearance {
  skin: RGB;
  beard: boolean;
  scar: boolean;
  hairStyle: NonNullable<CosmeticData['hairStyle']>;
  hairColor: RGB;
  torso: RGB;
  legs: RGB;
  coat: boolean;
  shoeColor: RGB;
  boots: boolean;
  acc: NonNullable<CosmeticData['acc']>;
  accColor: RGB;
  stripe: RGB | null;
  entBody: RGB;
  entGlow: RGB;
}

export function resolveAppearance(l: Partial<Loadout>): Appearance {
  const get = (slot: Slot) => COSMETIC_BY_ID[l[slot] ?? DEFAULT_LOADOUT[slot]] ?? COSMETIC_BY_ID[DEFAULT_LOADOUT[slot]];
  const face = get('rosto').data;
  const hair = get('cabelo').data;
  const top = get('roupa').data;
  const shoe = get('calcado').data;
  const acc = get('acessorio').data;
  const uni = get('uniforme').data;
  const ent = get('entidade').data;
  const hasUni = !!uni.torso;
  return {
    skin: face.skin ?? [0.8, 0.6, 0.5],
    beard: !!face.beard,
    scar: !!face.scar,
    hairStyle: hair.hairStyle ?? 'curto',
    hairColor: hair.hairColor ?? [0.2, 0.15, 0.1],
    torso: (hasUni ? uni.torso : top.torso) ?? [0.5, 0.5, 0.5],
    legs: (hasUni ? uni.legs : top.legs) ?? [0.3, 0.3, 0.3],
    coat: !hasUni && !!top.coat,
    shoeColor: (hasUni ? uni.shoeColor : shoe.shoeColor) ?? [0.2, 0.2, 0.2],
    boots: hasUni ? !!uni.boots : !!shoe.boots,
    acc: acc.acc ?? 'nenhum',
    accColor: acc.accColor ?? [0.5, 0.5, 0.5],
    stripe: hasUni ? (uni.stripe ?? null) : null,
    entBody: ent.body ?? [0.14, 0.13, 0.17],
    entGlow: ent.glow ?? [1, 0.24, 0.16],
  };
}

// ---- Níveis ----
export function xpToNext(level: number): number {
  return 200 + (level - 1) * 75;
}
export function levelFromXp(totalXp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = totalXp;
  while (rest >= xpToNext(level) && level < 100) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}
export function masteryFromXp(xp: number) {
  // maestria da entidade: 400 xp por nível
  return { level: 1 + Math.floor(xp / 400), into: xp % 400, need: 400 };
}

// ---- Estatísticas e conquistas ----
export interface Stats {
  matches: number;
  survivorMatches: number;
  entityMatches: number;
  escapes: number;
  deaths: number;
  revives: number;
  heals: number;
  objectives: number;
  itemsDelivered: number;
  hits: number;
  downs: number;
  kills: number;
  entityWins: number;
  survivorWins: number;
  timesHidden: number;
  echoes: number;
  playSeconds: number;
}

export const EMPTY_STATS: Stats = {
  matches: 0,
  survivorMatches: 0,
  entityMatches: 0,
  escapes: 0,
  deaths: 0,
  revives: 0,
  heals: 0,
  objectives: 0,
  itemsDelivered: 0,
  hits: 0,
  downs: 0,
  kills: 0,
  entityWins: 0,
  survivorWins: 0,
  timesHidden: 0,
  echoes: 0,
  playSeconds: 0,
};

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  check: (s: Stats) => boolean;
  coins: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'primeira_fuga', name: 'Primeira Fuga', desc: 'Escape do complexo pela primeira vez.', check: (s) => s.escapes >= 1, coins: 100 },
  { id: 'sobrevivente_nato', name: 'Sobrevivente Nato', desc: 'Escape 10 vezes.', check: (s) => s.escapes >= 10, coins: 300 },
  { id: 'anjo_da_guarda', name: 'Anjo da Guarda', desc: 'Resgate 10 companheiros caídos.', check: (s) => s.revives >= 10, coins: 250 },
  { id: 'engrenagem', name: 'Engrenagem', desc: 'Conclua 25 objetivos.', check: (s) => s.objectives >= 25, coins: 200 },
  { id: 'carteiro', name: 'Carteiro das Profundezas', desc: 'Entregue 30 itens de objetivo.', check: (s) => s.itemsDelivered >= 30, coins: 150 },
  { id: 'predador', name: 'Predador', desc: 'Vença uma partida como entidade.', check: (s) => s.entityWins >= 1, coins: 100 },
  { id: 'ressonancia_total', name: 'Ressonância Total', desc: 'Elimine 25 sobreviventes.', check: (s) => s.kills >= 25, coins: 300 },
  { id: 'ventriloquo', name: 'Ventríloquo', desc: 'Use o Eco Falso 50 vezes.', check: (s) => s.echoes >= 50, coins: 150 },
  { id: 'veterano', name: 'Veterano do Véu', desc: 'Jogue 25 partidas.', check: (s) => s.matches >= 25, coins: 200 },
];

// ---- Temporadas ----
export interface SeasonTier {
  tier: number;
  xp: number; // XP de temporada acumulado necessário
  reward: { coins?: number; cosmetic?: string };
}
export interface Season {
  id: string;
  name: string;
  start: string;
  end: string;
  tiers: SeasonTier[];
}

export const SEASONS: Season[] = [
  {
    id: 's1',
    name: 'Temporada 1 — Pressão Abissal',
    start: '2026-11-01',
    end: '2027-02-28',
    tiers: [
      { tier: 1, xp: 150, reward: { coins: 50 } },
      { tier: 2, xp: 400, reward: { coins: 75 } },
      { tier: 3, xp: 750, reward: { cosmetic: 'acc_cachecol' } },
      { tier: 4, xp: 1200, reward: { coins: 100 } },
      { tier: 5, xp: 1800, reward: { coins: 150 } },
      { tier: 6, xp: 2600, reward: { cosmetic: 'uni_abissal' } },
      { tier: 7, xp: 3600, reward: { coins: 250 } },
    ],
  },
];

export function currentSeason(now = new Date()): Season {
  const iso = now.toISOString().slice(0, 10);
  return SEASONS.find((s) => iso >= s.start && iso <= s.end) ?? SEASONS[SEASONS.length - 1];
}
