/**
 * Teste ponta a ponta do servidor com bots reais via WebSocket.
 *
 * Cobre: cadastro/login, criação de sala, entrada por código, lista pública,
 * seleção da entidade, contagem, carregamento, partida completa com objetivos,
 * ataque/queda/resgate, habilidades da entidade, fuga, vitória dos
 * sobreviventes, retorno ao lobby, revanche com vitória da entidade,
 * reconexão no meio da partida, espectador, colapso por tempo, recompensas e
 * proteções antitrapaça (speedhack, mensagens inválidas, ações indevidas).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type App } from '../server/app';
import { CELL, ENT, SURV } from '../shared/constants';
import { cc, getMap, T } from '../shared/map';
import type { ClientMsg, GameEvent, MatchIntro, MatchResults, Profile, RoomInfo, ServerMsg, Snapshot } from '../shared/protocol';

const map = getMap('abissal');
let failures = 0;
let passes = 0;
function check(cond: unknown, msg: string) {
  if (cond) {
    passes++;
    console.log(`  ✔ ${msg}`);
  } else {
    failures++;
    console.log(`  ✘ FALHOU: ${msg}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ cliente de teste
class Bot {
  ws!: WebSocket;
  token = '';
  profile!: Profile;
  room: RoomInfo | null = null;
  intro: MatchIntro | null = null;
  snap: Snapshot | null = null;
  results: MatchResults | null = null;
  started = false;
  events: GameEvent[] = [];
  errors: string[] = [];
  seq = 0;
  inbox: ServerMsg[] = [];
  // estado do "cérebro"
  holding = false;
  pulse = 0;
  constructor(
    readonly name: string,
    readonly base: string,
  ) {}
  get id() {
    return this.profile.id;
  }
  async api(path: string, body?: unknown, token = this.token) {
    const r = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: (await r.json()) as any };
  }
  async register(password = 'senha-forte-123') {
    const r = await this.api('/api/register', { username: this.name, password });
    if (r.status !== 200) throw new Error(`cadastro falhou: ${JSON.stringify(r.data)}`);
    this.token = r.data.token;
    this.profile = r.data.profile;
  }
  async connect() {
    this.ws = new WebSocket(this.base.replace('http', 'ws') + '/ws');
    await new Promise<void>((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws error'));
    });
    this.ws.onmessage = (ev) => this.onMsg(JSON.parse(String(ev.data)) as ServerMsg);
    this.send({ t: 'auth', token: this.token });
    await this.until(() => this.inbox.some((m) => m.t === 'hello'), 3000, 'hello');
  }
  onMsg(m: ServerMsg) {
    this.inbox.push(m);
    if (this.inbox.length > 200) this.inbox.splice(0, 100);
    switch (m.t) {
      case 'hello':
      case 'profile':
        this.profile = m.profile;
        break;
      case 'room':
        this.room = m.room;
        break;
      case 'match:load':
        this.intro = m.intro;
        this.started = false;
        this.results = null;
        this.snap = null;
        this.send({ t: 'match:loaded' });
        break;
      case 'match:start':
        this.started = true;
        break;
      case 'snap':
        this.snap = m.s;
        break;
      case 'ev':
        this.events.push(...m.e);
        break;
      case 'match:end':
        this.results = m.results;
        this.started = false;
        break;
      case 'err':
        this.errors.push(m.code + ':' + m.msg);
        break;
    }
  }
  send(m: ClientMsg | Record<string, unknown>) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  async until(pred: () => boolean, ms: number, what: string) {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`timeout esperando: ${what} (${this.name})`);
      await sleep(20);
    }
  }
  cmd(mx: number, mz: number, yaw: number, b = 0) {
    this.send({ t: 'in', cmds: [{ seq: ++this.seq, mx, mz, yaw, pitch: 0, b }] });
  }
}

// ------------------------------------------------------------------ navegação (BFS no grid)
function cellOf(x: number, z: number): [number, number] {
  return [Math.floor(x / CELL), Math.floor(z / CELL)];
}
function bfs(from: [number, number], goal: (cx: number, cz: number) => boolean, openDoors: Set<number>): [number, number][] | null {
  const w = map.w;
  const start = from[1] * w + from[0];
  const prev = new Int32Array(w * map.h).fill(-2);
  prev[start] = -1;
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % w;
    const z = (i / w) | 0;
    if (goal(x, z)) {
      const path: [number, number][] = [];
      for (let j = i; j !== -1; j = prev[j]) path.unshift([j % w, (j / w) | 0]);
      return path;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      const j = nz * w + nx;
      if (nx < 0 || nz < 0 || nx >= w || nz >= map.h || prev[j] !== -2) continue;
      const t = map.cells[j];
      const ok = t === T.FLOOR || t === T.DOOR || (t === T.SECDOOR && openDoors.has(j));
      if (!ok) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  return null;
}
const doorPulse = new Map<number, number>();
const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));

/** Move o bot um passo em direção ao objetivo. Retorna true quando chegou. */
function steer(bot: Bot, goal: (cx: number, cz: number) => boolean, sprint = true, radius = 0.35): boolean {
  const s = bot.snap!;
  const me = s.you;
  const open = new Set(s.doors);
  const path = bfs(cellOf(me.x, me.z), goal, open);
  if (!path) {
    bot.cmd(0, 0, 0);
    return false;
  }
  if (path.length === 1) return true;
  const [nx, nz] = path[1];
  const idx = nz * map.w + nx;
  const yaw = yawTo(me.x, me.z, cc(nx), cc(nz));
  if (map.cells[idx] === T.DOOR && !open.has(idx)) {
    // porta fechada: encara e interage (pulso)
    // aproxima-se da porta e interage; evita que dois bots alternem a mesma porta
    const dd = Math.hypot(cc(nx) - me.x, cc(nz) - me.z);
    bot.cmd(0, dd > 1.6 ? 0.6 : 0, yaw);
    const now = Date.now();
    if (dd <= 1.9 && now - (doorPulse.get(idx) ?? 0) > 700) {
      doorPulse.set(idx, now);
      bot.send({ t: 'act', a: 'interact', on: true });
      bot.send({ t: 'act', a: 'interact', on: false });
    }
    return false;
  }
  // corta caminho para o centro da célula seguinte; corrige quando está desalinhado
  let tx = cc(nx);
  let tz = cc(nz);
  if (path.length > 2) {
    const [ax, az] = path[2];
    if (ax !== nx && az !== nz) {
      tx = cc(nx);
      tz = cc(nz);
    }
  }
  void radius;
  bot.cmd(0, 1, yawTo(me.x, me.z, tx, tz), sprint && me.stamina > 20 ? 1 : 0);
  return false;
}

function adjacentTo(cx: number, cz: number) {
  return (x: number, z: number) => Math.abs(x - cx) + Math.abs(z - cz) === 1 && map.cells[z * map.w + x] === T.FLOOR;
}

// ------------------------------------------------------------------ cérebro dos bots
type Plan = { kind: 'item'; itemId: string; x: number; z: number } | { kind: 'deliver'; station: string } | { kind: 'channel'; station: string } | { kind: 'exit'; pod: string } | { kind: 'revive'; target: string } | { kind: 'idle' };

function survivorPlan(bot: Bot, app: App, roomCode: string, claimed: Set<string>): Plan {
  const s = bot.snap!;
  const room = app.rooms.rooms.get(roomCode)!;
  const dbg = room.match!.debugState();
  const me = s.you;
  // resgatar caído
  const downed = dbg.players.find((p) => p.status === 'downed' && p.id !== bot.id);
  if (downed && !claimed.has('revive:' + downed.id)) {
    claimed.add('revive:' + downed.id);
    return { kind: 'revive', target: downed.id };
  }
  if (s.pods.length) return { kind: 'exit', pod: s.pods[0] };
  const active = s.tasks.filter((t) => t.active);
  for (const t of active) {
    if (t.item && me.inv.includes(t.item)) return { kind: 'deliver', station: t.stations[0] };
  }
  // itens necessários (com reserva global para não duplicar)
  for (const t of active) {
    if (!t.item) continue;
    const carried = [bot, ...allBots].filter((b) => b.snap).reduce((a, b) => a + b.snap!.you.inv.filter((k) => k === t.item).length, 0);
    if (t.count + carried >= t.required) continue;
    const cands = dbg.items.filter((i) => i.kind === t.item && !claimed.has(i.id));
    cands.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    if (cands.length) {
      claimed.add(cands[0].id);
      return { kind: 'item', itemId: cands[0].id, x: cands[0].x, z: cands[0].z };
    }
  }
  for (const t of active) {
    if (t.item) continue;
    const left = t.stations.filter((st) => !t.doneStations.includes(st) && !claimed.has('st:' + st));
    if (left.length) {
      claimed.add('st:' + left[0]);
      return { kind: 'channel', station: left[0] };
    }
    const any = t.stations.find((st) => !t.doneStations.includes(st));
    if (any) return { kind: 'channel', station: any };
  }
  return { kind: 'idle' };
}

let allBots: Bot[] = [];

function runSurvivor(bot: Bot, plan: Plan, app: App, roomCode: string): 'continue' | 'done' {
  const s = bot.snap!;
  const me = s.you;
  if (me.st !== 'alive') return 'done';
  const room = app.rooms.rooms.get(roomCode)!;
  const dbg = room.match?.debugState();
  if (!dbg) return 'done';
  switch (plan.kind) {
    case 'idle':
      bot.cmd(0, 0, 0);
      return 'done';
    case 'item': {
      const it = dbg.items.find((i) => i.id === plan.itemId);
      if (!it) return 'done';
      const [icx, icz] = cellOf(it.x, it.z);
      const d = Math.hypot(it.x - me.x, it.z - me.z);
      if (d < 1.3) {
        bot.cmd(0, 0, yawTo(me.x, me.z, it.x, it.z));
        if (bot.pulse++ % 6 === 0) {
          bot.send({ t: 'act', a: 'interact', on: true });
          bot.send({ t: 'act', a: 'interact', on: false });
        }
        return 'continue';
      }
      if (steer(bot, (x, z) => x === icx && z === icz)) bot.cmd(0, 1, yawTo(me.x, me.z, it.x, it.z));
      return 'continue';
    }
    case 'deliver': {
      const st = map.stations.find((x) => x.id === plan.station)!;
      if (steer(bot, adjacentTo(st.cx, st.cz))) {
        if (Math.hypot(st.x - me.x, st.z - me.z) > 1.75) {
          bot.cmd(0, 0.5, yawTo(me.x, me.z, st.x, st.z));
          return 'continue';
        }
        bot.cmd(0, 0, yawTo(me.x, me.z, st.x, st.z));
        bot.send({ t: 'act', a: 'interact', on: true });
        bot.send({ t: 'act', a: 'interact', on: false });
        return 'done';
      }
      return 'continue';
    }
    case 'channel': {
      const st = map.stations.find((x) => x.id === plan.station)!;
      const task = s.tasks.find((t) => t.stations.includes(plan.station));
      if (!task || task.doneStations.includes(plan.station) || !task.active) {
        if (bot.holding) bot.send({ t: 'act', a: 'interact', on: false });
        bot.holding = false;
        return 'done';
      }
      if (steer(bot, adjacentTo(st.cx, st.cz))) {
        if (Math.hypot(st.x - me.x, st.z - me.z) > 1.75) {
          bot.cmd(0, 0.5, yawTo(me.x, me.z, st.x, st.z));
          return 'continue';
        }
        bot.cmd(0, 0, yawTo(me.x, me.z, st.x, st.z));
        if (!me.ch) {
          bot.send({ t: 'act', a: 'interact', on: false });
          bot.send({ t: 'act', a: 'interact', on: true });
          bot.holding = true;
        }
      }
      return 'continue';
    }
    case 'revive': {
      const t = dbg.players.find((p) => p.id === plan.target);
      if (!t || t.status !== 'downed') {
        bot.send({ t: 'act', a: 'interact', on: false });
        return 'done';
      }
      const d = Math.hypot(t.x - me.x, t.z - me.z);
      if (d < 1.4) {
        bot.cmd(0, 0, yawTo(me.x, me.z, t.x, t.z));
        if (!me.ch) {
          bot.send({ t: 'act', a: 'interact', on: false });
          bot.send({ t: 'act', a: 'interact', on: true });
        }
        return 'continue';
      }
      const [tcx, tcz] = cellOf(t.x, t.z);
      if (steer(bot, (x, z) => x === tcx && z === tcz)) bot.cmd(0, 1, yawTo(me.x, me.z, t.x, t.z));
      return 'continue';
    }
    case 'exit': {
      const r = map.exits[plan.pod];
      steer(bot, (x, z) => x * CELL >= r.x0 && (x + 1) * CELL <= r.x1 && z * CELL >= r.z0 && (z + 1) * CELL <= r.z1);
      return 'continue';
    }
  }
}

/** Entidade: persegue um alvo e ataca quando está perto. */
function runEntityHunt(bot: Bot, app: App, roomCode: string, targetId?: string, finish = true): boolean {
  const s = bot.snap!;
  const me = s.you;
  const dbg = app.rooms.rooms.get(roomCode)!.match!.debugState();
  const targets = dbg.players.filter((p) => p.role === 'survivor' && (p.status === 'alive' || (finish && p.status === 'downed')) && !p.hidden && (!targetId || p.id === targetId));
  if (!targets.length) {
    bot.cmd(0, 0, 0);
    return false;
  }
  targets.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
  const t = targets[0];
  const d = Math.hypot(t.x - me.x, t.z - me.z);
  const yaw = yawTo(me.x, me.z, t.x, t.z);
  if (d < 1.9) {
    bot.cmd(0, 0.3, yaw);
    if ((me.atk ?? 0) <= 0 && bot.pulse++ % 3 === 0) bot.send({ t: 'act', a: 'attack' });
    return true;
  }
  const [tcx, tcz] = cellOf(t.x, t.z);
  if (steer(bot, (x, z) => x === tcx && z === tcz, false)) bot.cmd(0, 1, yaw);
  return true;
}

// ------------------------------------------------------------------ cenário
async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'veu-test-'));
  const app = await createApp({ port: 0, host: '127.0.0.1', dataFile: join(dir, 'db.json'), publicDir: dir, countdown: 0.3, log: false });
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`servidor de teste em ${base}`);

  try {
    // ---------------- contas
    console.log('\n[1] Contas e autenticação');
    const alice = new Bot('alice', base);
    const bruno = new Bot('bruno', base);
    const carla = new Bot('carla', base);
    const davi = new Bot('davi', base);
    allBots = [alice, bruno, carla, davi];
    for (const b of allBots) await b.register();
    check(alice.profile.level === 1 && alice.profile.coins === 150, 'perfil inicial: nível 1 e 150 fragmentos');
    const dup = await alice.api('/api/register', { username: 'ALICE', password: 'outra-senha-1' }, '');
    check(dup.status === 400 && dup.data.error === 'username_taken', 'nome duplicado (sem diferenciar maiúsculas) é recusado');
    const bad = await alice.api('/api/login', { username: 'alice', password: 'errada-000' }, '');
    check(bad.status === 400 && bad.data.error === 'bad_credentials', 'senha errada é recusada');
    const ok = await alice.api('/api/login', { username: 'alice', password: 'senha-forte-123' }, '');
    check(ok.status === 200 && typeof ok.data.token === 'string', 'login correto devolve token');
    const unauth = await alice.api('/api/me', undefined, 'token-invalido-xxxxxxxxxxxxxx');
    check(unauth.status === 401, 'token inválido recebe 401');
    const guest = await alice.api('/api/guest', { name: 'Visitante' }, '');
    check(guest.status === 200 && guest.data.profile.guest === true && guest.data.profile.username.startsWith('Visitante#'), 'login como convidado');
    const shortPw = await alice.api('/api/register', { username: 'zeca', password: '123' }, '');
    check(shortPw.status === 400, 'senha curta é recusada');

    for (const b of allBots) await b.connect();

    // ---------------- salas
    console.log('\n[2] Salas, código e lobby');
    alice.send({ t: 'room:create', name: 'Teste <b>Abissal</b>', public: true, map: 'abissal' });
    await alice.until(() => !!alice.room, 2000, 'sala criada');
    const code = alice.room!.code;
    check(/^[A-Z2-9]{5}$/.test(code), `código de convite gerado (${code})`);
    bruno.send({ t: 'room:join', code: 'ZZZZZ' });
    await bruno.until(() => bruno.errors.length > 0, 2000, 'erro de código');
    check(bruno.errors[0].startsWith('room:'), 'código inexistente retorna erro');
    bruno.send({ t: 'room:list' });
    await bruno.until(() => bruno.inbox.some((m) => m.t === 'rooms'), 2000, 'lista');
    const list = bruno.inbox.find((m) => m.t === 'rooms') as Extract<ServerMsg, { t: 'rooms' }>;
    check(list.list.some((r) => r.code === code), 'sala pública aparece em "Encontrar partida"');
    for (const b of [bruno, carla, davi]) b.send({ t: 'room:join', code: code.toLowerCase() });
    await alice.until(() => alice.room?.players.length === 4, 2000, '4 jogadores na sala');
    check(alice.room!.players.length === 4, 'quatro jogadores entraram pelo código');
    check(alice.room!.hostId === alice.id, 'criador é o anfitrião');
    bruno.send({ t: 'room:start' });
    await bruno.until(() => bruno.errors.some((e) => e.includes('anfitrião')), 2000, 'não-anfitrião não inicia');
    check(true, 'apenas o anfitrião pode iniciar');
    alice.send({ t: 'room:start' });
    await alice.until(() => alice.errors.some((e) => e.includes('Aguardando')), 2000, 'precisa de prontos');
    check(true, 'início exige que todos estejam prontos');
    carla.send({ t: 'room:chat', text: 'olá\u0000 equipe' });
    await alice.until(() => alice.room!.chat.some((c) => c.from === 'carla'), 2000, 'chat');
    check(alice.room!.chat.find((c) => c.from === 'carla')!.text === 'olá equipe', 'chat do lobby sanitiza caracteres de controle');
    bruno.send({ t: 'room:pref', pref: 'entity' });
    for (const b of [bruno, carla, davi]) b.send({ t: 'room:ready', ready: true });
    await alice.until(() => alice.room!.players.filter((p) => p.ready).length === 3, 2000, 'prontos');
    // mensagem inválida
    alice.send({ t: 'room:join', code: 123 });
    await alice.until(() => alice.errors.some((e) => e.startsWith('bad_msg')), 2000, 'msg inválida');
    check(true, 'mensagem malformada é rejeitada pela validação');

    // ---------------- partida 1
    console.log('\n[3] Partida 1: distribuição de funções e carregamento');
    alice.send({ t: 'room:start' });
    await Promise.all(allBots.map((b) => b.until(() => b.started, 8000, 'match:start')));
    check(bruno.intro!.role === 'entity', 'jogador que pediu "Entidade" foi escolhido como entidade');
    check(allBots.filter((b) => b.intro!.role === 'entity').length === 1, 'exatamente uma entidade');
    check(alice.intro!.role === 'survivor' && alice.intro!.players.length === 4, 'demais são sobreviventes');
    await alice.until(() => !!alice.snap, 2000, 'snapshot');
    const tasks = alice.snap!.tasks;
    check(tasks.filter((t) => t.stage === 1).length === 2 && tasks.every((t) => t.stage === 1), 'fase 1 com 2 objetivos sorteados (fases futuras ocultas)');
    check(!bruno.snap || bruno.snap.you.cd !== undefined, 'entidade recebe recargas das habilidades');

    // antitrapaça: sobrevivente tenta atacar / speedhack
    console.log('\n[4] Antitrapaça');
    const room = app.rooms.rooms.get(code)!;
    const m = room.match!;
    const p0 = m.debugState().players.find((p) => p.id === alice.id)!;
    alice.send({ t: 'act', a: 'attack' });
    alice.send({ t: 'act', a: 'ability', id: 'ruptura' });
    // speedhack: envia 4x mais comandos que o permitido durante 1,5 s (corrida em linha reta)
    const t0 = Date.now();
    const yaw0 = Math.PI / 2; // anda para -X
    let hackSeq = alice.seq;
    while (Date.now() - t0 < 1500) {
      const cmds = [];
      for (let i = 0; i < 4; i++) cmds.push({ seq: ++hackSeq, mx: 0, mz: 1, yaw: yaw0, pitch: 0, b: 1 });
      alice.send({ t: 'in', cmds });
      await sleep(1000 / 30);
    }
    alice.seq = hackSeq;
    await sleep(400);
    const p1 = m.debugState().players.find((p) => p.id === alice.id)!;
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const maxLegit = SURV.sprint * 1.3 * (1.5 + 0.5) + 0.5;
    check(moved <= maxLegit, `speedhack limitado: moveu ${moved.toFixed(2)} m (máx. legítimo ≈ ${maxLegit.toFixed(1)} m)`);
    check(p1.hp === SURV.hpMax, 'sobrevivente não consegue usar ataque/habilidade da entidade');
    // entidade ataca de longe: nada acontece
    bruno.send({ t: 'act', a: 'attack' });
    await sleep(600);
    check(m.debugState().players.filter((p) => p.role === 'survivor').every((p) => p.hp === SURV.hpMax), 'ataque fora de alcance não causa dano');

    // ---------------- habilidades
    console.log('\n[5] Habilidades da entidade');
    const before = bruno.events.length;
    bruno.send({ t: 'act', a: 'ability', id: 'rastro' });
    await sleep(300);
    check((bruno.snap!.you.act?.rastro ?? 0) > 0, 'RASTRO ativado (duração em andamento)');
    bruno.send({ t: 'act', a: 'ability', id: 'eco', variant: 'radio' });
    await sleep(200);
    check((bruno.snap!.you.cd?.eco ?? 0) === 0, 'ECO FALSO recusado para som ainda não registrado (rádio)');
    bruno.send({ t: 'act', a: 'ability', id: 'eco', variant: 'passos' });
    await sleep(300);
    check((bruno.snap!.you.cd?.eco ?? 0) > 0, 'ECO FALSO com som registrado (passos) entra em recarga');
    bruno.send({ t: 'act', a: 'ability', id: 'ruptura' });
    await sleep(300);
    check((bruno.snap!.pl.find((p) => p[0] === bruno.id)![5] & 64) !== 0, 'RUPTURA ativa (avanço rápido)');
    await sleep(2600);
    bruno.send({ t: 'act', a: 'ability', id: 'parasita' });
    await sleep(300);
    check((bruno.snap!.you.cd?.parasita ?? 0) > 0 && bruno.events.slice(before).some((e) => e.k === 'ability' && e.a === 'parasita'), 'PARASITA ativada');
    const cdR = bruno.snap!.you.cd!.rastro;
    bruno.send({ t: 'act', a: 'ability', id: 'rastro' });
    await sleep(200);
    check(bruno.snap!.you.cd!.rastro <= cdR, 'habilidade em recarga não pode ser repetida');

    // ---------------- jogo: sobreviventes cumprem objetivos; entidade derruba um e recua
    console.log('\n[6] Partida 1: objetivos, ataque, resgate, fuga');
    const survivors = [alice, carla, davi];
    const plans = new Map<Bot, Plan>();
    let claimed = new Set<string>();
    let phase: 'hunt' | 'retreat' = 'hunt';
    let downedSeen = false;
    let reviveSeen = false;
    const huntTarget = davi.id;
    const tStart = Date.now();
    const brain = setInterval(() => {
      try {
        if (!room.match || room.match.ended) return;
        // entidade
        if (bruno.snap) {
          if (phase === 'hunt') {
            runEntityHunt(bruno, app, code, huntTarget, false);
            if (bruno.events.some((e) => e.k === 'down' && e.target === huntTarget)) {
              downedSeen = true;
              phase = 'retreat';
            }
          } else {
            // recua para a contenção e fica parada (camuflagem)
            const sp = map.entitySpawns[0];
            steer(bruno, (x, z) => x === Math.floor(sp.x / CELL) && z === Math.floor(sp.z / CELL), false);
          }
        }
        if (!reviveSeen && alice.events.some((e) => e.k === 'revive')) reviveSeen = true;
        if (process.env.DEBUG && room.match.tick % 60 === 0) {
          for (const b of survivors) console.log('   ', b.name, JSON.stringify(plans.get(b)), b.snap?.you.x.toFixed(1), b.snap?.you.z.toFixed(1), b.snap?.you.ch?.label ?? '', b.snap?.you.inv.join(','));
          console.log('    tasks', JSON.stringify(room.match.debugState().tasks.map((t) => [t.kind, t.count, t.doneStations.length, t.stations])));
        }
        // sobreviventes
        claimed = new Set([...plans.values()].flatMap((p) => (p.kind === 'item' ? [p.itemId] : p.kind === 'channel' ? ['st:' + p.station] : p.kind === 'revive' ? ['revive:' + p.target] : [])));
        for (const b of survivors) {
          if (!b.snap || b.snap.you.st !== 'alive') continue;
          let plan = plans.get(b);
          if (!plan || plan.kind === 'idle') {
            plan = survivorPlan(b, app, code, claimed);
            plans.set(b, plan);
          }
          // prioridade ao resgate
          const dbg = room.match.debugState();
          const downed = dbg.players.find((p) => p.status === 'downed');
          if (downed && plan.kind !== 'revive' && b === alice) plans.set(b, (plan = { kind: 'revive', target: downed.id }));
          const r = runSurvivor(b, plan, app, code);
          if (r === 'done') plans.delete(b);
        }
      } catch (e) {
        console.error('erro no cérebro', e);
      }
    }, 1000 / 30);

    await alice.until(() => !!alice.results, 6 * 60_000, 'fim da partida 1').catch((e) => {
      const dbg = room.match?.debugState();
      console.log('estado no timeout:', JSON.stringify({ stage: dbg?.stage, tasks: dbg?.tasks.map((t) => [t.kind, t.count, t.required, t.doneStations]), players: dbg?.players }, null, 1));
      throw e;
    });
    clearInterval(brain);
    const res1 = alice.results!;
    console.log(`  partida 1 terminou em ${((Date.now() - tStart) / 1000).toFixed(0)} s reais: ${res1.winner} — ${res1.reason}`);
    check(downedSeen, 'entidade derrubou um sobrevivente (2 golpes)');
    check(reviveSeen, 'sobrevivente caído foi resgatado por outro jogador');
    check(alice.events.some((e) => e.k === 'stage' && e.stage === 2) && alice.events.some((e) => e.k === 'stage' && e.stage === 3), 'fases 2 e 3 foram liberadas em sequência');
    check(alice.events.some((e) => e.k === 'escape'), 'sobreviventes fugiram pela cápsula');
    check(res1.winner === 'survivors', 'resultado calculado pelo servidor: vitória dos sobreviventes');
    check(res1.players.length === 4 && res1.players.every((p) => p.xp >= 0), 'resultado lista todos os jogadores com XP');
    check(!!res1.rewards && res1.rewards.xp > 0, 'recompensas aplicadas à conta');
    await alice.until(() => alice.room?.state === 'lobby', 2000, 'volta ao lobby');
    check(alice.room!.state === 'lobby' && alice.room!.players.length === 4, 'todos retornaram ao lobby da mesma sala');
    const me = await alice.api('/api/me');
    check(me.data.profile.totalXp === res1.rewards!.xp && me.data.profile.stats.matches === 1, 'XP e estatísticas persistidos no perfil');
    const hist = await alice.api('/api/history');
    check(hist.data.history.length === 1 && hist.data.history[0].matchId === res1.matchId, 'histórico de partidas registrado');

    // ---------------- partida 2: entidade vence; reconexão; espectador
    console.log('\n[7] Partida 2: revanche, rotação da entidade, reconexão, espectador');
    bruno.send({ t: 'room:pref', pref: 'any' });
    for (const b of [bruno, carla, davi]) b.send({ t: 'room:ready', ready: true });
    await alice.until(() => alice.room!.players.filter((p) => p.ready).length === 3, 2000, 'prontos 2');
    for (const b of allBots) b.events = [];
    alice.send({ t: 'room:start' });
    await Promise.all(allBots.map((b) => b.until(() => b.started, 8000, 'match:start 2')));
    const ent2 = allBots.find((b) => b.intro!.role === 'entity')!;
    check(ent2 !== bruno, `rotação: outro jogador virou entidade (${ent2.name})`);
    const surv2 = allBots.filter((b) => b !== ent2);
    // reconexão de um sobrevivente
    const rc = surv2[0];
    rc.ws.close();
    await sleep(500);
    check(room.match!.debugState().players.find((p) => p.id === rc.id)!.status === 'alive', 'desconexão não remove o jogador imediatamente');
    rc.started = false;
    await rc.connect();
    await rc.until(() => rc.started && !!rc.snap, 4000, 'reconectar');
    check(rc.intro!.role === 'survivor', 'reconectou e voltou para a mesma partida');
    let specSeen = false;
    const brain2 = setInterval(() => {
      try {
        if (!room.match || room.match.ended) return;
        if (ent2.snap) runEntityHunt(ent2, app, code, undefined, true);
        for (const b of surv2) {
          if (b.snap && b.snap.you.st === 'alive') b.cmd(0, 0, 0);
          if (b.snap?.you.st === 'dead' && b.snap.you.spec) specSeen = true;
        }
      } catch (e) {
        console.error(e);
      }
    }, 1000 / 30);
    await alice.until(() => !!alice.results, 4 * 60_000, 'fim da partida 2');
    clearInterval(brain2);
    const res2 = alice.results!;
    console.log(`  partida 2: ${res2.winner} — ${res2.reason}`);
    check(res2.winner === 'entity', 'vitória da entidade quando nenhum sobrevivente escapa');
    check(res2.players.filter((p) => p.role === 'survivor').every((p) => p.outcome === 'dead'), 'todos os sobreviventes foram eliminados');
    check(specSeen, 'sobrevivente eliminado entrou no modo espectador');
    check(surv2.every((b) => b.events.some((e) => e.k === 'jumpscare')), 'golpes disparam efeito de susto na vítima');
    await sleep(300);
    const p2 = await ent2.api('/api/me');
    check(p2.data.profile.stats.entityWins === 1 && p2.data.profile.achievements.includes('predador'), 'conquista "Predador" desbloqueada');

    // ---------------- loja e personalização
    console.log('\n[8] Loja e personalização');
    const coins = (await alice.api('/api/me')).data.profile.coins;
    const buy = await alice.api('/api/shop/buy', { id: 'calc_galocha' });
    check(buy.status === 200 && buy.data.profile.coins === coins - 120 && buy.data.profile.owned.includes('calc_galocha'), 'compra de cosmético com moeda virtual');
    const buyAgain = await alice.api('/api/shop/buy', { id: 'calc_galocha' });
    check(buyAgain.status === 400, 'não compra item já possuído');
    const lockedItem = await alice.api('/api/loadout', { loadout: { acessorio: 'acc_mascara' } });
    check(lockedItem.status === 400, 'não equipa item bloqueado');
    const eq = await alice.api('/api/loadout', { loadout: { calcado: 'calc_galocha', rosto: 'rosto_d' } });
    check(eq.status === 200 && eq.data.profile.loadout.calcado === 'calc_galocha', 'equipa item desbloqueado');
    await alice.until(() => alice.room!.players.find((p) => p.id === alice.id)!.loadout.calcado === 'calc_galocha', 2000, 'loadout no lobby');
    check(true, 'aparência atualizada aparece para a sala');
    const wrongSlot = await alice.api('/api/loadout', { loadout: { rosto: 'calc_bota' } });
    check(wrongSlot.status === 400, 'item em espaço errado é recusado');

    for (const b of allBots) b.ws.close();
  } finally {
    await app.close();
  }

  // ---------------- colapso por tempo (instância separada com partida curta)
  console.log('\n[9] Colapso por tempo limite');
  const dir2 = mkdtempSync(join(tmpdir(), 'veu-test2-'));
  const app2 = await createApp({ port: 0, host: '127.0.0.1', dataFile: null, publicDir: dir2, countdown: 0.2, matchDuration: 3, log: false });
  try {
    const base2 = `http://127.0.0.1:${(app2.server.address() as AddressInfo).port}`;
    const a = new Bot('eva', base2);
    const b = new Bot('fabio', base2);
    for (const x of [a, b]) {
      const r = await x.api('/api/guest', { name: x.name }, '');
      x.token = r.data.token;
      x.profile = r.data.profile;
      await x.connect();
    }
    a.send({ t: 'room:create', name: '', public: false, map: 'abissal' });
    await a.until(() => !!a.room, 2000, 'sala 2');
    b.send({ t: 'room:join', code: a.room!.code });
    b.send({ t: 'room:ready', ready: true });
    await a.until(() => a.room!.players.length === 2 && a.room!.players.every((p) => p.ready || p.host), 2000, 'pronto');
    a.send({ t: 'room:start' });
    await a.until(() => !!a.results, 15_000, 'colapso');
    check(a.results!.winner === 'entity' && a.results!.reason.includes('colapsou'), 'tempo esgotado: complexo colapsa e a entidade vence');
    check(a.room!.name === `Sala de ${a.profile.username}`, 'nome de sala vazio recebe nome padrão');
    a.ws.close();
    b.ws.close();
  } finally {
    await app2.close();
    rmSync(dir2, { recursive: true, force: true });
  }

  console.log(`\nResultado: ${passes} verificações aprovadas, ${failures} falhas.`);
  process.exit(failures ? 1 : 0);
}

void ENT;
main().catch((e) => {
  console.error('ERRO NO TESTE:', e);
  process.exit(1);
});
