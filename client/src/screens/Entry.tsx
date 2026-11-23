/** Tela inicial e tela de login/cadastro. */
import { useEffect, useState } from 'react';
import { audio } from '../game/audio';
import { ApiError } from '../net';
import { guest, login, register, restoreSession } from '../session';
import { go } from '../store';
import { Backdrop, Button, Tabs, Toggle, type Ev } from '../ui/kit';

export function TitleScreen() {
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    restoreSession().then((ok) => {
      if (!ok) setChecking(false);
    });
  }, []);
  const start = () => {
    audio.unlock();
    audio.ui('ok');
    go('auth');
  };
  useEffect(() => {
    if (checking) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') start();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [checking]);
  return (
    <div className="screen center" onClick={() => !checking && start()} style={{ cursor: checking ? 'default' : 'pointer' }}>
      <Backdrop />
      <div className="logo" style={{ position: 'relative' }}>
        <div className="title">VÉU</div>
        <div className="sub">ECOS DA RUPTURA</div>
      </div>
      <div style={{ position: 'relative', marginTop: 70, textAlign: 'center' }}>
        {checking ? (
          <div className="spinner" style={{ margin: '0 auto' }} />
        ) : (
          <div className="mono" style={{ letterSpacing: '0.35em', color: 'var(--muted)', animation: 'toastIn 1.6s ease-in-out infinite alternate' }}>
            CLIQUE OU PRESSIONE ENTER
          </div>
        )}
      </div>
      <div className="mono muted" style={{ position: 'absolute', bottom: 16, fontSize: 11, letterSpacing: '0.2em' }}>
        RECOMENDADO: FONES DE OUVIDO
      </div>
    </div>
  );
}

export function AuthScreen() {
  const [tab, setTab] = useState<'login' | 'cadastro' | 'convidado'>('login');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (tab === 'cadastro' && pass !== pass2) return setErr('As senhas não coincidem.');
    setBusy(true);
    try {
      if (tab === 'login') await login(user.trim(), pass, remember);
      else if (tab === 'cadastro') await register(user.trim(), pass, remember);
      else await guest(user.trim());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha inesperada.');
      audio.ui('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen center">
      <Backdrop />
      <div className="logo" style={{ position: 'relative', marginBottom: 26 }}>
        <div className="title" style={{ fontSize: 'clamp(44px, 9vw, 80px)' }}>
          VÉU
        </div>
        <div className="sub">ECOS DA RUPTURA</div>
      </div>
      <form
        className="panel"
        style={{ width: 'min(420px, 94vw)' }}
        onSubmit={(e: Ev) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Tabs
          value={tab}
          onChange={(t) => {
            setTab(t);
            setErr('');
          }}
          tabs={[
            ['login', 'Entrar'],
            ['cadastro', 'Criar conta'],
            ['convidado', 'Convidado'],
          ]}
        />
        <div className="field">
          <label htmlFor="u">{tab === 'convidado' ? 'Apelido (opcional)' : 'Nome de usuário'}</label>
          <input id="u" className="input" autoComplete="username" maxLength={16} value={user} onChange={(e: { target: HTMLInputElement }) => setUser(e.target.value)} autoFocus />
        </div>
        {tab !== 'convidado' && (
          <div className="field">
            <label htmlFor="p">Senha</label>
            <input id="p" className="input" type="password" autoComplete={tab === 'login' ? 'current-password' : 'new-password'} maxLength={128} value={pass} onChange={(e: { target: HTMLInputElement }) => setPass(e.target.value)} />
          </div>
        )}
        {tab === 'cadastro' && (
          <div className="field">
            <label htmlFor="p2">Confirmar senha</label>
            <input id="p2" className="input" type="password" autoComplete="new-password" maxLength={128} value={pass2} onChange={(e: { target: HTMLInputElement }) => setPass2(e.target.value)} />
            <span className="muted" style={{ fontSize: 12 }}>
              Mínimo de 8 caracteres. Nome: 3 a 16 caracteres.
            </span>
          </div>
        )}
        {tab === 'convidado' ? (
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Jogue sem cadastro. O progresso de convidados não é salvo após o servidor reiniciar.
          </p>
        ) : (
          <div style={{ margin: '4px 0 12px' }}>
            <Toggle value={remember} onChange={setRemember} label="Manter conectado neste dispositivo" />
          </div>
        )}
        <div className="error-text">{err}</div>
        <Button kind="primary" wide type="submit" disabled={busy || (tab !== 'convidado' && (!user || !pass))}>
          {busy ? 'Aguarde…' : tab === 'login' ? 'Entrar' : tab === 'cadastro' ? 'Criar conta' : 'Jogar como convidado'}
        </Button>
      </form>
    </div>
  );
}
