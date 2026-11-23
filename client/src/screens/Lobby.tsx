/** Lobby da sala: jogadores, preferências de função, prontidão, chat, voz e início. */
import { useEffect, useRef, useState } from 'react';
import { ABILITIES, MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/constants';
import { MAP_LIST } from '../../../shared/map';
import { resolveAppearance } from '../../../shared/progression';
import type { RolePref } from '../../../shared/protocol';
import { Voice, type MicState } from '../game/voice';
import { net } from '../net';
import { voice } from '../session';
import { getSettings, updateSettings } from '../settings';
import { go, toast, useApp } from '../store';
import { Backdrop, Button, enterFullscreen, Modal, rgbCss, Tabs, Toggle, TopBar, type Ev } from '../ui/kit';
import { CharacterPreview } from '../ui/Preview';

const PREF_LABEL: Record<RolePref, string> = { any: 'Qualquer', survivor: 'Sobrevivente', entity: 'Entidade' };

export function useVoiceState() {
  const [, force] = useState(0);
  useEffect(() => {
    if (!voice) return;
    const off = voice.onChange(() => force((x) => x + 1));
    const i = setInterval(() => force((x) => x + 1), 250);
    return () => {
      off();
      clearInterval(i);
    };
  }, []);
  return voice;
}

export function MicButton() {
  const v = useVoiceState();
  if (!v) return null;
  const st: MicState = v.micState;
  const label = st === 'on' ? 'Microfone ligado' : st === 'pending' ? 'Pedindo permissão…' : st === 'denied' ? 'Microfone bloqueado' : st === 'unsupported' ? 'Voz indisponível' : st === 'error' ? 'Erro no microfone' : 'Ligar microfone';
  return (
    <Button
      small
      kind={st === 'on' ? 'primary' : undefined}
      disabled={st === 'pending' || st === 'unsupported'}
      title={st === 'denied' ? 'Permita o microfone nas configurações do site no navegador.' : undefined}
      onClick={async () => {
        if (st === 'on') {
          v.disableMic();
          updateSettings({ micEnabled: false });
        } else {
          const r = await v.enableMic();
          if (r === 'on') updateSettings({ micEnabled: true });
          else if (r === 'denied') toast('Permissão de microfone negada. Libere nas configurações do navegador.', 'warn');
          else if (r === 'error') toast('Não foi possível abrir o microfone.', 'error');
        }
      }}
    >
      🎙 {label}
    </Button>
  );
}

export function LobbyScreen() {
  const room = useApp((s) => s.room);
  const profile = useApp((s) => s.profile);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'sobrevivente' | 'entidade'>('sobrevivente');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const v = useVoiceState();
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [room?.chat.length]);
  if (!room || !profile) return null;
  const me = room.players.find((p) => p.id === profile.id);
  const isHost = room.hostId === profile.id;
  const connected = room.players.filter((p) => p.connected);
  const notReady = connected.filter((p) => !p.host && !p.ready);
  const canStart = isHost && room.state === 'lobby' && connected.length >= MIN_PLAYERS && notReady.length === 0;
  const talking = v ? v.talking() : [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast('Código copiado.', 'good');
    } catch {
      toast(`Código: ${room.code}`, 'info');
    }
  };
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <TopBar
          title={room.name}
          onBack={() => go('menu')}
          right={
            <div className="row">
              <MicButton />
              <Button kind="danger" small onClick={() => setConfirmLeave(true)}>
                Sair da sala
              </Button>
            </div>
          }
        />
        <div className="lobby">
          <div className="col" style={{ minHeight: 0 }}>
            <div className="panel">
              <div className="row">
                <div className="grow">
                  <div className="label">Código de convite</div>
                  <div className="code-box">{room.code}</div>
                </div>
                <Button small onClick={copy}>
                  Copiar
                </Button>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="tag accent">{MAP_LIST.find((m) => m.id === room.mapId)?.name}</span>
                <span className="tag">{room.public ? 'pública' : 'privada'}</span>
                <span className="tag">
                  {room.players.length}/{MAX_PLAYERS} jogadores
                </span>
                {isHost && (
                  <Toggle value={room.public} onChange={(pub) => net.send({ t: 'room:settings', public: pub })} label="Pública" />
                )}
              </div>
            </div>
            <div className="panel" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <h3>Jogadores</h3>
              {room.players.map((p) => {
                const ap = resolveAppearance(p.loadout);
                return (
                  <div key={p.id} className="player-row">
                    <div className="avatar" style={{ background: `linear-gradient(180deg, ${rgbCss(ap.skin)} 0 45%, ${rgbCss(ap.torso)} 45%)`, borderColor: talking.includes(p.id) ? 'var(--good)' : undefined }} />
                    <div className="grow">
                      <div className="pname">
                        {p.name} {p.host && <span className="tag warn">anfitrião</span>} {p.guest && <span className="tag">convidado</span>} {!p.connected && <span className="tag danger">desconectado</span>}
                      </div>
                      <div className="mono muted" style={{ fontSize: 11 }}>
                        NÍVEL {p.level} · PREFERÊNCIA: {PREF_LABEL[p.pref].toUpperCase()}
                      </div>
                    </div>
                    {p.id !== profile.id && v && (
                      <Button small kind="ghost" title={v.isMuted(p.id) ? 'Ativar voz deste jogador' : 'Silenciar este jogador'} onClick={() => v.setMuted(p.id, !v.isMuted(p.id))}>
                        {v.isMuted(p.id) ? '🔇' : '🔊'}
                      </Button>
                    )}
                    {p.host ? <span className="tag accent">pronto</span> : p.ready ? <span className="tag good">pronto</span> : <span className="tag">aguardando</span>}
                    {isHost && p.id !== profile.id && room.state === 'lobby' && (
                      <Button small kind="ghost" title="Remover da sala" onClick={() => net.send({ t: 'room:kick', id: p.id })}>
                        ✕
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="panel">
              {room.state === 'countdown' ? (
                <div className="countdown">{room.countdown}</div>
              ) : (
                <div className="row">
                  <div className="grow">
                    <div className="label">Quero jogar como</div>
                    <div className="row" style={{ marginTop: 6 }}>
                      {(['any', 'survivor', 'entity'] as RolePref[]).map((pr) => (
                        <Button key={pr} small kind={me?.pref === pr ? 'primary' : undefined} onClick={() => net.send({ t: 'room:pref', pref: pr })}>
                          {PREF_LABEL[pr]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {isHost ? (
                    <Button kind="primary" disabled={!canStart} title={!canStart ? (connected.length < MIN_PLAYERS ? `Mínimo de ${MIN_PLAYERS} jogadores` : `Aguardando: ${notReady.map((p) => p.name).join(', ')}`) : undefined} onClick={() => {
                        if (matchMedia('(pointer: coarse)').matches) void enterFullscreen();
                        net.send({ t: 'room:start' });
                      }}>
                      Iniciar partida
                    </Button>
                  ) : (
                    <Button kind={me?.ready ? undefined : 'primary'} onClick={() => {
                        if (!me?.ready && matchMedia('(pointer: coarse)').matches) void enterFullscreen();
                        net.send({ t: 'room:ready', ready: !me?.ready });
                      }}>
                      {me?.ready ? 'Cancelar pronto' : 'Estou pronto'}
                    </Button>
                  )}
                </div>
              )}
              {isHost && !canStart && room.state === 'lobby' && (
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {connected.length < MIN_PLAYERS ? `Convide pelo código: são necessários pelo menos ${MIN_PLAYERS} jogadores (1 entidade + sobreviventes).` : `Aguardando ficarem prontos: ${notReady.map((p) => p.name).join(', ')}.`}
                </div>
              )}
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                A entidade é sorteada pelo servidor entre quem a prefere (ou “Qualquer”), priorizando quem foi entidade menos vezes nesta sala.
              </div>
            </div>
          </div>
          <div className="col" style={{ minHeight: 0 }}>
            <div className="panel">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  ['sobrevivente', 'Seu sobrevivente'],
                  ['entidade', 'Entidade'],
                ]}
              />
              {tab === 'sobrevivente' ? (
                <>
                  <CharacterPreview loadout={profile.loadout} kind="survivor" height={230} />
                  <Button small wide onClick={() => go('customize')}>
                    Personalizar aparência
                  </Button>
                </>
              ) : (
                <>
                  <CharacterPreview loadout={profile.loadout} kind="entity" height={200} />
                  <div style={{ fontWeight: 700, marginTop: 6 }}>O REVERBERANTE</div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    Única entidade disponível nesta versão. Registra sons e presenças e os devolve como ecos falsos.
                  </div>
                  {Object.values(ABILITIES).map((a) => (
                    <div key={a.id} style={{ fontSize: 12, marginBottom: 4 }}>
                      <b style={{ color: 'var(--entity)' }}>{a.name}</b> <span className="muted">({a.cooldown}s)</span> — {a.desc}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="panel chat">
              <h3>Chat da sala</h3>
              <div className="chat-log" ref={logRef}>
                {room.chat.map((c, i) => (
                  <div key={i} className={c.system ? 'sys' : ''}>
                    {c.system ? c.text : (
                      <>
                        <b>{c.from}:</b> {c.text}
                      </>
                    )}
                  </div>
                ))}
              </div>
              <form
                className="row"
                style={{ marginTop: 8, flexWrap: 'nowrap' }}
                onSubmit={(e: Ev) => {
                  e.preventDefault();
                  const t = msg.trim();
                  if (!t) return;
                  net.send({ t: 'room:chat', text: t });
                  setMsg('');
                }}
              >
                <input className="input grow" maxLength={200} placeholder="Mensagem…" value={msg} onChange={(e: { target: HTMLInputElement }) => setMsg(e.target.value)} />
                <Button type="submit">Enviar</Button>
              </form>
              {!Voice.supported() && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Seu navegador não suporta voz (WebRTC).</div>}
              {getSettings().pushToTalk && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Apertar para falar ativo (tecla configurável nas Configurações).</div>}
            </div>
          </div>
        </div>
      </div>
      {confirmLeave && (
        <Modal title="Sair da sala" onClose={() => setConfirmLeave(false)}>
          <p>Deseja sair desta sala?</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirmLeave(false)}>Cancelar</Button>
            <Button
              kind="danger"
              onClick={() => {
                net.send({ t: 'room:leave' });
                setConfirmLeave(false);
              }}
            >
              Sair
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
