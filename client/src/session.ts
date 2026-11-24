/** Sessão: login/logout, roteamento de mensagens do servidor e gerenciamento da voz. */
import type { Profile } from '../../shared/protocol';
import { audio } from './game/audio';
import { Voice } from './game/voice';
import { api, ApiError, loadToken, net, saveToken, type AuthResult } from './net';
import { getSettings, subscribeSettings } from './settings';
import { getState, go, setState, subscribe, toast } from './store';

export let voice: Voice | null = null;

export async function register(username: string, password: string, remember: boolean) {
  const r = await api<AuthResult>('/api/register', { username, password });
  startSession(r.token, r.profile, remember);
}
export async function login(username: string, password: string, remember: boolean) {
  const r = await api<AuthResult>('/api/login', { username, password });
  startSession(r.token, r.profile, remember);
}
export async function guest(name: string) {
  const r = await api<AuthResult>('/api/guest', { name: name || undefined });
  startSession(r.token, r.profile, false);
}

function startSession(token: string, profile: Profile, remember: boolean) {
  saveToken(token, remember);
  setState({ token, profile });
  net.connect(token);
  voice?.dispose();
  voice = new Voice(net, profile.id);
  voice.setPushToTalk(getSettings().pushToTalk);
  if (getSettings().micEnabled) void voice.enableMic();
  if (location.search.includes('debug')) (window as unknown as { __voice: Voice }).__voice = voice;
  go('menu');
}

export async function restoreSession(): Promise<boolean> {
  const token = loadToken();
  if (!token) return false;
  try {
    const r = await api<{ profile: Profile }>('/api/me', undefined, token);
    startSession(token, r.profile, !!localStorage.getItem('veu.token'));
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) saveToken(null, false);
    return false;
  }
}

export async function logout() {
  const token = getState().token;
  net.send({ t: 'room:leave' });
  try {
    if (token) await api('/api/logout', {}, token);
  } catch {
    /* servidor indisponível: encerra localmente mesmo assim */
  }
  net.close();
  voice?.dispose();
  voice = null;
  saveToken(null, false);
  setState({ token: null, profile: null, room: null, intro: null, results: null });
  go('auth');
}

export function setProfile(p: Profile) {
  setState({ profile: p });
}

/** Encaminha mensagens do servidor para o estado da aplicação. */
export function installRouter() {
  net.onStatus((s) => setState({ net: s }));
  net.on((m) => {
    const st = getState();
    switch (m.t) {
      case 'hello':
        setState({ profile: m.profile });
        break;
      case 'profile':
        setState({ profile: m.profile });
        break;
      case 'room':
        setState({ room: m.room });
        if (m.room && (st.screen === 'menu' || st.screen === 'play')) go('lobby');
        if (!m.room && st.screen === 'lobby') go('play');
        break;
      case 'rooms':
        setState({ rooms: m.list });
        break;
      case 'notice': {
        const n = m.n;
        setState({ notices: [...st.notices.slice(-30), n] });
        if (n.kind === 'friend_request') toast(`${n.from.username} quer ser seu amigo (veja em Amigos).`, 'info');
        else if (n.kind === 'friend_accept') toast(`${n.from.username} agora é seu amigo.`, 'good');
        else if (n.kind === 'invite') {
          setState({ invite: n });
          toast(`${n.from.username} convidou você para uma partida.`, 'info');
        }
        audio.ui('ok');
        break;
      }
      case 'match:load':
        setState({ intro: m.intro, matchStarted: false, results: null });
        go('match');
        break;
      case 'match:start':
        setState({ matchStarted: true });
        break;
      case 'match:end':
        setState({ results: m.results, intro: null, matchStarted: false });
        go('results');
        audio.ui(m.results.winner === (st.intro?.role === 'entity' ? 'entity' : 'survivors') ? 'ok' : 'error');
        break;
      case 'err':
        if (m.code === 'session') {
          toast(m.msg, 'error');
          saveToken(null, false);
          setState({ token: null, profile: null, room: null });
          go('auth');
        } else if (m.code === 'kicked') {
          toast(m.msg, 'warn');
          setState({ room: null });
          go('play');
        } else if (m.code !== 'bad_msg') toast(m.msg, 'error');
        break;
    }
  });
  // voz: lobby = todos da sala; partida = só sobreviventes (se eu for sobrevivente)
  const applyVoice = () => {
    if (!voice) return;
    const s = getState();
    const settings = getSettings();
    if (!settings.voiceEnabled || !s.room) return voice.setPeers([], { inMatch: false });
    if (s.intro && s.screen === 'match') {
      const me = s.intro.players.find((p) => p.id === s.intro!.you);
      if (me?.role !== 'survivor') return voice.setPeers([], { inMatch: true });
      return voice.setPeers(
        s.intro.players.filter((p) => p.role === 'survivor').map((p) => p.id),
        { inMatch: true },
      );
    }
    voice.setPeers(
      s.room.players.map((p) => p.id),
      { inMatch: false },
    );
  };
  subscribe(applyVoice);
  subscribeSettings(() => {
    applyVoice();
    voice?.setPushToTalk(getSettings().pushToTalk);
  });
}
