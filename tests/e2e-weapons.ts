/**
 * Teste ponta a ponta de armas e suprimentos (WebSocket real + servidor real).
 * Cobre: munição inicial, coleta, duas pessoas pegando a mesma caixa ao mesmo
 * tempo (sem duplicação), limite por jogador, sobra na caixa, reaparecimento
 * pelo servidor, tiro com dano, paredes bloqueando, cadência (antitrapaça),
 * recarga, fuzil automático, lança-chamas com combustível próprio e queimadura,
 * e destruição da entidade encerrando a partida com vitória dos sobreviventes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { ENTITY_HP_BASE, ENTITY_HP_PER_SURVIVOR, FLAMER, GUNS, supplyCap } from '../shared/constants';
import { cc, getMap } from '../shared/map';
import { PF, type ClientMsg, type GameEvent, type MatchResults, type ServerMsg, type Snapshot } from '../shared/protocol';

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const map = getMap('abissal');

class Bot {
  ws!: WebSocket;
  id = '';
  token = '';
  room: { code: string; players: { ready: boolean; host: boolean }[] } | null = null;
  role = '';
  started = false;
  snap: Snapshot | null = null;
  events: GameEvent[] = [];
  results: MatchResults | null = null;
  constructor(
    readonly name: string,
    readonly base: string,
  ) {}
  async connect() {
    const r = await fetch(this.base + '/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: this.name }) });
    const d = (await r.json()) as { token: string; profile: { id: string } };
    this.token = d.token;
    this.id = d.profile.id;
    this.ws = new WebSocket(this.base.replace('http', 'ws') + '/ws');
    await new Promise<void>((res) => (this.ws.onopen = () => res()));
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      if (m.t === 'room') this.room = m.room as never;
      if (m.t === 'match:load') {
        this.role = m.intro.role;
        this.send({ t: 'match:loaded' });
      }
      if (m.t === 'match:start') this.started = true;
      if (m.t === 'snap') this.snap = m.s;
      if (m.t === 'ev') this.events.push(...m.e);
      if (m.t === 'match:end') this.results = m.results;
    };
    this.send({ t: 'auth', token: this.token });
    await sleep(150);
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  async until(f: () => boolean, ms: number, what: string) {
    const t0 = Date.now();
    while (!f()) {
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + what);
      await sleep(20);
    }
  }
  interact() {
    this.send({ t: 'act', a: 'interact', on: true });
  }
  release() {
    this.send({ t: 'act', a: 'interact', on: false });
  }
  async click() {
    this.send({ t: 'act', a: 'fire', on: true });
    await sleep(30);
    this.send({ t: 'act', a: 'fire', on: false });
  }
}

const dir = mkdtempSync(join(tmpdir(), 'veu-wpn-'));
const app = await createApp({ port: 0, host: '127.0.0.1', dataFile: null, publicDir: dir, countdown: 0.2, supplyRespawn: 2, log: false });
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
try {
  const [a, b, c] = [new Bot('Ana', base), new Bot('Bia', base), new Bot('Caio', base)];
  for (const x of [a, b, c]) await x.connect();
  a.send({ t: 'room:create', name: 'armas', public: false, map: 'abissal' });
  await a.until(() => !!a.room, 2000, 'sala');
  for (const x of [b, c]) {
    x.send({ t: 'room:join', code: a.room!.code });
    x.send({ t: 'room:ready', ready: true });
  }
  c.send({ t: 'room:pref', pref: 'entity' });
  await a.until(() => a.room!.players.length === 3 && a.room!.players.every((p) => p.ready || p.host), 2000, 'prontos');
  await sleep(100);
  a.send({ t: 'room:start' });
  await Promise.all([a, b, c].map((x) => x.until(() => x.started && !!x.snap, 6000, 'início')));
  const m = app.rooms.rooms.get(a.room!.code)!.match!;
  const ent = [a, b, c].find((x) => x.role === 'entity')!;
  const [s1, s2] = [a, b, c].filter((x) => x !== ent);
  const st = () => m.debugState();
  const P = (bot: Bot) => st().players.find((p) => p.id === bot.id)!;

  console.log('[1] Estado inicial');
  check(ent === c, 'Caio (preferiu entidade) é a entidade');
  const p0 = P(s1);
  check(p0.mag.pistola === GUNS.pistola.startMag && p0.reserve.pistola === GUNS.pistola.startReserve && p0.mag.fuzil === 0 && p0.fuel === 0, 'sobrevivente começa com pistola carregada, fuzil e lança-chamas vazios');
  check(st().supplies.length === supplyCap(2), `caixas iniciais limitadas (${st().supplies.length} para 2 sobreviventes)`);
  check(st().supplies.every((s) => map.supplySpots.some((sp) => sp.x === s.x && sp.z === s.z)), 'caixas só surgem em pontos definidos do mapa');
  check(!st().supplies.some((s) => map.zones.find((z) => z.id.startsWith('doca') && s.x >= z.x0 * 2 && s.x <= (z.x1 + 1) * 2 && s.z >= z.z0 * 2 && s.z <= (z.z1 + 1) * 2)), 'nenhuma caixa nas docas de fuga');
  check(!!s1.snap!.you.wpn && !ent.snap!.you.wpn, 'munição aparece só para sobreviventes no snapshot');
  check(ent.snap!.eh[1] === ENTITY_HP_BASE + ENTITY_HP_PER_SURVIVOR * 2, `vida da entidade escala com a equipe (${ent.snap!.eh[1]})`);

  console.log('[2] Coleta simultânea (antiduplicação)');
  const X = cc(20);
  const Z = cc(6);
  const crateA = m.debugAddSupply('mun_fuzil', X, Z);
  m.debugSet(s1.id, { x: X - 1, z: Z, yaw: -Math.PI / 2, pitch: 0 });
  m.debugSet(s2.id, { x: X + 1, z: Z, yaw: Math.PI / 2, pitch: 0 });
  await sleep(100);
  s1.interact();
  s2.interact();
  await sleep(1300);
  s1.release();
  s2.release();
  const r1 = P(s1).reserve.fuzil;
  const r2 = P(s2).reserve.fuzil;
  check(r1 + r2 === 30 && (r1 === 0 || r2 === 0), `apenas um jogador recebeu a caixa (Ana ${r1}, Bia ${r2})`);
  check(!st().supplies.some((s) => s.id === crateA), 'caixa coletada some para todos');
  check(s1.events.some((e) => e.k === 'supply' && e.id === crateA) && s2.events.some((e) => e.k === 'supply' && e.id === crateA), 'coleta sincronizada para os jogadores próximos');
  const winner = r1 > 0 ? s1 : s2;
  const loser = winner === s1 ? s2 : s1;

  console.log('[3] Limite de munição e sobra na caixa');
  m.debugSet(winner.id, { reserve: { fuzil: 80 } });
  const crateB = m.debugAddSupply('mun_fuzil', X, Z);
  winner.interact();
  await sleep(1100);
  winner.release();
  check(P(winner).reserve.fuzil === GUNS.fuzil.maxReserve, `reserva para no limite (${GUNS.fuzil.maxReserve})`);
  check(st().supplies.find((s) => s.id === crateB)?.amount === 20, 'o que não coube continua na caixa (20)');
  winner.interact();
  await sleep(1100);
  winner.release();
  check(P(winner).reserve.fuzil === GUNS.fuzil.maxReserve && st().supplies.find((s) => s.id === crateB)?.amount === 20, 'no limite, não coleta mais');
  loser.interact();
  await sleep(1100);
  loser.release();
  check(!st().supplies.some((s) => s.id === crateB) && P(loser).reserve.fuzil === 20, 'outro jogador pega o restante');

  console.log('[4] Reaparecimento controlado pelo servidor');
  const before = st().supplies.length;
  const queueBefore = st().supplyRespawnAt.length;
  const target = st().supplies[0];
  m.debugSet(s2.id, { x: target.x, z: target.z, yaw: 0 });
  m.debugSet(s2.id, { reserve: { pistola: 0, fuzil: 0 }, fuel: 0 });
  await sleep(100);
  s2.interact();
  await sleep(1100);
  s2.release();
  check(st().supplies.length === before - 1 && st().supplyRespawnAt.length === queueBefore + 1, 'caixa coletada entra na fila de reposição');
  await sleep(2600);
  const after = st().supplies;
  check(after.length === before, 'nova caixa reaparece após o tempo de reposição');
  const newest = after.reduce((x, y) => (Number(x.id.slice(1)) > Number(y.id.slice(1)) ? x : y));
  check(Math.hypot(newest.x - P(s2).x, newest.z - P(s2).z) >= 15, 'reposição longe dos sobreviventes (sem "nascer" na frente de ninguém)');

  console.log('[5] Pistola: dano, cadência, recarga, paredes');
  const CZ = cc(11);
  m.debugSet(s1.id, { x: cc(10), z: CZ, yaw: -Math.PI / 2, pitch: 0, weapon: 'pistola', mag: { pistola: 8 }, reserve: { pistola: 8 } });
  m.debugSet(ent.id, { x: cc(10) + 8, z: CZ });
  await sleep(150);
  const hp0 = P(ent).hp;
  for (let i = 0; i < 8; i++) {
    await s1.click();
    await sleep(420);
  }
  await sleep(200);
  const hp1 = P(ent).hp;
  check(Math.abs(hp0 - hp1 - 8 * GUNS.pistola.damage) < 1, `8 tiros a 8 m = ${hp0 - hp1} de dano (esperado ${8 * GUNS.pistola.damage})`);
  check(s1.events.filter((e) => e.k === 'shot' && e.hit).length >= 8 && ent.events.some((e) => e.k === 'enthit'), 'disparos e acertos são transmitidos aos jogadores');
  check(ent.events.some((e) => e.k === 'ping' && e.kind === 'tiro'), 'tiros fazem barulho que a entidade percebe');
  await sleep(1800);
  check(P(s1).mag.pistola === 8 && P(s1).reserve.pistola === 0, 'pente vazio recarrega automaticamente usando a reserva');
  // cadência: 30 cliques em ~0,6 s
  const magBefore = P(s1).mag.pistola;
  for (let i = 0; i < 30; i++) {
    s1.send({ t: 'act', a: 'fire', on: true });
    s1.send({ t: 'act', a: 'fire', on: false });
    await sleep(20);
  }
  await sleep(300);
  check(magBefore - P(s1).mag.pistola <= 3, `cadência respeitada mesmo com cliques em excesso (${magBefore - P(s1).mag.pistola} disparos)`);
  // parede no caminho
  await sleep(500);
  m.debugSet(s1.id, { x: cc(7), z: CZ, yaw: 0, pitch: 0, mag: { pistola: 8 } });
  m.debugSet(ent.id, { x: cc(7), z: cc(8) });
  await sleep(150);
  const hpWall = P(ent).hp;
  for (let i = 0; i < 3; i++) {
    await s1.click();
    await sleep(420);
  }
  check(P(ent).hp >= hpWall, 'paredes bloqueiam os tiros');

  console.log('[6] Fuzil automático');
  s1.send({ t: 'act', a: 'weapon', slot: 1 });
  m.debugSet(s1.id, { x: cc(10), z: CZ, yaw: -Math.PI / 2, pitch: 0, mag: { fuzil: 30 }, reserve: { fuzil: 0 } });
  m.debugSet(ent.id, { x: cc(10) + 8, z: CZ });
  await sleep(500);
  const hpR = P(ent).hp;
  s1.send({ t: 'act', a: 'fire', on: true });
  await sleep(1000);
  s1.send({ t: 'act', a: 'fire', on: false });
  await sleep(150);
  const shots = 30 - P(s1).mag.fuzil;
  check(P(s1).weapon === 'fuzil' && shots >= 7 && shots <= 11, `segurar o gatilho dispara em sequência (${shots} tiros em 1 s; cadência máx. 10/s)`);
  check(hpR - P(ent).hp > 0 && hpR - P(ent).hp <= shots * GUNS.fuzil.damage + 1, `fuzil causa dano (${Math.round(hpR - P(ent).hp)})`);

  console.log('[7] Lança-chamas com combustível próprio');
  s1.send({ t: 'act', a: 'weapon', slot: 2 });
  m.debugSet(s1.id, { fuel: 0 });
  m.debugSet(ent.id, { x: cc(10) + 3, z: CZ });
  await sleep(500);
  s1.events = [];
  const hpF0 = P(ent).hp;
  s1.send({ t: 'act', a: 'fire', on: true });
  await sleep(400);
  s1.send({ t: 'act', a: 'fire', on: false });
  check(P(ent).hp >= hpF0 && s1.events.some((e) => e.k === 'sound' && e.s === 'vazio'), 'sem combustível não dispara (clique vazio)');
  check(P(s1).reserve.fuzil === 0 && P(s1).mag.fuzil < 30, 'lança-chamas não usa munição das outras armas');
  m.debugSet(s1.id, { fuel: 50 });
  await sleep(100);
  const hpF1 = P(ent).hp;
  s1.send({ t: 'act', a: 'fire', on: true });
  await sleep(1000);
  const burning = (ent.snap!.pl.find((p) => p[0] === ent.id)![5] & PF.BURNING) !== 0;
  s1.send({ t: 'act', a: 'fire', on: false });
  await sleep(100);
  const fuelUsed = 50 - P(s1).fuel;
  check(Math.abs(fuelUsed - FLAMER.fuelPerSec) < 2.5, `consome ~${FLAMER.fuelPerSec}/s de combustível (${fuelUsed.toFixed(1)})`);
  check(hpF1 - P(ent).hp > 40, `chamas causam dano (${Math.round(hpF1 - P(ent).hp)})`);
  check(burning, 'entidade fica em chamas (dano contínuo)');

  console.log('[8] Destruição da entidade');
  s1.send({ t: 'act', a: 'weapon', slot: 0 });
  m.debugSet(s1.id, { mag: { pistola: 8 } });
  m.debugSet(ent.id, { x: cc(10) + 6, z: CZ, hp: 30, burnUntil: 0 } as never);
  await sleep(500);
  await s1.click();
  await a.until(() => !!a.results, 3000, 'fim da partida');
  const res = a.results!;
  check(res.winner === 'survivors' && res.reason.includes('destruída'), `entidade destruída: vitória dos sobreviventes ("${res.reason}")`);
  check(s2.events.some((e) => e.k === 'entdeath'), 'todos são avisados da destruição');
  check(res.players.find((p) => p.id === s1.id)!.score > res.players.find((p) => p.id === s2.id)!.score, 'quem causou mais dano pontua mais');
  for (const x of [a, b, c]) x.ws.close();
} catch (e) {
  fail++;
  console.error('ERRO:', e);
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nResultado: ${pass} verificações aprovadas, ${fail} falhas.`);
process.exit(fail ? 1 : 0);
