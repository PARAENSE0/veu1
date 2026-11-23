/**
 * Física compartilhada: colisão círculo x grid, movimento determinístico,
 * linha de visão e raycast. O mesmo código roda no servidor (autoridade) e no
 * cliente (predição local), garantindo que ambos cheguem ao mesmo resultado.
 */
import { CELL, DT, SURV } from './constants';
import { T, type MapDef } from './map';

export interface Grid {
  w: number;
  h: number;
  cells: Uint8Array;
  /** 1 = porta aberta (índice da célula) */
  doorOpen: Uint8Array;
}

export function makeGrid(m: MapDef): Grid {
  return { w: m.w, h: m.h, cells: m.cells, doorOpen: new Uint8Array(m.w * m.h) };
}

export function isSolid(g: Grid, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) return true;
  const i = cz * g.w + cx;
  const t = g.cells[i];
  if (t === T.FLOOR) return false;
  if (t === T.DOOR || t === T.SECDOOR) return !g.doorOpen[i];
  return true;
}

export function isOpaque(g: Grid, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) return true;
  const i = cz * g.w + cx;
  const t = g.cells[i];
  if (t === T.WALL || t === T.LOCKER || t === T.MACHINE) return true;
  if (t === T.DOOR || t === T.SECDOOR) return !g.doorOpen[i];
  return false;
}

/** Empurra um círculo para fora das células sólidas. Retorna a nova posição. */
export function resolveCircle(g: Grid, x: number, z: number, r: number): [number, number] {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const cx0 = Math.floor((x - r) / CELL);
    const cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL);
    const cz1 = Math.floor((z + r) / CELL);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!isSolid(g, cx, cz)) continue;
        const minX = cx * CELL;
        const minZ = cz * CELL;
        const px = Math.max(minX, Math.min(x, minX + CELL));
        const pz = Math.max(minZ, Math.min(z, minZ + CELL));
        let dx = x - px;
        let dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-9) {
          // centro dentro da célula: empurra pelo eixo de menor penetração
          const left = x - minX;
          const right = minX + CELL - x;
          const top = z - minZ;
          const bottom = minZ + CELL - z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = minX - r;
          else if (m === right) x = minX + CELL + r;
          else if (m === top) z = minZ - r;
          else z = minZ + CELL + r;
        } else {
          const d = Math.sqrt(d2);
          const push = r - d;
          dx /= d;
          dz /= d;
          x += dx * push;
          z += dz * push;
        }
        moved = true;
      }
    if (!moved) break;
  }
  return [x, z];
}

/** Bits de botões em um comando de entrada. */
export const BTN = { SPRINT: 1, CROUCH: 2 } as const;

export interface InputCmd {
  seq: number;
  /** eixo lateral (-1..1, direita positiva) */
  mx: number;
  /** eixo frontal (-1..1, frente positiva) */
  mz: number;
  yaw: number;
  pitch: number;
  b: number;
}

export interface MoveState {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  stamina: number;
  exhausted: boolean;
  regenDelay: number;
  crouch: boolean;
  sprinting: boolean;
  /** velocidade horizontal efetiva no último passo (m/s) */
  speed: number;
}

export interface MoveParams {
  walk: number;
  sprint: number;
  crouch: number;
  /** multiplicador geral (lentidão, adrenalina, ruptura...) */
  mult: number;
  radius: number;
  useStamina: boolean;
  canMove: boolean;
  canSprint: boolean;
}

export function forwardVec(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/** Aplica UM comando de entrada (duração DT). Determinístico. */
export function stepMove(g: Grid, s: MoveState, cmd: InputCmd, p: MoveParams): void {
  s.yaw = wrapAngle(cmd.yaw);
  s.pitch = Math.max(-1.45, Math.min(1.45, cmd.pitch));
  let mx = Number.isFinite(cmd.mx) ? Math.max(-1, Math.min(1, cmd.mx)) : 0;
  let mz = Number.isFinite(cmd.mz) ? Math.max(-1, Math.min(1, cmd.mz)) : 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const moving = p.canMove && len > 0.05;
  s.crouch = (cmd.b & BTN.CROUCH) !== 0;
  const wantsSprint = (cmd.b & BTN.SPRINT) !== 0 && moving && !s.crouch && p.canSprint && mz > -0.2;
  let sprinting = wantsSprint && (!p.useStamina || (!s.exhausted && s.stamina > 0));

  if (p.useStamina) {
    if (sprinting) {
      s.stamina -= SURV.staminaDrain * DT;
      s.regenDelay = SURV.staminaRegenDelay;
      if (s.stamina <= 0) {
        s.stamina = 0;
        s.exhausted = true;
        sprinting = false;
      }
    } else {
      if (s.regenDelay > 0) s.regenDelay -= DT;
      else s.stamina = Math.min(SURV.staminaMax, s.stamina + SURV.staminaRegen * DT);
      if (s.exhausted && s.stamina >= SURV.exhaustedUntil) s.exhausted = false;
    }
  }
  s.sprinting = sprinting;

  if (!moving) {
    s.speed = 0;
    return;
  }
  const base = s.crouch ? p.crouch : sprinting ? p.sprint : p.walk;
  const spd = base * p.mult;
  const [fx, fz] = forwardVec(s.yaw);
  const rx = -fz; // direita = frente girada 90° no sentido horário
  const rz = fx;
  const vx = (fx * mz + rx * mx) * spd;
  const vz = (fz * mz + rz * mx) * spd;
  const ox = s.x;
  const oz = s.z;
  const [nx, nz] = resolveCircle(g, s.x + vx * DT, s.z + vz * DT, p.radius);
  s.x = nx;
  s.z = nz;
  s.speed = Math.hypot(nx - ox, nz - oz) / DT;
}

export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Linha de visão (DDA no grid). Ignora as células de origem e destino. */
export function lineOfSight(g: Grid, x0: number, z0: number, x1: number, z1: number): boolean {
  return raycast(g, x0, z0, x1 - x0, z1 - z0, 1, isOpaque) >= 0.999;
}

/**
 * Raycast no grid. Direção (dx,dz) não precisa ser normalizada; retorna a fração
 * [0..maxT] em que o raio encontra uma célula que satisfaz `blocks`.
 */
export function raycast(
  g: Grid,
  x0: number,
  z0: number,
  dx: number,
  dz: number,
  maxT: number,
  blocks: (g: Grid, cx: number, cz: number) => boolean,
): number {
  let cx = Math.floor(x0 / CELL);
  let cz = Math.floor(z0 / CELL);
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx)) : Infinity;
  let tMaxZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL - z0 : z0 - cz * CELL) / Math.abs(dz)) : Infinity;
  for (let n = 0; n < 256; n++) {
    let t: number;
    if (tMaxX < tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      cz += stepZ;
    }
    if (t >= maxT) return maxT;
    if (blocks(g, cx, cz)) return t;
  }
  return maxT;
}

export function dist2(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * Escolhe o alvo de interação mais adequado na frente do jogador.
 * Objetos que ocupam uma célula inteira (portas, armários, consoles) informam
 * `half` (meia-largura) e a distância é medida até a superfície deles.
 */
export function pickTarget<C extends { x: number; z: number; prio?: number; half?: number }>(
  px: number,
  pz: number,
  yaw: number,
  range: number,
  cands: C[],
): C | null {
  const [fx, fz] = forwardVec(yaw);
  let best: C | null = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    const dx = c.x - px;
    const dz = c.z - pz;
    const dc = Math.hypot(dx, dz);
    const h = c.half ?? 0;
    const d = h > 0 ? Math.hypot(Math.max(Math.abs(dx) - h, 0), Math.max(Math.abs(dz) - h, 0)) : dc;
    const r = h > 0 ? range - 0.9 : range;
    if (d > r) continue;
    const dot = dc > 0.01 ? (dx * fx + dz * fz) / dc : 1;
    if (dot < 0.15 && d > 0.6) continue;
    const score = dot * 2 - d + (c.prio ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
