/** Estado do HUD publicado pelo GameClient (atualizado ~12x por segundo). */
import { useSyncExternalStore } from 'react';
import type { AbilityId, ItemKind } from '../../../shared/constants';
import type { EcoType, PStatus, Role, TaskView, WeaponState } from '../../../shared/protocol';

export interface FeedLine {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'good' | 'bad';
  t: number;
}

export interface HudState {
  ready: boolean;
  role: Role;
  status: PStatus;
  hp: number;
  stamina: number;
  mapToggle: number;
  aimLock: boolean;
  staminaMax: number;
  exhausted: boolean;
  inv: (ItemKind | null)[];
  detCharges: number;
  channel: { label: string; p: number } | null;
  timeLeft: number;
  tasks: TaskView[];
  zone: string;
  prompt: string | null;
  threat: number;
  flash: boolean;
  hidden: boolean;
  bleed: number;
  cd: Record<AbilityId, number>;
  act: Record<AbilityId, number>;
  resonance: { level: number; points: number; next: number };
  attackCd: number;
  ecoAvailable: EcoType[];
  ecoSel: EcoType;
  camo: boolean;
  spectating: string | null;
  feed: FeedLine[];
  fps: number;
  ping: number;
  inventoryOpen: boolean;
  menuOpen: boolean;
  damage: number;
  glitch: number;
  thirdPerson: boolean;
  touch: boolean;
  alive: number;
  escaped: number;
  totalSurv: number;
  podsReady: boolean;
  talking: string[];
  drawCalls: number;
  stale: boolean;
  locked: boolean;
  wpn: WeaponState | null;
  entHp: [number, number];
  hit: boolean;
}

const zero = { rastro: 0, eco: 0, ruptura: 0, parasita: 0, golpe: 0 };

export function emptyHud(): HudState {
  return {
    ready: false,
    role: 'survivor',
    status: 'alive',
    hp: 100,
    stamina: 100,
    mapToggle: 0,
    aimLock: false,
    staminaMax: 100,
    exhausted: false,
    inv: [null, null, null, null],
    detCharges: 0,
    channel: null,
    timeLeft: 0,
    tasks: [],
    zone: '',
    prompt: null,
    threat: 0,
    flash: true,
    hidden: false,
    bleed: 0,
    cd: { ...zero },
    act: { ...zero },
    resonance: { level: 1, points: 0, next: 4 },
    attackCd: 0,
    ecoAvailable: ['passos'],
    ecoSel: 'passos',
    camo: false,
    spectating: null,
    feed: [],
    fps: 0,
    ping: 0,
    inventoryOpen: false,
    menuOpen: false,
    damage: 0,
    glitch: 0,
    thirdPerson: false,
    touch: false,
    alive: 0,
    escaped: 0,
    totalSurv: 0,
    podsReady: false,
    talking: [],
    drawCalls: 0,
    stale: false,
    locked: false,
    wpn: null,
    entHp: [1, 1],
    hit: false,
  };
}

export class HudStore {
  state: HudState = emptyHud();
  private ls = new Set<() => void>();
  set(p: Partial<HudState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.ls) l();
  }
  subscribe = (l: () => void) => {
    this.ls.add(l);
    return () => {
      this.ls.delete(l);
    };
  };
}

export function useHud<T>(store: HudStore, sel: (s: HudState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.state));
}
