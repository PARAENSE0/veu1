/**
 * Melhorias permanentes compradas com fragmentos (◈).
 *
 * Os valores por nível são pequenos de propósito: uma conta no máximo ganha
 * vantagem perceptível, mas não decisiva. Em especial, o ataque comum da
 * entidade com "Poder de ataque" no máximo continua abaixo de 21% da vida de um
 * humano — nunca dois golpes para derrubar (ver tests/unit.ts).
 */
export type HumanUpgrade = 'estamina' | 'recuperacao' | 'velocidade' | 'resistencia' | 'interacao';
export type MonsterUpgrade = 'm_velocidade' | 'm_resistencia' | 'm_ataque' | 'm_recarga' | 'm_eficiencia';
export type UpgradeId = HumanUpgrade | MonsterUpgrade;

export interface UpgradeDef {
  id: UpgradeId;
  side: 'humano' | 'monstro';
  name: string;
  /** benefício por nível (ex.: 0.05 = +5%) */
  perLevel: number;
  /** texto do efeito para um total (ex.: "+15% de fôlego") */
  fmt: (total: number) => string;
  desc: string;
}

export const MAX_UPGRADE_LEVEL = 5;
/** custo do próximo nível (índice = nível atual) */
export const UPGRADE_COSTS = [300, 700, 1200, 2000, 3000];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  estamina: { id: 'estamina', side: 'humano', name: 'Estamina máxima', perLevel: 0.05, fmt: (t) => `+${pct(t)} de fôlego`, desc: 'Corra por mais tempo antes de ficar exausto.' },
  recuperacao: { id: 'recuperacao', side: 'humano', name: 'Recuperação da estamina', perLevel: 0.1, fmt: (t) => `+${pct(t)} de recuperação`, desc: 'O fôlego volta mais rápido.' },
  velocidade: { id: 'velocidade', side: 'humano', name: 'Velocidade de movimentação', perLevel: 0.01, fmt: (t) => `+${pct(t)} de velocidade`, desc: 'Anda e corre um pouco mais rápido.' },
  resistencia: { id: 'resistencia', side: 'humano', name: 'Resistência física', perLevel: 0.03, fmt: (t) => `-${pct(t)} de dano recebido`, desc: 'Reduz o dano dos golpes da entidade.' },
  interacao: { id: 'interacao', side: 'humano', name: 'Velocidade de interação', perLevel: 0.06, fmt: (t) => `+${pct(t)} de rapidez`, desc: 'Consoles, cápsula, resgates, cura e coleta mais rápidos.' },
  m_velocidade: { id: 'm_velocidade', side: 'monstro', name: 'Velocidade de movimentação', perLevel: 0.01, fmt: (t) => `+${pct(t)} de velocidade`, desc: 'A entidade se move um pouco mais rápido.' },
  m_resistencia: { id: 'm_resistencia', side: 'monstro', name: 'Resistência', perLevel: 0.03, fmt: (t) => `-${pct(t)} de dano recebido`, desc: 'Reduz o dano das armas dos humanos.' },
  m_ataque: { id: 'm_ataque', side: 'monstro', name: 'Poder de ataque', perLevel: 0.03, fmt: (t) => `+${pct(t)} de dano`, desc: 'Golpes comuns e especiais mais fortes (com teto de equilíbrio).' },
  m_recarga: { id: 'm_recarga', side: 'monstro', name: 'Recuperação de habilidades', perLevel: 0.04, fmt: (t) => `-${pct(t)} de recarga`, desc: 'Habilidades e golpe especial voltam mais cedo.' },
  m_eficiencia: { id: 'm_eficiencia', side: 'monstro', name: 'Eficiência das habilidades', perLevel: 0.06, fmt: (t) => `+${pct(t)} de duração`, desc: 'Rastro, Eco Falso, Ruptura e Parasita duram mais.' },
};

export const HUMAN_UPGRADES: HumanUpgrade[] = ['estamina', 'recuperacao', 'velocidade', 'resistencia', 'interacao'];
export const MONSTER_UPGRADES: MonsterUpgrade[] = ['m_velocidade', 'm_resistencia', 'm_ataque', 'm_recarga', 'm_eficiencia'];

export type UpgradeLevels = Record<UpgradeId, number>;
export const EMPTY_UPGRADES: UpgradeLevels = {
  estamina: 0,
  recuperacao: 0,
  velocidade: 0,
  resistencia: 0,
  interacao: 0,
  m_velocidade: 0,
  m_resistencia: 0,
  m_ataque: 0,
  m_recarga: 0,
  m_eficiencia: 0,
};

/** Modificadores efetivos usados na partida (calculados no servidor). */
export interface Mods {
  staminaMax: number;
  staminaRegenMult: number;
  speedMult: number;
  damageTakenMult: number;
  interactMult: number;
  attackMult: number;
  cooldownMult: number;
  durationMult: number;
}

export function modsFor(role: 'survivor' | 'entity', lv: Partial<UpgradeLevels>): Mods {
  const l = (id: UpgradeId) => Math.max(0, Math.min(MAX_UPGRADE_LEVEL, lv[id] ?? 0)) * UPGRADES[id].perLevel;
  if (role === 'survivor') {
    return {
      staminaMax: 100 * (1 + l('estamina')),
      staminaRegenMult: 1 + l('recuperacao'),
      speedMult: 1 + l('velocidade'),
      damageTakenMult: 1 - l('resistencia'),
      interactMult: 1 + l('interacao'),
      attackMult: 1,
      cooldownMult: 1,
      durationMult: 1,
    };
  }
  return {
    staminaMax: 100,
    staminaRegenMult: 1,
    speedMult: 1 + l('m_velocidade'),
    damageTakenMult: 1 - l('m_resistencia'),
    interactMult: 1,
    attackMult: 1 + l('m_ataque'),
    cooldownMult: 1 - l('m_recarga'),
    durationMult: 1 + l('m_eficiencia'),
  };
}
