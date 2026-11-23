/** Ponto de entrada do cliente. */
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installRouter, voice } from './session';
import { getSettings } from './settings';
import { getState } from './store';

installRouter();

// apertar-para-falar fora da partida (na partida o GameClient cuida disso)
window.addEventListener('keydown', (e) => {
  if (getState().screen !== 'match' && getSettings().pushToTalk && e.code === getSettings().bindings.falar && !(e.target instanceof HTMLInputElement)) voice?.setPtt(true);
});
window.addEventListener('keyup', (e) => {
  if (getState().screen !== 'match' && e.code === getSettings().bindings.falar) voice?.setPtt(false);
});

createRoot(document.getElementById('root')!).render(<App />);

// PWA: registra o service worker (exige HTTPS ou localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] service worker não registrado', e));
  });
}
