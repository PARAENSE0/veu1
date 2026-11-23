/**
 * Modelos procedurais originais montados com caixas + animações procedurais.
 *  - Sobrevivente: corpo humano estilizado com personalização (rosto, cabelo,
 *    roupa, calçado, acessório, uniforme). Animações: andar, correr, agachar,
 *    rastejar (caído), canalizar/curar.
 *  - O Reverberante (entidade): criatura alta e digitígrada, cabeça em forma de
 *    membrana ressonante, câmaras luminosas no tórax, braços-lâmina e tentáculos.
 *    Animações: ocioso, andar, espreitar, ataque, Rastro, Eco Falso, Ruptura, Parasita.
 */
import type { SupplyKind, WeaponId } from '../../../shared/constants';
import type { Appearance, RGB } from '../../../shared/progression';
import { copy, mat4, rotX, rotY, rotZ, scale, translate, type Mat4 } from './math';
import type { DrawOpts, Renderer } from './renderer';
import { LAYER } from './textures';

const B = mat4();
const M = mat4();
const P = mat4();

/** Impede roupas quase pretas/brancas (vantagem de camuflagem no escuro). */
export function fairColor(c: RGB): RGB {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const min = 0.22;
  const max = 0.82;
  if (l < min) {
    const k = l > 0.001 ? min / l : 0;
    return l > 0.001 ? [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)] : [min, min, min];
  }
  if (l > max) {
    const k = max / l;
    return [c[0] * k, c[1] * k, c[2] * k];
  }
  return c;
}

interface Base {
  alpha: number;
  emit: [number, number, number];
}

function box(r: Renderer, parent: Mat4, tx: number, ty: number, tz: number, sx: number, sy: number, sz: number, layer: number, tint: RGB, b: Base, extra?: Partial<DrawOpts>) {
  copy(M, parent);
  translate(M, tx, ty, tz);
  scale(M, sx, sy, sz);
  r.draw(r.cube, M, { layer, tint, alpha: b.alpha, emit: b.emit, uv: [Math.max(sx, 0.3), Math.max(sy, 0.3)], ...extra });
}

export interface SurvivorPose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  phase: number;
  crouch: boolean;
  downed: boolean;
  channel: boolean;
  flash: boolean;
  time: number;
  /** arma em mãos (ausente = mãos livres) */
  weapon?: WeaponId;
  firing?: boolean;
  reloading?: boolean;
  collecting?: boolean;
}

export function drawSurvivor(r: Renderer, ap: Appearance, p: SurvivorPose, b: Base) {
  const torso = fairColor(ap.torso);
  const legs = fairColor(ap.legs);
  copy(B, identityM());
  translate(B, p.x, p.downed ? 0.2 : 0, p.z);
  rotY(B, p.yaw);
  if (p.downed) {
    rotX(B, -1.42);
    translate(B, 0, -0.3, 0);
  }
  const crouch = p.crouch && !p.downed;
  const hipY = crouch ? 0.6 : 0.92;
  const legLen = crouch ? 0.62 : 0.88;
  const amp = Math.min(0.75, p.speed * (crouch ? 0.22 : 0.15));
  const sw = Math.sin(p.phase) * amp;
  const lean = crouch ? 0.32 : Math.min(0.18, p.speed * 0.025);

  // pernas
  for (const side of [-1, 1]) {
    copy(P, B);
    translate(P, side * 0.12, hipY, 0);
    rotX(P, side * sw + (crouch ? -0.5 : 0));
    box(r, P, 0, -legLen / 2, 0, 0.17, legLen, 0.2, LAYER.FABRIC, legs, b);
    if (ap.stripe) box(r, P, 0, -legLen * 0.75, 0, 0.18, 0.05, 0.21, LAYER.PLAIN, ap.stripe, b, { emit: [ap.stripe[0] * 0.15, ap.stripe[1] * 0.15, ap.stripe[2] * 0.15] });
    box(r, P, 0, -legLen + 0.04, -0.05, 0.19, ap.boots ? 0.2 : 0.12, 0.3, LAYER.PLAIN, ap.shoeColor, b);
  }
  // tronco
  copy(P, B);
  translate(P, 0, hipY, 0);
  rotX(P, -lean);
  box(r, P, 0, 0.31, 0, 0.46, 0.62, 0.26, LAYER.FABRIC, torso, b);
  if (ap.coat) box(r, P, 0, -0.12, 0, 0.5, 0.42, 0.3, LAYER.FABRIC, torso, b);
  if (ap.stripe) box(r, P, 0, 0.4, 0, 0.47, 0.06, 0.27, LAYER.PLAIN, ap.stripe, b, { emit: [ap.stripe[0] * 0.15, ap.stripe[1] * 0.15, ap.stripe[2] * 0.15] });
  // lanterna no peito
  box(r, P, 0.13, 0.42, -0.15, 0.08, 0.08, 0.1, LAYER.PLAIN, [0.2, 0.2, 0.22], b, p.flash ? { emit: [1, 0.95, 0.8] } : {});
  // tanque do lança-chamas nas costas
  if (p.weapon === 'lanca') {
    box(r, P, -0.09, 0.32, 0.22, 0.14, 0.46, 0.14, LAYER.PLAIN, [0.62, 0.14, 0.1], b);
    box(r, P, 0.09, 0.32, 0.22, 0.14, 0.46, 0.14, LAYER.PLAIN, [0.62, 0.14, 0.1], b);
    box(r, P, 0, 0.6, 0.22, 0.3, 0.05, 0.05, LAYER.PLAIN, [0.25, 0.25, 0.27], b);
  }
  const aiming = !!p.weapon && !p.downed && !p.channel && !p.collecting;
  if (ap.acc === 'cachecol') box(r, P, 0, 0.6, 0, 0.36, 0.1, 0.3, LAYER.FABRIC, ap.accColor, b);
  // braços
  for (const side of [-1, 1]) {
    copy(M, P);
    const sh = mat4();
    copy(sh, P);
    translate(sh, side * 0.3, 0.58, 0);
    let ax = -side * sw * 0.9;
    if (p.channel || p.collecting) ax = -1.1 + Math.sin(p.time * 8 + side) * 0.1;
    else if (aiming) ax = p.reloading ? -0.9 : side > 0 ? -1.45 : -1.3;
    if (p.downed) ax = -2.6 + Math.sin(p.phase + (side > 0 ? 0 : Math.PI)) * 0.6;
    rotX(sh, ax);
    rotZ(sh, aiming && !p.reloading ? -side * 0.3 : side * 0.08);
    box(r, sh, 0, -0.3, 0, 0.13, 0.6, 0.14, LAYER.FABRIC, torso, b);
    box(r, sh, 0, -0.64, 0, 0.11, 0.1, 0.12, LAYER.PLAIN, ap.skin, b);
  }
  // arma nas mãos
  if (aiming && p.weapon) {
    const W = mat4();
    copy(W, P);
    translate(W, 0.06, p.reloading ? 0.3 : 0.45, -0.42);
    if (p.reloading) rotX(W, -0.6);
    drawWeapon(r, W, p.weapon, b, p.firing ?? false, p.time);
  }
  // cabeça
  const H = mat4();
  copy(H, P);
  translate(H, 0, 0.62, 0);
  rotX(H, Math.max(-0.6, Math.min(0.6, p.pitch * 0.6)));
  drawHead(r, H, ap, b);
}

function drawHead(r: Renderer, H: Mat4, ap: Appearance, b: Base) {
  box(r, H, 0, 0.05, 0, 0.12, 0.1, 0.12, LAYER.PLAIN, ap.skin, b); // pescoço
  box(r, H, 0, 0.24, 0, 0.25, 0.28, 0.26, LAYER.PLAIN, ap.skin, b);
  // olhos
  box(r, H, -0.06, 0.27, -0.131, 0.045, 0.03, 0.01, LAYER.PLAIN, [0.08, 0.08, 0.1], b);
  box(r, H, 0.06, 0.27, -0.131, 0.045, 0.03, 0.01, LAYER.PLAIN, [0.08, 0.08, 0.1], b);
  if (ap.beard) box(r, H, 0, 0.14, -0.06, 0.26, 0.1, 0.16, LAYER.FABRIC, ap.hairColor, b);
  if (ap.scar) box(r, H, 0.08, 0.24, -0.132, 0.02, 0.12, 0.01, LAYER.PLAIN, [0.55, 0.2, 0.2], b);
  switch (ap.hairStyle) {
    case 'curto':
      box(r, H, 0, 0.39, 0.02, 0.27, 0.06, 0.28, LAYER.FABRIC, ap.hairColor, b);
      box(r, H, 0, 0.3, 0.1, 0.27, 0.14, 0.08, LAYER.FABRIC, ap.hairColor, b);
      break;
    case 'raspado':
      box(r, H, 0, 0.385, 0.01, 0.255, 0.02, 0.265, LAYER.FABRIC, ap.hairColor, b);
      break;
    case 'coque':
      box(r, H, 0, 0.39, 0.02, 0.27, 0.05, 0.28, LAYER.FABRIC, ap.hairColor, b);
      box(r, H, 0, 0.36, 0.17, 0.12, 0.12, 0.1, LAYER.FABRIC, ap.hairColor, b);
      break;
    case 'longo':
      box(r, H, 0, 0.39, 0.02, 0.27, 0.06, 0.28, LAYER.FABRIC, ap.hairColor, b);
      box(r, H, 0, 0.18, 0.12, 0.28, 0.4, 0.06, LAYER.FABRIC, ap.hairColor, b);
      break;
    case 'moicano':
      box(r, H, 0, 0.43, 0.02, 0.06, 0.12, 0.3, LAYER.FABRIC, ap.hairColor, b);
      break;
    default:
      break;
  }
  switch (ap.acc) {
    case 'capacete':
      box(r, H, 0, 0.42, 0, 0.31, 0.1, 0.32, LAYER.PLAIN, ap.accColor, b);
      box(r, H, 0, 0.385, -0.17, 0.31, 0.03, 0.08, LAYER.PLAIN, ap.accColor, b);
      box(r, H, 0, 0.42, -0.165, 0.06, 0.05, 0.02, LAYER.PLAIN, [1, 1, 0.9], b, { emit: [0.4, 0.4, 0.35] });
      break;
    case 'oculos':
      box(r, H, 0, 0.28, -0.135, 0.24, 0.07, 0.02, LAYER.GLASS, ap.accColor, b);
      box(r, H, 0, 0.28, 0, 0.27, 0.03, 0.27, LAYER.PLAIN, [0.15, 0.15, 0.15], b);
      break;
    case 'fone':
      box(r, H, -0.14, 0.25, 0, 0.05, 0.1, 0.1, LAYER.PLAIN, ap.accColor, b);
      box(r, H, 0.14, 0.25, 0, 0.05, 0.1, 0.1, LAYER.PLAIN, ap.accColor, b);
      box(r, H, 0, 0.41, 0, 0.3, 0.03, 0.05, LAYER.PLAIN, ap.accColor, b);
      box(r, H, -0.14, 0.2, -0.1, 0.02, 0.02, 0.12, LAYER.PLAIN, ap.accColor, b);
      break;
    case 'mascara':
      box(r, H, 0, 0.18, -0.13, 0.2, 0.12, 0.06, LAYER.PLAIN, ap.accColor, b);
      box(r, H, -0.08, 0.16, -0.17, 0.06, 0.06, 0.04, LAYER.GRATE, [0.6, 0.6, 0.6], b);
      box(r, H, 0.08, 0.16, -0.17, 0.06, 0.06, 0.04, LAYER.GRATE, [0.6, 0.6, 0.6], b);
      break;
    default:
      break;
  }
}

const ID = mat4();
function identityM() {
  return ID;
}

export interface EntityPose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  phase: number;
  time: number;
  stalk: boolean;
  attack: number; // 0..1 (preparação do golpe)
  dash: boolean;
  eco: number; // 0..1
  rastro: boolean;
  parasite: number; // 0..1
}

/** Desenha O Reverberante. glowK multiplica o brilho (pulsa com sons). */
export function drawEntity(r: Renderer, body: RGB, glow: RGB, p: EntityPose, b: Base) {
  const pulse = 0.55 + 0.45 * Math.sin(p.time * (p.dash ? 18 : 4));
  const g = (k: number): [number, number, number] => [glow[0] * k, glow[1] * k, glow[2] * k];
  const glowOpts = (k: number): Partial<DrawOpts> => ({ emit: g(k * (b.alpha < 1 ? b.alpha : 1)) });
  copy(B, ID);
  translate(B, p.x, 0, p.z);
  rotY(B, p.yaw);
  const stalk = p.stalk ? 0.35 : 0;
  const lean = (p.dash ? 0.55 : 0.12) + stalk * 0.6 + p.attack * 0.25;
  const amp = Math.min(0.65, p.speed * 0.12);
  const sw = Math.sin(p.phase) * amp;
  const hipY = 1.25 - stalk * 0.4 + Math.abs(Math.sin(p.phase)) * 0.05;

  // pernas digitígradas: coxa para frente, canela para trás, pé longo
  for (const side of [-1, 1]) {
    copy(P, B);
    translate(P, side * 0.2, hipY, 0);
    rotX(P, side * sw - 0.55 - stalk * 0.3);
    box(r, P, 0, -0.32, 0, 0.16, 0.66, 0.18, LAYER.FLESH, body, b);
    translate(P, 0, -0.64, 0);
    rotX(P, 1.25 + stalk * 0.4);
    box(r, P, 0, -0.32, 0, 0.11, 0.66, 0.12, LAYER.FLESH, body, b);
    translate(P, 0, -0.64, 0);
    rotX(P, -0.7 - stalk * 0.1);
    box(r, P, 0, -0.04, -0.12, 0.13, 0.07, 0.34, LAYER.FLESH, body, b);
  }
  // pélvis + coluna segmentada
  copy(P, B);
  translate(P, 0, hipY, 0);
  box(r, P, 0, 0, 0, 0.36, 0.2, 0.24, LAYER.FLESH, body, b);
  const S = mat4();
  copy(S, P);
  for (let i = 0; i < 3; i++) {
    rotX(S, -lean / 2 + Math.sin(p.time * 1.3 + i) * 0.03);
    translate(S, 0, 0.12, 0);
    const w = 0.34 + i * 0.08;
    box(r, S, 0, 0.12, 0, w, 0.26, 0.26 + i * 0.03, LAYER.FLESH, body, b);
    // câmaras ressonantes: frestas luminosas nas laterais
    box(r, S, -w / 2 - 0.005, 0.12, 0, 0.02, 0.18, 0.2, LAYER.PLAIN, glow, b, glowOpts(0.6 + pulse * 0.6 + p.eco));
    box(r, S, w / 2 + 0.005, 0.12, 0, 0.02, 0.18, 0.2, LAYER.PLAIN, glow, b, glowOpts(0.6 + pulse * 0.6 + p.eco));
    translate(S, 0, 0.14, 0);
  }
  // tentáculos dorsais (Parasita os estende para frente)
  for (let i = 0; i < 3; i++) {
    const T = mat4();
    copy(T, S);
    translate(T, (i - 1) * 0.14, 0.05, 0.16);
    rotX(T, 0.9 - p.parasite * 2.4 + Math.sin(p.time * 2.5 + i * 2) * 0.25);
    rotZ(T, (i - 1) * 0.35);
    for (let k = 0; k < 3; k++) {
      box(r, T, 0, 0.18, 0, 0.05 - k * 0.012, 0.36, 0.05 - k * 0.012, LAYER.FLESH, body, b, k === 2 ? glowOpts(0.5 + p.parasite * 1.5) : {});
      translate(T, 0, 0.34, 0);
      rotX(T, 0.25 + Math.sin(p.time * 3 + i + k) * 0.2);
    }
  }
  // braços-lâmina
  for (const side of [-1, 1]) {
    const A = mat4();
    copy(A, S);
    translate(A, side * 0.3, -0.02, 0);
    let ax = -0.2 + side * sw * 0.6;
    if (side === 1 && p.attack > 0) ax = -2.6 * p.attack;
    if (p.dash) ax = 0.9;
    rotX(A, ax);
    rotZ(A, side * 0.25);
    box(r, A, 0, -0.42, 0, 0.11, 0.84, 0.12, LAYER.FLESH, body, b);
    translate(A, 0, -0.84, 0);
    rotX(A, -0.5 - (side === 1 ? p.attack * 0.6 : 0));
    box(r, A, 0, -0.42, 0, 0.09, 0.84, 0.1, LAYER.FLESH, body, b);
    translate(A, 0, -0.84, 0);
    box(r, A, 0, -0.3, -0.03, 0.03, 0.62, 0.16, LAYER.PLAIN, [0.85, 0.85, 0.9], b);
    box(r, A, 0, -0.3, -0.115, 0.035, 0.6, 0.015, LAYER.PLAIN, glow, b, glowOpts(0.7 + p.attack * 1.5));
  }
  // bracinhos dobrados no peito
  for (const side of [-1, 1]) {
    const A = mat4();
    copy(A, S);
    translate(A, side * 0.12, -0.2, -0.16);
    rotX(A, -1.2 + Math.sin(p.time * 6 + side) * 0.15);
    box(r, A, 0, -0.12, 0, 0.05, 0.24, 0.05, LAYER.FLESH, body, b);
  }
  // cabeça: membrana vertical com anéis luminosos
  const H = mat4();
  copy(H, S);
  translate(H, 0, 0.08, -0.05);
  rotX(H, Math.max(-0.5, Math.min(0.5, p.pitch * 0.5)) + (p.rastro ? 0.5 : 0));
  box(r, H, 0, 0.1, 0, 0.12, 0.22, 0.12, LAYER.FLESH, body, b);
  const vib = p.eco > 0 ? 1 + Math.sin(p.time * 60) * 0.06 * p.eco : 1;
  const Hd = mat4();
  copy(Hd, H);
  translate(Hd, 0, 0.5, -0.04);
  scale(Hd, vib, vib, 1);
  box(r, Hd, 0, 0, 0, 0.5, 0.72, 0.08, LAYER.FLESH, body, b);
  for (let k = 0; k < 3; k++) {
    const rr = 0.08 + k * 0.08;
    const kk = 0.5 + pulse * 0.8 + p.eco * 2 + (p.rastro ? 1 : 0);
    box(r, Hd, 0, rr * 1.3, -0.045, rr * 1.6, 0.025, 0.01, LAYER.PLAIN, glow, b, glowOpts(kk));
    box(r, Hd, 0, -rr * 1.3, -0.045, rr * 1.6, 0.025, 0.01, LAYER.PLAIN, glow, b, glowOpts(kk));
    box(r, Hd, rr, 0, -0.045, 0.025, rr * 2.4, 0.01, LAYER.PLAIN, glow, b, glowOpts(kk));
    box(r, Hd, -rr, 0, -0.045, 0.025, rr * 2.4, 0.01, LAYER.PLAIN, glow, b, glowOpts(kk));
  }
  box(r, Hd, 0, 0, -0.05, 0.06, 0.06, 0.01, LAYER.PLAIN, glow, b, glowOpts(1.5 + p.eco * 3));
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
  } else {
    box(r, parent, 0, 0, -0.1, 0.08, 0.1, 0.45, LAYER.PLAIN, [0.55, 0.16, 0.1], b);
    box(r, parent, 0, 0.01, -0.4, 0.05, 0.05, 0.16, LAYER.PLAIN, metal, b);
    box(r, parent, 0, -0.09, 0.0, 0.04, 0.12, 0.06, LAYER.PLAIN, dark, b);
    // chama piloto azul
    const k = 0.6 + 0.4 * Math.sin(time * 30);
    box(r, parent, 0, 0.01, -0.49, 0.02, 0.02, 0.03, LAYER.PLAIN, [0.3, 0.6, 1], b, { emit: [0.3 * k, 0.6 * k, 1 * k], unlit: 1 });
  }
  if (firing && w !== 'lanca') {
    const tip = w === 'pistola' ? -0.2 : -0.6;
    const s = 0.08 + Math.random() * 0.06;
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
  const w = long ? 0.8 : 0.5;
  const stripe: RGB = long ? [0.45, 0.9, 0.35] : [1, 0.8, 0.25];
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
