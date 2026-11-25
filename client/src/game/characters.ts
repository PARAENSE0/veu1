/**
 * Personagens com malhas orgânicas procedurais (sem cubos):
 *
 *  - Sobrevivente: corpo humano com tronco anatômico, membros afunilados com
 *    articulações arredondadas, mãos, cabeça com rosto (nariz, orelhas, olhos,
 *    sobrancelhas), cabelos e acessórios em cascas curvas. Animações: parado
 *    (respiração), andar, correr, agachar, rastejar (caído), canalizar,
 *    mirar/atirar/recarregar, coletar e reação a golpe.
 *
 *  - O Reverberante (entidade): criatura alta e magra baseada na imagem de
 *    referência — pele pálida com veias e sangue, cabeça redonda e lisa com um
 *    sorriso largo de dentes, coroa de espinhos ósseos, espinhos nos ombros e
 *    ao longo da coluna, braços compridos com dedos em garra e pernas longas
 *    com pés de garras. Animações: parado, andar, correr/perseguir, espreitar,
 *    ataque comum (garra), golpe especial (duas garras), reação a dano, morte,
 *    Eco Falso, Rastro e Parasita.
 */
import type { WeaponId } from '../../../shared/constants';
import type { Appearance, RGB } from '../../../shared/progression';
import { copy, mat4, rotX, rotY, rotZ, scale, translate, type Mat4 } from './math';
import { cone, ellipsoid, limb, meshOf, place, rings, roundBox, Xf } from './meshes';
import type { DrawOpts, Geom, Mesh, Renderer } from './renderer';
import { LAYER } from './textures';

export interface Base {
  alpha: number;
  emit: [number, number, number];
}

const L = LAYER;
const ID = mat4();
const B = mat4();

function put(r: Renderer, mesh: Mesh, m: Mat4, layer: number, tint: RGB, b: Base, extra?: Partial<DrawOpts>) {
  r.draw(mesh, m, { layer, tint, alpha: b.alpha, emit: b.emit, uv: [1, 1], ...extra });
}
function child(parent: Mat4, x: number, y: number, z: number, out = mat4()) {
  copy(out, parent);
  translate(out, x, y, z);
  return out;
}

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

// =====================================================================
//                              ENTIDADE
// =====================================================================
const M_THIGH = 0.7;
const M_SHIN = 0.66;
const M_UPPER = 0.44;
const M_FORE = 0.42;

function mHead(g: Geom) {
  // crânio liso e arredondado + face inferior mais larga (onde fica o sorriso)
  ellipsoid(g, 0.19, 0.2, 0.185, L.SKIN_M, 0, 0.25, 0.01, 20, 12);
  ellipsoid(g, 0.172, 0.12, 0.16, L.SKIN_M, 0, 0.13, -0.02, 20, 10);
}
/** Coroa de espinhos: [ângulo a partir do topo, direção em volta, comprimento, raio]. */
const HEAD_SPIKES: [number, number, number, number][] = [
  [0.12, 0, 0.36, 0.036],
  [0.62, Math.PI / 2 + 0.2, 0.3, 0.032],
  [0.62, -Math.PI / 2 - 0.2, 0.3, 0.032],
  [1.12, Math.PI / 2 + 0.35, 0.22, 0.028],
  [1.12, -Math.PI / 2 - 0.35, 0.22, 0.028],
  [0.7, 0.45, 0.3, 0.032],
  [0.7, -0.45, 0.3, 0.032],
  [1.25, 0, 0.26, 0.03],
  [1.05, 1.0, 0.2, 0.026],
  [1.05, -1.0, 0.2, 0.026],
];
function mHeadSpikes(g: Geom) {
  for (const [th, ph, len, rad] of HEAD_SPIKES) place(g, Xf.at(0, 0.25, 0.01).ry(ph).rx(th).t(0, 0.16, 0), (q) => cone(q, len, rad, L.BONE, 8, 0.12));
}
function mMouth(g: Geom) {
  // cavidade escura do sorriso e órbitas fundas
  ellipsoid(g, 0.15, 0.058, 0.07, L.PLAIN, 0, 0.115, -0.105, 18, 7);
  ellipsoid(g, 0.026, 0.012, 0.012, L.PLAIN, -0.065, 0.27, -0.174, 8, 5);
  ellipsoid(g, 0.026, 0.012, 0.012, L.PLAIN, 0.065, 0.27, -0.174, 8, 5);
}
function mTeeth(g: Geom) {
  // duas fileiras de dentes quadrados seguindo a curva da mandíbula (sorriso largo)
  const n = 14;
  for (const [y, h] of [
    [0.141, 0.03],
    [0.09, 0.027],
  ] as const)
    for (let i = 0; i < n; i++) {
      const a = -1.12 + (2.24 * (i + 0.5)) / n;
      const shrink = 1 - Math.abs(a) * 0.3;
      const x = Math.sin(a) * 0.172 * 0.985;
      const z = -0.02 - Math.cos(a) * 0.16 * 0.985;
      // normal da elipse da mandíbula nesse ponto
      const yaw = Math.atan2(Math.sin(a) / 0.172, Math.cos(a) / 0.16);
      place(g, Xf.at(x, y, z).ry(-yaw), (q) => ellipsoid(q, 0.0135 * shrink, h * shrink, 0.01, L.TEETH, 0, 0, 0, 8, 5));
    }
}
function mTorso(g: Geom) {
  rings(
    g,
    [
      { y: -0.02, rx: 0.06, rz: 0.05 },
      { y: 0.02, rx: 0.13, rz: 0.09 },
      { y: 0.08, rx: 0.15, rz: 0.1 },
      { y: 0.17, rx: 0.105, rz: 0.072, oz: 0.008 },
      { y: 0.28, rx: 0.122, rz: 0.088, oz: 0.01 },
      { y: 0.38, rx: 0.148, rz: 0.108 },
      { y: 0.48, rx: 0.165, rz: 0.115, oz: -0.004 },
      { y: 0.56, rx: 0.19, rz: 0.1, oz: 0.012 },
      { y: 0.62, rx: 0.12, rz: 0.08, oz: 0.016 },
      { y: 0.67, rx: 0.05, rz: 0.05, oz: 0.02 },
    ],
    L.SKIN_M,
    { segs: 18, capTop: true },
  );
  // ombros ossudos, quadris e peitoral magro (relevo anatômico)
  for (const s of [-1, 1]) {
    ellipsoid(g, 0.06, 0.055, 0.06, L.SKIN_M, s * 0.19, 0.56, 0.012, 10, 7);
    ellipsoid(g, 0.075, 0.07, 0.07, L.SKIN_M, s * 0.085, 0.04, 0, 10, 7);
  }
}
function mBackSpikes(g: Geom) {
  // coluna: espinhos apontando para trás, maiores no alto das costas
  for (let i = 0; i < 9; i++) {
    const y = 0.6 - i * 0.058;
    const len = 0.26 - i * 0.02;
    place(g, Xf.at(0, y, 0.09 - Math.abs(i - 3) * 0.004).rx(1.25 + i * 0.03).t(0, 0.0, 0), (q) => cone(q, len, 0.028, L.BONE, 7, 0.1));
  }
  // pares menores ao lado da coluna
  for (const s of [-1, 1])
    for (let i = 0; i < 4; i++) place(g, Xf.at(s * 0.07, 0.5 - i * 0.09, 0.085).ry(s * 0.5).rx(1.35), (q) => cone(q, 0.11 - i * 0.015, 0.02, L.BONE, 6, 0.1));
  // ombros: leque de espinhos para cima e para fora
  for (const s of [-1, 1]) {
    const sh: [number, number, number][] = [
      [0.35, 0.28, 0.034],
      [0.75, 0.24, 0.03],
      [1.05, 0.2, 0.026],
      [0.55, 0.32, 0.036],
    ];
    sh.forEach(([th, len, rad], k) => place(g, Xf.at(s * 0.2, 0.58, 0.04).ry(s * (Math.PI / 2) + (k === 3 ? -s * 1.1 : 0)).rx(th), (q) => cone(q, len, rad, L.BONE, 7, 0.12)));
  }
}
function mNeck(g: Geom) {
  rings(
    g,
    [
      { y: -0.02, rx: 0.055, rz: 0.05 },
      { y: 0.1, rx: 0.042, rz: 0.04 },
      { y: 0.2, rx: 0.046, rz: 0.045 },
    ],
    L.SKIN_M,
    { segs: 12, capTop: true },
  );
}
function mHand(g: Geom, side: number) {
  ellipsoid(g, 0.042, 0.06, 0.022, L.SKIN_M, 0, -0.05, 0, 10, 7);
  // quatro dedos longos em garra
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.02;
    const len = 0.13 - Math.abs(i - 1.5) * 0.015;
    place(g, Xf.at(x, -0.1, 0).rz((i - 1.5) * 0.08).rx(0.25), (q) => {
      limb(q, len, 0.011, 0.009, L.SKIN_M, 0, 0.5, 0.9, 7, 3);
      place(q, Xf.at(0, -len, 0).rx(0.5), (q2) => {
        limb(q2, len * 0.8, 0.009, 0.007, L.SKIN_M, 0, 0.5, 0.9, 6, 2);
        place(q2, Xf.at(0, -len * 0.8, 0).rx(Math.PI - 0.5), (q3) => cone(q3, 0.075, 0.008, L.BONE, 6, -0.2));
      });
    });
  }
  // polegar do lado de dentro
  place(g, Xf.at(-side * 0.035, -0.04, -0.01).rz(-side * 0.6).rx(0.3), (q) => {
    limb(q, 0.07, 0.011, 0.008, L.SKIN_M, 0, 0.5, 0.9, 6, 2);
    place(q, Xf.at(0, -0.07, 0).rx(Math.PI - 0.3), (q2) => cone(q2, 0.05, 0.008, L.BONE, 6, -0.2));
  });
}
function mFoot(g: Geom) {
  // tornozelo -> metatarso longo para a frente, três dedos compridos com garras e esporão atrás
  ellipsoid(g, 0.045, 0.05, 0.05, L.SKIN_M, 0, 0, 0, 10, 6);
  place(g, Xf.at(0, 0, 0).rx(1.4), (q) => {
    limb(q, 0.22, 0.04, 0.03, L.SKIN_M, 0.005, 0.3, 0.75, 10, 4);
    for (let i = -1; i <= 1; i++)
      place(q, Xf.at(i * 0.022, -0.22, 0).rz(i * 0.42).rx(-0.1), (q2) => {
        const tl = 0.16 - Math.abs(i) * 0.03;
        limb(q2, tl, 0.016, 0.011, L.SKIN_M, 0, 0.5, 0.85, 7, 3);
        place(q2, Xf.at(0, -tl, 0).rx(Math.PI - 0.45), (q3) => cone(q3, 0.11, 0.012, L.BONE, 6, -0.3));
      });
  });
  place(g, Xf.at(0, -0.03, 0.035).rx(-1.1), (q) => cone(q, 0.09, 0.014, L.BONE, 6, 0.1));
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
  attack: number; // 0..1 (preparação/execução do ataque comum)
  dash: boolean;
  eco: number; // 0..1
  rastro: boolean;
  parasite: number; // 0..1
  /** 0..1 preparação do golpe especial (duas garras); >1 = golpe descendo */
  special?: number;
  /** 0..1 reação a dano (decai) */
  hit?: number;
  /** 0..1 queda ao ser destruída */
  death?: number;
}

/** Desenha O Reverberante (forma baseada na imagem de referência). */
export function drawEntity(r: Renderer, body: RGB, glow: RGB, p: EntityPose, b: Base) {
  const m = {
    head: meshOf(r, 'm_head', mHead),
    spikesH: meshOf(r, 'm_hspk', mHeadSpikes),
    mouth: meshOf(r, 'm_mouth', mMouth),
    teeth: meshOf(r, 'm_teeth', mTeeth),
    torso: meshOf(r, 'm_torso', mTorso),
    spikesB: meshOf(r, 'm_bspk', mBackSpikes),
    neck: meshOf(r, 'm_neck', mNeck),
    thigh: meshOf(r, 'm_thigh', (g) => limb(g, M_THIGH, 0.07, 0.042, L.SKIN_M, 0.016, 0.28, 0.85, 12, 8)),
    shin: meshOf(r, 'm_shin', (g) => limb(g, M_SHIN, 0.044, 0.028, L.SKIN_M, 0.012, 0.22, 0.85, 12, 8)),
    upper: meshOf(r, 'm_upper', (g) => limb(g, M_UPPER, 0.05, 0.034, L.SKIN_M, 0.012, 0.25, 0.9, 12, 7)),
    fore: meshOf(r, 'm_fore', (g) => limb(g, M_FORE, 0.04, 0.026, L.SKIN_M, 0.01, 0.3, 0.9, 12, 7)),
    handL: meshOf(r, 'm_handL', (g) => mHand(g, -1)),
    handR: meshOf(r, 'm_handR', (g) => mHand(g, 1)),
    foot: meshOf(r, 'm_foot', mFoot),
  };
  const fade = b.alpha < 1 ? b.alpha : 1;
  // extremidades mais ensanguentadas (como na referência)
  const blood: RGB = [body[0], body[1] * 0.78, body[2] * 0.78];
  const pulse = 0.55 + 0.45 * Math.sin(p.time * (p.dash ? 16 : 3));
  const glowK = (k: number): [number, number, number] => [glow[0] * k * fade, glow[1] * k * fade, glow[2] * k * fade];
  const death = Math.min(1, p.death ?? 0);
  const hit = Math.max(0, p.hit ?? 0) * (1 - death);
  const sp = p.special ?? 0;
  const spRaise = Math.min(1, sp);
  const spSlam = sp > 1 ? Math.min(1, sp - 1) : 0;
  const chase = (p.dash || p.speed > 4.6) && death === 0;
  const stalk = p.stalk && !chase ? 1 : 0;
  const amp = Math.min(chase ? 0.95 : 0.6, p.speed * (chase ? 0.16 : 0.13)) * (1 - death);
  const breathe = Math.sin(p.time * 1.7);

  copy(B, ID);
  translate(B, p.x, 0, p.z);
  rotY(B, p.yaw);
  // morte: tomba para trás
  if (death > 0) {
    translate(B, 0, 0, 0.4 * death);
    rotX(B, death * death * 1.35);
  }

  // ---- pernas
  const legBend = stalk * 0.55 + death * 0.9;
  const ang: { th: number; sh: number }[] = [];
  let lowest = 0;
  for (const side of [-1, 1]) {
    const ph = p.phase + (side > 0 ? 0 : Math.PI);
    const swing = Math.sin(ph) * amp;
    const flex = 0.08 + Math.max(0, Math.cos(ph)) * amp * 1.5 + legBend * 1.6;
    const th = swing + legBend * 0.8;
    const sh = -flex;
    ang.push({ th, sh });
    const drop = M_THIGH * (1 - Math.cos(th)) + M_SHIN * (1 - Math.cos(th + sh));
    lowest = Math.max(lowest, M_THIGH + M_SHIN - drop);
  }
  const hipY = Math.min(M_THIGH + M_SHIN, lowest) + 0.09 + (chase ? Math.abs(Math.sin(p.phase)) * 0.06 : 0);
  [-1, 1].forEach((side, i) => {
    const { th, sh } = ang[i];
    const P = child(B, side * 0.1, hipY, 0);
    rotZ(P, side * 0.035);
    rotX(P, th);
    put(r, m.thigh, P, L.SKIN_M, body, b);
    translate(P, 0, -M_THIGH, 0);
    rotX(P, sh);
    put(r, m.shin, P, L.SKIN_M, body, b);
    translate(P, 0, -M_SHIN, 0);
    rotX(P, -(th + sh)); // pé fica paralelo ao chão
    put(r, m.foot, P, -1, blood, b);
  });

  // ---- tronco
  const S = child(B, 0, hipY, 0);
  const lean = (chase ? 0.42 : 0.08) + stalk * 0.45 - spRaise * 0.25 * (1 - spSlam) + spSlam * 0.5 + p.attack * 0.15 - hit * 0.35;
  rotX(S, -lean);
  rotZ(S, Math.sin(p.phase) * amp * 0.08);
  const Sb = mat4();
  copy(Sb, S);
  scale(Sb, 1, 1 + breathe * 0.012, 1 + breathe * 0.02);
  put(r, m.torso, Sb, L.SKIN_M, body, b);
  put(r, m.spikesB, Sb, L.BONE, [1, 1, 1], b, { emit: glowK(p.parasite * 1.6 + (p.rastro ? 0.3 : 0)) });

  // ---- braços
  for (const side of [-1, 1]) {
    const A = child(S, side * 0.205, 0.555, 0.015);
    const ph = p.phase + (side > 0 ? Math.PI : 0);
    let ux = Math.sin(ph) * amp * 0.7; // balanço
    let uz = side * (0.16 + 0.03 * breathe);
    let el = 0.22 + Math.max(0, Math.sin(ph)) * amp * 0.4;
    if (chase) {
      ux = 1.15 + Math.sin(ph) * 0.25; // braços estendidos para a frente na perseguição
      el = 0.15;
      uz = side * 0.22;
    }
    if (stalk) {
      ux = 0.5 + Math.sin(p.time * 1.4 + side) * 0.08;
      el = 0.9;
    }
    if (side === 1 && p.attack > 0 && spRaise === 0) {
      // ataque comum: ergue a garra direita e corta em diagonal
      ux = 2.5 * p.attack;
      uz = side * (0.25 - 0.55 * p.attack);
      el = 0.3 + 0.6 * p.attack;
    }
    if (spRaise > 0) {
      // golpe especial: duas garras acima da cabeça, depois desce com tudo
      ux = spSlam > 0 ? 2.7 - spSlam * 2.0 : 2.7 * spRaise;
      // com o braço erguido, inclinar para fora exige ângulo negativo
      uz = side * (0.15 - 0.6 * spRaise * (1 - spSlam));
      el = spSlam > 0 ? 0.2 : 0.7 * spRaise;
    }
    if (p.parasite > 0) {
      ux = Math.max(ux, 1.4 * p.parasite);
      uz = side * (0.6 * p.parasite + 0.15);
    }
    if (hit > 0) ux -= hit * 0.6;
    if (death > 0) {
      ux = ux * (1 - death) - 0.3 * death;
      uz = side * (0.2 + death * 0.9);
      el = el * (1 - death) + 0.1 * death;
    }
    rotZ(A, uz);
    rotX(A, ux);
    put(r, m.upper, A, L.SKIN_M, body, b);
    translate(A, 0, -M_UPPER, 0);
    rotX(A, el);
    put(r, m.fore, A, L.SKIN_M, body, b);
    translate(A, 0, -M_FORE, 0);
    rotX(A, 0.1 + (chase ? 0.25 : 0) + Math.sin(p.time * 3 + side) * 0.05);
    put(r, side > 0 ? m.handR : m.handL, A, -1, blood, b);
  }

  // ---- pescoço e cabeça
  const N = child(S, 0, 0.64, 0.025);
  rotX(N, -0.3 - (chase ? 0.35 : 0) - stalk * 0.2 + hit * 0.4);
  put(r, m.neck, N, L.SKIN_M, body, b);
  const H = child(N, 0, 0.18, 0);
  const look = Math.max(-0.5, Math.min(0.5, p.pitch * 0.6));
  rotX(H, 0.3 + (chase ? 0.4 : 0) + stalk * 0.15 + look + (p.rastro ? 0.35 : 0) - hit * 0.5 - death * 0.4);
  // tiques: inclinação lenta da cabeça e tremor no Eco Falso
  rotZ(H, Math.sin(p.time * 0.9) * 0.18 * (chase ? 0.3 : 1) + (p.eco > 0 ? Math.sin(p.time * 55) * 0.05 * p.eco : 0));
  rotY(H, Math.sin(p.time * 0.53 + 1) * 0.15 * (chase ? 0.2 : 1));
  put(r, m.head, H, L.SKIN_M, body, b);
  put(r, m.spikesH, H, L.BONE, [1, 1, 1], b, { emit: glowK(p.eco * 0.8) });
  put(r, m.mouth, H, L.PLAIN, [0.05, 0.01, 0.01], b, { emit: glowK(0.08 + pulse * 0.12 + p.eco * 1.2 + p.attack * 0.6 + spRaise * 0.8) });
  put(r, m.teeth, H, L.TEETH, [1, 0.98, 0.92], b);
}

// =====================================================================
//                            SOBREVIVENTE
// =====================================================================
const H_THIGH = 0.44;
const H_SHIN = 0.43;
const H_UPPER = 0.29;
const H_FORE = 0.27;

function hTorso(g: Geom, coat: boolean) {
  rings(
    g,
    [
      { y: -0.04, rx: 0.1, rz: 0.07 },
      { y: 0.0, rx: 0.165, rz: 0.11 },
      { y: 0.1, rx: 0.16, rz: 0.105 },
      { y: 0.2, rx: 0.15, rz: 0.098, oz: 0.004 },
      { y: 0.32, rx: 0.17, rz: 0.11, oz: -0.004 },
      { y: 0.43, rx: 0.19, rz: 0.12, oz: -0.008 },
      { y: 0.52, rx: 0.205, rz: 0.108 },
      { y: 0.58, rx: 0.16, rz: 0.09, oz: 0.006 },
      { y: 0.62, rx: 0.07, rz: 0.065, oz: 0.01 },
    ],
    L.FABRIC,
    { segs: 18, capTop: true, capBottom: true, uRep: 2, vRep: 2 },
  );
  for (const s of [-1, 1]) ellipsoid(g, 0.07, 0.065, 0.075, L.FABRIC, s * 0.2, 0.52, 0, 10, 7);
  // gola
  rings(
    g,
    [
      { y: 0.58, rx: 0.085, rz: 0.08, oz: 0.008 },
      { y: 0.635, rx: 0.075, rz: 0.07, oz: 0.01 },
    ],
    L.FABRIC,
    { segs: 14, uRep: 2 },
  );
  if (coat)
    rings(
      g,
      [
        { y: 0.12, rx: 0.172, rz: 0.115 },
        { y: -0.1, rx: 0.19, rz: 0.13 },
        { y: -0.36, rx: 0.215, rz: 0.15 },
      ],
      L.FABRIC,
      { segs: 18, uRep: 2, vRep: 2, a0: 0.3, a1: Math.PI * 2 - 0.3 },
    );
}
function hStripe(g: Geom) {
  rings(
    g,
    [
      { y: 0.39, rx: 0.184, rz: 0.118, oz: -0.006 },
      { y: 0.43, rx: 0.195, rz: 0.125, oz: -0.008 },
    ],
    L.PLAIN,
    { segs: 18 },
  );
}
function hLegStripe(g: Geom) {
  rings(
    g,
    [
      { y: -0.3, rx: 0.058, rz: 0.054 },
      { y: -0.34, rx: 0.056, rz: 0.052 },
    ],
    L.PLAIN,
    { segs: 12 },
  );
}
function hHand(g: Geom, side: number) {
  ellipsoid(g, 0.04, 0.05, 0.022, L.SKIN, 0, -0.045, 0, 10, 7);
  // dedos juntos levemente dobrados + polegar
  place(g, Xf.at(0, -0.085, 0.002).rx(0.35), (q) => ellipsoid(q, 0.038, 0.035, 0.018, L.SKIN, 0, -0.025, 0, 10, 6));
  place(g, Xf.at(-side * 0.035, -0.035, -0.012).rz(-side * 0.7), (q) => limb(q, 0.045, 0.012, 0.01, L.SKIN, 0, 0.5, 0.9, 7, 2));
}
function hShoe(g: Geom, boots: boolean) {
  ellipsoid(g, 0.058, 0.05, 0.135, L.PLAIN, 0, -0.035, -0.045, 14, 8);
  rings(
    g,
    [
      { y: -0.075, rx: 0.06, rz: 0.13, oz: -0.045 },
      { y: -0.06, rx: 0.062, rz: 0.135, oz: -0.045 },
    ],
    L.PLAIN,
    { segs: 14, capBottom: true },
  );
  if (boots)
    rings(
      g,
      [
        { y: -0.04, rx: 0.06, rz: 0.062 },
        { y: 0.16, rx: 0.056, rz: 0.058 },
        { y: 0.18, rx: 0.05, rz: 0.052 },
      ],
      L.PLAIN,
      { segs: 12, capTop: true },
    );
}
function hHead(g: Geom) {
  // crânio, mandíbula, nariz e orelhas
  ellipsoid(g, 0.098, 0.122, 0.112, L.SKIN, 0, 0.16, 0.005, 18, 12);
  ellipsoid(g, 0.074, 0.058, 0.074, L.SKIN, 0, 0.095, -0.018, 14, 8);
  place(g, Xf.at(0, 0.135, -0.11).rx(-0.35), (q) => ellipsoid(q, 0.018, 0.03, 0.02, L.SKIN, 0, 0, 0, 8, 6));
  for (const s of [-1, 1]) ellipsoid(g, 0.014, 0.03, 0.022, L.SKIN, s * 0.098, 0.15, 0.01, 8, 6);
  // pescoço
  rings(
    g,
    [
      { y: -0.04, rx: 0.052, rz: 0.05 },
      { y: 0.08, rx: 0.05, rz: 0.048 },
    ],
    L.SKIN,
    { segs: 12 },
  );
}
function hEyes(g: Geom) {
  for (const s of [-1, 1]) {
    ellipsoid(g, 0.017, 0.011, 0.008, L.PLAIN, s * 0.038, 0.165, -0.103, 8, 5);
  }
}
function hBrows(g: Geom) {
  for (const s of [-1, 1]) place(g, Xf.at(s * 0.038, 0.187, -0.106).rz(s * 0.12), (q) => ellipsoid(q, 0.024, 0.006, 0.008, L.HAIR, 0, 0, 0, 8, 4));
}
function dome(g: Geom, k: number, from: number, cy = 0.16, rx = 0.098, ry = 0.122, rz = 0.112, layer: number = L.HAIR, back = 0) {
  // casca acima da linha 'from' (radianos a partir do equador); 'back' desce mais na nuca
  const rs = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = from + ((Math.PI / 2 - from) * i) / steps;
    const c = Math.max(0, Math.cos(t));
    rs.push({ y: cy + Math.sin(t) * ry * k, rx: rx * k * c, rz: rz * k * c, oz: 0.005 + back * (1 - i / steps) });
  }
  rings(g, rs, layer, { segs: 18, uRep: 2, vRep: 3 });
}
function hHair(g: Geom, style: Appearance['hairStyle']) {
  switch (style) {
    case 'curto':
      dome(g, 1.1, 0.1, 0.16, 0.098, 0.122, 0.112, L.HAIR, 0.02);
      break;
    case 'raspado':
      dome(g, 1.035, 0.25);
      break;
    case 'coque':
      dome(g, 1.08, 0.15);
      ellipsoid(g, 0.05, 0.05, 0.05, L.HAIR, 0, 0.265, 0.11, 12, 8);
      break;
    case 'longo':
      dome(g, 1.1, 0.05, 0.16, 0.098, 0.122, 0.112, L.HAIR, 0.02);
      rings(
        g,
        [
          { y: 0.2, rx: 0.11, rz: 0.12, oz: 0.01 },
          { y: 0.05, rx: 0.115, rz: 0.12, oz: 0.03 },
          { y: -0.12, rx: 0.12, rz: 0.1, oz: 0.07 },
        ],
        L.HAIR,
        { segs: 14, a0: Math.PI / 2 + 0.2, a1: Math.PI * 1.5 - 0.2, vRep: 3 },
      );
      break;
    case 'moicano':
      ellipsoid(g, 0.022, 0.05, 0.12, L.HAIR, 0, 0.27, 0.01, 10, 8);
      dome(g, 1.02, 0.4);
      break;
    default:
      break;
  }
}
function hBeard(g: Geom) {
  rings(
    g,
    [
      { y: 0.03, rx: 0.06, rz: 0.06, oz: -0.035 },
      { y: 0.08, rx: 0.088, rz: 0.09, oz: -0.032 },
      { y: 0.13, rx: 0.1, rz: 0.105, oz: -0.02 },
    ],
    L.HAIR,
    { segs: 14, a0: -1.5, a1: 1.5, vRep: 3 },
  );
}
function hAcc(g: Geom, acc: Appearance['acc']) {
  switch (acc) {
    case 'capacete':
      dome(g, 1.24, 0, 0.17, 0.098, 0.122, 0.112, L.PLAIN);
      rings(
        g,
        [
          { y: 0.17, rx: 0.128, rz: 0.15, oz: -0.012 },
          { y: 0.165, rx: 0.135, rz: 0.17, oz: -0.02 },
        ],
        L.PLAIN,
        { segs: 18, a0: -1.2, a1: 1.2 },
      );
      break;
    case 'oculos':
      rings(
        g,
        [
          { y: 0.152, rx: 0.103, rz: 0.117 },
          { y: 0.174, rx: 0.103, rz: 0.117 },
        ],
        L.PLAIN,
        { segs: 18 },
      );
      for (const s of [-1, 1]) ellipsoid(g, 0.033, 0.022, 0.015, L.GLASS, s * 0.04, 0.163, -0.112, 10, 6);
      break;
    case 'fone':
      for (const s of [-1, 1]) ellipsoid(g, 0.022, 0.045, 0.04, L.PLAIN, s * 0.11, 0.15, 0.005, 10, 7);
      place(g, Xf.at(0, 0.15, 0.005).rx(Math.PI / 2), (q) =>
        rings(
          q,
          [
            { y: -0.012, rx: 0.13, rz: 0.13 },
            { y: 0.012, rx: 0.13, rz: 0.13 },
          ],
          L.PLAIN,
          { segs: 14, a0: -Math.PI / 2, a1: Math.PI / 2 },
        ),
      );
      place(g, Xf.at(-0.1, 0.11, -0.06).rx(-1.2).rz(-0.3), (q) => limb(q, 0.07, 0.006, 0.006, L.PLAIN, 0, 0.5, 1, 6, 2));
      break;
    case 'mascara':
      ellipsoid(g, 0.085, 0.06, 0.06, L.PLAIN, 0, 0.1, -0.075, 14, 8);
      for (const s of [-1, 1]) place(g, Xf.at(s * 0.065, 0.085, -0.12).rx(-1.35).ry(s * 0.4), (q) => rings(q, [{ y: 0, rx: 0.028, rz: 0.028 }, { y: 0.035, rx: 0.028, rz: 0.028 }], L.GRATE, { segs: 10, capTop: true }));
      break;
    default:
      break;
  }
}
function hScarf(g: Geom) {
  rings(
    g,
    [
      { y: 0.57, rx: 0.1, rz: 0.095, oz: 0 },
      { y: 0.6, rx: 0.115, rz: 0.11 },
      { y: 0.66, rx: 0.09, rz: 0.088, oz: 0.004 },
    ],
    L.FABRIC,
    { segs: 16, uRep: 2 },
  );
}
function hLamp(g: Geom) {
  roundBox(g, 0.07, 0.07, 0.05, L.PLAIN);
}
function hTank(g: Geom) {
  for (const s of [-1, 1]) {
    rings(
      g,
      [
        { y: -0.22, rx: 0.065, rz: 0.065, ox: s * 0.075 },
        { y: 0.2, rx: 0.065, rz: 0.065, ox: s * 0.075 },
      ],
      L.PLAIN,
      { segs: 12, capTop: true, capBottom: true },
    );
    ellipsoid(g, 0.065, 0.04, 0.065, L.PLAIN, s * 0.075, 0.2, 0, 12, 6);
  }
}

// ---- IK de dois ossos (ombro → cotovelo → mão) para segurar a arma com as duas mãos
type V = [number, number, number];
function armFK(ux: number, uz: number, el: number, a: number, b: number): V {
  // forearm em coordenadas do braço: Rx(el)(0,-b,0)
  const fy = -a - b * Math.cos(el);
  const fz = -b * Math.sin(el);
  // Rx(ux)
  const cx = Math.cos(ux), sx = Math.sin(ux);
  const y1 = cx * fy - sx * fz;
  const z1 = sx * fy + cx * fz;
  // Rz(uz)
  const cz = Math.cos(uz), sz = Math.sin(uz);
  return [-sz * y1, cz * y1, z1];
}
const ikCache = new Map<string, { ux: number; uz: number; el: number }>();
/** Ângulos do braço para a mão alcançar 'target' (no espaço do ombro). */
export function solveArm(target: V, a: number, b: number) {
  const key = target.map((v) => v.toFixed(3)).join(',');
  const hit = ikCache.get(key);
  if (hit) return hit;
  const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, Math.hypot(...target)));
  const el = Math.PI - Math.acos((a * a + b * b - d * d) / (2 * a * b));
  let best = { ux: 1.2, uz: 0, el };
  const err = (o: { ux: number; uz: number }) => {
    const h = armFK(o.ux, o.uz, el, a, b);
    return Math.hypot(h[0] - target[0], h[1] - target[1], h[2] - target[2]);
  };
  let e = err(best);
  for (let step = 0.4; step > 0.0005; step *= 0.6)
    for (let it = 0; it < 8; it++) {
      let moved = false;
      for (const [dx, dz] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const c = { ux: best.ux + dx, uz: best.uz + dz, el };
        const ce = err(c);
        if (ce < e) {
          e = ce;
          best = c;
          moved = true;
        }
      }
      if (!moved) break;
    }
  if (ikCache.size > 200) ikCache.clear();
  ikCache.set(key, best);
  return best;
}
/** Onde a arma fica (no espaço do tronco) e onde cada mão segura (no espaço da arma). */
const GRIP: Record<WeaponId, { at: V; right: V; left: V }> = {
  pistola: { at: [0.05, 0.43, -0.42], right: [0, -0.07, 0.03], left: [-0.025, -0.08, 0.05] },
  fuzil: { at: [0.08, 0.41, -0.24], right: [0, -0.08, -0.08], left: [0, -0.03, -0.4] },
  escopeta: { at: [0.08, 0.4, -0.22], right: [0, -0.08, -0.04], left: [0, -0.04, -0.38] },
  lanca: { at: [0.09, 0.36, -0.22], right: [0, -0.08, 0], left: [0, -0.03, -0.3] },
};

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
  /** 0..1 reação a golpe (decai) */
  hit?: number;
}

export function drawSurvivor(r: Renderer, ap: Appearance, p: SurvivorPose, b: Base, drawWeapon?: (r: Renderer, m: Mat4, w: WeaponId, b: Base, firing: boolean, time: number) => void) {
  const torso = fairColor(ap.torso);
  const legs = fairColor(ap.legs);
  const m = {
    torso: meshOf(r, ap.coat ? 'h_torso_c' : 'h_torso', (g) => hTorso(g, ap.coat)),
    thigh: meshOf(r, 'h_thigh', (g) => limb(g, H_THIGH, 0.082, 0.058, L.FABRIC, 0.01, 0.3, 0.92, 12, 7, { uRep: 2, vRep: 2 })),
    shin: meshOf(r, 'h_shin', (g) => limb(g, H_SHIN, 0.058, 0.045, L.FABRIC, 0.01, 0.25, 0.92, 12, 7, { uRep: 2, vRep: 2 })),
    upper: meshOf(r, 'h_upper', (g) => limb(g, H_UPPER, 0.056, 0.046, L.FABRIC, 0.006, 0.3, 0.95, 12, 6, { uRep: 2, vRep: 2 })),
    fore: meshOf(r, 'h_fore', (g) => limb(g, H_FORE, 0.047, 0.036, L.FABRIC, 0.006, 0.25, 0.95, 12, 6, { uRep: 2, vRep: 2 })),
    handL: meshOf(r, 'h_handL', (g) => hHand(g, -1)),
    handR: meshOf(r, 'h_handR', (g) => hHand(g, 1)),
    shoe: meshOf(r, ap.boots ? 'h_boot' : 'h_shoe', (g) => hShoe(g, ap.boots)),
    head: meshOf(r, 'h_head', hHead),
    eyes: meshOf(r, 'h_eyes', hEyes),
    brows: meshOf(r, 'h_brows', hBrows),
    hair: ap.hairStyle !== 'nenhum' ? meshOf(r, 'h_hair_' + ap.hairStyle, (g) => hHair(g, ap.hairStyle)) : null,
    beard: ap.beard ? meshOf(r, 'h_beard', hBeard) : null,
    acc: ap.acc !== 'nenhum' && ap.acc !== 'cachecol' ? meshOf(r, 'h_acc_' + ap.acc, (g) => hAcc(g, ap.acc)) : null,
    scarf: ap.acc === 'cachecol' ? meshOf(r, 'h_scarf', hScarf) : null,
    stripe: ap.stripe ? meshOf(r, 'h_stripe', hStripe) : null,
    legStripe: ap.stripe ? meshOf(r, 'h_lstripe', hLegStripe) : null,
    lamp: meshOf(r, 'h_lamp', hLamp),
    tank: meshOf(r, 'h_tank', hTank),
  };
  const hit = Math.max(0, p.hit ?? 0);
  const stripeEmit = (k: number): Partial<DrawOpts> => (ap.stripe ? { emit: [ap.stripe[0] * k, ap.stripe[1] * k, ap.stripe[2] * k] } : {});
  copy(B, ID);
  translate(B, p.x, p.downed ? 0.17 : 0, p.z);
  rotY(B, p.yaw);
  if (p.downed) {
    rotX(B, -1.42);
    translate(B, 0, -0.32, 0);
  }
  const crouch = p.crouch && !p.downed;
  const run = p.speed > 3.6 && !crouch && !p.downed;
  const amp = Math.min(run ? 0.85 : 0.55, p.speed * (crouch ? 0.24 : run ? 0.15 : 0.16));
  const breathe = Math.sin(p.time * 1.6);

  // ---- pernas
  const ang: { th: number; sh: number }[] = [];
  let lowest = 0;
  for (const side of [-1, 1]) {
    const ph = p.phase + (side > 0 ? 0 : Math.PI);
    let th = Math.sin(ph) * amp;
    let sh = -(0.05 + Math.max(0, Math.cos(ph)) * amp * (run ? 1.7 : 1.2));
    if (crouch) {
      th += 0.95;
      sh -= 1.55;
    }
    if (p.downed) {
      th = Math.sin(ph) * 0.25;
      sh = -0.2 - Math.max(0, Math.sin(ph)) * 0.5;
    }
    ang.push({ th, sh });
    const drop = H_THIGH * (1 - Math.cos(th)) + H_SHIN * (1 - Math.cos(th + sh));
    lowest = Math.max(lowest, H_THIGH + H_SHIN - drop);
  }
  const hipY = (p.downed ? H_THIGH + H_SHIN : lowest) + 0.075 + (run ? Math.abs(Math.cos(p.phase)) * 0.04 : 0);
  [-1, 1].forEach((side, i) => {
    const { th, sh } = ang[i];
    const P = child(B, side * 0.09, hipY, 0);
    rotZ(P, side * 0.02);
    rotX(P, th);
    put(r, m.thigh, P, L.FABRIC, legs, b, { uv: [1, 1] });
    translate(P, 0, -H_THIGH, 0);
    rotX(P, sh);
    put(r, m.shin, P, L.FABRIC, legs, b);
    if (m.legStripe) put(r, m.legStripe, P, L.PLAIN, ap.stripe!, b, stripeEmit(0.15));
    translate(P, 0, -H_SHIN, 0);
    rotX(P, -(th + sh));
    put(r, m.shoe, P, L.PLAIN, ap.shoeColor, b);
  });

  // ---- tronco
  const S = child(B, 0, hipY, 0);
  const lean = crouch ? 0.38 : run ? 0.22 : Math.min(0.1, p.speed * 0.02);
  rotX(S, -lean + hit * 0.3);
  rotZ(S, Math.sin(p.phase) * amp * 0.06);
  const Sb = mat4();
  copy(Sb, S);
  scale(Sb, 1, 1 + breathe * 0.008, 1 + breathe * 0.015);
  put(r, m.torso, Sb, L.FABRIC, torso, b);
  if (m.stripe) put(r, m.stripe, Sb, L.PLAIN, ap.stripe!, b, stripeEmit(0.15));
  if (m.scarf) put(r, m.scarf, Sb, L.FABRIC, ap.accColor, b);
  // lanterna presa ao peito
  const lamp = child(S, 0.1, 0.44, -0.125);
  put(r, m.lamp, lamp, L.PLAIN, [0.2, 0.2, 0.22], b, p.flash ? { emit: [1, 0.95, 0.8] } : {});
  if (p.weapon === 'lanca') put(r, m.tank, child(S, 0, 0.32, 0.17), L.PLAIN, [0.62, 0.14, 0.1], b);

  // ---- braços
  const aiming = !!p.weapon && !p.downed && !p.channel && !p.collecting;
  for (const side of [-1, 1]) {
    const A = child(S, side * 0.215, 0.52, 0);
    const ph = p.phase + (side > 0 ? Math.PI : 0);
    let ux = Math.sin(ph) * amp * (run ? 1.1 : 0.8);
    let uz = side * (0.08 + breathe * 0.01);
    let el = 0.15 + Math.max(0, Math.sin(ph)) * amp * (run ? 1.2 : 0.5) + (run ? 0.6 : 0);
    if (p.channel || p.collecting) {
      ux = 0.95 + Math.sin(p.time * 8 + side) * 0.08;
      el = 0.7;
      uz = side * 0.15;
    } else if (aiming) {
      if (p.reloading) {
        ux = side > 0 ? 0.8 : 0.9 + Math.sin(p.time * 9) * 0.15;
        el = side > 0 ? 0.9 : 1.2;
        uz = -side * 0.2;
      } else if (p.weapon) {
        // as duas mãos na arma (IK): mão direita no cabo, esquerda na frente
        const gp = GRIP[p.weapon];
        const h = side > 0 ? gp.right : gp.left;
        const sol = solveArm([gp.at[0] + h[0] - side * 0.215, gp.at[1] + h[1] - 0.52, gp.at[2] + h[2]], H_UPPER, H_FORE + 0.045);
        ux = sol.ux;
        uz = sol.uz;
        el = sol.el;
      }
    }
    if (p.downed) {
      ux = 2.4 + Math.sin(p.phase + (side > 0 ? 0 : Math.PI)) * 0.6;
      el = 0.4;
      uz = side * 0.25;
    }
    if (hit > 0) {
      ux -= hit * 0.5;
      uz += side * hit * 0.3;
    }
    rotZ(A, uz);
    rotX(A, ux);
    put(r, m.upper, A, L.FABRIC, torso, b);
    translate(A, 0, -H_UPPER, 0);
    rotX(A, el);
    put(r, m.fore, A, L.FABRIC, torso, b);
    translate(A, 0, -H_FORE, 0);
    put(r, side > 0 ? m.handR : m.handL, A, L.SKIN, ap.skin, b);
  }
  // arma nas mãos
  if (aiming && p.weapon && drawWeapon) {
    const gp = GRIP[p.weapon].at;
    const W = child(S, gp[0], p.reloading ? 0.3 : gp[1], p.reloading ? -0.32 : gp[2]);
    if (p.reloading) rotX(W, -0.6);
    drawWeapon(r, W, p.weapon, b, p.firing ?? false, p.time);
  }

  // ---- cabeça
  const H = child(S, 0, 0.6, 0.005);
  rotX(H, Math.max(-0.6, Math.min(0.6, p.pitch * 0.6)) + (crouch ? 0.25 : 0) - hit * 0.3);
  put(r, m.head, H, L.SKIN, ap.skin, b);
  put(r, m.eyes, H, L.PLAIN, [0.06, 0.05, 0.05], b);
  put(r, m.brows, H, L.HAIR, ap.hairColor, b);
  if (m.hair) put(r, m.hair, H, L.HAIR, ap.hairColor, b);
  if (m.beard) put(r, m.beard, H, L.HAIR, ap.hairColor, b);
  if (ap.scar) {
    const sc = child(H, 0.055, 0.15, -0.103);
    rotZ(sc, 0.3);
    scale(sc, 0.006, 0.05, 0.004);
    r.draw(r.cube, sc, { layer: L.PLAIN, tint: [0.55, 0.22, 0.2], alpha: b.alpha, emit: b.emit });
  }
  if (m.acc) {
    const accLayer = ap.acc === 'oculos' || ap.acc === 'mascara' ? -1 : L.PLAIN;
    put(r, m.acc, H, accLayer, ap.accColor, b);
    if (ap.acc === 'capacete') {
      const lampH = child(H, 0, 0.27, -0.13);
      scale(lampH, 0.05, 0.035, 0.02);
      r.draw(r.cube, lampH, { layer: L.PLAIN, tint: [1, 1, 0.9], alpha: b.alpha, emit: [0.4, 0.4, 0.35] });
    }
  }
}

/** Reexporta para quem só precisa do formato (testes de geometria). */
export const builders = { mHead, mHeadSpikes, mTeeth, mTorso, mBackSpikes, mHand, mFoot, hTorso, hHead, hHair, hHand, hShoe };
