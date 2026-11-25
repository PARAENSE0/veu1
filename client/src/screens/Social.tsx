/**
 * Perfil, ranking online, amigos, melhorias permanentes e código de presente.
 * Tudo vem do servidor (nada é calculado só no navegador): o cliente envia o
 * pedido e mostra a resposta validada.
 */
import { useEffect, useRef, useState } from 'react';
import { MAX_LEVEL } from '../../../shared/progression';
import type { FriendInfo, Profile, RankingEntry, RewardLogEntryView, WeekHistory } from '../../../shared/protocol';
import { HUMAN_UPGRADES, MAX_UPGRADE_LEVEL, MONSTER_UPGRADES, UPGRADES, UPGRADE_COSTS, type UpgradeId } from '../../../shared/upgrades';
import { api, ApiError, net } from '../net';
import { setProfile } from '../session';
import { getState, go, setState, toast, useApp } from '../store';
import { Backdrop, Bar, Button, Tabs, TopBar, type Ev } from '../ui/kit';

const token = () => getState().token;
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Erro inesperado.');

/** Barra de nível que entende o nível máximo. */
export function LevelBar(p: { profile: Profile }) {
  const pr = p.profile;
  return (
    <div>
      <div className="label">
        {pr.maxLevel ? `NÍVEL MÁXIMO (${MAX_LEVEL}) — o XP continua somando no ranking` : `Nível ${pr.level} · ${pr.levelInto}/${pr.levelNeed} XP para o ${pr.level + 1}`}
      </div>
      <Bar value={pr.maxLevel ? 1 : pr.levelInto / Math.max(1, pr.levelNeed)} color={pr.maxLevel ? 'var(--accent)' : undefined} />
    </div>
  );
}

const SOURCE_NAMES: Record<string, string> = { partida: 'Partida', conquista: 'Conquista', temporada: 'Temporada', nivel: 'Nível', codigo: 'Código', melhoria: 'Melhoria', loja: 'Loja' };

// ------------------------------------------------------------------ PERFIL
export function ProfileScreen() {
  const profile = useApp((s) => s.profile);
  useEffect(() => {
    api<{ profile: Profile }>('/api/me', undefined, token())
      .then((r) => setProfile(r.profile))
      .catch(() => {});
  }, []);
  if (!profile) return null;
  const st = profile.stats;
  const wins = (st.survivorWins ?? 0) + (st.entityWins ?? 0);
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Perfil" back="menu" />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="panel">
            <h3>
              {profile.username} {profile.guest && <span className="tag warn">convidado</span>}
            </h3>
            <div className="mono muted" style={{ fontSize: 11, marginBottom: 10 }}>
              ID {profile.id}
            </div>
            <div className="row">
              <div className="stat grow">
                <b>{profile.level}</b>
                <span>nível</span>
              </div>
              <div className="stat grow">
                <b>{profile.totalXp.toLocaleString('pt-BR')}</b>
                <span>XP total</span>
              </div>
              <div className="stat grow">
                <b>{profile.coins.toLocaleString('pt-BR')}</b>
                <span>fragmentos ◈</span>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <LevelBar profile={profile} />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="stat grow">
                <b>{st.matches ?? 0}</b>
                <span>partidas</span>
              </div>
              <div className="stat grow">
                <b>{wins}</b>
                <span>vitórias</span>
              </div>
              <div className="stat grow">
                <b>{profile.achievements.length}</b>
                <span>conquistas</span>
              </div>
            </div>
            <WeekLine profile={profile} />
            {profile.guest && (
              <p className="muted" style={{ fontSize: 12 }}>
                Contas de convidado não guardam progresso permanente, melhorias, amigos ou códigos. Crie uma conta para salvar tudo.
              </p>
            )}
          </div>
          <div className="panel">
            <h3>Aparência e itens</h3>
            <div className="col" style={{ gap: 8 }}>
              <Button wide onClick={() => go('customize')}>
                Personalização
              </Button>
              <Button wide onClick={() => go('shop')}>
                Loja de cosméticos
              </Button>
              <Button wide onClick={() => go('collection')}>
                Inventário ({profile.owned.length})
              </Button>
              <Button wide onClick={() => go('history')}>
                Histórico de partidas
              </Button>
            </div>
          </div>
          <div className="panel">
            <h3>Histórico de recompensas</h3>
            {profile.rewardLog.length === 0 && <p className="muted">Nenhuma recompensa ainda.</p>}
            <div className="col" style={{ gap: 4, maxHeight: 340, overflow: 'auto' }}>
              {profile.rewardLog.map((e: RewardLogEntryView, i: number) => (
                <div key={i} className="row" style={{ fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 4 }}>
                  <span className="tag">{SOURCE_NAMES[e.source] ?? e.source}</span>
                  <span className="grow">{e.desc}</span>
                  <span className="mono muted">
                    {e.xp ? `+${e.xp} XP ` : ''}
                    {e.coins ? `${e.coins > 0 ? '+' : ''}${e.coins} ◈` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekLine(p: { profile: Profile }) {
  const left = useCountdown(p.profile.weekEndsAt);
  return (
    <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
      Ranking semanal: <b>{p.profile.weekXp.toLocaleString('pt-BR')} XP</b> nesta semana · reinicia em <span className="mono">{left}</span>
    </div>
  );
}

// ------------------------------------------------------------------ RANKING
type RankData = { list: RankingEntry[]; me: RankingEntry | null; total: number; updated: string; week: { id: string; start: string; end: string; msLeft: number } };

/** "3 d 04 h 12 min" até o fim da semana (contagem regressiva ao vivo). */
export function useCountdown(endIso: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!endIso) return '';
  const ms = Math.max(0, new Date(endIso).getTime() - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return d > 0 ? `${d} d ${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')} min` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function RankingScreen() {
  const [by, setBy] = useState<'semanal' | 'xp' | 'vitorias'>('semanal');
  const [data, setData] = useState<RankData | null>(null);
  const [hist, setHist] = useState<WeekHistory[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<RankData>(`/api/ranking?by=${by}`, undefined, token())
        .then((d) => alive && (setData(d), setErr('')))
        .catch((e) => alive && setErr(errMsg(e)));
    void load();
    const i = setInterval(load, 10000); // atualização automática
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [by]);
  useEffect(() => {
    api<{ weeks: WeekHistory[] }>('/api/ranking/history')
      .then((r) => setHist(r.weeks))
      .catch(() => {});
  }, [data?.week.id]);
  const meId = useApp((s) => s.profile?.id);
  const left = useCountdown(data?.week.end);
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Ranking" back="menu" right={data ? <span className="muted mono" style={{ fontSize: 11 }}>{data.total} jogadores · atualizado {new Date(data.updated).toLocaleTimeString('pt-BR')}</span> : undefined} />
        <Tabs
          value={by}
          onChange={setBy}
          tabs={[
            ['semanal', 'Semanal'],
            ['xp', 'Geral (XP total)'],
            ['vitorias', 'Vitórias'],
          ]}
        />
        {data && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="tag accent week-timer">Temporada semanal {fmtDay(data.week.start)} – {fmtDay(new Date(new Date(data.week.end).getTime() - 1).toISOString())} · reinicia em {left}</span>
            <span className="muted" style={{ fontSize: 12 }}>O placar semanal zera toda segunda-feira às 00:00 (Brasília). XP, nível, moedas e melhorias nunca são apagados.</span>
          </div>
        )}
        {err && <p className="tag danger">{err}</p>}
        <div className="panel" style={{ marginTop: 10 }}>
          <table className="rank">
            <thead>
              <tr>
                <th>#</th>
                <th>Jogador</th>
                <th>Nível</th>
                <th>{by === 'semanal' ? 'XP da semana' : 'XP total'}</th>
                <th>Vitórias</th>
                <th>Partidas</th>
              </tr>
            </thead>
            <tbody>
              {data?.list.map((e) => (
                <tr key={e.id} className={e.id === meId ? 'me' : ''}>
                  <td className="mono">{e.pos <= 3 ? ['🥇', '🥈', '🥉'][e.pos - 1] : e.pos}</td>
                  <td>{e.username}</td>
                  <td>{e.level}</td>
                  <td className="mono">{(by === 'semanal' ? e.weekXp : e.totalXp).toLocaleString('pt-BR')}</td>
                  <td>{e.wins}</td>
                  <td>{e.matches}</td>
                </tr>
              ))}
              {data?.list.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {by === 'semanal' ? 'Ninguém pontuou nesta semana ainda. Jogue uma partida para entrar no placar!' : 'Nenhum jogador registrado ainda.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {data?.me && data.me.pos > data.list.length && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="tag accent">Sua posição: {data.me.pos}º</span>
            </div>
          )}
          {!data?.me && by !== 'semanal' && <p className="muted" style={{ fontSize: 12 }}>Convidados não entram no ranking. Crie uma conta para competir.</p>}
          {!data?.me && by === 'semanal' && <p className="muted" style={{ fontSize: 12 }}>Você ainda não pontuou nesta semana (convidados não entram no ranking).</p>}
        </div>
        {hist.length > 0 && (
          <div className="panel" style={{ marginTop: 10 }}>
            <h3>Semanas anteriores</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {hist.map((w) => (
                <div key={w.id}>
                  <div className="label">
                    {fmtDay(w.start)} – {fmtDay(new Date(new Date(w.end).getTime() - 1).toISOString())} · {w.players} jogadores
                  </div>
                  {w.top.slice(0, 3).map((t) => (
                    <div key={t.pos} className="row" style={{ fontSize: 13 }}>
                      <span>{['🥇', '🥈', '🥉'][t.pos - 1]}</span>
                      <span className="grow">{t.username}</span>
                      <span className="mono muted">{t.weekXp.toLocaleString('pt-BR')} XP</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AMIGOS
type FriendsView = { friends: FriendInfo[]; incoming: { id: string; username: string; level: number }[]; outgoing: { id: string; username: string; level: number }[] };
const STATUS_TXT: Record<FriendInfo['status'], [string, string]> = {
  partida: ['em partida', 'danger'],
  lobby: ['no lobby', 'accent'],
  menu: ['online', 'good'],
  offline: ['offline', ''],
};
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}

export function FriendsScreen() {
  const profile = useApp((s) => s.profile);
  const room = useApp((s) => s.room);
  const [view, setView] = useState<FriendsView | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; username: string; level: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const notices = useApp((s) => s.notices);
  const load = () =>
    api<FriendsView>('/api/friends', undefined, token())
      .then(setView)
      .catch((e) => toast(errMsg(e), 'error'));
  useEffect(() => {
    void load();
    const i = setInterval(load, 5000); // presença ao vivo
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    void load();
  }, [notices.length]);
  const act = async (action: string, id: string, ok?: string) => {
    setBusy(true);
    try {
      const r = await api<FriendsView & { result?: string }>(`/api/friends/${action}`, { id }, token());
      if ('friends' in r && r.friends) setView(r);
      if (ok) toast(r.result === 'accepted' ? 'Vocês agora são amigos!' : ok, 'good');
      if (action === 'invite') return;
      void load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const search = async (e: Ev) => {
    e.preventDefault();
    if (q.trim().length < 2) return toast('Digite pelo menos 2 letras (nome) ou o ID.', 'warn');
    try {
      const r = await api<{ users: { id: string; username: string; level: number }[] }>(`/api/users/search?q=${encodeURIComponent(q.trim())}`, undefined, token());
      setFound(r.users);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };
  if (!profile) return null;
  if (profile.guest)
    return (
      <div className="screen">
        <Backdrop />
        <div style={{ position: 'relative' }}>
          <TopBar title="Amigos" back="menu" />
          <div className="panel">
            <p>Crie uma conta para adicionar amigos (convidados não têm lista permanente).</p>
          </div>
        </div>
      </div>
    );
  const rel = (id: string) => (view?.friends.some((f) => f.id === id) ? 'amigo' : view?.outgoing.some((f) => f.id === id) ? 'enviado' : view?.incoming.some((f) => f.id === id) ? 'recebido' : null);
  const canInvite = !!room && (room.state === 'lobby' || room.state === 'countdown');
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Amigos" back="menu" right={<span className="muted mono" style={{ fontSize: 11 }}>seu ID: {profile.id}</span>} />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="panel">
            <h3>Lista de amigos ({view?.friends.length ?? 0})</h3>
            {!canInvite && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Entre em uma sala para convidar amigos para a partida.</p>}
            {view?.friends.length === 0 && <p className="muted">Busque jogadores pelo nome ou ID para adicionar.</p>}
            <div className="col" style={{ gap: 6 }}>
              {view?.friends.map((f) => (
                <div key={f.id} className="row friend">
                  <span className={`dot ${f.status}`} />
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{f.username}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      nível {f.level} · <span className={`tag ${STATUS_TXT[f.status][1]}`}>{STATUS_TXT[f.status][0]}</span> {f.status === 'offline' ? `· visto ${ago(f.lastSeen)}` : ''}
                    </div>
                  </div>
                  {f.status === 'lobby' && f.roomCode && !room && (
                    <Button small onClick={() => net.send({ t: 'room:join', code: f.roomCode! })}>
                      Entrar na sala
                    </Button>
                  )}
                  <Button small disabled={!canInvite || f.status === 'offline' || busy} onClick={() => void act('invite', f.id, `Convite enviado para ${f.username}.`)} title={canInvite ? 'Convidar para a sua sala' : 'Entre em uma sala primeiro'}>
                    Convidar
                  </Button>
                  <Button small kind="ghost" disabled={busy} onClick={() => confirm(`Remover ${f.username} da sua lista?`) && void act('remove', f.id, 'Amizade removida.')}>
                    Remover
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Solicitações</h3>
            <div className="label">Recebidas ({view?.incoming.length ?? 0})</div>
            {view?.incoming.map((f) => (
              <div key={f.id} className="row friend">
                <div className="grow">
                  {f.username} <span className="muted">· nível {f.level}</span>
                </div>
                <Button small kind="primary" disabled={busy} onClick={() => void act('accept', f.id, `Você e ${f.username} agora são amigos.`)}>
                  Aceitar
                </Button>
                <Button small kind="ghost" disabled={busy} onClick={() => void act('reject', f.id, 'Solicitação recusada.')}>
                  Recusar
                </Button>
              </div>
            ))}
            <div className="label" style={{ marginTop: 12 }}>
              Enviadas ({view?.outgoing.length ?? 0})
            </div>
            {view?.outgoing.map((f) => (
              <div key={f.id} className="row friend">
                <div className="grow">
                  {f.username} <span className="muted">· aguardando</span>
                </div>
                <Button small kind="ghost" disabled={busy} onClick={() => void act('cancel', f.id, 'Solicitação cancelada.')}>
                  Cancelar
                </Button>
              </div>
            ))}
          </div>
          <div className="panel">
            <h3>Adicionar amigo</h3>
            <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={search}>
              <input className="input grow" placeholder="Nome ou ID do jogador" maxLength={40} value={q} onChange={(e: { target: HTMLInputElement }) => setQ(e.target.value)} />
              <Button type="submit">Buscar</Button>
            </form>
            {found && found.length === 0 && <p className="muted">Nenhum jogador encontrado.</p>}
            <div className="col" style={{ gap: 6, marginTop: 8 }}>
              {found?.map((u) => {
                const r = rel(u.id);
                return (
                  <div key={u.id} className="row friend">
                    <div className="grow">
                      {u.username} <span className="muted">· nível {u.level}</span>
                    </div>
                    {r === 'amigo' ? (
                      <span className="tag good">amigo</span>
                    ) : r === 'enviado' ? (
                      <span className="tag">pedido enviado</span>
                    ) : r === 'recebido' ? (
                      <Button small kind="primary" onClick={() => void act('accept', u.id, `Você e ${u.username} agora são amigos.`)}>
                        Aceitar pedido
                      </Button>
                    ) : (
                      <Button small kind="primary" disabled={busy} onClick={() => void act('request', u.id, `Pedido enviado para ${u.username}.`)}>
                        Adicionar
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ MELHORIAS
export function UpgradesScreen() {
  const profile = useApp((s) => s.profile);
  const [side, setSide] = useState<'humano' | 'monstro'>('humano');
  const [busy, setBusy] = useState<string | null>(null);
  if (!profile) return null;
  const buy = async (id: UpgradeId) => {
    setBusy(id);
    try {
      const r = await api<{ profile: Profile }>('/api/upgrades/buy', { id }, token());
      setProfile(r.profile);
      toast(`${UPGRADES[id].name}: nível ${r.profile.upgrades[id]}!`, 'good');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const list = side === 'humano' ? HUMAN_UPGRADES : MONSTER_UPGRADES;
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Melhorias" back="menu" right={<span className="tag accent">{profile.coins.toLocaleString('pt-BR')} ◈</span>} />
        <Tabs
          value={side}
          onChange={setSide}
          tabs={[
            ['humano', 'Humanos'],
            ['monstro', 'Monstro'],
          ]}
        />
        {profile.guest && <p className="tag warn">Convidados não podem comprar melhorias permanentes — crie uma conta.</p>}
        <p className="muted" style={{ fontSize: 12 }}>
          Melhorias valem em todas as partidas e são aplicadas pelo servidor. Elas têm limite de equilíbrio: nenhum monstro derruba um humano com dois ataques comuns, mesmo com Poder de ataque no máximo.
        </p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {list.map((id) => {
            const def = UPGRADES[id];
            const lvl = profile.upgrades[id] ?? 0;
            const max = lvl >= MAX_UPGRADE_LEVEL;
            const cost = max ? 0 : UPGRADE_COSTS[lvl];
            return (
              <div key={id} className="panel upgrade">
                <h3 style={{ marginBottom: 4 }}>{def.name}</h3>
                <div className="muted" style={{ fontSize: 13 }}>
                  {def.desc}
                </div>
                <div className="pips" aria-label={`nível ${lvl} de ${MAX_UPGRADE_LEVEL}`}>
                  {Array.from({ length: MAX_UPGRADE_LEVEL }, (_, i) => (
                    <i key={i} className={i < lvl ? 'on' : ''} />
                  ))}
                </div>
                <div style={{ fontSize: 13 }}>
                  Atual: <b>{lvl ? def.fmt(lvl * def.perLevel) : 'sem bônus'}</b>
                  <br />
                  {max ? <span className="tag good">nível máximo</span> : <>Próximo nível: <b>{def.fmt((lvl + 1) * def.perLevel)}</b></>}
                </div>
                <Button kind="primary" wide disabled={max || busy !== null || profile.guest || profile.coins < cost} onClick={() => void buy(id)}>
                  {max ? 'Máximo' : busy === id ? 'Comprando…' : `Comprar nível ${lvl + 1} · ${cost.toLocaleString('pt-BR')} ◈`}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ CÓDIGO DE PRESENTE
export function GiftCodeScreen() {
  const profile = useApp((s) => s.profile);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  if (!profile) return null;
  const submit = async (e: Ev) => {
    e.preventDefault();
    if (!code.trim()) return setResult({ ok: false, text: 'Digite um código.' });
    setBusy(true);
    try {
      const r = await api<{ reward: { coins: number; xp: number; levelBefore: number; levelAfter: number }; profile: Profile }>('/api/codes/redeem', { code: code.trim() }, token());
      setProfile(r.profile);
      const parts = [];
      if (r.reward.levelAfter > r.reward.levelBefore) parts.push(`nível ${r.reward.levelBefore} → ${r.reward.levelAfter}`);
      if (r.reward.coins) parts.push(`+${r.reward.coins.toLocaleString('pt-BR')} fragmentos`);
      if (r.reward.xp && r.reward.levelAfter === r.reward.levelBefore) parts.push(`+${r.reward.xp} XP`);
      setResult({ ok: true, text: `Código resgatado com sucesso! ${parts.join(' · ')}` });
      setCode('');
    } catch (err) {
      setResult({ ok: false, text: errMsg(err) });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Código de presente" back="menu" />
        <div className="panel" style={{ maxWidth: 520 }}>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="gift">CÓDIGO DE PRESENTE</label>
              <input
                id="gift"
                ref={input}
                className="input mono"
                autoComplete="off"
                maxLength={24}
                placeholder="DIGITE O CÓDIGO"
                value={code}
                onChange={(e: { target: HTMLInputElement }) => setCode(e.target.value.toUpperCase())}
                style={{ letterSpacing: '0.2em' }}
              />
            </div>
            <Button kind="primary" type="submit" wide disabled={busy || profile.guest}>
              {busy ? 'Validando…' : 'Resgatar'}
            </Button>
          </form>
          {profile.guest && <p className="tag warn" style={{ marginTop: 10 }}>Crie uma conta para resgatar códigos (convidados não guardam progresso).</p>}
          {result && (
            <p className={`tag ${result.ok ? 'good' : 'danger'}`} role="status" style={{ marginTop: 12, display: 'block', whiteSpace: 'normal' }}>
              {result.text}
            </p>
          )}
          {profile.redeemedCodes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="label">Códigos já resgatados nesta conta</div>
              <div className="row">
                {profile.redeemedCodes.map((c) => (
                  <span key={c} className="tag mono">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            Cada código vale uma vez por conta. A validação e a entrega das recompensas acontecem no servidor.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Convite recebido: aparece em qualquer tela fora da partida. */
export function InviteBanner() {
  const invite = useApp((s) => s.invite);
  const screen = useApp((s) => s.screen);
  if (!invite || screen === 'match') return null;
  return (
    <div className="invite panel" role="alert">
      <div className="grow">
        <b>{invite.from.username}</b> convidou você para a sala <b>{invite.roomName ?? invite.code}</b>
      </div>
      <Button
        small
        kind="primary"
        onClick={() => {
          if (getState().room) net.send({ t: 'room:leave' });
          net.send({ t: 'room:join', code: invite.code! });
          setState({ invite: null });
        }}
      >
        Entrar
      </Button>
      <Button small kind="ghost" onClick={() => setState({ invite: null })}>
        Recusar
      </Button>
    </div>
  );
}
