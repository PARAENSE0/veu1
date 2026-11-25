/**
 * Minimapa (canto superior esquerdo): desenha a planta real do mapa (paredes,
 * pisos, portas abertas/fechadas/travadas, áreas de fuga), a posição e a
 * direção do próprio jogador em tempo real e apenas o que o jogador já pode
 * ver (companheiros visíveis, objetivos ativos). Clique (ou tecla M) amplia;
 * clique de novo ou no ✕ reduz.
 */
import { useEffect, useRef, useState } from 'react';
import { CELL } from '../../../shared/constants';
import { T, type MapDef } from '../../../shared/map';
import type { GameClient } from '../game/game';
import { getSettings, updateSettings } from '../settings';

function staticLayer(map: MapDef, px: number) {
  const c = document.createElement('canvas');
  c.width = map.w * px;
  c.height = map.h * px;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(4,12,16,0.92)';
  g.fillRect(0, 0, c.width, c.height);
  for (let z = 0; z < map.h; z++)
    for (let x = 0; x < map.w; x++) {
      const t = map.cells[z * map.w + x];
      if (t === T.WALL) continue;
      g.fillStyle = t === T.FLOOR || t === T.DOOR || t === T.SECDOOR ? '#1d3a40' : t === T.MACHINE ? '#30383c' : '#26474d';
      g.fillRect(x * px, z * px, px, px);
    }
  // contorno das paredes que tocam o piso
  g.fillStyle = '#4f7c81';
  for (let z = 0; z < map.h; z++)
    for (let x = 0; x < map.w; x++) {
      if (map.cells[z * map.w + x] !== T.WALL) continue;
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dz]) => {
        const nx = x + dx, nz = z + dz;
        return nx >= 0 && nz >= 0 && nx < map.w && nz < map.h && map.cells[nz * map.w + nx] !== T.WALL;
      });
      if (near) g.fillRect(x * px, z * px, px, px);
    }
  // nomes das salas e corredores (os mesmos do mapa real); só quando há espaço para ler
  if (px >= 5) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const zn of map.zones) {
      const w = (zn.x1 - zn.x0 + 1) * px;
      const h = (zn.z1 - zn.z0 + 1) * px;
      const cx = zn.x0 * px + w / 2;
      const cz = zn.z0 * px + h / 2;
      const name = zn.name.toUpperCase();
      let size = Math.min(px * 1.6, 15);
      g.font = `600 ${size}px system-ui, sans-serif`;
      while (size > 7 && g.measureText(name).width > w * 0.92) {
        size -= 1;
        g.font = `600 ${size}px system-ui, sans-serif`;
      }
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.fillStyle = 'rgba(220,240,242,0.9)';
      g.strokeText(name, cx, cz);
      g.fillText(name, cx, cz);
    }
  }
  // áreas de fuga
  g.strokeStyle = 'rgba(120,255,180,0.5)';
  g.lineWidth = 1;
  for (const r of Object.values(map.exits)) g.strokeRect((r.x0 / CELL) * px + 0.5, (r.z0 / CELL) * px + 0.5, ((r.x1 - r.x0) / CELL) * px - 1, ((r.z1 - r.z0) / CELL) * px - 1);
  return c;
}

export function Minimap(p: { client: GameClient; toggle: number; touch: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const [big, setBig] = useState(getSettings().minimapBig);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setBig((b) => !b);
  }, [p.toggle]);
  useEffect(() => updateSettings({ minimapBig: big }), [big]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const info0 = p.client.minimapInfo();
    const map = info0.map;
    const fit = () => {
      const maxW = big ? Math.min(window.innerWidth * 0.86, 900) : p.touch ? Math.min(150, window.innerWidth * 0.2) : Math.min(200, window.innerWidth * 0.26);
      const maxH = big ? window.innerHeight * 0.78 : 9999;
      return Math.max(2, Math.floor(Math.min(maxW / map.w, maxH / map.h)));
    };
    let px = fit();
    let layer = staticLayer(map, px);
    cv.width = layer.width;
    cv.height = layer.height;
    const g = cv.getContext('2d')!;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < (big ? 33 : 66)) return; // ~15–30 Hz bastam
      last = now;
      const want = fit();
      if (want !== px) {
        px = want;
        layer = staticLayer(map, px);
        cv.width = layer.width;
        cv.height = layer.height;
      }
      const s = p.client.minimapInfo();
      g.drawImage(layer, 0, 0);
      const k = px / CELL;
      // contorno da sala atual
      if (s.zone) {
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = 1.5;
        g.strokeRect(s.zone.x0 * px + 0.75, s.zone.z0 * px + 0.75, (s.zone.x1 - s.zone.x0 + 1) * px - 1.5, (s.zone.z1 - s.zone.z0 + 1) * px - 1.5);
      }
      if (roomRef.current) {
        const name = s.zone?.name ?? 'Passagem';
        if (roomRef.current.textContent !== name) roomRef.current.textContent = name;
      }
      // portas
      const locked = new Set(s.locked);
      for (const d of map.doors) {
        const open = s.doorOpen[d.idx] === 1;
        g.fillStyle = locked.has(d.idx) ? '#ff5a4a' : d.secure ? (open ? '#7dff9c' : '#e0b040') : open ? '#3e7f86' : '#b9d6d8';
        const cx = d.idx % map.w;
        const cz = Math.floor(d.idx / map.w);
        g.fillRect(cx * px + 1, cz * px + 1, px - 2, px - 2);
      }
      // cápsulas prontas
      g.fillStyle = 'rgba(120,255,180,0.25)';
      for (const id of s.pods) {
        const r = map.exits[id];
        if (r) g.fillRect(r.x0 * k, r.z0 * k, (r.x1 - r.x0) * k, (r.z1 - r.z0) * k);
      }
      // objetivos ativos (já listados no HUD)
      const pulse = 0.6 + 0.4 * Math.sin(now / 250);
      g.fillStyle = `rgba(255,200,80,${pulse})`;
      for (const st of s.stations) {
        const x = st.x * k;
        const z = st.z * k;
        const r = Math.max(2.5, px * 0.45);
        g.beginPath();
        g.moveTo(x, z - r);
        g.lineTo(x + r, z);
        g.lineTo(x, z + r);
        g.lineTo(x - r, z);
        g.closePath();
        g.fill();
      }
      if (s.detector) {
        g.strokeStyle = 'rgba(255,90,90,0.9)';
        g.beginPath();
        g.arc(s.detector.x * k, s.detector.z * k, px * 1.5, 0, Math.PI * 2);
        g.stroke();
      }
      // companheiros visíveis
      for (const m of s.mates) {
        g.fillStyle = m.downed ? '#ff7a5a' : '#8fe3ff';
        g.beginPath();
        g.arc(m.x * k, m.z * k, Math.max(2, px * 0.35), 0, Math.PI * 2);
        g.fill();
      }
      // eu: seta na direção do olhar (frente = -sin(yaw), -cos(yaw))
      const x = s.me.x * k;
      const z = s.me.z * k;
      const fx = -Math.sin(s.me.yaw);
      const fz = -Math.cos(s.me.yaw);
      const r = Math.max(5, px * 0.9);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.moveTo(x, z);
      g.arc(x, z, r * 3, Math.atan2(fz, fx) - 0.5, Math.atan2(fz, fx) + 0.5);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + fx * r, z + fz * r);
      g.lineTo(x - fx * r * 0.6 - fz * r * 0.6, z - fz * r * 0.6 + fx * r * 0.6);
      g.lineTo(x - fx * r * 0.25, z - fz * r * 0.25);
      g.lineTo(x - fx * r * 0.6 + fz * r * 0.6, z - fz * r * 0.6 - fx * r * 0.6);
      g.closePath();
      g.stroke();
      g.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [big, p.client, p.touch]);
  return (
    <div className={`minimap ${big ? 'big' : ''}`} onClick={() => setBig((b) => !b)} title={big ? 'Clique para reduzir' : 'Clique para ampliar (tecla M)'} role="button" aria-label="Minimapa">
      <canvas ref={ref} />
      <div className="minimap-room" ref={roomRef} aria-live="polite" />
      {big && (
        <button
          className="minimap-close"
          aria-label="Fechar mapa ampliado"
          onClick={(e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            setBig(false);
          }}
        >
          ✕
        </button>
      )}
      {big && <div className="minimap-legend">◆ objetivo · ● companheiro · ▮ porta (vermelha = travada, verde = segurança aberta)</div>}
    </div>
  );
}
