/**
 * Geometria orgânica procedural (sem arquivos externos): superfícies de
 * revolução com seção elíptica e normais suaves, elipsoides, membros afunilados
 * com volume muscular, espinhos cônicos e montagem de várias peças numa malha
 * só (menos chamadas de desenho). Usada pelos modelos de personagens.
 *
 * Convenções: Y para cima, frente = -Z. Membros crescem para -Y a partir da
 * articulação (origem), como uma corrente de ossos.
 */
import { Geom, type Mesh, type Renderer } from './renderer';

export interface Ring {
  /** altura do anel */
  y: number;
  /** raio lateral (X) e frontal (Z) */
  rx: number;
  rz: number;
  /** deslocamento do centro do anel (para costas/barriga/curvatura) */
  ox?: number;
  oz?: number;
}

export interface RingOpts {
  segs?: number;
  /** repetições da textura em volta e ao longo */
  uRep?: number;
  vRep?: number;
  capTop?: boolean;
  capBottom?: boolean;
  /** ângulo inicial/final (para cascas parciais, ex.: cabelo) */
  a0?: number;
  a1?: number;
  /** v=0 no primeiro anel e v=1 no último (para gradientes ao longo da peça) */
  vNormalized?: boolean;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Superfície que passa por uma sequência de anéis elípticos (de baixo para cima
 * ou de cima para baixo — a orientação das faces é corrigida automaticamente).
 */
export function rings(g: Geom, rs: Ring[], layer: number, o: RingOpts = {}) {
  const segs = o.segs ?? 14;
  const a0 = o.a0 ?? 0;
  const a1 = o.a1 ?? Math.PI * 2;
  const closed = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const uRep = o.uRep ?? 1;
  const n = rs.length;
  // comprimento acumulado ao longo do perfil (para v)
  const lens = [0];
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(rs[i].y - rs[i - 1].y, rs[i].rx - rs[i - 1].rx, (rs[i].oz ?? 0) - (rs[i - 1].oz ?? 0)));
  const total = lens[n - 1] || 1;
  const vOf = (i: number) => (o.vNormalized ? lens[i] / total : lens[i] * (o.vRep ?? 1));
  const P = (i: number, a: number): V3 => {
    const r = rs[Math.max(0, Math.min(n - 1, i))];
    // x = sin, z = -cos: a=0 aponta para a frente (-Z)
    return [(r.ox ?? 0) + Math.sin(a) * r.rx, r.y, (r.oz ?? 0) - Math.cos(a) * r.rz];
  };
  const center = (i: number): V3 => [rs[i].ox ?? 0, rs[i].y, rs[i].oz ?? 0];
  const N = (i: number, a: number): V3 => {
    const da = 0.01;
    const t = sub(P(i, a + da), P(i, a - da));
    const up = i === 0 ? sub(P(1, a), P(0, a)) : i === n - 1 ? sub(P(n - 1, a), P(n - 2, a)) : sub(P(i + 1, a), P(i - 1, a));
    let nn = norm(cross(t, up));
    // garante que a normal aponte para fora
    const out = sub(P(i, a), center(i));
    if (nn[0] * out[0] + nn[1] * out[1] + nn[2] * out[2] < 0) nn = [-nn[0], -nn[1], -nn[2]];
    // anel degenerado (ponta): usa a direção do eixo
    if (rs[i].rx < 1e-4 && rs[i].rz < 1e-4) nn = norm(i === 0 ? sub(center(0), center(1)) : sub(center(n - 1), center(n - 2)));
    return nn;
  };
  const vert = (i: number, k: number) => {
    const a = a0 + ((a1 - a0) * k) / segs;
    const p = P(i, a);
    const nn = N(i, a);
    g.vert(p[0], p[1], p[2], nn[0], nn[1], nn[2], (k / segs) * uRep, vOf(i), layer);
  };
  // orientação: o triângulo (i,k)->(i,k+1)->(i+1,k+1) precisa ter normal para fora
  const up = rs[n - 1].y >= rs[0].y;
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < segs; k++) {
      if (up) {
        vert(i, k);
        vert(i + 1, k + 1);
        vert(i, k + 1);
        vert(i, k);
        vert(i + 1, k);
        vert(i + 1, k + 1);
      } else {
        vert(i, k);
        vert(i, k + 1);
        vert(i + 1, k + 1);
        vert(i, k);
        vert(i + 1, k + 1);
        vert(i + 1, k);
      }
    }
  const cap = (i: number, top: boolean) => {
    const c = center(i);
    const dir = (top ? 1 : -1) * (up ? 1 : -1);
    for (let k = 0; k < segs; k++) {
      const p0 = P(i, a0 + ((a1 - a0) * k) / segs);
      const p1 = P(i, a0 + ((a1 - a0) * (k + 1)) / segs);
      const tri = dir > 0 ? [c, p1, p0] : [c, p0, p1];
      for (const p of tri) g.vert(p[0], p[1], p[2], 0, dir, 0, 0.5, vOf(i), layer);
    }
  };
  if (closed && o.capTop) cap(n - 1, true);
  if (closed && o.capBottom) cap(0, false);
}

/** Elipsoide centrado em (cx, cy, cz). */
export function ellipsoid(g: Geom, rx: number, ry: number, rz: number, layer: number, cx = 0, cy = 0, cz = 0, segs = 14, stacks = 9, o: RingOpts = {}) {
  const rs: Ring[] = [];
  for (let i = 0; i <= stacks; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / stacks;
    const c = Math.max(0, Math.cos(t));
    rs.push({ y: cy + Math.sin(t) * ry, rx: rx * c, rz: rz * c, ox: cx, oz: cz });
  }
  rings(g, rs, layer, { segs, ...o });
}

/**
 * Membro afunilado ao longo de -Y (da articulação até len), com volume
 * muscular (bulge) concentrado em 'peak' (0..1) e leve achatamento frontal.
 */
export function limb(g: Geom, len: number, r0: number, r1: number, layer: number, bulge = 0, peak = 0.35, flat = 0.85, segs = 12, steps = 7, o: RingOpts = {}) {
  const rs: Ring[] = [];
  // ponta superior arredondada (articulação)
  for (const k of [0, 0.55, 0.85]) {
    const a = Math.acos(k);
    rs.push({ y: Math.sin(a) * r0 * 0.8, rx: r0 * k, rz: r0 * flat * k });
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const base = r0 + (r1 - r0) * t;
    const m = bulge * Math.exp(-((t - peak) * (t - peak)) / 0.06);
    const r = base + m;
    rs.push({ y: -len * t, rx: r, rz: r * flat, oz: -m * 0.25 });
  }
  // ponta inferior arredondada
  for (const k of [0.85, 0.55, 0]) {
    const a = Math.acos(k);
    rs.push({ y: -len - Math.sin(a) * r1 * 0.8, rx: r1 * k, rz: r1 * flat * k });
  }
  rings(g, rs, layer, { segs, ...o });
}

/** Cone (espinho, garra, dente) ao longo de +Y; v vai de 0 (base) a 1 (ponta). */
export function cone(g: Geom, len: number, r: number, layer: number, segs = 7, curve = 0) {
  const rs: Ring[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    rs.push({ y: len * t, rx: r * (1 - t) ** 1.25, rz: r * (1 - t) ** 1.25, oz: -curve * len * t * t });
  }
  rings(g, rs, layer, { segs, capBottom: true, vNormalized: true });
}

/** Caixa com cantos chanfrados (para dentes, fivelas, botas). */
export function roundBox(g: Geom, w: number, h: number, d: number, layer: number, cx = 0, cy = 0, cz = 0) {
  g.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, layer, 1);
}

// ------------------------------------------------------------------ montagem
/** Matriz 4x4 coluna-maior simples para posicionar peças dentro de uma malha. */
export class Xf {
  m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  static at(x: number, y: number, z: number) {
    const t = new Xf();
    t.m[12] = x;
    t.m[13] = y;
    t.m[14] = z;
    return t;
  }
  private mul(b: number[]) {
    const a = this.m;
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    this.m = o;
    return this;
  }
  rx(a: number) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this.mul([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }
  ry(a: number) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this.mul([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }
  rz(a: number) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this.mul([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  t(x: number, y: number, z: number) {
    return this.mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  }
  s(x: number, y: number, z: number) {
    return this.mul([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
  }
}

/** Constrói uma peça numa geometria temporária e a copia transformada para 'into'. */
export function place(into: Geom, xf: Xf, build: (g: Geom) => void) {
  const tmp = new Geom();
  build(tmp);
  const m = xf.m;
  const d = tmp.data;
  for (let i = 0; i < d.length; i += 9) {
    const x = d[i], y = d[i + 1], z = d[i + 2];
    const nx = d[i + 3], ny = d[i + 4], nz = d[i + 5];
    const px = m[0] * x + m[4] * y + m[8] * z + m[12];
    const py = m[1] * x + m[5] * y + m[9] * z + m[13];
    const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
    let qx = m[0] * nx + m[4] * ny + m[8] * nz;
    let qy = m[1] * nx + m[5] * ny + m[9] * nz;
    let qz = m[2] * nx + m[6] * ny + m[10] * nz;
    const l = Math.hypot(qx, qy, qz) || 1;
    qx /= l;
    qy /= l;
    qz /= l;
    into.vert(px, py, pz, qx, qy, qz, d[i + 6], d[i + 7], d[i + 8]);
  }
}

/** Cache de malhas por contexto WebGL (o menu de personalização tem o seu). */
const caches = new WeakMap<Renderer, Map<string, Mesh>>();
export function meshOf(r: Renderer, key: string, build: (g: Geom) => void): Mesh {
  let c = caches.get(r);
  if (!c) caches.set(r, (c = new Map()));
  let m = c.get(key);
  if (!m) {
    const g = new Geom();
    build(g);
    m = r.upload(g);
    c.set(key, m);
  }
  return m;
}
