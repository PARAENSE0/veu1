/**
 * Texturas procedurais originais (geradas em canvas no carregamento).
 * Nenhuma imagem externa é usada. Cada textura vira uma camada de um
 * TEXTURE_2D_ARRAY, então o mundo inteiro é desenhado com uma única textura.
 */
import { Rng } from '../../../shared/rng';

export const LAYER = {
  FLOOR: 0,
  WALL: 1,
  CEIL: 2,
  HAZARD: 3,
  LOCKER: 4,
  WINDOW: 5,
  SCREEN: 6,
  DOOR: 7,
  PLAIN: 8,
  FABRIC: 9,
  FLESH: 10,
  GRATE: 11,
  DECAL: 12,
  GLASS: 13,
  LAMP: 14,
  CRATE: 15,
  /** pele da criatura: pálida, veias arroxeadas e escorridos de sangue */
  SKIN_M: 16,
  /** espinhos/garras: osso marfim que escurece em vermelho na ponta (v=0 base, v=1 ponta) */
  BONE: 17,
  TEETH: 18,
  /** pele humana (tingida pelo tom escolhido) */
  SKIN: 19,
  HAIR: 20,
} as const;
export const LAYER_COUNT = 21;

/** Quanto cada camada brilha por conta própria (emissiva). */
export const LAYER_EMIT = new Float32Array(LAYER_COUNT);
LAYER_EMIT[LAYER.WINDOW] = 0.55;
LAYER_EMIT[LAYER.SCREEN] = 0.95;
LAYER_EMIT[LAYER.LAMP] = 1.0;
LAYER_EMIT[LAYER.GLASS] = 0.35;

type Ctx = CanvasRenderingContext2D;

function noise(ctx: Ctx, s: number, rng: Rng, amount: number, alpha = 1) {
  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = Math.round(d[i + 3] * alpha);
  }
  ctx.putImageData(img, 0, 0);
}

function grime(ctx: Ctx, s: number, rng: Rng, n: number, color: string, maxR: number) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * s;
    const y = rng.next() * s;
    const r = rng.range(maxR * 0.2, maxR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function rivets(ctx: Ctx, pts: [number, number][], r: number) {
  for (const [x, y] of pts) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(x + r * 0.3, y + r * 0.3, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,210,220,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const painters: ((ctx: Ctx, s: number, rng: Rng) => void)[] = [];

painters[LAYER.FLOOR] = (c, s, rng) => {
  c.fillStyle = '#3a4048';
  c.fillRect(0, 0, s, s);
  // placas de piso 2x2 com frisos
  const h = s / 2;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const g = c.createLinearGradient(i * h, j * h, i * h + h, j * h + h);
      g.addColorStop(0, '#454c55');
      g.addColorStop(1, '#353a42');
      c.fillStyle = g;
      c.fillRect(i * h + 2, j * h + 2, h - 4, h - 4);
    }
  // padrão antiderrapante
  c.strokeStyle = 'rgba(255,255,255,0.05)';
  c.lineWidth = Math.max(1, s / 128);
  for (let y = 0; y < s; y += s / 16)
    for (let x = 0; x < s; x += s / 16) {
      c.beginPath();
      c.moveTo(x + s / 64, y + s / 64);
      c.lineTo(x + s / 24, y + s / 24);
      c.stroke();
    }
  rivets(c, [[s * 0.06, s * 0.06], [s * 0.44, s * 0.06], [s * 0.06, s * 0.44], [s * 0.44, s * 0.44], [s * 0.56, s * 0.56], [s * 0.94, s * 0.94], [s * 0.56, s * 0.94], [s * 0.94, s * 0.56]], s / 90);
  grime(c, s, rng, 14, 'rgba(10,20,15,0.35)', s / 4);
  grime(c, s, rng, 4, 'rgba(60,35,15,0.3)', s / 6);
  noise(c, s, rng, 22);
};

painters[LAYER.WALL] = (c, s, rng) => {
  c.fillStyle = '#4b5560';
  c.fillRect(0, 0, s, s);
  // painel principal
  const g = c.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#56616d');
  g.addColorStop(0.55, '#4a545f');
  g.addColorStop(1, '#2f363e');
  c.fillStyle = g;
  c.fillRect(s * 0.04, s * 0.04, s * 0.92, s * 0.62);
  // rodapé escuro
  c.fillStyle = '#272c33';
  c.fillRect(0, s * 0.7, s, s * 0.3);
  c.fillStyle = '#1c2026';
  c.fillRect(0, s * 0.7, s, s * 0.03);
  // tubulação
  for (const y of [0.78, 0.88]) {
    const pg = c.createLinearGradient(0, s * y - s * 0.03, 0, s * y + s * 0.03);
    pg.addColorStop(0, '#20252b');
    pg.addColorStop(0.5, '#6c7680');
    pg.addColorStop(1, '#1a1e23');
    c.fillStyle = pg;
    c.fillRect(0, s * y - s * 0.03, s, s * 0.06);
  }
  // listra de sinalização
  c.fillStyle = 'rgba(40,160,170,0.55)';
  c.fillRect(0, s * 0.665, s, s * 0.012);
  rivets(c, [[s * 0.08, s * 0.08], [s * 0.92, s * 0.08], [s * 0.08, s * 0.62], [s * 0.92, s * 0.62]], s / 100);
  // marcas de ferrugem e umidade escorrendo
  for (let i = 0; i < 6; i++) {
    const x = rng.next() * s;
    const w = rng.range(s * 0.01, s * 0.03);
    const lg = c.createLinearGradient(0, s * 0.1, 0, s * 0.7);
    lg.addColorStop(0, 'rgba(90,50,20,0.35)');
    lg.addColorStop(1, 'rgba(90,50,20,0)');
    c.fillStyle = lg;
    c.fillRect(x, s * rng.range(0.05, 0.3), w, s * 0.5);
  }
  grime(c, s, rng, 10, 'rgba(0,0,0,0.3)', s / 5);
  noise(c, s, rng, 18);
};

painters[LAYER.CEIL] = (c, s, rng) => {
  c.fillStyle = '#23282e';
  c.fillRect(0, 0, s, s);
  c.strokeStyle = '#15181c';
  c.lineWidth = s / 40;
  for (let i = 0; i <= 4; i++) {
    c.beginPath();
    c.moveTo((i * s) / 4, 0);
    c.lineTo((i * s) / 4, s);
    c.stroke();
    c.beginPath();
    c.moveTo(0, (i * s) / 4);
    c.lineTo(s, (i * s) / 4);
    c.stroke();
  }
  grime(c, s, rng, 8, 'rgba(0,0,0,0.4)', s / 4);
  noise(c, s, rng, 14);
};

painters[LAYER.HAZARD] = (c, s, rng) => {
  c.fillStyle = '#1b1b1b';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#c9a420';
  const w = s / 6;
  for (let i = -6; i < 12; i++) {
    c.beginPath();
    c.moveTo(i * w * 2, 0);
    c.lineTo(i * w * 2 + w, 0);
    c.lineTo(i * w * 2 + w + s, s);
    c.lineTo(i * w * 2 + s, s);
    c.fill();
  }
  grime(c, s, rng, 16, 'rgba(0,0,0,0.45)', s / 4);
  noise(c, s, rng, 30);
};

painters[LAYER.LOCKER] = (c, s, rng) => {
  c.fillStyle = '#3d5a5c';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#2d4446';
  c.fillRect(s * 0.06, s * 0.04, s * 0.88, s * 0.92);
  c.fillStyle = '#466567';
  c.fillRect(s * 0.1, s * 0.07, s * 0.8, s * 0.86);
  // ventilação
  c.fillStyle = '#101618';
  for (let i = 0; i < 6; i++) c.fillRect(s * 0.25, s * (0.12 + i * 0.035), s * 0.5, s * 0.015);
  // maçaneta
  c.fillStyle = '#9aa4a8';
  c.fillRect(s * 0.78, s * 0.45, s * 0.05, s * 0.12);
  grime(c, s, rng, 8, 'rgba(0,0,0,0.35)', s / 4);
  noise(c, s, rng, 20);
};

painters[LAYER.WINDOW] = (c, s, rng) => {
  // escotilha com o oceano escuro e luz difusa
  c.fillStyle = '#2e353d';
  c.fillRect(0, 0, s, s);
  const cx = s / 2;
  const cy = s * 0.38;
  const r = s * 0.27;
  c.fillStyle = '#1a1f24';
  c.beginPath();
  c.arc(cx, cy, r * 1.25, 0, Math.PI * 2);
  c.fill();
  const g = c.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#1c5d73');
  g.addColorStop(0.6, '#0b2c3c');
  g.addColorStop(1, '#03121a');
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  // partículas marinhas
  for (let i = 0; i < 25; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * r * 0.9;
    c.fillStyle = `rgba(160,230,255,${rng.range(0.1, 0.5)})`;
    c.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s / 160, s / 160);
  }
  rivets(c, Array.from({ length: 10 }, (_, i) => [cx + Math.cos((i / 10) * Math.PI * 2) * r * 1.12, cy + Math.sin((i / 10) * Math.PI * 2) * r * 1.12] as [number, number]), s / 110);
  c.fillStyle = '#272c33';
  c.fillRect(0, s * 0.7, s, s * 0.3);
  noise(c, s, rng, 12);
};

painters[LAYER.SCREEN] = (c, s, rng) => {
  c.fillStyle = '#04140f';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#2bd49a';
  c.font = `${Math.floor(s / 14)}px monospace`;
  const lines = ['SIST. 07 // PRESSÃO', '> CASCO: 0.81 atm', '> O2: 19.2%', 'ALERTA: CONTENÇÃO', '> SETOR C: ??', '  //////  ', '> SINAL: 0 dB'];
  lines.forEach((l, i) => c.fillText(l, s * 0.06, s * (0.14 + i * 0.12)));
  for (let y = 0; y < s; y += 3) {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(0, y, s, 1);
  }
  noise(c, s, rng, 16);
};

painters[LAYER.DOOR] = (c, s, rng) => {
  c.fillStyle = '#5a6168';
  c.fillRect(0, 0, s, s);
  const g = c.createLinearGradient(0, 0, s, 0);
  g.addColorStop(0, '#454b51');
  g.addColorStop(0.5, '#6a727a');
  g.addColorStop(1, '#40464c');
  c.fillStyle = g;
  c.fillRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
  // faixa de advertência
  c.save();
  c.beginPath();
  c.rect(s * 0.05, s * 0.72, s * 0.9, s * 0.12);
  c.clip();
  c.fillStyle = '#c9a420';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#1b1b1b';
  for (let i = -10; i < 20; i++) {
    c.beginPath();
    c.moveTo(i * s * 0.08, s * 0.72);
    c.lineTo(i * s * 0.08 + s * 0.04, s * 0.72);
    c.lineTo(i * s * 0.08 + s * 0.16, s * 0.84);
    c.lineTo(i * s * 0.08 + s * 0.12, s * 0.84);
    c.fill();
  }
  c.restore();
  // visor
  c.fillStyle = '#0e1a22';
  c.fillRect(s * 0.35, s * 0.15, s * 0.3, s * 0.2);
  c.fillStyle = 'rgba(80,160,200,0.25)';
  c.fillRect(s * 0.36, s * 0.16, s * 0.28, s * 0.06);
  rivets(c, [[s * 0.1, s * 0.1], [s * 0.9, s * 0.1], [s * 0.1, s * 0.9], [s * 0.9, s * 0.9]], s / 90);
  grime(c, s, rng, 8, 'rgba(0,0,0,0.3)', s / 4);
  noise(c, s, rng, 18);
};

painters[LAYER.PLAIN] = (c, s, rng) => {
  c.fillStyle = '#e8e8e8';
  c.fillRect(0, 0, s, s);
  noise(c, s, rng, 10);
};

painters[LAYER.FABRIC] = (c, s, rng) => {
  c.fillStyle = '#dddddd';
  c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < s; i += 3) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i, s);
    c.stroke();
  }
  // costuras
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.setLineDash([s / 40, s / 60]);
  c.strokeRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
  c.setLineDash([]);
  grime(c, s, rng, 6, 'rgba(0,0,0,0.15)', s / 4);
  noise(c, s, rng, 18);
};

painters[LAYER.FLESH] = (c, s, rng) => {
  // quitina escura com veias (tingida pela cor da entidade)
  c.fillStyle = '#b8b8b8';
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    c.strokeStyle = `rgba(0,0,0,${rng.range(0.15, 0.4)})`;
    c.lineWidth = rng.range(1, s / 60);
    c.beginPath();
    let x = rng.next() * s;
    let y = rng.next() * s;
    c.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += rng.range(-s / 10, s / 10);
      y += rng.range(-s / 10, s / 10);
      c.lineTo(x, y);
    }
    c.stroke();
  }
  // placas
  for (let i = 0; i < 12; i++) {
    c.fillStyle = `rgba(255,255,255,${rng.range(0.05, 0.15)})`;
    c.beginPath();
    c.ellipse(rng.next() * s, rng.next() * s, rng.range(s / 20, s / 8), rng.range(s / 30, s / 12), rng.next() * 3, 0, Math.PI * 2);
    c.fill();
  }
  noise(c, s, rng, 40);
};

painters[LAYER.GRATE] = (c, s, rng) => {
  c.fillStyle = '#0c0e10';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#4a525a';
  const n = 10;
  for (let i = 0; i < n; i++) {
    c.fillRect(0, (i * s) / n, s, s / n / 3);
    c.fillRect((i * s) / n, 0, s / n / 3, s);
  }
  noise(c, s, rng, 25);
};

painters[LAYER.DECAL] = (c, s) => {
  c.clearRect(0, 0, s, s);
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
};

painters[LAYER.GLASS] = (c, s, rng) => {
  const g = c.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, 'rgba(120,220,200,0.9)');
  g.addColorStop(1, 'rgba(40,120,110,0.9)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 30; i++) {
    c.fillStyle = `rgba(255,255,255,${rng.range(0.05, 0.3)})`;
    c.beginPath();
    c.arc(rng.next() * s, rng.next() * s, rng.range(1, s / 30), 0, Math.PI * 2);
    c.fill();
  }
};

painters[LAYER.LAMP] = (c, s) => {
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, s, s);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 1; i < 6; i++) c.fillRect((i * s) / 6, 0, s / 60, s);
};

painters[LAYER.CRATE] = (c, s, rng) => {
  c.fillStyle = '#5b5a4a';
  c.fillRect(0, 0, s, s);
  c.strokeStyle = '#3a392f';
  c.lineWidth = s / 18;
  c.strokeRect(s * 0.04, s * 0.04, s * 0.92, s * 0.92);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(s, s);
  c.stroke();
  c.fillStyle = 'rgba(220,220,200,0.5)';
  c.font = `bold ${Math.floor(s / 9)}px monospace`;
  c.fillText('AB-07', s * 0.28, s * 0.55);
  grime(c, s, rng, 10, 'rgba(0,0,0,0.3)', s / 4);
  noise(c, s, rng, 22);
};

/** Desenha repetindo nas bordas para a textura emendar sem costura. */
function wrapped(c: Ctx, s: number, draw: (ox: number, oy: number) => void) {
  for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) draw(ox, oy);
}

painters[LAYER.SKIN_M] = (c, s, rng) => {
  // base pálida lilás-acinzentada com manchas
  c.fillStyle = '#d8d0d8';
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * s, y = rng.next() * s, r = rng.range(s / 14, s / 4);
    const tone = rng.next() < 0.5 ? 'rgba(150,140,190,0.22)' : 'rgba(235,215,200,0.25)';
    wrapped(c, s, (ox, oy) => {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, tone);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }
  // veias ramificadas (azul-arroxeadas)
  const vein = (x: number, y: number, ang: number, w: number, depth: number) => {
    let px = x, py = y, a = ang;
    const steps = 8 + Math.floor(rng.next() * 8);
    for (let k = 0; k < steps; k++) {
      const nx = px + (Math.cos(a) * s) / 30, ny = py + (Math.sin(a) * s) / 30;
      c.strokeStyle = `rgba(95,80,150,${Math.min(0.6, 0.25 + 0.2 * (w / (s / 80)))})`;
      c.lineWidth = w;
      wrapped(c, s, (ox, oy) => {
        c.beginPath();
        c.moveTo(px + ox, py + oy);
        c.lineTo(nx + ox, ny + oy);
        c.stroke();
      });
      px = nx;
      py = ny;
      a += rng.range(-0.5, 0.5);
      w *= 0.93;
      if (depth < 2 && rng.next() < 0.18) vein(px, py, a + rng.range(-1.2, 1.2), w * 0.7, depth + 1);
    }
  };
  for (let i = 0; i < 14; i++) vein(rng.next() * s, rng.next() * s, rng.next() * Math.PI * 2, rng.range(s / 160, s / 80), 0);
  // sangue: escorridos verticais e respingos
  for (let i = 0; i < 18; i++) {
    const x = rng.next() * s, y = rng.next() * s, len = rng.range(s / 10, s / 2.5), w = rng.range(s / 120, s / 45);
    wrapped(c, s, (ox, oy) => {
      const g = c.createLinearGradient(0, y + oy, 0, y + oy + len);
      g.addColorStop(0, 'rgba(120,8,10,0.85)');
      g.addColorStop(0.7, 'rgba(150,15,15,0.55)');
      g.addColorStop(1, 'rgba(150,15,15,0)');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x + ox, y + oy + len / 2, w, len / 2, 0, 0, Math.PI * 2);
      c.fill();
    });
  }
  for (let i = 0; i < 40; i++) {
    const x = rng.next() * s, y = rng.next() * s, r = rng.range(1, s / 70);
    c.fillStyle = `rgba(130,10,12,${rng.range(0.4, 0.9)})`;
    wrapped(c, s, (ox, oy) => {
      c.beginPath();
      c.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      c.fill();
    });
  }
  noise(c, s, rng, 22);
};

painters[LAYER.BONE] = (c, s, rng) => {
  const g = c.createLinearGradient(0, 0, 0, s);
  // topo do canvas = base do espinho (v=0); embaixo = ponta (v=1)
  g.addColorStop(0, '#ece3cb');
  g.addColorStop(0.45, '#d9c9a4');
  g.addColorStop(0.75, '#9c4a32');
  g.addColorStop(1, '#5a0c0c');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 30; i++) {
    c.strokeStyle = `rgba(90,20,15,${rng.range(0.1, 0.35)})`;
    c.lineWidth = rng.range(1, s / 90);
    const x = rng.next() * s;
    c.beginPath();
    c.moveTo(x, rng.range(0, s * 0.5));
    c.lineTo(x + rng.range(-s / 40, s / 40), s);
    c.stroke();
  }
  noise(c, s, rng, 16);
};

painters[LAYER.TEETH] = (c, s, rng) => {
  // esmalte amarelado uniforme (os dentes são pequenos: qualquer trecho da textura serve)
  c.fillStyle = '#e8dfc4';
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 20; i++) {
    c.fillStyle = `rgba(150,110,60,${rng.range(0.03, 0.08)})`;
    c.beginPath();
    c.arc(rng.next() * s, rng.next() * s, rng.range(s / 20, s / 6), 0, Math.PI * 2);
    c.fill();
  }
  noise(c, s, rng, 10);
};

painters[LAYER.SKIN] = (c, s, rng) => {
  c.fillStyle = '#e8e0da';
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 60; i++) {
    const x = rng.next() * s, y = rng.next() * s, r = rng.range(s / 30, s / 8);
    c.fillStyle = rng.next() < 0.5 ? 'rgba(200,150,140,0.06)' : 'rgba(255,255,255,0.05)';
    wrapped(c, s, (ox, oy) => {
      c.beginPath();
      c.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      c.fill();
    });
  }
  noise(c, s, rng, 10);
};

painters[LAYER.HAIR] = (c, s, rng) => {
  c.fillStyle = '#9a9a9a';
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 500; i++) {
    const x = rng.next() * s, y = rng.next() * s, len = rng.range(s / 12, s / 4);
    const dx1 = rng.range(-3, 3), dx2 = rng.range(-4, 4);
    c.strokeStyle = rng.next() < 0.5 ? `rgba(0,0,0,${rng.range(0.1, 0.3)})` : `rgba(255,255,255,${rng.range(0.05, 0.18)})`;
    c.lineWidth = rng.range(0.6, 1.6);
    wrapped(c, s, (ox, oy) => {
      c.beginPath();
      c.moveTo(x + ox, y + oy);
      c.quadraticCurveTo(x + ox + dx1, y + oy + len / 2, x + ox + dx2, y + oy + len);
      c.stroke();
    });
  }
};

export function buildTextureLayers(size: number): ImageData[] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const out: ImageData[] = [];
  for (let i = 0; i < LAYER_COUNT; i++) {
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = 1;
    const p = painters[i];
    if (p) p(ctx, size, new Rng(1000 + i * 77));
    out.push(ctx.getImageData(0, 0, size, size));
  }
  return out;
}
