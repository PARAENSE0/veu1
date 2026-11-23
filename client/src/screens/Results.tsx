/** Tela de vitória/derrota com resultados calculados pelo servidor. */
import { ACHIEVEMENTS } from '../../../shared/progression';
import type { PlayerResult } from '../../../shared/protocol';
import { go, setState, useApp } from '../store';
import { Backdrop, Button, fmtTime } from '../ui/kit';

const OUT: Record<PlayerResult['outcome'], [string, string]> = {
  escaped: ['Fugiu', 'good'],
  dead: ['Eliminado', 'danger'],
  survived: ['Sobreviveu', 'warn'],
  disconnected: ['Desconectou', ''],
  entity: ['Entidade', 'danger'],
};

export function ResultsScreen() {
  const r = useApp((s) => s.results);
  const profile = useApp((s) => s.profile);
  const room = useApp((s) => s.room);
  if (!r || !profile) return null;
  const me = r.players.find((p) => p.id === profile.id);
  const myRole = me?.role ?? 'survivor';
  const won = (myRole === 'entity') === (r.winner === 'entity');
  const rw = r.rewards;
  const back = () => {
    setState({ results: null });
    go(room ? 'lobby' : 'menu');
  };
  return (
    <div className="screen">
      <Backdrop />
      <div style={{ position: 'relative', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        <div className={`result-head ${won ? 'win' : 'lose'}`}>{won ? 'VITÓRIA' : 'DERROTA'}</div>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 18 }}>{r.winner === 'survivors' ? 'Vitória dos sobreviventes.' : 'Vitória da entidade.'}</div>
          <div className="muted">
            {r.reason} · {r.escaped}/{r.needed} fugas necessárias · duração {fmtTime(r.duration)}
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="panel">
            <h3>Jogadores</h3>
            <table className="list">
              <tbody>
                {r.players
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((p) => (
                    <tr key={p.id} style={{ background: p.id === profile.id ? 'rgba(95,225,214,0.06)' : undefined }}>
                      <td>
                        <b>{p.name}</b> {p.role === 'entity' && <span className="tag danger">entidade</span>}
                      </td>
                      <td>
                        <span className={`tag ${OUT[p.outcome][1]}`}>{OUT[p.outcome][0]}</span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {p.score} pts
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <h3>Suas recompensas</h3>
            {rw ? (
              <>
                <div className="row">
                  <div className="stat grow">
                    <b>+{rw.xp}</b>
                    <span>experiência</span>
                  </div>
                  <div className="stat grow">
                    <b>+{rw.coins}</b>
                    <span>fragmentos ◈</span>
                  </div>
                </div>
                {rw.levelAfter > rw.levelBefore && (
                  <div className="tag good" style={{ marginTop: 10, fontSize: 13 }}>
                    Subiu para o nível {rw.levelAfter}! (+{(rw.levelAfter - rw.levelBefore) * 50} ◈)
                  </div>
                )}
                {rw.masteryXp > 0 && <div className="muted" style={{ marginTop: 8 }}>+{rw.masteryXp} de maestria do Reverberante</div>}
                {rw.achievements.map((a) => {
                  const ach = ACHIEVEMENTS.find((x) => x.id === a);
                  return (
                    <div key={a} className="ach" style={{ marginTop: 8 }}>
                      <div className="medal">★</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>Conquista: {ach?.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {ach?.desc} · +{ach?.coins} ◈
                        </div>
                      </div>
                    </div>
                  );
                })}
                {rw.seasonTiers.length > 0 && <div className="tag warn" style={{ marginTop: 8 }}>Temporada: nível(is) {rw.seasonTiers.join(', ')} alcançado(s)</div>}
              </>
            ) : (
              <p className="muted">Recompensas indisponíveis.</p>
            )}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <Button kind="primary" onClick={back}>
            {room ? 'Voltar ao lobby' : 'Voltar ao menu'}
          </Button>
          <Button onClick={() => go('history')}>Histórico</Button>
        </div>
      </div>
    </div>
  );
}
