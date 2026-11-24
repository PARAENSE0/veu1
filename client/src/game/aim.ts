/**
 * Assistência de mira (somente para sobreviventes com arma em mãos).
 *
 * - NÃO atira sozinha: só ajusta a câmera de leve e reduz a sensibilidade
 *   quando a mira passa sobre a entidade ("fricção").
 * - Só age se a entidade estiver visível para o jogador (o servidor já não
 *   envia o que está fora da visão), dentro do alcance da arma, dentro de um
 *   cone pequeno à frente da mira e sem parede no caminho.
 * - Não age sobre a entidade camuflada (não revela nada que o jogo esconde).
 * - Mais forte no celular (toque) e moderada no PC; pode ser desligada.
 * - O servidor continua validando alcance, linha de visão e dano: a
 *   assistência não muda nenhuma regra de acerto.
 */
export type AimLevel = 'auto' | 'desligada' | 'leve' | 'media' | 'forte';

export interface AimParams {
  /** fração do erro angular corrigida por segundo */
  pull: number;
  /** meio-ângulo do cone de captura (rad) */
  cone: number;
  /** redução de sensibilidade com a mira sobre o alvo (0..1) */
  friction: number;
}

export const AIM_LEVELS: Record<Exclude<AimLevel, 'auto'>, AimParams | null> = {
  desligada: null,
  leve: { pull: 1.6, cone: 0.1, friction: 0.25 },
  media: { pull: 3.2, cone: 0.15, friction: 0.4 },
  forte: { pull: 5.5, cone: 0.22, friction: 0.55 },
};

/** 'auto': forte no toque, média no mouse. */
export function aimParams(level: AimLevel, touch: boolean): AimParams | null {
  if (level === 'auto') return AIM_LEVELS[touch ? 'forte' : 'media'];
  return AIM_LEVELS[level];
}

export interface AimTarget {
  x: number;
  y: number;
  z: number;
  /** raio do alvo (m) — usado para saber se a mira está "em cima" */
  radius: number;
}

export interface AimInput {
  eye: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  target: AimTarget | null;
  /** alcance da arma atual */
  range: number;
  /** linha de visão livre entre olho e alvo */
  visible: boolean;
  dt: number;
  params: AimParams | null;
}

export interface AimResult {
  dyaw: number;
  dpitch: number;
  /** multiplicador de sensibilidade (1 = normal) */
  sens: number;
  /** alvo dentro do cone (para o retículo indicar) */
  engaged: boolean;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function aimAssist(i: AimInput): AimResult {
  const none: AimResult = { dyaw: 0, dpitch: 0, sens: 1, engaged: false };
  const p = i.params;
  const t = i.target;
  if (!p || !t || !i.visible) return none;
  const dx = t.x - i.eye.x;
  const dy = t.y - i.eye.y;
  const dz = t.z - i.eye.z;
  const dh = Math.hypot(dx, dz);
  const dist = Math.hypot(dh, dy);
  if (dist > i.range || dist < 0.3) return none;
  // convenção do jogo: frente = (-sin(yaw), -cos(yaw)); pitch positivo olha para cima
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2(dy, dh);
  const ey = wrap(wantYaw - i.yaw);
  const ep = wantPitch - i.pitch;
  const err = Math.hypot(ey, ep);
  // cone maior de perto (o alvo ocupa mais da tela), limitado
  const cone = Math.min(p.cone * 2, p.cone + Math.atan2(t.radius, dist));
  if (err > cone) return none;
  const k = Math.min(1, p.pull * i.dt);
  const over = err < Math.atan2(t.radius, dist);
  return { dyaw: ey * k, dpitch: ep * k, sens: over ? 1 - p.friction : 1, engaged: true };
}
