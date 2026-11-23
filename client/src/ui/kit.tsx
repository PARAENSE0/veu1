/** Componentes de interface reutilizáveis. */
import type { ReactNode } from 'react';
import { audio } from '../game/audio';
import { go, type Screen } from '../store';

/** Tipos estruturais de eventos (compatíveis com os eventos sintéticos do React). */
export type Ev = { preventDefault(): void; stopPropagation(): void };
export type PtrEv = Ev & { clientX: number; clientY: number; pointerId: number; currentTarget: EventTarget | null };

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="fog" />
      <div className="fog b" />
      <div className="rays" />
      <div className="motes" />
      <div className="scan" />
    </div>
  );
}

export function Button(p: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'danger' | 'ghost'; small?: boolean; wide?: boolean; disabled?: boolean; title?: string; type?: 'button' | 'submit' }) {
  const cls = ['btn', p.kind ?? '', p.small ? 'small' : '', p.wide ? 'wide' : ''].join(' ');
  return (
    <button
      type={p.type ?? 'button'}
      className={cls}
      disabled={p.disabled}
      title={p.title}
      onClick={() => {
        audio.unlock();
        audio.ui('click');
        p.onClick?.();
      }}
    >
      {p.children}
    </button>
  );
}

export function TopBar(p: { title: string; back?: Screen; right?: ReactNode; onBack?: () => void }) {
  return (
    <div className="topbar">
      {(p.back || p.onBack) && (
        <Button kind="ghost" small onClick={() => (p.onBack ? p.onBack() : go(p.back!))}>
          ← Voltar
        </Button>
      )}
      <h2>{p.title}</h2>
      <div className="spacer" />
      {p.right}
    </div>
  );
}

export function Toggle(p: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <span
      className={`toggle ${p.value ? 'on' : ''}`}
      role="switch"
      aria-checked={p.value}
      tabIndex={0}
      onClick={() => {
        audio.ui('click');
        p.onChange(!p.value);
      }}
      onKeyDown={(e: { key: string }) => {
        if (e.key === 'Enter' || e.key === ' ') p.onChange(!p.value);
      }}
    >
      <span className="sw" />
      {p.label && <span>{p.label}</span>}
    </span>
  );
}

export function Slider(p: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e: { target: HTMLInputElement }) => p.onChange(Number(e.target.value))} />
      <span className="mono" style={{ minWidth: 46, textAlign: 'right', fontSize: 12 }}>
        {p.fmt ? p.fmt(p.value) : p.value}
      </span>
    </div>
  );
}

export function Select<T extends string>(p: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <select className="input" value={p.value} onChange={(e: { target: HTMLSelectElement }) => p.onChange(e.target.value as T)}>
      {p.options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function Tabs<T extends string>(p: { value: T; tabs: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {p.tabs.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={p.value === v}
          className={`tab ${p.value === v ? 'on' : ''}`}
          onClick={() => {
            audio.ui('click');
            p.onChange(v);
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function Modal(p: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-bg" onClick={() => p.onClose?.()}>
      <div className="panel modal" onClick={(e: Ev) => e.stopPropagation()}>
        <h3>{p.title}</h3>
        {p.children}
      </div>
    </div>
  );
}

export function Bar(p: { value: number; color?: string }) {
  return (
    <div className="bar">
      <i style={{ width: `${Math.max(0, Math.min(1, p.value)) * 100}%`, background: p.color }} />
    </div>
  );
}

export function rgbCss(c: [number, number, number]) {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}

/** Tela cheia + orientação horizontal (celulares). Precisa ser chamada por um toque/clique. */
export async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    /* navegador não permite (ex.: iPhone fora do app instalado) */
  }
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}
