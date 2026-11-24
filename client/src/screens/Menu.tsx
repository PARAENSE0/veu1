/** Menu principal e tela "Jogar" (criar sala, entrar por código, encontrar partida). */
import { useEffect, useState } from 'react';
import { MAP_LIST } from '../../../shared/map';
import { audio } from '../game/audio';
import { net } from '../net';
import { logout } from '../session';
import { go, toast, useApp } from '../store';
import { Backdrop, Bar, Button, Modal, TopBar, Toggle, type Ev } from '../ui/kit';

export function MainMenu() {
  const profile = useApp((s) => s.profile);
  const room = useApp((s) => s.room);
  const status = useApp((s) => s.net);
  const [confirmOut, setConfirmOut] = useState(false);
  if (!profile) return null;
  const pendingFriends = profile.friendRequests;
  const items: [string, () => void, string?, boolean?][] = [
    [room ? 'Voltar à sala' : 'Jogar', () => go(room ? 'lobby' : 'play'), room ? room.code : undefined, true],
    ['Perfil', () => go('profile'), `nível ${profile.level}`],
    ['Ranking', () => go('ranking')],
    ['Amigos', () => go('friends'), pendingFriends ? `${pendingFriends} pedido(s)` : undefined],
    ['Melhorias', () => go('upgrades'), `${profile.coins.toLocaleString('pt-BR')} ◈`],
    ['Código de presente', () => go('gift')],
    ['Estatísticas', () => go('stats')],
    ['Configurações', () => go('settings')],
  ];
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative', display: 'flex', flex: 1, alignItems: 'center', gap: '6vw', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div className="logo" style={{ textAlign: 'left' }}>
          <div className="title" style={{ fontSize: 'clamp(56px, 10vw, 120px)' }}>
            VÉU
          </div>
          <div className="sub">ECOS DA RUPTURA</div>
        </div>
        <nav className="menu-list" aria-label="Menu principal">
          {items.map(([label, fn, small, primary]) => (
            <button
              key={label}
              className={`menu-item ${primary ? 'primary' : ''}`}
              onMouseEnter={() => audio.ui('hover')}
              onClick={() => {
                audio.ui('click');
                fn();
              }}
            >
              <span>{label}</span>
              {small && <small>{small}</small>}
            </button>
          ))}
          <button className="menu-item" onClick={() => setConfirmOut(true)}>
            <span>Sair da conta</span>
          </button>
        </nav>
      </div>
      <div className="panel" style={{ position: 'relative', alignSelf: 'flex-start', minWidth: 280, padding: 12 }}>
        <div className="row">
          <div className="grow">
            <div style={{ fontWeight: 700 }}>
              {profile.username} {profile.guest && <span className="tag warn">convidado</span>}
            </div>
            <div className="mono muted" style={{ fontSize: 11 }}>
              {profile.maxLevel ? `NÍVEL MÁXIMO ${profile.level}` : `NÍVEL ${profile.level} · ${profile.levelInto}/${profile.levelNeed} XP`}
            </div>
          </div>
          <span className={`tag ${status === 'online' ? 'good' : status === 'connecting' ? 'warn' : 'danger'}`}>{status === 'online' ? 'online' : status === 'connecting' ? 'conectando' : 'offline'}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <Bar value={profile.maxLevel ? 1 : profile.levelInto / Math.max(1, profile.levelNeed)} />
        </div>
      </div>
      {confirmOut && (
        <Modal title="Sair da conta" onClose={() => setConfirmOut(false)}>
          <p>{profile.guest ? 'Contas de convidado não podem ser recuperadas depois de sair.' : 'Você poderá entrar novamente com seu usuário e senha.'}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirmOut(false)}>Cancelar</Button>
            <Button kind="danger" onClick={() => void logout()}>
              Sair
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function PlayScreen() {
  const rooms = useApp((s) => s.rooms);
  const status = useApp((s) => s.net);
  const profile = useApp((s) => s.profile);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pub, setPub] = useState(true);
  const [map, setMap] = useState(MAP_LIST[0].id);
  useEffect(() => {
    net.send({ t: 'room:list' });
    const i = setInterval(() => net.send({ t: 'room:list' }), 4000);
    return () => clearInterval(i);
  }, [status]);
  const offline = status !== 'online';
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative' }}>
        <TopBar title="Jogar" back="menu" right={offline ? <span className="tag danger">sem conexão com o servidor</span> : undefined} />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="panel">
            <h3>Partida rápida</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Entra na sala pública com mais jogadores esperando, ou cria uma nova.
            </p>
            <Button kind="primary" wide disabled={offline} onClick={() => net.send({ t: 'room:quick' })}>
              Encontrar partida
            </Button>
          </div>
          <div className="panel">
            <h3>Entrar com código</h3>
            <form
              className="row"
              style={{ flexWrap: 'nowrap' }}
              onSubmit={(e: Ev) => {
                e.preventDefault();
                if (code.trim().length < 4) return toast('Digite o código de 5 caracteres.', 'warn');
                net.send({ t: 'room:join', code: code.trim() });
              }}
            >
              <input className="input grow mono" placeholder="EX: K7QPM" maxLength={8} value={code} onChange={(e: { target: HTMLInputElement }) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '0.3em', textTransform: 'uppercase' }} />
              <Button type="submit" disabled={offline}>
                Entrar
              </Button>
            </form>
          </div>
          <div className="panel">
            <h3>Criar sala</h3>
            <div className="field">
              <label htmlFor="rn">Nome da sala</label>
              <input id="rn" className="input" maxLength={32} placeholder={`Sala de ${profile?.username ?? ''}`} value={name} onChange={(e: { target: HTMLInputElement }) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rm">Mapa</label>
              <select id="rm" className="input" value={map} onChange={(e: { target: HTMLSelectElement }) => setMap(e.target.value)}>
                {MAP_LIST.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Toggle value={pub} onChange={setPub} label={pub ? 'Pública (aparece na lista)' : 'Privada (só por código)'} />
            </div>
            <Button kind="primary" wide disabled={offline} onClick={() => net.send({ t: 'room:create', name, public: pub, map })}>
              Criar sala
            </Button>
          </div>
        </div>
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="row">
            <h3 className="grow" style={{ margin: 0 }}>
              Salas públicas
            </h3>
            <Button small disabled={offline} onClick={() => net.send({ t: 'room:list' })}>
              Atualizar
            </Button>
          </div>
          {rooms.length === 0 ? (
            <p className="muted">Nenhuma sala pública no momento. Crie uma ou use “Encontrar partida”.</p>
          ) : (
            <table className="list" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Sala</th>
                  <th>Mapa</th>
                  <th>Jogadores</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.code}>
                    <td>
                      {r.name} <span className="mono muted">#{r.code}</span>
                    </td>
                    <td>{MAP_LIST.find((m) => m.id === r.map)?.name ?? r.map}</td>
                    <td className="mono">
                      {r.players}/{r.max}
                    </td>
                    <td>{r.state === 'lobby' ? <span className="tag good">aguardando</span> : <span className="tag warn">em partida</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button small disabled={r.state !== 'lobby' || r.players >= r.max} onClick={() => net.send({ t: 'room:join', code: r.code })}>
                        Entrar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
