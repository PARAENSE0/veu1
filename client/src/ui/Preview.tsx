/** Visualização 3D giratória de um personagem (usa o mesmo renderizador do jogo). */
import { useEffect, useRef } from 'react';
import { resolveAppearance, type Loadout } from '../../../shared/progression';
import { identity, mat4, scale, translate } from '../game/math';
import { drawEntity, drawSurvivor } from '../game/models';
import { Renderer } from '../game/renderer';
import { LAYER } from '../game/textures';

export function CharacterPreview(p: { loadout: Loadout; kind: 'survivor' | 'entity'; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const loadRef = useRef(p.loadout);
  loadRef.current = p.loadout;
  const kindRef = useRef(p.kind);
  kindRef.current = p.kind;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let r: Renderer;
    try {
      r = new Renderer(cv, { scale: 1, lights: 4, spots: 1, particles: 0, texSize: 256, grain: 0 });
    } catch {
      return;
    }
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let drag = 0;
    let dragging = false;
    let lastX = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      cv.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (dragging) {
        drag += (e.clientX - lastX) * 0.01;
        lastX = e.clientX;
      }
    };
    const up = () => (dragging = false);
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    const M = mat4();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      t += dt;
      const ent = kindRef.current === 'entity';
      const camY = ent ? 1.7 : 1.05;
      const dist = ent ? 6.2 : 3.9;
      r.begin({ x: 0, y: camY, z: dist, yaw: 0, pitch: ent ? 0.02 : -0.03, fov: 40 }, { ambient: [0.18, 0.2, 0.24], fog: [0.02, 0.05, 0.07], fogDensity: 0.02, vision: 0, time: t });
      r.setLights(
        [
          { x: 1.5, y: 3, z: 2, r: 1.4, g: 1.3, b: 1.2, radius: 9 },
          { x: -2, y: 1.5, z: -1, r: 0.2, g: 0.6, b: 0.7, radius: 7 },
          { x: 0, y: 0.3, z: 1.5, r: ent ? 0.6 : 0.2, g: 0.1, b: 0.08, radius: 4 },
        ],
        [],
      );
      identity(M);
      translate(M, 0, -0.05, 0);
      scale(M, 3, 0.1, 3);
      r.draw(r.cube, M, { layer: LAYER.FLOOR, uv: [2, 2] });
      const ap = resolveAppearance(loadRef.current);
      const yaw = Math.PI + t * 0.5 + drag;
      if (ent) drawEntity(r, ap.entBody, ap.entGlow, { x: 0, z: 0, yaw, pitch: 0, speed: 0, phase: 0, time: t, stalk: false, attack: 0, dash: false, eco: Math.max(0, Math.sin(t * 0.7)) * 0.5, rastro: false, parasite: Math.max(0, Math.sin(t * 0.4)) }, { alpha: 1, emit: [0, 0, 0] });
      else drawSurvivor(r, ap, { x: 0, z: 0, yaw, pitch: 0, speed: 0, phase: 0, crouch: false, downed: false, channel: false, flash: false, time: t }, { alpha: 1, emit: [0, 0, 0] });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      r.dispose();
    };
  }, []);
  return <canvas ref={ref} className="preview-canvas" style={{ height: p.height ?? 360, cursor: 'grab' }} aria-label="Pré-visualização do personagem (arraste para girar)" />;
}
