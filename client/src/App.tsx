/** Raiz da interface: escolhe a tela atual e exibe notificações. */
import { useEffect } from 'react';
import { audio } from './game/audio';
import { AuthScreen, TitleScreen } from './screens/Entry';
import { LobbyScreen } from './screens/Lobby';
import { MatchScreen } from './screens/Match';
import { MainMenu, PlayScreen } from './screens/Menu';
import { CollectionScreen, CustomizeScreen, HistoryScreen, ShopScreen, StatsScreen } from './screens/Profile';
import { ResultsScreen } from './screens/Results';
import { SettingsScreen } from './screens/Settings';
import { getSettings, subscribeSettings } from './settings';
import { useApp } from './store';

export function App() {
  const screen = useApp((s) => s.screen);
  const toasts = useApp((s) => s.toasts);
  useEffect(() => {
    const apply = () => {
      const s = getSettings();
      audio.setVolumes(s.master, s.music, s.sfx, s.voice);
      audio.setQuality(s.audioQuality === 'alta');
    };
    apply();
    const unlock = () => {
      audio.unlock();
      apply();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const off = subscribeSettings(apply);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      off();
    };
  }, []);
  let view;
  switch (screen) {
    case 'title':
      view = <TitleScreen />;
      break;
    case 'auth':
      view = <AuthScreen />;
      break;
    case 'menu':
      view = <MainMenu />;
      break;
    case 'play':
      view = <PlayScreen />;
      break;
    case 'lobby':
      view = <LobbyScreen />;
      break;
    case 'customize':
      view = <CustomizeScreen />;
      break;
    case 'shop':
      view = <ShopScreen />;
      break;
    case 'collection':
      view = <CollectionScreen />;
      break;
    case 'stats':
      view = <StatsScreen />;
      break;
    case 'history':
      view = <HistoryScreen />;
      break;
    case 'settings':
      view = <SettingsScreen />;
      break;
    case 'match':
      view = <MatchScreen />;
      break;
    case 'results':
      view = <ResultsScreen />;
      break;
  }
  return (
    <>
      {view}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
