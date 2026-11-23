/**
 * Configurações do jogador (gráficos, controles, áudio, voz), salvas no navegador.
 */
import type { Quality } from './game/renderer';

export type QualityPreset = 'baixa' | 'media' | 'alta';

export type Action =
  | 'frente'
  | 'tras'
  | 'esquerda'
  | 'direita'
  | 'correr'
  | 'agachar'
  | 'interagir'
  | 'lanterna'
  | 'inventario'
  | 'item1'
  | 'item2'
  | 'item3'
  | 'item4'
  | 'rastro'
  | 'eco'
  | 'ruptura'
  | 'parasita'
  | 'ecoProximo'
  | 'falar'
  | 'camera'
  | 'atirar'
  | 'trocarArma'
  | 'recarregar';

export const ACTION_LABELS: Record<Action, string> = {
  frente: 'Mover para frente',
  tras: 'Mover para trás',
  esquerda: 'Mover para a esquerda',
  direita: 'Mover para a direita',
  correr: 'Correr',
  agachar: 'Agachar / espreitar',
  interagir: 'Interagir (segurar)',
  lanterna: 'Lanterna',
  inventario: 'Inventário',
  item1: 'Usar item 1',
  item2: 'Usar item 2',
  item3: 'Usar item 3',
  item4: 'Usar item 4',
  rastro: 'Entidade: Rastro',
  eco: 'Entidade: Eco Falso',
  ruptura: 'Entidade: Ruptura',
  parasita: 'Entidade: Parasita',
  ecoProximo: 'Entidade: trocar som do Eco',
  falar: 'Falar (apertar para falar)',
  camera: 'Alternar 1ª/3ª pessoa',
  atirar: 'Atirar',
  trocarArma: 'Trocar de arma',
  recarregar: 'Recarregar',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  frente: 'KeyW',
  tras: 'KeyS',
  esquerda: 'KeyA',
  direita: 'KeyD',
  correr: 'ShiftLeft',
  agachar: 'ControlLeft',
  interagir: 'KeyE',
  lanterna: 'KeyF',
  inventario: 'Tab',
  item1: 'Digit1',
  item2: 'Digit2',
  item3: 'Digit3',
  item4: 'Digit4',
  rastro: 'KeyQ',
  eco: 'KeyR',
  ruptura: 'Space',
  parasita: 'KeyF',
  ecoProximo: 'KeyZ',
  falar: 'KeyV',
  camera: 'KeyC',
  atirar: 'Mouse0',
  trocarArma: 'KeyQ',
  recarregar: 'KeyR',
};

export interface Settings {
  quality: QualityPreset;
  resolutionScale: number;
  shadows: boolean;
  textures: 'baixa' | 'media' | 'alta';
  particles: boolean;
  grain: boolean;
  headBob: boolean;
  fov: number;
  camera: 'primeira' | 'terceira';
  mouseSens: number;
  touchSens: number;
  invertY: boolean;
  touchControls: 'auto' | 'sempre' | 'nunca';
  bindings: Record<Action, string>;
  master: number;
  music: number;
  sfx: number;
  voice: number;
  audioQuality: 'alta' | 'baixa';
  voiceEnabled: boolean;
  micEnabled: boolean;
  pushToTalk: boolean;
  showFps: boolean;
}

export const PRESETS: Record<QualityPreset, Partial<Settings>> = {
  baixa: { resolutionScale: 0.6, shadows: false, textures: 'baixa', particles: false, grain: false },
  media: { resolutionScale: 0.85, shadows: true, textures: 'media', particles: true, grain: true },
  alta: { resolutionScale: 1, shadows: true, textures: 'alta', particles: true, grain: true },
};

function detectPreset(): QualityPreset {
  if (typeof navigator === 'undefined') return 'media';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile || cores <= 2) return 'baixa';
  if (cores >= 8) return 'alta';
  return 'media';
}

export function defaultSettings(): Settings {
  const q = detectPreset();
  return {
    quality: q,
    resolutionScale: 0.85,
    shadows: true,
    textures: 'media',
    particles: true,
    grain: true,
    headBob: true,
    fov: 75,
    camera: 'primeira',
    mouseSens: 1,
    touchSens: 1,
    invertY: false,
    touchControls: 'auto',
    bindings: { ...DEFAULT_BINDINGS },
    master: 0.8,
    music: 0.6,
    sfx: 0.9,
    voice: 1,
    audioQuality: 'alta',
    voiceEnabled: true,
    micEnabled: false,
    pushToTalk: false,
    showFps: false,
    ...PRESETS[q],
  };
}

const KEY = 'veu.settings.v1';
let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return { ...d, ...s, bindings: { ...d.bindings, ...(s.bindings ?? {}) } };
  } catch {
    return d;
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* armazenamento indisponível (modo privado): mantém só na memória */
  }
  for (const l of listeners) l();
}

export function resetSettings() {
  current = defaultSettings();
  updateSettings({});
}

export function subscribeSettings(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function qualityOf(s: Settings): Quality {
  const tex = s.textures === 'baixa' ? 128 : s.textures === 'media' ? 256 : 512;
  const lights = s.quality === 'baixa' ? 8 : s.quality === 'media' ? 12 : 16;
  const spots = s.quality === 'baixa' ? 3 : s.quality === 'media' ? 4 : 6;
  return { scale: s.resolutionScale, lights, spots, particles: s.particles ? (s.quality === 'alta' ? 700 : 300) : 0, texSize: tex, grain: s.grain ? 0.035 : 0 };
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift dir.',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl dir.',
    Space: 'Espaço',
    Tab: 'Tab',
    AltLeft: 'Alt',
    Mouse0: 'Botão esq.',
    Mouse1: 'Botão meio',
    Mouse2: 'Botão dir.',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    CapsLock: 'Caps',
  };
  return map[code] ?? code;
}
