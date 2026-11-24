/** Personalização, loja, inventário de cosméticos, estatísticas/progresso e histórico. */
import { useEffect, useState } from 'react';
import { MAP_LIST } from '../../../shared/map';
import { ACHIEVEMENTS, COSMETICS, COSMETIC_BY_ID, SLOT_NAMES, currentSeason, masteryFromXp, type Cosmetic, type Loadout, type Slot } from '../../../shared/progression';
import type { MatchHistoryEntry } from '../../../shared/protocol';
import { api, ApiError } from '../net';
import { setProfile } from '../session';
import { getState, go, toast, useApp } from '../store';
import { Backdrop, Bar, Button, Modal, rgbCss, Tabs, TopBar } from '../ui/kit';
import { CharacterPreview } from '../ui/Preview';

function unlockText(c: Cosmetic): string {
  const u = c.unlock;
  switch (u.type) {
    case 'default':
      return 'Padrão';
    case 'shop':
      return `Loja · ${u.price} ◈`;
    case 'level':
      return `Nível ${u.level}`;
    case 'achievement':
      return `Conquista: ${ACHIEVEMENTS.find((a) => a.id === u.id)?.name ?? u.id}`;
    case 'season':
      return `Temporada · nível ${u.tier}`;
    case 'mastery':
      return `Maestria da entidade ${u.level}`;
  }
}

function swatch(c: Cosmetic): string[] {
  const d = c.data;
  return [d.skin, d.hairColor, d.torso, d.legs, d.shoeColor, d.accColor, d.stripe, d.body, d.glow].filter(Boolean).map((x) => rgbCss(x!));
}

function CosmeticCard(p: { c: Cosmetic; owned: boolean; selected?: boolean; onClick?: () => void; footer?: string }) {
  const cols = swatch(p.c);
  return (
    <button className={`card ${p.selected ? 'selected' : ''} ${p.owned ? '' : 'locked'}`} onClick={p.onClick}>
      <div className="swatch">{cols.length ? cols.map((c, i) => <i key={i} style={{ background: c }} />) : <i style={{ background: 'rgba(255,255,255,0.05)' }} />}</div>
      <div className="name">{p.c.name}</div>
      <div className="req">{p.footer ?? (p.owned ? 'Desbloqueado' : `🔒 ${unlockText(p.c)}`)}</div>
    </button>
  );
}

export function CustomizeScreen() {
  const profile = useApp((s) => s.profile);
  const [slot, setSlot] = useState<Slot>('rosto');
  const [draft, setDraft] = useState<Loadout | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (profile && !draft) setDraft({ ...profile.loadout });
  }, [profile]);
  if (!profile || !draft) return null;
  const owned = new Set(profile.owned);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.loadout);
  const save = async () => {
    setSaving(true);
    try {
      const r = await api<{ profile: typeof profile }>('/api/loadout', { loadout: draft }, getState().token);
      setProfile(r.profile);
      toast('Aparência salva.', 'good');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };
  const slots = Object.keys(SLOT_NAMES) as Slot[];
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar
          title="Personalização"
          back={getState().room ? 'lobby' : 'profile'}
          right={
            <div className="row">
              <Button disabled={!dirty} onClick={() => setDraft({ ...profile.loadout })}>
                Desfazer
              </Button>
              <Button kind="primary" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          }
        />
        <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(300px, 1.4fr)' }}>
          <div className="panel">
            <CharacterPreview loadout={draft} kind={slot === 'entidade' ? 'entity' : 'survivor'} height={440} />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Arraste para girar. Itens cosméticos não alteram atributos; cores muito escuras ou claras são equalizadas para ninguém ganhar camuflagem no escuro.
            </div>
          </div>
          <div className="panel">
            <Tabs value={slot} onChange={setSlot} tabs={slots.map((s) => [s, SLOT_NAMES[s]] as [Slot, string])} />
            {slot === 'uniforme' && <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Um uniforme substitui a roupa e os calçados.</p>}
            <div className="cards">
              {COSMETICS.filter((c) => c.slot === slot).map((c) => (
                <CosmeticCard
                  key={c.id}
                  c={c}
                  owned={owned.has(c.id)}
                  selected={draft[slot] === c.id}
                  onClick={() => {
                    if (!owned.has(c.id)) {
                      toast(`Bloqueado — ${unlockText(c)}.`, 'warn');
                      return;
                    }
                    setDraft({ ...draft, [slot]: c.id });
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShopScreen() {
  const profile = useApp((s) => s.profile);
  const [confirm, setConfirm] = useState<Cosmetic | null>(null);
  if (!profile) return null;
  const owned = new Set(profile.owned);
  const items = COSMETICS.filter((c) => c.unlock.type === 'shop');
  const buy = async (c: Cosmetic) => {
    try {
      const r = await api<{ profile: typeof profile }>('/api/shop/buy', { id: c.id }, getState().token);
      setProfile(r.profile);
      toast(`Você adquiriu “${c.name}”.`, 'good');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha na compra.', 'error');
    }
    setConfirm(null);
  };
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Loja de cosméticos" back="profile" right={<span className="tag accent" style={{ fontSize: 13 }}>{profile.coins} ◈ fragmentos</span>} />
        <p className="muted" style={{ marginTop: 0 }}>
          Fragmentos (◈) são ganhos jogando partidas, subindo de nível, em conquistas e na temporada. Esta versão não tem pagamentos com dinheiro real.
        </p>
        <div className="cards">
          {items.map((c) => {
            const price = c.unlock.type === 'shop' ? c.unlock.price : 0;
            const has = owned.has(c.id);
            return (
              <div key={c.id} className="col">
                <CosmeticCard c={c} owned footer={`${SLOT_NAMES[c.slot]} · ${has ? 'adquirido' : `${price} ◈`}`} />
                <Button small disabled={has || profile.coins < price} onClick={() => setConfirm(c)}>
                  {has ? 'Adquirido' : profile.coins < price ? 'Fragmentos insuficientes' : 'Comprar'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
      {confirm && (
        <Modal title="Confirmar compra" onClose={() => setConfirm(null)}>
          <p>
            Comprar <b>{confirm.name}</b> por {confirm.unlock.type === 'shop' ? confirm.unlock.price : 0} ◈?
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button kind="primary" onClick={() => void buy(confirm)}>
              Comprar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function CollectionScreen() {
  const profile = useApp((s) => s.profile);
  if (!profile) return null;
  const owned = new Set(profile.owned);
  const slots = Object.keys(SLOT_NAMES) as Slot[];
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Inventário" back="profile" right={<Button onClick={() => go('customize')}>Personalizar</Button>} />
        <p className="muted" style={{ marginTop: 0 }}>
          {owned.size} de {COSMETICS.length} itens desbloqueados.
        </p>
        {slots.map((s) => (
          <div key={s} className="panel" style={{ marginBottom: 12 }}>
            <h3>
              {SLOT_NAMES[s]} <span className="muted">({COSMETICS.filter((c) => c.slot === s && owned.has(c.id)).length}/{COSMETICS.filter((c) => c.slot === s).length})</span>
            </h3>
            <div className="cards">
              {COSMETICS.filter((c) => c.slot === s).map((c) => (
                <CosmeticCard key={c.id} c={c} owned={owned.has(c.id)} selected={profile.loadout[s] === c.id} footer={profile.loadout[s] === c.id ? 'Equipado' : undefined} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsScreen() {
  const profile = useApp((s) => s.profile);
  if (!profile) return null;
  const st = profile.stats;
  const season = currentSeason();
  const mastery = masteryFromXp(profile.masteryXp);
  const stats: [string, number | string][] = [
    ['Partidas', st.matches],
    ['Como sobrevivente', st.survivorMatches],
    ['Como entidade', st.entityMatches],
    ['Fugas', st.escapes],
    ['Vitórias (sobrev.)', st.survivorWins],
    ['Vitórias (entidade)', st.entityWins],
    ['Mortes', st.deaths],
    ['Resgates', st.revives],
    ['Curas', st.heals],
    ['Objetivos', st.objectives],
    ['Itens entregues', st.itemsDelivered],
    ['Golpes', st.hits],
    ['Derrubadas', st.downs],
    ['Eliminações', st.kills],
    ['Ecos falsos', st.echoes],
    ['Tempo jogado', `${Math.floor(st.playSeconds / 60)} min`],
  ];
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Estatísticas e progresso" back="menu" />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="panel">
            <h3>Conta</h3>
            <div className="row">
              <div className="stat grow">
                <b>{profile.level}</b>
                <span>nível</span>
              </div>
              <div className="stat grow">
                <b>{profile.coins}</b>
                <span>fragmentos ◈</span>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="label">{profile.maxLevel ? 'Nível máximo atingido' : `Experiência ${profile.levelInto}/${profile.levelNeed}`}</div>
              <Bar value={profile.maxLevel ? 1 : profile.levelInto / Math.max(1, profile.levelNeed)} />
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="label">Maestria — O Reverberante: nível {mastery.level}</div>
              <Bar value={mastery.into / mastery.need} color="var(--entity)" />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Jogar como entidade evolui a maestria e desbloqueia aparências da criatura.
              </div>
            </div>
          </div>
          <div className="panel">
            <h3>{season.name}</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {season.start} a {season.end} · XP da temporada: {profile.season.xp}
            </div>
            {season.tiers.map((t) => {
              const got = profile.season.claimed.includes(t.tier);
              return (
                <div key={t.tier} className="row" style={{ marginBottom: 6, opacity: got ? 1 : 0.75 }}>
                  <span className={`tag ${got ? 'good' : ''}`}>N{t.tier}</span>
                  <span className="grow" style={{ fontSize: 13 }}>
                    {t.reward.coins ? `${t.reward.coins} ◈` : COSMETIC_BY_ID[t.reward.cosmetic!]?.name}
                  </span>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {got ? 'obtido' : `${t.xp} XP`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel" style={{ marginTop: 12 }}>
          <h3>Estatísticas individuais</h3>
          <div className="statgrid">
            {stats.map(([l, v]) => (
              <div key={l} className="stat">
                <b>{v}</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel" style={{ marginTop: 12 }}>
          <h3>Conquistas</h3>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {ACHIEVEMENTS.map((a) => {
              const has = profile.achievements.includes(a.id);
              return (
                <div key={a.id} className={`ach ${has ? '' : 'off'}`}>
                  <div className="medal">{has ? '★' : '?'}</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {a.desc} · +{a.coins} ◈
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const OUTCOME: Record<MatchHistoryEntry['outcome'], string> = { escaped: 'Fugiu', dead: 'Morreu', survived: 'Sobreviveu', disconnected: 'Desconectou', entity: 'Entidade' };

export function HistoryScreen() {
  const token = useApp((s) => s.token);
  const [list, setList] = useState<MatchHistoryEntry[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ history: MatchHistoryEntry[] }>('/api/history', undefined, token)
      .then((r) => setList(r.history))
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.'));
  }, [token]);
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Histórico de partidas" back="profile" />
        <div className="panel">
          {err && <div className="error-text">{err}</div>}
          {!list && !err && <div className="spinner" />}
          {list && list.length === 0 && <p className="muted">Nenhuma partida registrada ainda.</p>}
          {list && list.length > 0 && (
            <table className="list">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Mapa</th>
                  <th>Função</th>
                  <th>Resultado</th>
                  <th>Duração</th>
                  <th>Pontos</th>
                  <th>XP</th>
                  <th>◈</th>
                </tr>
              </thead>
              <tbody>
                {list.map((h) => {
                  const won = (h.role === 'entity') === (h.winner === 'entity');
                  return (
                    <tr key={h.matchId}>
                      <td>{new Date(h.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{MAP_LIST.find((m) => m.id === h.map)?.name ?? h.map}</td>
                      <td>{h.role === 'entity' ? 'Entidade' : 'Sobrevivente'}</td>
                      <td>
                        <span className={`tag ${won ? 'good' : 'danger'}`}>{won ? 'vitória' : 'derrota'}</span> <span className="muted">{OUTCOME[h.outcome]}</span>
                      </td>
                      <td className="mono">
                        {Math.floor(h.duration / 60)}:{String(h.duration % 60).padStart(2, '0')}
                      </td>
                      <td className="mono">{h.score}</td>
                      <td className="mono">+{h.xp}</td>
                      <td className="mono">+{h.coins}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
