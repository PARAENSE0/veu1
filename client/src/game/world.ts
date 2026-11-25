/**
 * Gera a malha estática do mapa a partir do grid: piso, teto, paredes (só faces
 * expostas), escotilhas, móveis e máquinas. Tudo vai para um único buffer.
 */
import { CELL, WALL_H } from '../../../shared/constants';
import { PROP, T, type MapDef } from '../../../shared/map';
import { hashString } from '../../../shared/rng';
import { Geom } from './renderer';
import { LAYER } from './textures';

export function buildWorldGeom(m: MapDef): Geom {
  const g = new Geom();
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= m.w || z >= m.h ? T.WALL : m.cells[z * m.w + x]);
  const zoneOf = (x: number, z: number) => {
    for (let i = m.zones.length - 1; i >= 0; i--) {
      const zn = m.zones[i];
      if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn;
    }
    return null;
  };
  const exitCells = new Set<string>();
  for (const r of Object.values(m.exits))
    for (let z = r.z0 / CELL; z < r.z1 / CELL; z++) for (let x = r.x0 / CELL; x < r.x1 / CELL; x++) exitCells.add(`${x},${z}`);

  for (let z = 0; z < m.h; z++)
    for (let x = 0; x < m.w; x++) {
      const t = at(x, z);
      const x0 = x * CELL, z0 = z * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      if (t !== T.WALL) {
        const zn = zoneOf(x, z);
        const floorLayer = exitCells.has(`${x},${z}`) ? LAYER.HAZARD : zn?.theme === 'tunnel' ? LAYER.GRATE : LAYER.FLOOR;
        g.quad([[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]], floorLayer);
        g.quad([[x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], LAYER.CEIL);
        continue;
      }
      // parede: faces voltadas para células abertas
      const isBorder = x === 0 || z === 0 || x === m.w - 1 || z === m.h - 1;
      const faces: [number, number, number[][], number[]][] = [
        [1, 0, [[x1, 0, z1], [x1, 0, z0], [x1, WALL_H, z0], [x1, WALL_H, z1]], [1, 0, 0]],
        [-1, 0, [[x0, 0, z0], [x0, 0, z1], [x0, WALL_H, z1], [x0, WALL_H, z0]], [-1, 0, 0]],
        [0, 1, [[x0, 0, z1], [x1, 0, z1], [x1, WALL_H, z1], [x0, WALL_H, z1]], [0, 0, 1]],
        [0, -1, [[x1, 0, z0], [x0, 0, z0], [x0, WALL_H, z0], [x1, WALL_H, z0]], [0, 0, -1]],
      ];
      for (const [dx, dz, p, n] of faces) {
        const nt = at(x + dx, z + dz);
        if (nt === T.WALL) continue;
        const nzn = zoneOf(x + dx, z + dz);
        let layer: number = LAYER.WALL;
        const h = hashString(`${x},${z},${dx},${dz}`);
        if (isBorder && nzn?.windows && h % 3 === 0) layer = LAYER.WINDOW;
        if (nt === T.SECDOOR) layer = LAYER.HAZARD;
        g.quad(p, n, [[0, 1], [1, 1], [1, 0], [0, 0]], layer);
      }
    }

  // faixas de advertência ao redor das portas de segurança
  for (const d of m.doors) {
    if (!d.secure) continue;
    const x0 = d.cx * CELL, z0 = d.cz * CELL;
    g.box(x0 + 0.05, WALL_H - 0.5, z0 + 0.05, x0 + CELL - 0.05, WALL_H - 0.05, z0 + CELL - 0.05, LAYER.HAZARD, 0.5);
  }

  // móveis e máquinas
  for (let z = 0; z < m.h; z++)
    for (let x = 0; x < m.w; x++) {
      const t = at(x, z);
      const p = m.props[z * m.w + x];
      const x0 = x * CELL, z0 = z * CELL, cx = x0 + CELL / 2, cz = z0 + CELL / 2;
      if (t === T.LOW) {
        switch (p) {
          case PROP.BED:
            g.box(x0 + 0.15, 0, z0 + 0.25, x0 + 1.85, 0.42, z0 + 1.75, LAYER.CRATE, 0.5);
            g.box(x0 + 0.2, 0.42, z0 + 0.3, x0 + 1.8, 0.58, z0 + 1.7, LAYER.FABRIC, 0.5);
            g.box(x0 + 0.25, 0.58, z0 + 0.4, x0 + 0.75, 0.7, z0 + 1.6, LAYER.FABRIC, 1);
            // beliche
            g.box(x0 + 0.15, 1.3, z0 + 0.25, x0 + 1.85, 1.45, z0 + 1.75, LAYER.CRATE, 0.5);
            g.box(x0 + 0.15, 0, z0 + 0.25, x0 + 0.25, 1.45, z0 + 0.35, LAYER.PLAIN, 1);
            g.box(x0 + 1.75, 0, z0 + 1.65, x0 + 1.85, 1.45, z0 + 1.75, LAYER.PLAIN, 1);
            break;
          case PROP.TABLE:
          case PROP.BENCH:
            g.box(x0 + 0.1, 0.82, z0 + 0.1, x0 + 1.9, 0.92, z0 + 1.9, p === PROP.BENCH ? LAYER.PLAIN : LAYER.CRATE, 0.5);
            for (const [lx, lz] of [[0.2, 0.2], [1.7, 0.2], [0.2, 1.7], [1.7, 1.7]]) g.box(x0 + lx, 0, z0 + lz, x0 + lx + 0.1, 0.82, z0 + lz + 0.1, LAYER.PLAIN, 1);
            if (p === PROP.BENCH) {
              g.box(x0 + 0.4, 0.92, z0 + 0.5, x0 + 0.7, 1.2, z0 + 0.8, LAYER.GLASS, 1);
              g.box(x0 + 1.1, 0.92, z0 + 1.0, x0 + 1.6, 1.05, z0 + 1.4, LAYER.SCREEN, 1);
            }
            break;
          case PROP.DESK:
            g.box(x0 + 0.1, 0, z0 + 0.3, x0 + 1.9, 0.85, z0 + 1.7, LAYER.WALL, 0.5);
            g.box(x0 + 0.5, 0.85, z0 + 0.8, x0 + 1.5, 1.45, z0 + 0.9, LAYER.SCREEN, 1);
            break;
          case PROP.COUNTER:
            g.box(x0, 0, z0 + 0.2, x0 + CELL, 1.0, z0 + 1.8, LAYER.WALL, 0.5);
            g.box(x0, 1.0, z0 + 0.15, x0 + CELL, 1.08, z0 + 1.85, LAYER.PLAIN, 1);
            break;
          case PROP.MEDBOX:
            break; // desenhada a cada quadro por drawMedbox (luz/animação de uso)
          default:
            g.box(x0 + 0.25, 0, z0 + 0.25, x0 + 1.75, 1.1, z0 + 1.75, LAYER.CRATE, 0.66);
            g.box(x0 + 0.5, 1.1, z0 + 0.5, x0 + 1.4, 1.7, z0 + 1.4, LAYER.CRATE, 1);
        }
      } else if (t === T.MACHINE) {
        switch (p) {
          case PROP.GENERATOR:
            g.box(x0, 0, z0, x0 + CELL, 2.4, z0 + CELL, LAYER.WALL, 0.5);
            g.box(x0 + 0.2, 2.4, z0 + 0.2, x0 + 1.8, 2.7, z0 + 1.8, LAYER.GRATE, 1);
            g.box(x0 - 0.01, 0.2, z0 + 0.6, x0 + CELL + 0.01, 0.6, z0 + 1.4, LAYER.HAZARD, 0.5);
            break;
          case PROP.TANK:
            g.box(x0 + 0.1, 0, z0 + 0.1, x0 + 1.9, 0.4, z0 + 1.9, LAYER.WALL, 0.5);
            g.box(x0 + 0.2, 0.4, z0 + 0.2, x0 + 1.8, 2.6, z0 + 1.8, LAYER.GLASS, 0.5);
            g.box(x0 + 0.1, 2.6, z0 + 0.1, x0 + 1.9, WALL_H, z0 + 1.9, LAYER.WALL, 0.5);
            break;
          case PROP.CABINET:
            g.box(x0 + 0.1, 0, z0 + 0.1, x0 + 1.9, 2.2, z0 + 1.9, LAYER.LOCKER, 0.5);
            break;
          default:
            g.box(cx - 0.6, 0, cz - 0.6, cx + 0.6, WALL_H, cz + 0.6, LAYER.WALL, 0.5);
            g.box(cx - 0.65, 0, cz - 0.65, cx + 0.65, 0.5, cz + 0.65, LAYER.HAZARD, 0.5);
        }
      }
    }
  // armários (estáticos; a porta não anima)
  for (const l of m.lockers) {
    const x0 = l.cx * CELL, z0 = l.cz * CELL;
    g.box(x0 + 0.2, 0, z0 + 0.2, x0 + 1.8, 2.3, z0 + 1.8, LAYER.LOCKER, 0.5);
  }
  return g;
}
