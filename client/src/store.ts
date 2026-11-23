/** Estado global da aplicação (fora do jogo 3D), com assinatura para o React. */
import { useSyncExternalStore } from 'react';
import type { MatchIntro, MatchResults, Profile, RoomInfo, RoomListEntry } from '../../shared/protocol';
import type { NetStatus } from './net';

export type Screen = 'title' | 'auth' | 'menu' | 'play' | 'lobby' | 'customize' | 'shop' | 'collection' | 'settings' | 'stats' | 'history' | 'match' | 'results';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'good' | 'error';
}

export interface AppState {
  screen: Screen;
  prevScreen: Screen;
  token: string | null;
  profile: Profile | null;
  room: RoomInfo | null;
  rooms: RoomListEntry[];
  intro: MatchIntro | null;
  matchStarted: boolean;
  results: MatchResults | null;
  net: NetStatus;
  toasts: Toast[];
}

let state: AppState = {
  screen: 'title',
  prevScreen: 'title',
  token: null,
  profile: null,
  room: null,
  rooms: [],
  intro: null,
  matchStarted: false,
  results: null,
  net: 'offline',
  toasts: [],
};

const listeners = new Set<() => void>();

export function getState() {
  return state;
}
export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

export function go(screen: Screen) {
  setState({ prevScreen: state.screen, screen });
}

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const t = { id: ++toastId, text, tone };
  setState({ toasts: [...state.toasts.slice(-4), t] });
  setTimeout(() => setState({ toasts: state.toasts.filter((x) => x.id !== t.id) }), 4200);
}
