/**
 * Modelos do jogo.
 *  - Personagens (sobrevivente e entidade): malhas orgânicas em characters.ts.
 *  - Armas e caixas de suprimento: peças mecânicas (caixas chanfradas fazem
 *    sentido para objetos fabricados).
 */
import type { SupplyKind, WeaponId } from '../../../shared/constants';
import type { Appearance, RGB } from '../../../shared/progression';
import { drawEntity as drawEntityMesh, drawSurvivor as drawSurvivorMesh, fairColor, type Base, type EntityPose, type SurvivorPose } from './characters';
import { copy, mat4, rotX, rotY, scale, translate, type Mat4 } from './math';
import type { DrawOpts, Renderer } from './renderer';
import { LAYER } from './textures';

export { fairColor, type EntityPose, type SurvivorPose };

const B = mat4();
const M = mat4();
const ID = mat4();

function box(r: Renderer, parent: Mat4, tx: number, ty: number, tz: number, sx: number, sy: number, sz: number, layer: number, tint: RGB, b: Base, extra?: Partial<DrawOpts>) {
  copy(M, parent);
  translate(M, tx, ty, tz);
  scale(M, sx, sy, sz);
  r.draw(r.cube, M, { layer, tint, alpha: b.alpha, emit: b.emit, uv: [Math.max(sx, 0.3), Math.max(sy, 0.3)], ...extra });
}

export function drawSurvivor(r: Renderer, ap: Appearance, p: SurvivorPose, b: Base) {
  drawSurvivorMesh(r, ap, p, b, drawWeapon);
}

export function drawEntity(r: Renderer, body: RGB, glow: RGB, p: EntityPose, b: Base) {
  drawEntityMesh(r, body, glow, p, b);
}

/** Arma no sistema local da mão (frente = -Z). Usada no corpo e na visão em 1ª pessoa. */
export function drawWeapon(r: Renderer, parent: Mat4, w: WeaponId, b: Base, firing: boolean, time: number) {
  const metal: RGB = [0.22, 0.23, 0.25];
  const dark: RGB = [0.12, 0.12, 0.13];
  if (w === 'pistola') {
    box(r, parent, 0, -0.06, 0.03, 0.04, 0.12, 0.05, LAYER.PLAIN, dark, b);
    box(r, parent, 0, 0.0, -0.06, 0.045, 0.05, 0.22, LAYER.PLAIN, metal, b);
    box(r, parent, 0, 0.03, -0.16, 0.01, 0.015, 0.01, LAYER.PLAIN, [0.9, 0.5, 0.2], b, { emit: [0.4, 0.2, 0.05] });
  } else if (w === 'fuzil') {
    box(r, parent, 0, 0, -0.12, 0.06, 0.08, 0.5, LAYER.PLAIN, dark, b);
    box(r, parent, 0, 0.015, -0.47, 0.025, 0.025, 0.22, LAYER.PLAIN, metal, b);
    box(r, parent, 0, -0.1, -0.12, 0.04, 0.15, 0.07, LAYER.PLAIN, metal, b);
    box(r, parent, 0, -0.03, 0.18, 0.05, 0.1, 0.2, LAYER.CRATE, [0.45, 0.35, 0.25], b);
    box(r, parent, 0, 0.065, -0.1, 0.02, 0.03, 0.08, LAYER.PLAIN, [0.1, 0.1, 0.1], b);
  } else if (w === 'escopeta') {
    const wood: RGB = [0.42, 0.26, 0.14];
    // cano duplo sobreposto, guarda-mão de bomba, coronha de madeira
    box(r, parent, 0, 0.02, -0.33, 0.035, 0.035, 0.56, LAYER.PLAIN, metal, b);
    box(r, parent, 0, -0.018, -0.3, 0.032, 0.032, 0.5, LAYER.PLAIN, dark, b);
    box(r, parent, 0, -0.025, -0.33 + (firing ? 0.05 : 0), 0.06, 0.05, 0.16, LAYER.CRATE, wood, b);
    box(r, parent, 0, 0, -0.02, 0.06, 0.08, 0.2, LAYER.PLAIN, dark, b);
    box(r, parent, 0, -0.08, -0.02, 0.035, 0.12, 0.05, LAYER.PLAIN, dark, b);
    box(r, parent, 0, -0.035, 0.18, 0.05, 0.1, 0.24, LAYER.CRATE, wood, b);
    box(r, parent, 0, 0.045, -0.6, 0.008, 0.012, 0.01, LAYER.PLAIN, [0.9, 0.85, 0.6], b);
  } else {
    box(r, parent, 0, 0, -0.1, 0.08, 0.1, 0.45, LAYER.PLAIN, [0.55, 0.16, 0.1], b);
    box(r, parent, 0, 0.01, -0.4, 0.05, 0.05, 0.16, LAYER.PLAIN, metal, b);
    box(r, parent, 0, -0.09, 0.0, 0.04, 0.12, 0.06, LAYER.PLAIN, dark, b);
    // chama piloto azul
    const k = 0.6 + 0.4 * Math.sin(time * 30);
    box(r, parent, 0, 0.01, -0.49, 0.02, 0.02, 0.03, LAYER.PLAIN, [0.3, 0.6, 1], b, { emit: [0.3 * k, 0.6 * k, 1 * k], unlit: 1 });
  }
  if (firing && w !== 'lanca') {
    const tip = w === 'pistola' ? -0.2 : w === 'escopeta' ? -0.64 : -0.6;
    const s = (w === 'escopeta' ? 0.16 : 0.08) + Math.random() * 0.06;
    box(r, parent, 0, 0.015, tip, s, s, s * 1.6, LAYER.PLAIN, [1, 0.8, 0.4], b, { emit: [1.5, 1.1, 0.5], unlit: 1 });
  }
}

/** Caixas de munição e galão de combustível. claimed = alguém coletando (tampa abre). */
export function drawSupply(r: Renderer, kind: SupplyKind, x: number, z: number, time: number, claimed: boolean, b: Base) {
  copy(B, ID);
  translate(B, x, 0, z);
  rotY(B, (x * 7.13 + z * 3.7) % Math.PI);
  const pulse = claimed ? 0.5 + 0.5 * Math.sin(time * 14) : 0.25 + 0.1 * Math.sin(time * 2 + x);
  if (kind === 'combustivel') {
    const red: RGB = [0.7, 0.12, 0.08];
    box(r, B, 0, 0.25, 0, 0.36, 0.5, 0.2, LAYER.PLAIN, red, b);
    box(r, B, 0, 0.53, 0.04, 0.24, 0.05, 0.04, LAYER.PLAIN, [0.2, 0.2, 0.2], b);
    box(r, B, 0.12, 0.54 + (claimed ? 0.05 : 0), -0.05, 0.06, 0.07, 0.06, LAYER.PLAIN, [0.85, 0.75, 0.2], b);
    box(r, B, 0, 0.28, -0.101, 0.3, 0.06, 0.005, LAYER.PLAIN, [1, 0.5, 0.2], b, { emit: [pulse, pulse * 0.4, pulse * 0.1] });
    return;
  }
  const long = kind === 'mun_fuzil';
  const w = long ? 0.8 : kind === 'mun_escopeta' ? 0.62 : 0.5;
  const stripe: RGB = long ? [0.45, 0.9, 0.35] : kind === 'mun_escopeta' ? [1, 0.3, 0.25] : [1, 0.8, 0.25];
  const olive: RGB = [0.3, 0.33, 0.2];
  box(r, B, 0, 0.15, 0, w, 0.3, 0.36, LAYER.CRATE, olive, b);
  // tampa: abre durante a coleta
  const lid = mat4();
  copy(lid, B);
  translate(lid, 0, 0.3, 0.18);
  rotX(lid, claimed ? -0.9 - 0.2 * Math.sin(time * 6) : 0);
  box(r, lid, 0, 0.02, -0.18, w + 0.02, 0.05, 0.38, LAYER.CRATE, olive, b);
  box(r, B, 0, 0.2, -0.182, w * 0.8, 0.05, 0.005, LAYER.PLAIN, stripe, b, { emit: [stripe[0] * pulse, stripe[1] * pulse, stripe[2] * pulse] });
  if (claimed) {
    // cartuchos à mostra
    for (let i = 0; i < 5; i++) box(r, B, -w / 2 + 0.08 + i * (w - 0.16) / 4, 0.31, 0, 0.03, 0.06, 0.03, LAYER.PLAIN, [0.85, 0.65, 0.3], b);
  }
}

/** Arma no chão (para pegar): gira devagar e tem um brilho de destaque. */
export function drawGroundWeapon(r: Renderer, w: WeaponId, x: number, z: number, time: number, b: Base) {
  copy(B, ID);
  translate(B, x, 0.35 + Math.sin(time * 2 + x) * 0.04, z);
  rotY(B, time * 0.8 + x);
  rotY(B, Math.PI / 2);
  scale(B, 1.4, 1.4, 1.4);
  drawWeapon(r, B, w, b, false, time);
  // base luminosa no chão
  const M2 = mat4();
  copy(M2, ID);
  translate(M2, x, 0.01, z);
  scale(M2, 0.8, 0.01, 0.8);
  const k = 0.35 + 0.15 * Math.sin(time * 3 + z);
  r.draw(r.cube, M2, { layer: LAYER.DECAL, tint: [0.4, 0.9, 1], alpha: 0.5 * b.alpha, emit: [0.25 * k, 0.6 * k, 0.7 * k], unlit: 1 });
}

/** Caixa Médica (armário branco com cruz vermelha luminosa) encostada na parede. */
export function drawMedbox(r: Renderer, x: number, z: number, facing: number, time: number, active: boolean, b: Base) {
  copy(B, ID);
  translate(B, x, 0, z);
  rotY(B, facing);
  const white: RGB = [0.85, 0.88, 0.9];
  box(r, B, 0, 0.55, 0.35, 1.3, 1.1, 0.5, LAYER.PLAIN, white, b);
  box(r, B, 0, 1.12, 0.35, 1.34, 0.06, 0.54, LAYER.PLAIN, [0.6, 0.62, 0.65], b);
  // portas e puxadores
  box(r, B, -0.32, 0.6, 0.095, 0.6, 0.9, 0.02, LAYER.PLAIN, [0.92, 0.94, 0.96], b);
  box(r, B, 0.32, 0.6, 0.095, 0.6, 0.9, 0.02, LAYER.PLAIN, [0.92, 0.94, 0.96], b);
  // cruz vermelha luminosa (pulsa mais forte quando alguém usa)
  const k = active ? 0.9 + 0.3 * Math.sin(time * 12) : 0.45 + 0.15 * Math.sin(time * 2);
  box(r, B, 0, 0.72, 0.08, 0.36, 0.1, 0.02, LAYER.PLAIN, [1, 0.15, 0.15], b, { emit: [k, 0.08 * k, 0.08 * k] });
  box(r, B, 0, 0.72, 0.08, 0.1, 0.36, 0.02, LAYER.PLAIN, [1, 0.15, 0.15], b, { emit: [k, 0.08 * k, 0.08 * k] });
}
