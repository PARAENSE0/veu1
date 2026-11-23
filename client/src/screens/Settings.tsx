/** Configurações: gráficos, controles (teclas configuráveis), áudio e voz. */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { audio } from '../game/audio';
import { ACTION_LABELS, DEFAULT_BINDINGS, PRESETS, getSettings, keyLabel, resetSettings, subscribeSettings, updateSettings, type Action, type QualityPreset, type Settings } from '../settings';
import { go, getState } from '../store';
import { Backdrop, Button, Modal, Select, Slider, Tabs, Toggle, TopBar } from '../ui/kit';
import { MicButton } from './Lobby';

export function useSettings(): Settings {
  return useSyncExternalStore((cb) => {
    const off = subscribeSettings(cb);
    return () => {
      off();
    };
  }, getSettings);
}

function Row(p: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div>{p.label}</div>
        {p.desc && <div className="desc">{p.desc}</div>}
      </div>
      <div>{p.children}</div>
    </div>
  );
}

const SURV_ACTIONS: Action[] = ['frente', 'tras', 'esquerda', 'direita', 'correr', 'agachar', 'interagir', 'lanterna', 'inventario', 'item1', 'item2', 'item3', 'item4', 'atirar', 'trocarArma', 'recarregar', 'camera', 'falar'];
const ENT_ACTIONS: Action[] = ['rastro', 'eco', 'ruptura', 'parasita', 'ecoProximo'];

export function SettingsPanel(p: { compact?: boolean }) {
  const s = useSettings();
  const [tab, setTab] = useState<'graficos' | 'controles' | 'audio' | 'voz'>('graficos');
  const [listening, setListening] = useState<Action | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setListening(null);
      updateSettings({ bindings: { ...getSettings().bindings, [listening]: e.code } });
      setListening(null);
    };
    const onMouse = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.bind-btn')) return;
      e.preventDefault();
      updateSettings({ bindings: { ...getSettings().bindings, [listening]: `Mouse${e.button}` } });
      setListening(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  }, [listening]);

  const conflict = (a: Action, group: Action[]) => {
    const code = s.bindings[a];
    const all = group === ENT_ACTIONS ? [...ENT_ACTIONS, 'frente', 'tras', 'esquerda', 'direita', 'agachar', 'interagir', 'camera', 'falar'] : SURV_ACTIONS;
    return all.filter((o) => o !== a && s.bindings[o as Action] === code).map((o) => ACTION_LABELS[o as Action]);
  };

  const bindRows = (group: Action[]) =>
    group.map((a) => {
      const c = conflict(a, group);
      return (
        <Row key={a} label={ACTION_LABELS[a]} desc={c.length ? `⚠ mesma tecla de: ${c.join(', ')}` : undefined}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="key grow" style={{ padding: '8px 10px' }}>
              {listening === a ? 'Pressione uma tecla… (Esc cancela)' : keyLabel(s.bindings[a])}
            </span>
            <span className="bind-btn">
              <Button small onClick={() => setListening(a)}>
                Alterar
              </Button>
            </span>
          </div>
        </Row>
      );
    });

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['graficos', 'Gráficos'],
          ['controles', 'Controles'],
          ['audio', 'Áudio'],
          ['voz', 'Voz'],
        ]}
      />
      {tab === 'graficos' && (
        <div>
          <Row label="Qualidade gráfica" desc="Predefinição: ajusta resolução, texturas, efeitos e número de luzes.">
            <Select<QualityPreset>
              value={s.quality}
              options={[
                ['baixa', 'Baixa (computadores modestos/celulares)'],
                ['media', 'Média'],
                ['alta', 'Alta'],
              ]}
              onChange={(q) => updateSettings({ quality: q, ...PRESETS[q] })}
            />
          </Row>
          <Row label="Escala de resolução" desc="Abaixo de 100% melhora o desempenho.">
            <Slider value={s.resolutionScale} min={0.4} max={1} step={0.05} onChange={(v) => updateSettings({ resolutionScale: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          </Row>
          <Row label="Texturas" desc="Resolução das texturas procedurais.">
            <Select
              value={s.textures}
              options={[
                ['baixa', 'Baixa (128 px)'],
                ['media', 'Média (256 px)'],
                ['alta', 'Alta (512 px)'],
              ]}
              onChange={(v) => updateSettings({ textures: v })}
            />
          </Row>
          <Row label="Sombras de contato" desc="Sombras suaves sob os personagens.">
            <Toggle value={s.shadows} onChange={(v) => updateSettings({ shadows: v })} />
          </Row>
          <Row label="Partículas" desc="Sedimentos em suspensão, faíscas e sangue.">
            <Toggle value={s.particles} onChange={(v) => updateSettings({ particles: v })} />
          </Row>
          <Row label="Granulação de filme">
            <Toggle value={s.grain} onChange={(v) => updateSettings({ grain: v })} />
          </Row>
          <Row label="Balanço da câmera">
            <Toggle value={s.headBob} onChange={(v) => updateSettings({ headBob: v })} />
          </Row>
          <Row label="Campo de visão">
            <Slider value={s.fov} min={60} max={100} step={1} onChange={(v) => updateSettings({ fov: v })} fmt={(v) => `${v}°`} />
          </Row>
          <Row label="Câmera" desc="Também pode alternar durante a partida (tecla C).">
            <Select
              value={s.camera}
              options={[
                ['primeira', 'Primeira pessoa'],
                ['terceira', 'Terceira pessoa'],
              ]}
              onChange={(v) => updateSettings({ camera: v })}
            />
          </Row>
          <Row label="Mostrar FPS e desempenho">
            <Toggle value={s.showFps} onChange={(v) => updateSettings({ showFps: v })} />
          </Row>
        </div>
      )}
      {tab === 'controles' && (
        <div>
          <Row label="Sensibilidade do mouse">
            <Slider value={s.mouseSens} min={0.2} max={3} step={0.05} onChange={(v) => updateSettings({ mouseSens: v })} fmt={(v) => v.toFixed(2)} />
          </Row>
          <Row label="Sensibilidade da câmera (toque)">
            <Slider value={s.touchSens} min={0.2} max={3} step={0.05} onChange={(v) => updateSettings({ touchSens: v })} fmt={(v) => v.toFixed(2)} />
          </Row>
          <Row label="Inverter eixo vertical">
            <Toggle value={s.invertY} onChange={(v) => updateSettings({ invertY: v })} />
          </Row>
          <Row label="Controles de toque" desc="Automático detecta telas sensíveis ao toque.">
            <Select
              value={s.touchControls}
              options={[
                ['auto', 'Automático'],
                ['sempre', 'Sempre mostrar'],
                ['nunca', 'Nunca mostrar'],
              ]}
              onChange={(v) => updateSettings({ touchControls: v })}
            />
          </Row>
          <h3 style={{ marginTop: 18 }}>Teclas — sobrevivente e geral</h3>
          {bindRows(SURV_ACTIONS)}
          <h3 style={{ marginTop: 18 }}>Teclas — entidade</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            Ataque: botão esquerdo do mouse. A entidade usa as mesmas teclas de movimento, agachar (espreitar) e interagir.
          </div>
          {bindRows(ENT_ACTIONS)}
          <div style={{ marginTop: 12 }}>
            <Button small onClick={() => updateSettings({ bindings: { ...DEFAULT_BINDINGS } })}>
              Restaurar teclas padrão
            </Button>
          </div>
        </div>
      )}
      {tab === 'audio' && (
        <div>
          <Row label="Volume geral">
            <Slider value={s.master} min={0} max={1} step={0.01} onChange={(v) => updateSettings({ master: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          </Row>
          <Row label="Música e ambiente">
            <Slider value={s.music} min={0} max={1} step={0.01} onChange={(v) => updateSettings({ music: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          </Row>
          <Row label="Efeitos sonoros">
            <Slider value={s.sfx} min={0} max={1} step={0.01} onChange={(v) => updateSettings({ sfx: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          </Row>
          <Row label="Qualidade de áudio" desc="Alta: som 3D binaural (HRTF) e reverberação. Baixa: estéreo simples, mais leve.">
            <Select
              value={s.audioQuality}
              options={[
                ['alta', 'Alta'],
                ['baixa', 'Baixa'],
              ]}
              onChange={(v) => {
                updateSettings({ audioQuality: v });
                audio.setQuality(v === 'alta');
              }}
            />
          </Row>
          <Row label="Testar som">
            <Button
              small
              onClick={() => {
                audio.unlock();
                audio.play('porta', null);
              }}
            >
              Tocar
            </Button>
          </Row>
        </div>
      )}
      {tab === 'voz' && (
        <div>
          <Row label="Comunicação por voz" desc="Desativada: você não ouve nem fala com ninguém.">
            <Toggle value={s.voiceEnabled} onChange={(v) => updateSettings({ voiceEnabled: v })} />
          </Row>
          <Row label="Microfone" desc="O navegador pedirá permissão. Durante a partida a voz é por proximidade e só entre sobreviventes.">
            <MicButton />
          </Row>
          <Row label="Apertar para falar" desc={`Segure ${keyLabel(s.bindings.falar)} para transmitir.`}>
            <Toggle value={s.pushToTalk} onChange={(v) => updateSettings({ pushToTalk: v })} />
          </Row>
          <Row label="Volume das vozes">
            <Slider value={s.voice} min={0} max={1.5} step={0.01} onChange={(v) => updateSettings({ voice: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          </Row>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Silencie jogadores individualmente na lista do lobby. Atrás de redes muito restritivas a voz pode exigir um servidor TURN configurado pelo administrador do servidor.
          </div>
        </div>
      )}
      {!p.compact && (
        <div style={{ marginTop: 18 }}>
          <Button kind="danger" small onClick={() => setConfirmReset(true)}>
            Restaurar todas as configurações
          </Button>
        </div>
      )}
      {confirmReset && (
        <Modal title="Restaurar configurações" onClose={() => setConfirmReset(false)}>
          <p>Todas as configurações voltarão ao padrão deste dispositivo.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirmReset(false)}>Cancelar</Button>
            <Button
              kind="danger"
              onClick={() => {
                resetSettings();
                setConfirmReset(false);
              }}
            >
              Restaurar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function SettingsScreen() {
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative', maxWidth: 860, width: '100%', margin: '0 auto' }}>
        <TopBar title="Configurações" onBack={() => go(getState().prevScreen === 'lobby' ? 'lobby' : 'menu')} />
        <div className="panel">
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
}
