/**
 * Página de inspeção dos modelos (usada por tests/model-shots.mjs): desenha a
 * entidade e sobreviventes em várias poses com o MESMO renderizador do jogo.
 * window.render(cena) desenha uma cena e devolve estatísticas.
 */
import { resolveAppearance, DEFAULT_LOADOUT, COSMETICS } from '../../shared/progression';
import { identity, mat4, scale, translate } from '../../client/src/game/math';
import { drawEntity, drawSurvivor } from '../../client/src/game/models';
import { Renderer } from '../../client/src/game/renderer';
import { LAYER } from '../../client/src/game/textures';

const cv = document.getElementById('c') as HTMLCanvasElement;
const r = new Renderer(cv, { scale: 1, lights: 8, spots: 1, particles: 0, texSize: 512, grain: 0 });
const M = mat4();
type Scene = { kind: 'entity' | 'survivor'; yaw: number; t?: number; pose?: Record<string, unknown>; loadout?: Record<string, string>; dist?: number; camY?: number; dark?: boolean };
(window as unknown as { render: (s: Scene) => unknown }).render = (s: Scene) => {
  const ent = s.kind === 'entity';
  const t = s.t ?? 1;
  r.begin({ x: 0, y: s.camY ?? (ent ? 1.45 : 0.95), z: s.dist ?? (ent ? 4.6 : 2.8), yaw: 0, pitch: 0, fov: 45 }, { ambient: s.dark ? [0.06, 0.066, 0.08] : [0.22, 0.22, 0.25], fog: [0.02, 0.03, 0.04], fogDensity: 0.01, vision: 0, time: t });
  r.setLights(
    [
      { x: 1.8, y: 3.2, z: 2.5, r: 1.5, g: 1.4, b: 1.3, radius: 10 },
      { x: -2.2, y: 2, z: -1, r: 0.35, g: 0.35, b: 0.5, radius: 8 },
      { x: 0, y: 1, z: 3, r: 0.4, g: 0.4, b: 0.4, radius: 6 },
    ],
    [],
  );
  identity(M);
  translate(M, 0, -0.05, 0);
  scale(M, 6, 0.1, 6);
  r.draw(r.cube, M, { layer: LAYER.FLOOR, uv: [3, 3] });
  r.drawCalls = 0;
  const ap = resolveAppearance({ ...DEFAULT_LOADOUT, ...(s.loadout ?? {}) } as never);
  if (ent) drawEntity(r, ap.entBody, ap.entGlow, { x: 0, z: 0, yaw: s.yaw, pitch: 0, speed: 0, phase: 0, time: t, stalk: false, attack: 0, dash: false, eco: 0, rastro: false, parasite: 0, ...(s.pose ?? {}) } as never, { alpha: 1, emit: [0, 0, 0] });
  else drawSurvivor(r, ap, { x: 0, z: 0, yaw: s.yaw, pitch: 0, speed: 0, phase: 0, crouch: false, downed: false, channel: false, flash: false, time: t, ...(s.pose ?? {}) } as never, { alpha: 1, emit: [0, 0, 0] });
  return { drawCalls: r.drawCalls };
};
(window as unknown as { cosmetics: unknown }).cosmetics = COSMETICS.map((c) => ({ id: c.id, slot: c.slot }));
(window as unknown as { ready: boolean }).ready = true;
