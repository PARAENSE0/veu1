/**
 * Teste ponta a ponta de combate, portas automáticas, estamina e efeito real
 * das melhorias dentro da partida (WebSocket real + servidor real).
 *  - ataque comum ≈ 18% da vida; nenhum monstro derruba com 2 ataques comuns,
 *    nem com Poder de Ataque no máximo;
 *  - um golpe acerta um único alvo (sem dano duplo por animação);
 *  - sem dano através de paredes ou fora do alcance;
 *  - golpe especial: mais forte, com recarga;
 *  - Resistência Física (humano) e Resistência (monstro) reduzem dano;
 *  - portas abrem sozinhas para humanos, fecham depois, não fecham em cima de
 *    ninguém, a entidade não aciona o sensor, portas travadas continuam
 *    travadas e um humano atravessa a porta andando sem ficar preso;
 *  - estamina: máximo com melhoria, gasta correndo, recupera parado.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { AUTO_DOOR_CLOSE_DELAY, ENT, PLAYER_RADIUS, SURV } from '../shared/constants';
import { getMap } from '../shared/map';
import { BTN, isSolid, lineOfSight, makeGrid } from '../shared/physics';
import type { ClientMsg, ServerMsg, Snapshot } from '../shared/protocol';
import { UPGRADES } from '../shared/upgrades';

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
const grid = makeGrid(map);

class Bot {
  ws!: WebSocket;
  id = '';
  token = '';
  room: { code: string; players: { ready: boolean; host: boolean }[] } | null = null;
  role = '';
  started = false;
  snap: Snapshot | null = null;
  seq = 0;
  constructor(
    readonly name: string,
    readonly base: string,
  ) {}
  async connect() {
    const r = await fetch(this.base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: this.name, password: 'senha-forte-1' }) });
    const d = (await r.json()) as { token: string; profile: { id: string } };
    this.token = d.token;
    this.id = d.profile.id;
  }
  async open() {
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
  /** Envia comandos de movimento em tempo real (30 por segundo). */
  async walk(seconds: number, yaw: number, mz: number, b = 0) {
    const n = Math.round(seconds * 30);
    for (let i = 0; i < n; i++) {
      this.send({ t: 'in', cmds: [{ seq: ++this.seq, mx: 0, mz, yaw, pitch: 0, b }] });
      await sleep(1000 / 30);
    }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'veu-cmb-'));
const app = await createApp({ port: 0, host: '127.0.0.1', dataFile: null, publicDir: dir, countdown: 0.2, matchDuration: 900, log: false });
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
try {
  const [a, b, c] = [new Bot('ana', base), new Bot('bia', base), new Bot('caio', base)];
  for (const x of [a, b, c]) await x.connect();
  // melhorias gravadas na conta antes de entrar na sala (compradas em e2e-social)
  const set = async (bot: Bot, up: Record<string, number>) => Object.assign((await app.store.getUser(bot.id))!.upgrades, up);
  await set(c, { m_ataque: 5, m_resistencia: 5, m_recarga: 5 }); // Caio: monstro com ataque no máximo
  await set(b, { resistencia: 5 }); // Bia: resistência física no máximo
  await set(a, { estamina: 5, recuperacao: 5 }); // Ana: estamina no máximo
  for (const x of [a, b, c]) await x.open();
  a.send({ t: 'room:create', name: 'combate', public: false, map: 'abissal' });
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
  const st = () => m.debugState();
  const P = (bot: Bot) => st().players.find((p) => p.id === bot.id)!;
  check(c.role === 'entity', 'Caio é a entidade');
  // tira todos de perto das portas e uns dos outros
  const park = (bot: Bot, x: number, z: number, yaw = 0) => m.debugSet(bot.id, { x, z, yaw, pitch: 0 });
  const FAR = { x: 21, z: 23 }; // área aberta (célula 10,11)
  park(a, 49, 51);
  park(b, 7, 45 + 4);

  // ---------------------------------------------------------------- dano
  console.log('[1] Ataque comum e regra dos dois golpes');
  const atkMult = P(c).mods.attackMult;
  check(Math.abs(atkMult - (1 + 5 * UPGRADES.m_ataque.perLevel)) < 1e-9, `melhoria de ataque aplicada no servidor (x${atkMult.toFixed(2)})`);
  const common = ENT.attackDamage * atkMult;
  check(ENT.attackDamage / SURV.hpMax >= 0.15 && ENT.attackDamage / SURV.hpMax <= 0.2, `dano comum = ${ENT.attackDamage}% da vida (15–20%)`);
  park(c, FAR.x, FAR.z, -Math.PI / 2); // olhando para +x
  park(a, FAR.x + 1.4, FAR.z);
  m.debugSet(a.id, { hp: 100 });
  await sleep(100);
  const hit = async () => {
    await c.until(() => P(c).attackCd === 0, 4000, 'recarga do ataque');
    c.send({ t: 'act', a: 'attack' });
    await sleep((ENT.attackWindup + 0.15) * 1000);
  };
  await hit();
  const hp1 = P(a).hp;
  check(Math.abs(100 - hp1 - common) < 0.11, `1º golpe: ${(100 - hp1).toFixed(1)} de dano (esperado ${common.toFixed(1)})`);
  await hit();
  const hp2 = P(a).hp;
  check(hp2 > 0 && P(a).status === 'alive', `2 golpes comuns com ataque no máximo: ainda de pé (${hp2.toFixed(1)} de vida)`);
  check(hp2 >= 100 - 2 * ENT.attackDamage * 1.15 - 0.2, 'dois golpes nunca passam de ~41% da vida');
  let hits = 2;
  while (P(a).status === 'alive' && hits < 12) {
    await hit();
    hits++;
  }
  check(hits >= 5, `foram necessários ${hits} golpes comuns para derrubar (mínimo 5)`);
  check(P(a).status === 'downed', 'sobrevivente caído (não morto direto)');
  m.debugSet(a.id, { hp: 100, status: 'alive' });

  console.log('[2] Um golpe, um alvo');
  park(a, FAR.x + 1.3, FAR.z - 0.4);
  park(b, FAR.x + 1.3, FAR.z + 0.4);
  m.debugSet(a.id, { hp: 100 });
  m.debugSet(b.id, { hp: 100 });
  await hit();
  const lost = [100 - P(a).hp, 100 - P(b).hp];
  check(lost.filter((x) => x > 0).length === 1, `dois humanos na frente: só um levou dano (${lost.map((x) => x.toFixed(1)).join(' / ')})`);

  console.log('[3] Resistência física');
  park(a, 49, 51);
  park(b, FAR.x + 1.4, FAR.z);
  m.debugSet(b.id, { hp: 100 });
  await hit();
  const bLoss = 100 - P(b).hp;
  check(Math.abs(bLoss - common * (1 - 5 * UPGRADES.resistencia.perLevel)) < 0.11, `Bia (resistência 5) perdeu ${bLoss.toFixed(1)} em vez de ${common.toFixed(1)}`);

  console.log('[4] Paredes e alcance');
  // procura dois pontos livres a ~2 m separados por uma quina de parede
  const free = (x: number, z: number, r: number) => {
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) if (isSolid(grid, Math.floor((x + dx) / 2), Math.floor((z + dz) / 2))) return false;
    return true;
  };
  let pair: [number, number, number, number] | null = null;
  outer: for (let x = 4; x < map.w * 2 - 4; x += 0.5)
    for (let z = 4; z < map.h * 2 - 4; z += 0.5) {
      if (!free(x, z, ENT.radius + 0.05)) continue;
      for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 8) {
        const tx = x + Math.cos(ang) * 1.9;
        const tz = z + Math.sin(ang) * 1.9;
        if (free(tx, tz, PLAYER_RADIUS + 0.05) && !lineOfSight(grid, x, z, tx, tz)) {
          pair = [x, z, tx, tz];
          break outer;
        }
      }
    }
  check(!!pair, 'encontrado ponto com parede entre monstro e humano a 1,9 m');
  if (pair) {
    const [ex, ez, tx, tz] = pair;
    park(b, 7, 49);
    m.debugSet(c.id, { x: ex, z: ez, yaw: Math.atan2(-(tx - ex), -(tz - ez)) });
    m.debugSet(a.id, { x: tx, z: tz, hp: 100 });
    await sleep(80);
    await hit();
    check(P(a).hp === 100, 'sem dano através da parede');
  }
  park(c, FAR.x, FAR.z, -Math.PI / 2);
  park(a, FAR.x + ENT.attackRange + PLAYER_RADIUS + 0.6, FAR.z);
  m.debugSet(a.id, { hp: 100 });
  await sleep(80);
  await hit();
  check(P(a).hp === 100, `sem dano fora do alcance (${(ENT.attackRange + PLAYER_RADIUS + 0.6).toFixed(1)} m)`);

  console.log('[5] Golpe especial');
  park(a, FAR.x + 1.4, FAR.z);
  m.debugSet(a.id, { hp: 100 });
  await c.until(() => P(c).attackCd === 0, 4000, 'recarga');
  c.send({ t: 'act', a: 'ability', id: 'golpe' });
  await sleep((ENT.specialWindup + 0.2) * 1000);
  const sLoss = 100 - P(a).hp;
  check(Math.abs(sLoss - ENT.specialDamage * atkMult) < 0.11 && sLoss > common, `especial causa ${sLoss.toFixed(1)} (mais que o comum ${common.toFixed(1)})`);
  check(P(c).cd.golpe > 0, `especial entra em recarga (${P(c).cd.golpe.toFixed(1)} s, com Recarga de Habilidades)`);
  const hpBefore = P(a).hp;
  await c.until(() => P(c).attackCd === 0, 4000, 'recarga');
  c.send({ t: 'act', a: 'ability', id: 'golpe' });
  await sleep((ENT.specialWindup + 0.2) * 1000);
  check(P(a).hp === hpBefore, 'especial em recarga não acerta de novo');
  check(ENT.specialDamage * 1.15 + ENT.attackDamage * 1.15 < SURV.hpMax, 'especial + comum (ataque no máximo) não derrubam');

  console.log('[6] Resistência do monstro');
  const em = P(c).mods.damageTakenMult;
  check(Math.abs(em - (1 - 5 * UPGRADES.m_resistencia.perLevel)) < 1e-9, `monstro com resistência recebe ${(em * 100).toFixed(0)}% do dano`);
  park(a, 49, 51);
  park(b, 7, 49);
  park(c, 7, 30);

  // ---------------------------------------------------------------- portas
  console.log('[7] Portas automáticas');
  const door = map.doors.find((d) => d.idx === 243)!; // porta leste-oeste em (27, 11)
  const isOpen = () => st().doorsOpen.includes(door.idx);
  await sleep(AUTO_DOOR_CLOSE_DELAY * 1000 + 400);
  check(!isOpen(), 'porta começa fechada sem ninguém por perto');
  m.debugSet(c.id, { x: door.x - 1.6, z: door.z, yaw: -Math.PI / 2 });
  await sleep(400);
  check(!isOpen(), 'a entidade não aciona a porta automática');
  park(c, 7, 30);
  m.debugSet(a.id, { x: door.x - 1.7, z: door.z, yaw: -Math.PI / 2 });
  await sleep(150);
  check(isOpen(), 'humano chega perto: porta abre sozinha');
  await sleep(500);
  check(a.snap!.doors.includes(door.idx) && b.snap!.doors.includes(door.idx), 'abertura sincronizada para todos os jogadores');
  m.debugSet(a.id, { x: door.x, z: door.z }); // parada no vão
  park(b, 7, 49);
  await sleep(AUTO_DOOR_CLOSE_DELAY * 1000 + 600);
  check(isOpen(), 'não fecha com alguém parado no vão');
  m.debugSet(a.id, { x: door.x - 6, z: door.z });
  await sleep(AUTO_DOOR_CLOSE_DELAY * 1000 - 600);
  check(isOpen(), 'espera o atraso antes de fechar');
  await sleep(1200);
  check(!isOpen(), `fecha sozinha ~${AUTO_DOOR_CLOSE_DELAY} s depois que todos se afastam`);
  // atravessar andando (sem ficar preso)
  m.debugSet(a.id, { x: door.x - 3.5, z: door.z, yaw: -Math.PI / 2, stamina: 0 });
  await a.walk(1.8, -Math.PI / 2, 1);
  check(P(a).x > door.x + 1.2, `humano atravessa a porta andando (x ${(door.x - 3.5).toFixed(1)} → ${P(a).x.toFixed(1)})`);
  // porta travada pelo Parasita continua travada
  m.debugSet(a.id, { x: door.x + 6, z: door.z });
  await sleep(AUTO_DOOR_CLOSE_DELAY * 1000 + 600);
  m.debugSet(c.id, { x: door.x - 4, z: door.z });
  await sleep(100);
  c.send({ t: 'act', a: 'ability', id: 'parasita' });
  await sleep(150);
  park(c, 7, 30);
  m.debugSet(a.id, { x: door.x + 1.7, z: door.z });
  await sleep(500);
  check(!isOpen() && a.snap!.locked.includes(door.idx), 'porta travada pela interferência não abre sozinha');

  // ---------------------------------------------------------------- estamina
  console.log('[8] Estamina');
  const smax = P(a).mods.staminaMax;
  check(Math.abs(smax - SURV.staminaMax * (1 + 5 * UPGRADES.estamina.perLevel)) < 1e-9, `estamina máxima com melhoria: ${smax}`);
  m.debugSet(a.id, { x: FAR.x - 3, z: FAR.z, stamina: smax });
  await sleep(100);
  check(Math.abs((a.snap!.you.stamina ?? 0) - smax) < 1, 'barra recebe o valor do servidor (snapshot)');
  await a.walk(1.5, Math.PI / 2, 1, BTN.SPRINT);
  const afterRun = P(a).stamina;
  check(afterRun < smax - 10, `correr gasta estamina (${smax} → ${afterRun.toFixed(0)})`);
  await a.walk(0.4, Math.PI / 2, 0);
  const t0 = P(a).stamina;
  await a.walk(1.5, Math.PI / 2, 0);
  const t1 = P(a).stamina;
  check(t1 > t0 + 5, `parado recupera gradualmente (${t0.toFixed(0)} → ${t1.toFixed(0)})`);
  m.debugSet(a.id, { stamina: 0, x: FAR.x - 3, z: FAR.z });
  m.debugSet(a.id, {});
  await a.walk(0.3, Math.PI / 2, 1, BTN.SPRINT);
  check(a.snap!.you.exh || P(a).stamina < 5, 'sem estamina não corre (exausto)');
} catch (e) {
  fail++;
  console.error('ERRO', e);
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nResultado: ${pass} verificações aprovadas, ${fail} falhas.`);
process.exit(fail ? 1 : 0);
