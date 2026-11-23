/**
 * Objetivos das partidas. Cada partida sorteia:
 *  - Fase 1: 2 tarefas entre energia, amostras, documentos e transmissores;
 *  - Fase 2: 1 tarefa entre comunicação e cartões de acesso;
 *  - Fase 3: evacuação em uma das cápsulas (sorteada).
 * Também são sorteados os pontos dos itens e quais estações ficam ativas,
 * e a quantidade exigida escala com o número de sobreviventes.
 */
import type { ItemKind } from '../shared/constants';
import type { MapDef, StationDef } from '../shared/map';
import type { TaskKind, TaskView } from '../shared/protocol';
import type { Rng } from '../shared/rng';

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  desc: string;
  stage: number;
  done: boolean;
  /** coleta e entrega */
  item?: ItemKind;
  deliverTo?: string;
  required: number;
  count: number;
  /** canalização em estações */
  stations: string[];
  channelTime: number;
  progress: Record<string, number>;
  doneStations: string[];
}

const STAGE1: TaskKind[] = ['energia', 'amostras', 'documentos', 'transmissores'];
const STAGE2: TaskKind[] = ['comunicacao', 'cartoes'];

export function buildTasks(rng: Rng, map: MapDef, nSurv: number): Task[] {
  const collectN = Math.max(2, Math.min(4, 2 + Math.floor(nSurv / 3)));
  const st = (kind: StationDef['kind']) => map.stations.filter((s) => s.kind === kind).map((s) => s.id);
  const tasks: Task[] = [];
  const mk = (kind: TaskKind, stage: number): Task => {
    const base = { id: `${kind}`, kind, stage, done: false, count: 0, progress: {}, doneStations: [], channelTime: 0, stations: [] as string[], required: 1, title: '', desc: '' };
    switch (kind) {
      case 'energia':
        return { ...base, title: 'Restaurar a energia', desc: `Encontre ${collectN} fusíveis e instale-os no painel do gerador (Sala de Energia).`, item: 'fusivel', deliverTo: 'gen', stations: ['gen'], required: collectN };
      case 'amostras':
        return { ...base, title: 'Coletar amostras biológicas', desc: `Leve ${collectN} amostras ao analisador do Laboratório.`, item: 'amostra', deliverTo: 'analyzer', stations: ['analyzer'], required: collectN };
      case 'documentos':
        return { ...base, title: 'Recuperar documentos secretos', desc: `Entregue ${collectN} documentos no terminal de arquivo (Centro de Controle).`, item: 'documento', deliverTo: 'archive', stations: ['archive'], required: collectN };
      case 'cartoes': {
        const n = Math.max(2, collectN - 1);
        return { ...base, title: 'Encontrar cartões de acesso', desc: `Leve ${n} cartões ao painel de segurança (Centro de Controle).`, item: 'cartao', deliverTo: 'secpanel', stations: ['secpanel'], required: n };
      }
      case 'transmissores': {
        const n = nSurv <= 2 ? 2 : 3;
        const chosen = rng.sample(st('tx'), n);
        return { ...base, title: 'Ativar transmissores', desc: `Ative ${n} transmissores espalhados pelo complexo (segure a interação).`, stations: chosen, required: n, channelTime: 8 };
      }
      case 'comunicacao': {
        const chosen = rng.sample(st('comm'), 2);
        return { ...base, title: 'Reativar as comunicações', desc: 'Opere 2 consoles de comunicação no Centro de Controle.', stations: chosen, required: 2, channelTime: 12 };
      }
      case 'evacuacao': {
        const pod = rng.pick(st('pod'));
        const name = map.stations.find((s) => s.id === pod)!.label;
        return { ...base, title: 'Preparar a evacuação', desc: `Prepare a ${name} e fuja pela doca.`, stations: [pod], required: 1, channelTime: 20 };
      }
    }
  };
  for (const k of rng.sample(STAGE1, 2)) tasks.push(mk(k, 1));
  tasks.push(mk(rng.pick(STAGE2), 2));
  tasks.push(mk('evacuacao', 3));
  return tasks;
}

export function taskView(t: Task, currentStage: number): TaskView {
  const progress = t.channelTime > 0 && t.required > 0 ? (t.doneStations.length + Object.entries(t.progress).filter(([s]) => !t.doneStations.includes(s)).reduce((a, [, v]) => a + Math.min(1, v / t.channelTime), 0)) / t.required : t.count / t.required;
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    desc: t.desc,
    stage: t.stage,
    done: t.done,
    progress: Math.min(1, progress),
    count: t.channelTime > 0 ? t.doneStations.length : t.count,
    required: t.required,
    stations: t.stations,
    doneStations: t.doneStations,
    item: t.item,
    active: t.stage === currentStage && !t.done,
  };
}
