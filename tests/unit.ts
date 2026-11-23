/** Testes unitários do núcleo compartilhado e do servidor (sem rede). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fairColor } from '../client/src/game/models';
import { buildTasks } from '../server/tasks';
import { FileStore } from '../server/store';
import { parseClientMsg } from '../server/validate';
import { CELL, PLAYER_RADIUS, SURV } from '../shared/constants';
import { getMap, T } from '../shared/map';
import { isSolid, lineOfSight, makeGrid, stepMove, type MoveState } from '../shared/physics';
import { DEFAULT_LOADOUT, levelFromXp, resolveAppearance } from '../shared/progression';
import { Rng } from '../shared/rng';

let pass = 0;
let fail = 0;
const check = (c: unknown, m: string) => {
  if (c) {
    pass++;
    console.log(`  ✔ ${m}`);
  } else {
    fail++;
    console.log(`  ✘ FALHOU: ${m}`);
  }
};

const map = getMap('abissal');
console.log('[mapa]');
check(map.stations.length === 16 && map.lockers.length >= 15 && map.doors.length >= 15, `estações (${map.stations.length}), armários (${map.lockers.length}) e portas (${map.doors.length})`);
check(map.zones.length === 12, 'oito áreas pedidas + corredores e docas (12 zonas)');
check(['laboratorio', 'controle', 'alojamentos', 'refeitorio', 'enfermaria', 'energia', 'tuneis', 'contencao'].every((z) => map.zones.some((x) => x.id === z)), 'todas as áreas do Complexo Abissal existem');
check(map.itemSpots.length >= 30, 'pontos de itens suficientes para sorteio');

console.log('[física]');
const mkState = (x: number, z: number): MoveState => ({ x, z, yaw: 0, pitch: 0, stamina: SURV.staminaMax, exhausted: false, regenDelay: 0, crouch: false, sprinting: false, speed: 0 });
const params = { walk: SURV.walk, sprint: SURV.sprint, crouch: SURV.crouch, mult: 1, radius: PLAYER_RADIUS, useStamina: true, canMove: true, canSprint: true };
const spawn = map.survivorSpawns[0][0];
const rng = new Rng(42);
const cmds = Array.from({ length: 3000 }, (_, i) => ({ seq: i, mx: rng.range(-1, 1), mz: rng.range(-0.3, 1), yaw: rng.range(-3, 3), pitch: 0, b: rng.next() < 0.5 ? 1 : 0 }));
const g1 = makeGrid(map);
const g2 = makeGrid(map);
const s1 = mkState(spawn.x, spawn.z);
const s2 = mkState(spawn.x, spawn.z);
let insideWall = 0;
for (const c of cmds) {
  stepMove(g1, s1, c, params);
  stepMove(g2, s2, c, params);
  // o centro nunca pode estar dentro de célula sólida
  if (isSolid(g1, Math.floor(s1.x / CELL), Math.floor(s1.z / CELL))) insideWall++;
}
check(s1.x === s2.x && s1.z === s2.z && s1.stamina === s2.stamina, 'movimento é determinístico (base da predição do cliente)');
check(insideWall === 0, 'caminhada aleatória de 3000 passos nunca atravessa paredes');
const st = mkState(spawn.x, spawn.z);
for (let i = 0; i < 300; i++) stepMove(g1, st, { seq: i, mx: 0, mz: 1, yaw: 0, pitch: 0, b: 1 }, params);
check(st.exhausted || st.stamina < SURV.staminaMax, 'corrida esgota o fôlego');
// linha de visão através de porta
const d = map.doors.find((x) => !x.secure && x.axis === 'x')!;
const a = { x: d.x, z: d.z - 3 };
const b = { x: d.x, z: d.z + 3 };
const g = makeGrid(map);
const blockedClosed = !lineOfSight(g, a.x, a.z, b.x, b.z);
g.doorOpen[d.idx] = 1;
const clearOpen = lineOfSight(g, a.x, a.z, b.x, b.z);
check(blockedClosed && clearOpen, 'porta fechada bloqueia a visão; aberta libera');
check(map.cells[d.idx] === T.DOOR, 'porta registrada no grid');

console.log('[objetivos]');
const combos = new Set<string>();
for (let seed = 1; seed <= 60; seed++) {
  const t = buildTasks(new Rng(seed), map, 4);
  combos.add(t.map((x) => x.kind + ':' + x.stations.join('/')).join('|'));
  if (t.length !== 4 || t[3].kind !== 'evacuacao' || t.filter((x) => x.stage === 1).length !== 2) {
    check(false, `estrutura de fases (semente ${seed})`);
    break;
  }
}
check(combos.size >= 20, `objetivos variam entre partidas (${combos.size} combinações em 60 sorteios)`);
check(buildTasks(new Rng(5), map, 8).find((x) => x.item)!.required >= buildTasks(new Rng(5), map, 1).find((x) => x.item)!.required, 'quantidade de itens escala com o número de sobreviventes');

console.log('[progressão e cosméticos]');
check(levelFromXp(0).level === 1 && levelFromXp(200).level === 2 && levelFromXp(10_000).level > 10, 'curva de níveis');
const ap = resolveAppearance({ ...DEFAULT_LOADOUT, uniforme: 'uni_mergulho' });
check(ap.stripe !== null && ap.boots && !ap.coat, 'uniforme substitui roupa e calçado');
const dark = fairColor([0.01, 0.01, 0.01]);
const light = fairColor([1, 1, 1]);
check(0.3 * dark[0] + 0.59 * dark[1] + 0.11 * dark[2] >= 0.21 && 0.3 * light[0] + 0.59 * light[1] + 0.11 * light[2] <= 0.83, 'roupas muito escuras/claras são equalizadas (sem vantagem no escuro)');

console.log('[validação]');
check(parseClientMsg('{"t":"in","cmds":[{"seq":1,"mx":0,"mz":1,"yaw":0,"pitch":0,"b":1}]}') !== null, 'comando válido aceito');
check(parseClientMsg('{"t":"in","cmds":[{"seq":1,"mx":0,"mz":50,"yaw":0,"pitch":0,"b":1}]}') === null, 'eixo fora do limite recusado');
check(parseClientMsg('{"t":"act","a":"teleport"}') === null, 'ação inexistente recusada');
check(parseClientMsg('não é json') === null, 'texto inválido recusado');
check(parseClientMsg(JSON.stringify({ t: 'room:chat', text: 'x'.repeat(500) })) === null, 'chat acima do limite recusado');

console.log('[persistência]');
const dir = mkdtempSync(join(tmpdir(), 'veu-unit-'));
const file = join(dir, 'db.json');
const store = new FileStore(file);
await store.init();
const base = { passHash: 'x', salt: 'y', createdAt: '', totalXp: 10, coins: 5, purchased: [], loadout: DEFAULT_LOADOUT, stats: {} as never, achievements: [], season: { id: 's1', xp: 0, claimed: [] }, masteryXp: 0, history: [] };
await store.createUser({ id: 'u1', username: 'Zé', usernameLower: 'zé', guest: false, ...base });
await store.createUser({ id: 'g1', username: 'Conv#1', usernameLower: 'conv#1', guest: true, ...base });
await store.createSession({ tokenHash: 'h', userId: 'u1', expires: Date.now() + 1000 });
await store.flush();
const store2 = new FileStore(file);
await store2.init();
check((await store2.getUserByName('zé'))?.totalXp === 10, 'conta sobrevive ao reinício do servidor');
check((await store2.getUser('g1')) === null, 'convidados não são gravados em disco');
check((await store2.getSession('h'))?.userId === 'u1', 'sessão persistida (apenas o hash do token)');
let dupErr = false;
try {
  await store2.createUser({ id: 'u2', username: 'ZÉ', usernameLower: 'zé', guest: false, ...base });
} catch {
  dupErr = true;
}
check(dupErr, 'nome duplicado recusado no armazenamento');
rmSync(dir, { recursive: true, force: true });

console.log(`\nResultado: ${pass} verificações aprovadas, ${fail} falhas.`);
process.exit(fail ? 1 : 0);
