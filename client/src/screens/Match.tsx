/** Tela da partida: canvas 3D, HUD, controles de toque, inventário, menu e carregamento. */
import { useEffect, useRef, useState } from 'react';
import { ABILITIES, FLAMER, GUNS, ITEM_INFO, WEAPON_NAMES, WEAPON_ORDER, type AbilityId } from '../../../shared/constants';
import { GameClient, ECO_NAMES } from '../game/game';
import { useHud, type HudStore } from '../game/hudstore';
import { net } from '../net';
import { voice } from '../session';
import { getSettings, keyLabel } from '../settings';
import { go, setState, useApp } from '../store';
import { Bar, Button, enterFullscreen, fmtTime, Modal, rgbCss, type PtrEv } from '../ui/kit';
import { SettingsPanel } from './Settings';

const LORE = [
  'Complexo Abissal, 2.400 m de profundidade. A última transmissão falava de "algo que repete nossas vozes".',
  'Relatório 7-C: a criatura não enxerga como nós. Ela escuta — e lembra.',
  'Dica: agachado você não deixa rastro e quase não faz barulho.',
  'Dica: o Detector de ressonância denuncia ecos falsos por perto.',
  'Dica: correr gera ruído que a entidade percebe através das paredes.',
  'Dica: um sinalizador anula a camuflagem da entidade nas proximidades.',
  'Dica (entidade): o Eco Falso só imita sons que você ouviu nos últimos 90 segundos.',
  'Dica: segurar a interação junto com companheiros acelera consoles e cápsulas.',
];

export function MatchScreen() {
  const intro = useApp((s) => s.intro);
  const started = useApp((s) => s.matchStarted);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [client, setClient] = useState<GameClient | null>(null);
  const [error, setError] = useState('');
  const [lore] = useState(() => LORE[Math.floor(Math.random() * LORE.length)]);
  useEffect(() => {
    if (!intro || !canvasRef.current || !overlayRef.current) return;
    let c: GameClient;
    try {
      c = new GameClient(canvasRef.current, overlayRef.current, intro, net);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    c.voice = voice;
    c.start();
    // gancho de inspeção para testes automatizados (?debug na URL)
    if (location.search.includes('debug')) (window as unknown as { __veu: GameClient }).__veu = c;
    net.send({ t: 'match:loaded' });
    setClient(c);
    return () => {
      c.dispose();
      setClient(null);
    };
  }, [intro?.matchId]);

  if (!intro) return null;
  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="gl" tabIndex={0} />
      <canvas ref={overlayRef} className="overlay" />
      {client && <Hud client={client} store={client.hud} />}
      {error && (
        <Modal title="Não foi possível iniciar o 3D">
          <p>{error}</p>
          <p className="muted">Ative a aceleração de hardware no navegador ou use um navegador com suporte a WebGL2.</p>
          <Button
            kind="danger"
            onClick={() => {
              net.send({ t: 'room:leave' });
              setState({ intro: null });
              go('menu');
            }}
          >
            Sair da partida
          </Button>
        </Modal>
      )}
      {(!started || !client) && !error && <LoadingScreen lore={lore} role={intro.role} started={started} />}
      {started && client && <ReadyGate store={client.hud} lore={lore} role={intro.role} />}
    </div>
  );
}

/** Mantém a tela de carregamento até chegar o primeiro snapshot do servidor. */
function ReadyGate(p: { store: HudStore; lore: string; role: 'survivor' | 'entity' }) {
  const ready = useHud(p.store, (s) => s.ready);
  return ready ? null : <LoadingScreen lore={p.lore} role={p.role} started />;
}

function LoadingScreen(p: { lore: string; role: 'survivor' | 'entity'; started: boolean }) {
  return (
    <div className="loading-screen">
      <div className="logo">
        <div className="title" style={{ fontSize: 56 }}>
          VÉU
        </div>
      </div>
      <div style={{ fontSize: 20, letterSpacing: '0.2em', textTransform: 'uppercase', color: p.role === 'entity' ? 'var(--entity)' : 'var(--accent)' }}>
        {p.role === 'entity' ? 'Você é a ENTIDADE' : 'Você é um SOBREVIVENTE'}
      </div>
      <div className="muted" style={{ maxWidth: 520 }}>
        {p.role === 'entity' ? 'Cace os sobreviventes antes que preparem a cápsula de evacuação. Use seus ecos para confundi-los.' : 'Cumpra os objetivos com a equipe, prepare a evacuação e fuja. Pelo menos metade precisa escapar.'}
      </div>
      <div className="spinner" />
      <div className="mono muted" style={{ fontSize: 12, letterSpacing: '0.2em' }}>
        {p.started ? 'SINCRONIZANDO…' : 'CARREGANDO COMPLEXO E AGUARDANDO JOGADORES…'}
      </div>
      <div className="lore">{p.lore}</div>
    </div>
  );
}

function Hud(p: { client: GameClient; store: HudStore }) {
  const h = useHud(p.store, (s) => s);
  const c = p.client;
  const settings = getSettings();
  const b = settings.bindings;
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  if (!h.ready) return null;
  const surv = h.role === 'survivor';
  const stageTasks = h.tasks.filter((t) => t.stage === Math.max(...h.tasks.map((x) => x.stage)));
  const stage = stageTasks[0]?.stage ?? 1;
  const timeLow = h.timeLeft < 120;
  const quit = () => {
    net.send({ t: 'room:leave' });
    setState({ intro: null, matchStarted: false });
    go('menu');
  };
  return (
    <div className={`hud ${h.touch ? 'touch' : ''}`}>
      <div className="vignette" />
      {surv && <div className="threat" style={{ opacity: Math.min(0.9, h.threat * h.threat * 1.2) }} />}
      {h.damage > 0 && <div className="damage" style={{ opacity: h.damage }} />}
      {h.glitch > 0 && <div className="glitch" style={{ opacity: h.glitch }} />}
      {!h.spectating && <div className={`crosshair ${h.wpn && h.role === 'survivor' ? 'gun' : ''}`} />}
      {h.hit && <div className="hitmarker">✕</div>}

      {/* topo: tempo e local */}
      <div className="hud-tc">
        <div className={`timer ${timeLow ? 'low' : ''}`}>{fmtTime(h.timeLeft)}</div>
        <div className="zone-name">{h.zone}</div>
        {h.stale && <div className="tag danger" style={{ marginTop: 6 }}>conexão instável — reconectando…</div>}
        <div className="ent-hp" title="Integridade da entidade">
          <span>{h.role === 'entity' ? 'SUA INTEGRIDADE' : 'ENTIDADE'}</span>
          <Bar value={h.entHp[0] / h.entHp[1]} color="var(--entity)" />
          <span className="mono">{h.entHp[0]}</span>
        </div>
      </div>

      {/* objetivos */}
      <div className="hud-tl hud-box">
        <div className="stage-label">
          FASE {stage}/3 · {h.role === 'entity' ? 'OBJETIVOS DOS SOBREVIVENTES' : 'OBJETIVOS'}
        </div>
        {h.tasks.map((t) => (
          <div key={t.id} className={`task ${t.done ? 'done' : ''}`}>
            <div className="t">
              <span>{t.title}</span>
              <span className="mono">
                {t.count}/{t.required}
              </span>
            </div>
            {!t.done && t.active && <div className="d">{t.desc}</div>}
            {!t.done && <Bar value={t.progress} color={t.active ? undefined : 'var(--muted)'} />}
          </div>
        ))}
        <div className="mono muted" style={{ fontSize: 10, marginTop: 6 }}>
          ESCAPARAM {h.escaped}/{h.totalSurv} · NECESSÁRIO {Math.ceil(h.totalSurv / 2)}
        </div>
      </div>

      {/* feed */}
      <div className="hud-tr">
        {settings.showFps && (
          <div className="mono" style={{ fontSize: 11, background: 'rgba(0,0,0,0.5)', padding: '3px 6px' }}>
            {h.fps} FPS · {h.ping} ms · {h.drawCalls} draws
          </div>
        )}
        {h.feed.map((f) => (
          <div key={f.id} className={`feed-line ${f.tone}`}>
            {f.text}
          </div>
        ))}
      </div>

      {/* estado central */}
      {h.status === 'downed' && (
        <div className="center-msg">
          <h1 style={{ color: 'var(--danger)' }}>CAÍDO</h1>
          <div>Rasteje até um companheiro. Sangramento: {Math.ceil(h.bleed)} s</div>
        </div>
      )}
      {h.hidden && (
        <div className="center-msg">
          <div className="mono" style={{ letterSpacing: '0.3em' }}>
            ESCONDIDO
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Pressione {keyLabel(b.interagir)} para sair. Ficar tempo demais acelera o coração…
          </div>
        </div>
      )}
      {h.spectating && (
        <div className="center-msg" style={{ top: 'auto', bottom: 60, transform: 'translateX(-50%)' }}>
          <div className="mono" style={{ letterSpacing: '0.25em', color: h.status === 'escaped' ? 'var(--good)' : 'var(--danger)' }}>
            {h.status === 'escaped' ? 'VOCÊ ESCAPOU' : 'VOCÊ FOI ELIMINADO'}
          </div>
          <div>
            Assistindo: <b>{h.spectating}</b>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {h.touch ? 'Toque em ▶ para trocar' : 'Clique para trocar de jogador'}
          </div>
          {h.touch && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 8, pointerEvents: 'auto' }}>
              <Button small onClick={() => net.send({ t: 'spectate', dir: -1 })}>
                ◀
              </Button>
              <Button small onClick={() => net.send({ t: 'spectate', dir: 1 })}>
                ▶
              </Button>
            </div>
          )}
        </div>
      )}

      {/* prompt e canalização */}
      <div className="hud-bc">
        {h.prompt && !h.spectating && (
          <div className="prompt">
            <span className="key">{h.touch ? 'USAR' : keyLabel(b.interagir)}</span>
            {h.prompt}
          </div>
        )}
        {h.channel && (
          <div className="channel hud-box">
            <div style={{ fontSize: 12, marginBottom: 6 }}>{h.channel.label}</div>
            <Bar value={h.channel.p} />
          </div>
        )}
      </div>

      {/* vitais */}
      {!h.spectating && surv && (
        <div className="hud-bl hud-box">
          <div className="vital hp">
            <span style={{ width: 54 }}>VIDA</span>
            <Bar value={h.hp / 100} />
            <span>{h.hp}</span>
          </div>
          <div className={`vital st ${h.exhausted ? 'exh' : ''}`}>
            <span style={{ width: 54 }}>{h.exhausted ? 'EXAUSTO' : 'FÔLEGO'}</span>
            <Bar value={h.stamina / 100} />
          </div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <span className={`tag ${h.flash ? 'accent' : ''}`}>lanterna {h.flash ? 'ligada' : 'desligada'}</span>
            {h.hp <= 50 && h.status === 'alive' && <span className="tag danger">ferido</span>}
          </div>
        </div>
      )}
      {!h.spectating && !surv && (
        <div className="hud-bl hud-box">
          <div className="stage-label" style={{ color: 'var(--entity)' }}>
            RESSONÂNCIA — NÍVEL {h.resonance.level}
          </div>
          <Bar value={h.resonance.next > 0 ? h.resonance.points / h.resonance.next : 1} color="var(--entity)" />
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {h.resonance.next > 0 ? `${h.resonance.points}/${h.resonance.next} para evoluir (recargas menores)` : 'Evolução máxima'}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {h.camo && <span className="tag accent">camuflado</span>}
            <span className="tag">ataque {h.attackCd > 0 ? h.attackCd.toFixed(1) + 's' : 'pronto'}</span>
          </div>
        </div>
      )}

      {/* inventário rápido / habilidades */}
      {!h.spectating && surv && (
        <div className="hud-br">
          {h.wpn && <WeaponPanel h={h} />}
          <div className="slots">
            {h.inv.map((k, i) => (
              <div key={i} className="slot" style={{ pointerEvents: h.touch ? 'auto' : 'none' }} onClick={() => k && c.useSlot(i)}>
                <span className="k">{i + 1}</span>
                {k ? (
                  <div>
                    <div className="ico" style={{ background: rgbCss(ITEM_INFO[k].color), margin: '0 auto 3px' }} />
                    {ITEM_INFO[k].name}
                    {k === 'detector' ? ` (${h.detCharges})` : ''}
                  </div>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            ))}
          </div>
          <div className="mono muted touch-hint" style={{ fontSize: 10, textAlign: 'right', marginTop: 4 }}>
            {keyLabel(b.inventario)} INVENTÁRIO · {keyLabel(b.lanterna)} LANTERNA · {keyLabel(b.trocarArma)}/RODA ARMA · {keyLabel(b.recarregar)} RECARREGAR
          </div>
        </div>
      )}
      {!h.spectating && !surv && (
        <div className="hud-br">
          <div className="row eco-tags" style={{ justifyContent: 'flex-end', marginBottom: 6, gap: 6 }}>
            <span className="mono muted touch-hint" style={{ fontSize: 11 }}>
              ECO: {keyLabel(b.ecoProximo)}/roda troca
            </span>
            {(['passos', 'porta', 'radio', 'alarme', 'presenca'] as const).map((e) => (
              <span
                key={e}
                className={`tag eco-tag ${h.ecoSel === e ? 'warn' : h.ecoAvailable.includes(e) ? '' : 'danger'}`}
                style={{ opacity: h.ecoAvailable.includes(e) ? 1 : 0.35 }}
                title="Toque para escolher o som do Eco Falso"
                onClick={() => c.setEco(e)}
              >
                {ECO_NAMES[e]}
              </span>
            ))}
          </div>
          <div className="abilities">
            {(Object.keys(ABILITIES) as AbilityId[]).map((id) => {
              const a = ABILITIES[id];
              const cd = h.cd[id];
              const act = h.act[id] > 0;
              const key = keyLabel(b[id === 'eco' ? 'eco' : id]);
              return (
                <div
                  key={id}
                  className={`ability ${act ? 'active' : ''}`}
                  title={`${a.desc} ${a.limit}`}
                  onClick={() => h.touch && net.send({ t: 'act', a: 'ability', id, variant: id === 'eco' ? h.ecoSel : undefined })}
                >
                  <span className="k">{h.touch ? '' : key}</span>
                  {cd > 0 && <div className="cd" style={{ height: `${Math.min(1, cd / a.cooldown) * 100}%` }} />}
                  <span className="n">{a.name}</span>
                  <span className="s">{act ? h.act[id].toFixed(0) : cd > 0 ? Math.ceil(cd) : '●'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {h.touch && <TouchControls client={c} role={h.role} spectating={!!h.spectating} />}

      {!h.touch && !h.locked && !h.menuOpen && !h.inventoryOpen && (
        <div className="overlay-menu" onClick={() => c.resume()}>
          <div className="panel" style={{ textAlign: 'center' }}>
            <h3>Pronto</h3>
            <p>Clique para assumir o controle.</p>
            <p className="muted mono" style={{ fontSize: 12 }}>
              WASD mover · Mouse olhar · {keyLabel(b.interagir)} interagir · Esc menu
            </p>
          </div>
        </div>
      )}

      {h.inventoryOpen && (
        <div className="overlay-menu">
          <div className="panel inventory-panel">
            <h3>Inventário</h3>
            <div className="inv-grid">
              {h.inv.map((k, i) => (
                <div key={i} className="inv-cell">
                  <div className="row">
                    <span className="key">{i + 1}</span>
                    <b className="grow">{k ? ITEM_INFO[k].name : 'Vazio'}</b>
                    {k && <span className="ico" style={{ width: 14, height: 14, borderRadius: 3, background: rgbCss(ITEM_INFO[k].color) }} />}
                  </div>
                  {k && <div className="muted" style={{ fontSize: 12 }}>{ITEM_INFO[k].desc}{k === 'detector' ? ` Cargas: ${h.detCharges}.` : ''}</div>}
                  {k && (
                    <div className="row">
                      {ITEM_INFO[k].usable && (
                        <Button small onClick={() => c.useSlot(i)}>
                          Usar
                        </Button>
                      )}
                      <Button small kind="ghost" onClick={() => c.dropSlot(i)}>
                        Soltar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button onClick={() => c.resume()}>Fechar ({keyLabel(b.inventario)})</Button>
            </div>
          </div>
        </div>
      )}

      {h.menuOpen && (
        <div className="overlay-menu">
          <div className="panel" style={{ width: showSettings ? 'min(860px, 94vw)' : 'min(380px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}>
            {showSettings ? (
              <>
                <div className="row">
                  <h3 className="grow" style={{ margin: 0 }}>
                    Configurações
                  </h3>
                  <Button small onClick={() => setShowSettings(false)}>
                    Voltar
                  </Button>
                </div>
                <SettingsPanel compact />
              </>
            ) : (
              <>
                <h3>Menu</h3>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  A partida continua enquanto este menu está aberto.
                </p>
                <div className="col">
                  <Button kind="primary" onClick={() => c.resume()}>
                    Voltar ao jogo
                  </Button>
                  <Button onClick={() => c.toggleCamera()}>Câmera: {h.thirdPerson ? '3ª pessoa' : '1ª pessoa'}</Button>
                  <Button onClick={() => setShowSettings(true)}>Configurações</Button>
                  <Button kind="danger" onClick={() => setConfirmQuit(true)}>
                    Abandonar partida
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {confirmQuit && (
        <div style={{ pointerEvents: 'auto' }}>
          <Modal title="Abandonar partida?" onClose={() => setConfirmQuit(false)}>
            <p>{h.role === 'entity' ? 'Se a entidade abandonar, os sobreviventes vencem imediatamente.' : 'Abandonar conta como morte e você sai da sala.'}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setConfirmQuit(false)}>Cancelar</Button>
              <Button kind="danger" onClick={quit}>
                Abandonar
              </Button>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}

function WeaponPanel(p: { h: { wpn: import('../../../shared/protocol').WeaponState | null; touch: boolean } }) {
  const w = p.h.wpn!;
  const sel = w.sel;
  const gun = sel === 'lanca' ? null : GUNS[sel];
  const mag = gun ? w.mag[sel as 'pistola' | 'fuzil'] : 0;
  const res = gun ? w.res[sel as 'pistola' | 'fuzil'] : 0;
  const low = gun ? mag === 0 && res === 0 : w.fuel <= 0;
  return (
    <div className="hud-box weapon-panel">
      <div className="row" style={{ gap: 6, marginBottom: 4, flexWrap: 'nowrap' }}>
        {WEAPON_ORDER.map((id) => (
          <span key={id} className={`tag ${id === sel ? 'warn' : ''}`}>
            {id === 'pistola' ? 'P-50' : id === 'fuzil' ? 'FR-9' : 'LC-3'}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{WEAPON_NAMES[sel]}</div>
      {gun ? (
        <div className="ammo">
          <b className={mag === 0 ? 'empty' : ''}>{mag}</b>
          <span>/ {res}</span>
          <small>
            pente {gun.mag} · máx. {gun.maxReserve}
          </small>
        </div>
      ) : (
        <div style={{ marginTop: 4 }}>
          <div className="label">Combustível {Math.round(w.fuel)}/{FLAMER.maxFuel}</div>
          <Bar value={w.fuel / FLAMER.maxFuel} color="#ff7a3a" />
        </div>
      )}
      {w.reload > 0 && <div className="tag warn" style={{ marginTop: 4 }}>recarregando… {w.reload.toFixed(1)} s</div>}
      {low && <div className="tag danger" style={{ marginTop: 4 }}>{gun ? 'sem munição — procure caixas' : 'sem combustível'}</div>}
    </div>
  );
}

function TouchControls(p: { client: GameClient; role: 'survivor' | 'entity'; spectating: boolean }) {
  const inp = p.client.input;
  const knob = useRef<HTMLDivElement | null>(null);
  const joyId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const [, force] = useState(0);
  const joy = (e: PtrEv, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    inp.setJoystick(x, y);
    if (knob.current) knob.current.style.transform = `translate(${x * 42}px, ${y * 42}px)`;
  };
  const btn = (action: Parameters<typeof inp.touchPress>[0], label: string, opts: { toggle?: boolean; red?: boolean } = {}) => (
    <button
      className={`tbtn ${inp.touchActive(action) ? 'on' : ''} ${opts.red ? 'red' : ''}`}
      onPointerDown={(e: PtrEv) => {
        e.preventDefault();
        if (opts.toggle) inp.touchToggle(action);
        else inp.touchPress(action);
        force((x) => x + 1);
      }}
      onPointerUp={() => {
        if (!opts.toggle) inp.touchRelease(action);
        force((x) => x + 1);
      }}
      onPointerCancel={() => !opts.toggle && inp.touchRelease(action)}
    >
      {label}
    </button>
  );
  if (p.spectating) return null;
  return (
    <div className="touch-layer">
      <div
        className="look-zone"
        onPointerDown={(e: PtrEv) => {
          lookId.current = e.pointerId;
          last.current = { x: e.clientX, y: e.clientY };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e: PtrEv) => {
          if (lookId.current !== e.pointerId) return;
          inp.addLook(e.clientX - last.current.x, e.clientY - last.current.y);
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (lookId.current = null)}
        onPointerCancel={() => (lookId.current = null)}
      />
      <div
        className="joy"
        onPointerDown={(e: PtrEv) => {
          joyId.current = e.pointerId;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          joy(e, e.currentTarget as HTMLElement);
        }}
        onPointerMove={(e: PtrEv) => joyId.current === e.pointerId && joy(e, e.currentTarget as HTMLElement)}
        onPointerUp={() => {
          joyId.current = null;
          inp.setJoystick(0, 0);
          if (knob.current) knob.current.style.transform = '';
        }}
        onPointerCancel={() => {
          joyId.current = null;
          inp.setJoystick(0, 0);
        }}
      >
        <div className="knob" ref={knob} />
      </div>
      <div className="touch-top">
        <button className="tbtn" onPointerDown={() => p.client.openMenu()}>
          Menu
        </button>
        {!document.fullscreenElement && document.fullscreenEnabled && (
          <button className="tbtn" onClick={() => void enterFullscreen()}>
            Tela cheia
          </button>
        )}
        {p.role === 'survivor' && btn('inventario', 'Itens')}
        {p.role === 'survivor' && btn('lanterna', 'Luz')}
      </div>
      <div className="tbtns">
        {p.role === 'survivor' && (
          <>
            <button className="tbtn" onPointerDown={() => p.client.cycleWeapon(1)}>
              Arma
            </button>
            <button className="tbtn" onPointerDown={() => p.client.reload()}>
              Recarr.
            </button>
            <span />
          </>
        )}
        {btn('agachar', p.role === 'entity' ? 'Espreitar' : 'Agachar', { toggle: true })}
        {p.role === 'survivor' ? btn('correr', 'Correr', { toggle: true }) : <span />}
        {btn('interagir', 'Usar')}
        {p.role === 'survivor' && (
          <button
            className={`tbtn red ${inp.touchActive('atirar') ? 'on' : ''}`}
            style={{ gridColumn: '1 / span 3', width: '100%', borderRadius: 30 }}
            onPointerDown={(e: PtrEv) => {
              e.preventDefault();
              inp.touchPress('atirar');
              force((x) => x + 1);
            }}
            onPointerUp={() => {
              inp.touchRelease('atirar');
              force((x) => x + 1);
            }}
            onPointerCancel={() => inp.touchRelease('atirar')}
          >
            Atirar
          </button>
        )}
        {p.role === 'entity' && (
          <button
            className="tbtn red"
            style={{ gridColumn: '1 / span 3', width: '100%', borderRadius: 30 }}
            onPointerDown={() => {
              p.client.touchAttack = true;
            }}
          >
            Atacar
          </button>
        )}
      </div>
    </div>
  );
}
