/**
 * Definição de mapas baseada em grid.
 *
 * Cada mapa é construído por código com o MapBuilder (salas, corredores, portas,
 * móveis, estações de objetivo, armários, pontos de itens, luzes). O resultado é
 * um MapDef imutável usado igualmente pelo servidor (colisão/regras) e pelo
 * cliente (geração da malha 3D). Para criar um novo mapa basta escrever outra
 * função build*() e registrá-la em MAPS.
 */
import { CELL, WALL_H } from './constants';

/** Tipos de célula. */
export const T = {
  FLOOR: 0,
  WALL: 1,
  LOW: 2, // móvel baixo: bloqueia passagem, não bloqueia visão
  LOCKER: 3, // armário esconderijo
  DOOR: 4,
  SECDOOR: 5, // porta de segurança (abre por objetivo)
  STATION: 6, // console de objetivo (baixo)
  MACHINE: 7, // máquina alta: bloqueia passagem e visão
} as const;
export type CellType = (typeof T)[keyof typeof T];

/** Variações visuais de móveis/máquinas. */
export const PROP = {
  NONE: 0,
  BED: 1,
  TABLE: 2,
  CRATE: 3,
  DESK: 4,
  COUNTER: 5,
  BENCH: 6,
  GENERATOR: 10,
  TANK: 11,
  CABINET: 12,
  PILLAR: 13,
} as const;

export type StationKind = 'gen' | 'analyzer' | 'archive' | 'secpanel' | 'comm' | 'tx' | 'pod';

export interface StationDef {
  id: string;
  kind: StationKind;
  label: string;
  cx: number;
  cz: number;
  x: number;
  z: number;
  /** direção (yaw) para onde o console está virado */
  facing: number;
  zone: string;
}

export interface DoorDef {
  idx: number;
  cx: number;
  cz: number;
  x: number;
  z: number;
  secure: boolean;
  /** id da cápsula que esta porta de segurança protege */
  group?: string;
  /** 'x' = a folha da porta se estende no eixo X (passagem no eixo Z) */
  axis: 'x' | 'z';
}

export interface LockerDef {
  id: string;
  cx: number;
  cz: number;
  x: number;
  z: number;
  facing: number;
  /** posição de saída do armário (célula livre adjacente) */
  outX: number;
  outZ: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  theme: 'cold' | 'warm' | 'lab' | 'industrial' | 'dock' | 'tunnel' | 'containment' | 'corridor';
  windows: boolean;
}

export interface LightDef {
  x: number;
  y: number;
  z: number;
  zone: string;
  color: [number, number, number];
  radius: number;
  emergency: boolean;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface MapDef {
  id: string;
  name: string;
  w: number;
  h: number;
  cells: Uint8Array;
  props: Uint8Array;
  doors: DoorDef[];
  stations: StationDef[];
  lockers: LockerDef[];
  zones: ZoneDef[];
  lights: LightDef[];
  itemSpots: { x: number; z: number; zone: string }[];
  /** pontos onde caixas de munição/combustível podem surgir */
  supplySpots: { x: number; z: number; zone: string }[];
  survivorSpawns: { x: number; z: number }[][];
  entitySpawns: { x: number; z: number }[];
  /** área de fuga (em metros) de cada cápsula */
  exits: Record<string, Rect>;
  fogColor: [number, number, number];
}

export const cc = (c: number) => (c + 0.5) * CELL;

const THEME_LIGHT: Record<ZoneDef['theme'], [number, number, number]> = {
  cold: [0.62, 0.78, 1.0],
  warm: [1.0, 0.78, 0.55],
  lab: [0.65, 1.0, 0.92],
  industrial: [1.0, 0.86, 0.6],
  dock: [0.55, 0.85, 1.0],
  tunnel: [1.0, 0.7, 0.4],
  containment: [0.85, 0.55, 1.0],
  corridor: [0.75, 0.85, 1.0],
};

export class MapBuilder {
  readonly cells: Uint8Array;
  readonly props: Uint8Array;
  private doors: DoorDef[] = [];
  private stations: StationDef[] = [];
  private lockerCells: { cx: number; cz: number }[] = [];
  private zones: ZoneDef[] = [];
  private lights: LightDef[] = [];
  private itemSpots: { x: number; z: number; zone: string }[] = [];
  private supplySpots: { x: number; z: number; zone: string }[] = [];
  private survivorSpawns: { x: number; z: number }[][] = [];
  private entitySpawns: { x: number; z: number }[] = [];
  private exits: Record<string, Rect> = {};
  private extraLights: { cx: number; cz: number; zone: string }[] = [];
  private noAutoLight = new Set<string>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly w: number,
    readonly h: number,
    readonly fogColor: [number, number, number],
  ) {
    this.cells = new Uint8Array(w * h).fill(T.WALL);
    this.props = new Uint8Array(w * h);
  }

  idx(cx: number, cz: number) {
    return cz * this.w + cx;
  }
  get(cx: number, cz: number): number {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return T.WALL;
    return this.cells[this.idx(cx, cz)];
  }
  private set(cx: number, cz: number, t: number, prop = 0) {
    if (cx <= 0 || cz <= 0 || cx >= this.w - 1 || cz >= this.h - 1) throw new Error(`célula fora do mapa: ${cx},${cz}`);
    this.cells[this.idx(cx, cz)] = t;
    this.props[this.idx(cx, cz)] = prop;
  }

  carve(x0: number, z0: number, x1: number, z1: number) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, z, T.FLOOR);
    return this;
  }

  zone(id: string, name: string, x0: number, z0: number, x1: number, z1: number, theme: ZoneDef['theme'], opts: { carve?: boolean; windows?: boolean; autoLight?: boolean } = {}) {
    if (opts.carve !== false) this.carve(x0, z0, x1, z1);
    this.zones.push({ id, name, x0, z0, x1, z1, theme, windows: !!opts.windows });
    if (opts.autoLight === false) this.noAutoLight.add(id);
    return this;
  }

  door(cx: number, cz: number, secure = false, group?: string) {
    this.set(cx, cz, secure ? T.SECDOOR : T.DOOR);
    this.doors.push({ idx: this.idx(cx, cz), cx, cz, x: cc(cx), z: cc(cz), secure, group, axis: 'x' });
    return this;
  }
  low(cx: number, cz: number, prop: number) {
    this.set(cx, cz, T.LOW, prop);
    return this;
  }
  lows(list: [number, number][], prop: number) {
    for (const [x, z] of list) this.low(x, z, prop);
    return this;
  }
  machine(cx: number, cz: number, prop: number) {
    this.set(cx, cz, T.MACHINE, prop);
    return this;
  }
  machines(list: [number, number][], prop: number) {
    for (const [x, z] of list) this.machine(x, z, prop);
    return this;
  }
  locker(cx: number, cz: number) {
    this.set(cx, cz, T.LOCKER);
    this.lockerCells.push({ cx, cz });
    return this;
  }
  station(id: string, kind: StationKind, label: string, cx: number, cz: number) {
    this.set(cx, cz, T.STATION);
    this.stations.push({ id, kind, label, cx, cz, x: cc(cx), z: cc(cz), facing: 0, zone: '' });
    return this;
  }
  item(cx: number, cz: number) {
    this.itemSpots.push({ x: cc(cx), z: cc(cz), zone: '' });
    return this;
  }
  supply(cx: number, cz: number) {
    this.supplySpots.push({ x: cc(cx), z: cc(cz), zone: '' });
    return this;
  }
  spawnGroup(list: [number, number][]) {
    this.survivorSpawns.push(list.map(([x, z]) => ({ x: cc(x), z: cc(z) })));
    return this;
  }
  entitySpawn(cx: number, cz: number) {
    this.entitySpawns.push({ x: cc(cx), z: cc(cz) });
    return this;
  }
  exit(podId: string, x0: number, z0: number, x1: number, z1: number) {
    this.exits[podId] = { x0: x0 * CELL, z0: z0 * CELL, x1: (x1 + 1) * CELL, z1: (z1 + 1) * CELL };
    return this;
  }
  light(cx: number, cz: number, zone: string) {
    this.extraLights.push({ cx, cz, zone });
    return this;
  }

  zoneAt(cx: number, cz: number): string {
    // zonas declaradas depois têm prioridade (permite sub-zonas)
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i];
      if (cx >= zn.x0 && cx <= zn.x1 && cz >= zn.z0 && cz <= zn.z1) return zn.id;
    }
    return 'corr_norte';
  }

  /** Direção (yaw) apontando da célula para o primeiro vizinho livre. yaw=0 olha para -Z. */
  private facingTo(cx: number, cz: number): { yaw: number; ox: number; oz: number } {
    const dirs: [number, number, number][] = [
      [0, 1, Math.PI], // +Z
      [1, 0, -Math.PI / 2], // +X
      [0, -1, 0], // -Z
      [-1, 0, Math.PI / 2], // -X
    ];
    for (const [dx, dz, yaw] of dirs) {
      if (this.get(cx + dx, cz + dz) === T.FLOOR) return { yaw, ox: cx + dx, oz: cz + dz };
    }
    throw new Error(`objeto sem acesso livre em ${cx},${cz}`);
  }

  build(): MapDef {
    // orientação das portas
    for (const d of this.doors) {
      const solidX = this.get(d.cx - 1, d.cz) !== T.FLOOR && this.get(d.cx + 1, d.cz) !== T.FLOOR;
      d.axis = solidX ? 'x' : 'z';
    }
    for (const s of this.stations) {
      s.facing = this.facingTo(s.cx, s.cz).yaw;
      s.zone = this.zoneAt(s.cx, s.cz);
    }
    const lockers: LockerDef[] = this.lockerCells.map((l, i) => {
      const f = this.facingTo(l.cx, l.cz);
      return { id: `L${i}`, cx: l.cx, cz: l.cz, x: cc(l.cx), z: cc(l.cz), facing: f.yaw, outX: cc(f.ox), outZ: cc(f.oz) };
    });
    for (const it of this.itemSpots) {
      const cx = Math.floor(it.x / CELL);
      const cz = Math.floor(it.z / CELL);
      if (this.get(cx, cz) !== T.FLOOR) throw new Error(`ponto de item em célula ocupada: ${cx},${cz}`);
      it.zone = this.zoneAt(cx, cz);
    }
    for (const sp of this.supplySpots) {
      const cx = Math.floor(sp.x / CELL);
      const cz = Math.floor(sp.z / CELL);
      if (this.get(cx, cz) !== T.FLOOR) throw new Error(`ponto de suprimento em célula ocupada: ${cx},${cz}`);
      sp.zone = this.zoneAt(cx, cz);
    }
    for (const g of this.survivorSpawns)
      for (const p of g) if (this.get(Math.floor(p.x / CELL), Math.floor(p.z / CELL)) !== T.FLOOR) throw new Error(`spawn inválido ${p.x},${p.z}`);

    // luzes automáticas: grade por zona + uma luz de emergência por zona
    for (const zn of this.zones) {
      const color = THEME_LIGHT[zn.theme];
      if (!this.noAutoLight.has(zn.id)) {
        const wCells = zn.x1 - zn.x0 + 1;
        const hCells = zn.z1 - zn.z0 + 1;
        const nx = Math.max(1, Math.round(wCells / 5));
        const nz = Math.max(1, Math.round(hCells / 5));
        for (let i = 0; i < nx; i++)
          for (let j = 0; j < nz; j++) {
            let cx = Math.floor(zn.x0 + ((i + 0.5) * wCells) / nx);
            let cz = Math.floor(zn.z0 + ((j + 0.5) * hCells) / nz);
            if (this.get(cx, cz) !== T.FLOOR) {
              // procura célula livre próxima
              let found = false;
              for (let r = 1; r < 3 && !found; r++)
                for (let dz = -r; dz <= r && !found; dz++)
                  for (let dx = -r; dx <= r && !found; dx++)
                    if (this.get(cx + dx, cz + dz) === T.FLOOR) {
                      cx += dx;
                      cz += dz;
                      found = true;
                    }
              if (!found) continue;
            }
            this.lights.push({ x: cc(cx), y: WALL_H - 0.3, z: cc(cz), zone: zn.id, color, radius: 11, emergency: false });
          }
      }
      // emergência: 1 a 3 luzes vermelhas por zona, ao longo do maior eixo
      const wC = zn.x1 - zn.x0 + 1;
      const hC = zn.z1 - zn.z0 + 1;
      const n = Math.max(1, Math.min(3, Math.round(Math.max(wC, hC) / 9)));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const ex = wC >= hC ? Math.floor(zn.x0 + t * wC) : Math.floor((zn.x0 + zn.x1) / 2);
        const ez = wC >= hC ? Math.floor((zn.z0 + zn.z1) / 2) : Math.floor(zn.z0 + t * hC);
        this.lights.push({ x: cc(ex), y: WALL_H - 0.4, z: cc(ez), zone: zn.id, color: [1, 0.14, 0.09], radius: 12, emergency: true });
      }
    }
    for (const l of this.extraLights) {
      const zn = this.zones.find((z) => z.id === l.zone)!;
      this.lights.push({ x: cc(l.cx), y: WALL_H - 0.3, z: cc(l.cz), zone: l.zone, color: THEME_LIGHT[zn.theme], radius: 9, emergency: false });
    }

    const def: MapDef = {
      id: this.id,
      name: this.name,
      w: this.w,
      h: this.h,
      cells: this.cells,
      props: this.props,
      doors: this.doors,
      stations: this.stations,
      lockers,
      zones: this.zones,
      lights: this.lights,
      itemSpots: this.itemSpots,
      supplySpots: this.supplySpots,
      survivorSpawns: this.survivorSpawns,
      entitySpawns: this.entitySpawns,
      exits: this.exits,
      fogColor: this.fogColor,
    };
    validateConnectivity(def);
    return def;
  }
}

/** Garante que toda célula livre seja alcançável (com portas abertas). Lança erro caso contrário. */
export function validateConnectivity(m: MapDef) {
  const passable = (i: number) => m.cells[i] === T.FLOOR || m.cells[i] === T.DOOR || m.cells[i] === T.SECDOOR;
  const start = m.entitySpawns[0];
  const s = Math.floor(start.z / CELL) * m.w + Math.floor(start.x / CELL);
  const seen = new Uint8Array(m.w * m.h);
  const q = [s];
  seen[s] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % m.w;
    const z = (i / m.w) | 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= m.w || nz >= m.h) continue;
      const j = nz * m.w + nx;
      if (!seen[j] && passable(j)) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  const unreached: string[] = [];
  for (let i = 0; i < m.cells.length; i++) if (passable(i) && !seen[i]) unreached.push(`${i % m.w},${(i / m.w) | 0}`);
  if (unreached.length) throw new Error(`Mapa ${m.id}: células inalcançáveis: ${unreached.slice(0, 10).join(' ')}`);
}

// ---------------------------------------------------------------------------
// MAPA 1 — COMPLEXO ABISSAL
// Instalação científica a 2.400 m de profundidade. 46 x 34 células (92 x 68 m).
// ---------------------------------------------------------------------------
export function buildComplexoAbissal(): MapDef {
  const b = new MapBuilder('abissal', 'Complexo Abissal', 46, 34, [0.012, 0.03, 0.045]);

  // --- Zonas ---
  b.zone('alojamentos', 'Alojamentos', 1, 1, 12, 9, 'warm', { windows: true });
  b.zone('refeitorio', 'Refeitório', 15, 1, 28, 9, 'warm', { windows: true });
  b.zone('enfermaria', 'Enfermaria', 31, 1, 44, 9, 'cold', { windows: true });
  b.zone('corr_norte', 'Corredor Norte', 1, 11, 44, 12, 'corridor');
  b.zone('energia', 'Sala de Energia', 1, 14, 11, 21, 'industrial', { windows: true });
  b.zone('controle', 'Centro de Controle', 15, 14, 29, 21, 'cold');
  b.zone('laboratorio', 'Laboratório Principal', 33, 14, 44, 21, 'lab', { windows: true });
  b.zone('corr_sul', 'Corredor Sul', 1, 23, 44, 24, 'corridor');
  b.zone('tuneis', 'Túneis de Manutenção', 8, 26, 20, 32, 'tunnel', { carve: false, autoLight: false });
  b.zone('contencao', 'Câmara de Contenção', 23, 26, 33, 32, 'containment');
  b.zone('doca_oeste', 'Doca de Evacuação Oeste', 1, 26, 6, 32, 'dock', { windows: true });
  b.zone('doca_leste', 'Doca de Evacuação Leste', 36, 26, 44, 32, 'dock', { windows: true });

  // --- Ligações (portas e passagens) ---
  b.door(4, 10).carve(10, 10, 10, 10); // alojamentos <-> corredor norte
  b.carve(18, 10, 19, 10).door(26, 10); // refeitório
  b.door(34, 10).carve(41, 10, 41, 10); // enfermaria
  b.door(13, 5).carve(14, 5, 14, 5); // alojamentos <-> refeitório
  b.carve(29, 7, 29, 7).door(30, 7); // refeitório <-> enfermaria
  b.door(5, 13).carve(9, 13, 9, 13); // energia
  b.carve(21, 13, 22, 13).door(27, 13); // controle
  b.door(36, 13).carve(42, 13, 42, 13); // laboratório
  b.door(12, 18).carve(13, 18, 14, 18); // energia <-> controle
  b.carve(30, 16, 31, 16).door(32, 16); // controle <-> laboratório
  b.door(3, 22).carve(8, 22, 8, 22); // energia <-> corredor sul
  b.carve(17, 22, 17, 22).door(25, 22); // controle <-> corredor sul
  b.door(38, 22).carve(43, 22, 43, 22); // laboratório <-> corredor sul
  b.carve(10, 25, 10, 26).carve(18, 25, 18, 26); // corredor sul <-> túneis
  b.door(24, 25).carve(31, 25, 31, 25); // corredor sul <-> contenção
  b.door(3, 25, true, 'podW'); // doca oeste (segurança)
  b.door(40, 25, true, 'podE'); // doca leste (segurança)

  // --- Túneis de manutenção (labirinto estreito) ---
  b.carve(8, 27, 20, 27).carve(8, 30, 20, 30).carve(8, 32, 20, 32);
  b.carve(8, 27, 8, 32).carve(14, 27, 14, 30).carve(20, 27, 20, 32).carve(11, 30, 11, 32).carve(17, 30, 17, 32);
  b.carve(21, 31, 22, 31); // brecha para a contenção
  b.carve(12, 28, 12, 28).carve(16, 28, 16, 28); // nichos
  b.light(8, 27, 'tuneis').light(14, 30, 'tuneis').light(20, 27, 'tuneis').light(11, 32, 'tuneis').light(20, 32, 'tuneis').light(17, 30, 'tuneis');

  // --- Alojamentos ---
  b.lows([[2, 2], [3, 2], [6, 2], [7, 2], [10, 2], [11, 2], [2, 7], [3, 7], [6, 7], [7, 7]], PROP.BED);
  b.locker(1, 4).locker(1, 5).locker(1, 6).locker(12, 8).locker(8, 9);
  // --- Refeitório ---
  b.lows([[17, 3], [18, 3], [22, 3], [23, 3], [17, 6], [18, 6], [22, 6], [23, 6]], PROP.TABLE);
  b.lows([[25, 1], [26, 1], [27, 1], [28, 1]], PROP.COUNTER);
  b.locker(15, 8).locker(28, 9);
  // --- Enfermaria ---
  b.lows([[33, 2], [36, 2], [39, 2], [42, 2], [33, 6], [36, 6], [39, 6]], PROP.BED);
  b.machines([[44, 4], [44, 5]], PROP.CABINET);
  b.locker(31, 4).locker(44, 8);
  // --- Sala de energia ---
  b.machines([[3, 16], [4, 16], [3, 17], [4, 17], [7, 16], [8, 16], [7, 17], [8, 17]], PROP.GENERATOR);
  b.lows([[10, 14], [11, 14]], PROP.CRATE);
  b.locker(6, 21).locker(11, 21);
  // --- Centro de controle ---
  b.lows([[19, 17], [20, 17], [24, 17], [25, 17]], PROP.DESK);
  b.locker(28, 14).locker(29, 21);
  // --- Laboratório ---
  b.lows([[35, 16], [36, 16], [39, 16], [40, 16], [35, 19], [36, 19], [39, 19], [40, 19]], PROP.BENCH);
  b.machine(44, 14, PROP.TANK);
  b.locker(33, 21).locker(44, 21);
  // --- Contenção ---
  b.machines([[27, 28], [28, 28], [27, 29], [28, 29]], PROP.TANK);
  b.machines([[24, 27], [31, 31]], PROP.PILLAR);
  b.locker(33, 32);
  // --- Docas ---
  b.lows([[5, 31], [6, 31]], PROP.CRATE).lows([[37, 31], [38, 31]], PROP.CRATE);
  b.locker(1, 26).locker(44, 26);
  // --- Túneis: armários nos nichos ---
  b.locker(12, 29).locker(16, 29);

  // --- Estações de objetivo ---
  b.station('gen', 'gen', 'Painel do gerador', 1, 19);
  b.station('analyzer', 'analyzer', 'Analisador biológico', 44, 17);
  b.station('archive', 'archive', 'Terminal de arquivo', 15, 20);
  b.station('secpanel', 'secpanel', 'Painel de segurança', 18, 14);
  b.station('comm1', 'comm', 'Console de comunicação A', 15, 15);
  b.station('comm2', 'comm', 'Console de comunicação B', 29, 19);
  b.station('comm3', 'comm', 'Console de comunicação C', 24, 21);
  b.station('tx1', 'tx', 'Transmissor dos alojamentos', 12, 1);
  b.station('tx2', 'tx', 'Transmissor do refeitório', 15, 1);
  b.station('tx3', 'tx', 'Transmissor da enfermaria', 44, 1);
  b.station('tx4', 'tx', 'Transmissor do laboratório', 33, 14);
  b.station('tx5', 'tx', 'Transmissor dos túneis', 9, 28);
  b.station('tx6', 'tx', 'Transmissor da energia', 11, 16);
  b.station('tx7', 'tx', 'Transmissor da contenção', 33, 27);
  b.station('podW', 'pod', 'Cápsula de evacuação Oeste', 6, 27);
  b.station('podE', 'pod', 'Cápsula de evacuação Leste', 36, 27);
  b.exit('podW', 1, 30, 3, 32);
  b.exit('podE', 42, 30, 44, 32);

  // --- Pontos possíveis de itens ---
  const spots: [number, number][] = [
    [4, 4], [9, 5], [11, 9], [5, 8], // alojamentos
    [20, 2], [27, 5], [16, 9], [24, 8], // refeitório
    [35, 4], [41, 8], [43, 3], [32, 8], // enfermaria
    [6, 12], [30, 11], [16, 12], // corredor norte
    [2, 14], [6, 19], [10, 19], // energia
    [17, 16], [27, 16], [22, 19], // controle
    [34, 18], [41, 14], [38, 21], [42, 18], // laboratório
    [13, 24], [35, 23], // corredor sul
    [12, 28], [16, 28], [8, 32], [20, 30], [14, 32], // túneis
    [26, 31], [32, 26], // contenção
  ];
  for (const [x, z] of spots) b.item(x, z);

  // --- Pontos de suprimentos (munição e combustível) ---
  // Corredores, túneis e a própria contenção: lugares de passagem e de risco.
  // Nenhum nas docas, para não facilitar a fuga.
  const supplies: [number, number][] = [
    [2, 11], [24, 12], [38, 11], [44, 12], // corredor norte
    [2, 24], [22, 23], [29, 24], [44, 23], // corredor sul
    [14, 27], [20, 28], [8, 30], [17, 32], // túneis
    [23, 32], [30, 26], // contenção
    [10, 20], [28, 18], [44, 19], [38, 9], [12, 4], [28, 4], // salas
  ];
  for (const [x, z] of supplies) b.supply(x, z);

  // --- Spawns ---
  b.spawnGroup([[19, 4], [20, 4], [21, 4], [19, 5], [20, 5], [21, 5], [20, 8], [21, 8]]);
  b.spawnGroup([[4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 4], [4, 4], [5, 4]]);
  b.spawnGroup([[34, 4], [35, 4], [37, 4], [38, 4], [40, 4], [41, 4], [35, 8], [37, 8]]);
  b.entitySpawn(25, 30).entitySpawn(31, 27);

  return b.build();
}

export const MAPS: Record<string, () => MapDef> = {
  abissal: buildComplexoAbissal,
};

export const MAP_LIST = [{ id: 'abissal', name: 'Complexo Abissal', desc: 'Instalação científica submarina a 2.400 m de profundidade.' }];

const cache: Record<string, MapDef> = {};
export function getMap(id: string): MapDef {
  if (!MAPS[id]) throw new Error(`mapa desconhecido: ${id}`);
  return (cache[id] ??= MAPS[id]());
}
