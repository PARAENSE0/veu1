/**
 * Teste ponta a ponta de contas, progressão e social (HTTP + WebSocket reais,
 * servidor real com arquivo de dados em disco):
 *  - código de presente PARAENSE01 (nível 50 + 20.000), uso único, inválido,
 *    convidado, resgate simultâneo (sem duplicação), códigos novos via admin;
 *  - nível máximo 50 (XP não passa do teto, moedas continuam);
 *  - melhorias: custo, saldo, nível máximo, ids inválidos, convidado;
 *  - ranking (posições, sem duplicados, posição do próprio jogador);
 *  - amigos: busca, pedido, aceitar, recusar, cancelar, remover, notificações,
 *    presença (offline/menu/lobby/partida) e convite para a sala;
 *  - recompensa de partida não duplica;
 *  - persistência de tudo após reiniciar o servidor; nada vaza entre contas.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { MAX_LEVEL, XP_FOR_MAX, levelFromXp, xpToNext } from '../shared/progression';
import { UPGRADE_COSTS, MAX_UPGRADE_LEVEL } from '../shared/upgrades';
import type { Notice, Profile, ServerMsg } from '../shared/protocol';

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

const dir = mkdtempSync(join(tmpdir(), 'veu-social-'));
const dataFile = join(dir, 'dados.json');
const ADMIN = 'segredo-de-teste-123';
let app = await createApp({ port: 0, host: '127.0.0.1', dataFile, publicDir: dir, countdown: 0.2, log: false, adminToken: ADMIN });
let base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

async function api<T = Record<string, unknown>>(path: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T & { msg?: string; error?: string } }> {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: (await r.json()) as never };
}

class Client {
  token = '';
  profile!: Profile;
  ws: WebSocket | null = null;
  notices: Notice[] = [];
  room: { code: string } | null = null;
  constructor(readonly name: string) {}
  async register() {
    const r = await api<{ token: string; profile: Profile }>('/api/register', undefined, { username: this.name, password: 'senha-forte-1' });
    this.token = r.data.token;
    this.profile = r.data.profile;
    return r;
  }
  async login() {
    const r = await api<{ token: string; profile: Profile }>('/api/login', undefined, { username: this.name, password: 'senha-forte-1' });
    this.token = r.data.token;
    this.profile = r.data.profile;
    return r;
  }
  async connect() {
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    await new Promise<void>((res) => (this.ws!.onopen = () => res()));
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      if (m.t === 'notice') this.notices.push(m.n);
      if (m.t === 'room') this.room = m.room as never;
    };
    this.ws.send(JSON.stringify({ t: 'auth', token: this.token }));
    await sleep(150);
  }
  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
  send(m: unknown) {
    this.ws!.send(JSON.stringify(m));
  }
  get id() {
    return this.profile.id;
  }
}

try {
  const alice = new Client('alice');
  const bob = new Client('bob');
  const carla = new Client('carla');
  for (const c of [alice, bob, carla]) await c.register();

  console.log('[1] Conta nova');
  check(alice.profile.level === 1 && alice.profile.totalXp === 0 && !alice.profile.maxLevel, 'conta nova começa no nível 1 com 0 XP');
  check(Object.values(alice.profile.upgrades).every((v) => v === 0), 'conta nova sem melhorias');
  check(levelFromXp(XP_FOR_MAX).level === MAX_LEVEL && levelFromXp(XP_FOR_MAX - 1).level === MAX_LEVEL - 1, `nível 50 exige exatamente ${XP_FOR_MAX} XP`);
  check(xpToNext(2) > xpToNext(1) && xpToNext(49) > xpToNext(10), 'curva de XP progressiva (cada nível pede mais XP)');

  console.log('[2] Código de presente');
  const guest = await api<{ token: string }>('/api/guest', undefined, { name: 'Visitante' });
  const gr = await api('/api/codes/redeem', guest.data.token, { code: 'PARAENSE01' });
  check(gr.status === 400 && /Crie uma conta/.test(gr.data.msg ?? ''), 'convidado não resgata código (precisa de conta)');
  const bad = await api('/api/codes/redeem', alice.token, { code: 'NAOEXISTE9' });
  check(bad.status === 400 && bad.data.msg === 'Código inválido.', 'código inexistente: "Código inválido."');
  const empty = await api('/api/codes/redeem', alice.token, { code: '' });
  check(empty.status === 400, 'código vazio recusado');
  const ok = await api<{ reward: { coins: number; levelAfter: number; levelBefore: number }; profile: Profile }>('/api/codes/redeem', alice.token, { code: 'PARAENSE01' });
  check(ok.status === 200 && ok.data.reward.coins === 20000 && ok.data.reward.levelAfter === 50 && ok.data.reward.levelBefore === 1, 'PARAENSE01: nível 1 → 50 e 20.000 fragmentos');
  check(ok.data.profile.level === 50 && ok.data.profile.maxLevel && ok.data.profile.totalXp === XP_FOR_MAX, 'perfil no nível máximo com XP no teto');
  check(ok.data.profile.coins === 150 + 20000, `saldo correto (${ok.data.profile.coins})`);
  check(ok.data.profile.rewardLog.some((e) => e.source === 'codigo' && e.coins === 20000), 'resgate registrado no histórico de recompensas');
  const again = await api('/api/codes/redeem', alice.token, { code: 'paraense01' });
  check(again.status === 400 && again.data.msg === 'Você já resgatou este código.', 'segundo resgate (mesmo em minúsculas): "Você já resgatou este código."');
  const me1 = await api<{ profile: Profile }>('/api/me', alice.token);
  check(me1.data.profile.coins === 20150, 'nenhuma moeda extra após a tentativa repetida');
  // corrida: dois resgates ao mesmo tempo na mesma conta
  const race = await Promise.all([1, 2, 3].map(() => api('/api/codes/redeem', bob.token, { code: 'PARAENSE01' })));
  check(race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 400).length === 2, 'três resgates simultâneos: só um é aceito');
  const bobMe = await api<{ profile: Profile }>('/api/me', bob.token);
  check(bobMe.data.profile.coins === 20150, 'saldo do Bob sem duplicação');

  console.log('[3] Administração de códigos');
  const noAdm = await api('/api/admin/codes', undefined, { code: 'BONUS2026', coins: 500, maxUses: 1 });
  check(noAdm.status === 403, 'criar código sem token administrativo: recusado');
  const wrongAdm = await api('/api/admin/codes', undefined, { code: 'BONUS2026', coins: 500, maxUses: 1 }, { 'x-admin-token': 'x'.repeat(ADMIN.length) });
  check(wrongAdm.status === 403, 'token administrativo errado: recusado');
  const adm = await api<{ code: { code: string } }>('/api/admin/codes', undefined, { code: 'BONUS2026', coins: 500, maxUses: 1 }, { 'x-admin-token': ADMIN });
  check(adm.status === 200 && adm.data.code.code === 'BONUS2026', 'administrador cria código novo');
  const c1 = await api('/api/codes/redeem', carla.token, { code: 'BONUS2026' });
  const c2 = await api('/api/codes/redeem', alice.token, { code: 'BONUS2026' });
  check(c1.status === 200 && c2.status === 400 && /limite de usos/.test(c2.data.msg ?? ''), 'código com 1 uso: segundo jogador recebe "limite de usos"');
  const list = await api<{ codes: { code: string; uses: number }[] }>('/api/admin/codes', undefined, undefined, { 'x-admin-token': ADMIN });
  check(list.data.codes.find((c) => c.code === 'PARAENSE01')?.uses === 2, 'contagem de usos do PARAENSE01 registrada (2)');

  console.log('[4] Teto do nível 50');
  const aRec = (await app.store.getUser(alice.id))!;
  const rw = await app.accounts.applyMatch(aRec, { id: alice.id, name: 'alice', role: 'survivor', outcome: 'escaped', score: 900, xp: 400, coins: 100 }, { matches: 1 }, { matchId: 'm-teste-1', map: 'abissal', winner: 'survivors', duration: 300, role: 'survivor' });
  check(aRec.totalXp === XP_FOR_MAX && levelFromXp(aRec.totalXp).level === 50, 'XP não passa do teto no nível 50');
  check(rw.coins === 100 && aRec.coins >= 20250, 'no nível 50 continua ganhando fragmentos');
  const coinsBefore = aRec.coins;
  const rw2 = await app.accounts.applyMatch(aRec, { id: alice.id, name: 'alice', role: 'survivor', outcome: 'escaped', score: 900, xp: 400, coins: 100 }, { matches: 1 }, { matchId: 'm-teste-1', map: 'abissal', winner: 'survivors', duration: 300, role: 'survivor' });
  check(rw2.coins === 0 && rw2.xp === 0 && aRec.coins === coinsBefore && aRec.stats.matches === 1, 'mesma partida não recompensa duas vezes');

  console.log('[5] Melhorias');
  const davi = new Client('davi');
  await davi.register();
  const poor = await api('/api/upgrades/buy', davi.token, { id: 'estamina' });
  check(poor.status === 400 && poor.data.msg === 'Fragmentos insuficientes.', 'sem saldo: "Fragmentos insuficientes."');
  const fake = await api('/api/upgrades/buy', alice.token, { id: 'voar' });
  check(fake.status === 400 && fake.data.msg === 'Melhoria inexistente.', 'melhoria inexistente recusada');
  const gUp = await api('/api/upgrades/buy', guest.data.token, { id: 'estamina' });
  check(gUp.status === 400, 'convidado não compra melhorias permanentes');
  let last: Profile | null = null;
  const c0 = (await api<{ profile: Profile }>('/api/me', alice.token)).data.profile.coins;
  for (let i = 0; i < MAX_UPGRADE_LEVEL; i++) last = (await api<{ profile: Profile }>('/api/upgrades/buy', alice.token, { id: 'estamina' })).data.profile;
  const spent = UPGRADE_COSTS.reduce((a, b) => a + b, 0);
  check(last!.upgrades.estamina === MAX_UPGRADE_LEVEL && last!.coins === c0 - spent, `estamina até o nível ${MAX_UPGRADE_LEVEL} custando ${spent}`);
  const over = await api('/api/upgrades/buy', alice.token, { id: 'estamina' });
  check(over.status === 400 && /nível máximo/.test(over.data.msg ?? ''), 'acima do máximo: recusado');
  await api('/api/upgrades/buy', alice.token, { id: 'm_ataque' });
  const aMe = (await api<{ profile: Profile }>('/api/me', alice.token)).data.profile;
  check(aMe.upgrades.m_ataque === 1 && aMe.rewardLog.some((e) => e.source === 'melhoria'), 'melhoria de monstro comprada e registrada');
  const bMe = (await api<{ profile: Profile }>('/api/me', bob.token)).data.profile;
  check(bMe.upgrades.estamina === 0 && bMe.upgrades.m_ataque === 0, 'melhorias da Alice não aparecem na conta do Bob');

  console.log('[6] Ranking');
  const rk = await api<{ list: { pos: number; id: string; username: string; level: number; totalXp: number }[]; me: { pos: number } | null; total: number }>('/api/ranking', carla.token);
  const ids = rk.data.list.map((e) => e.id);
  check(rk.data.total === 4 && new Set(ids).size === ids.length, 'ranking sem duplicados e sem convidados');
  check(rk.data.list.every((e, i) => e.pos === i + 1 && (i === 0 || rk.data.list[i - 1].totalXp >= e.totalXp)), 'ordenado por XP com posições corretas');
  check(rk.data.list[0].level === 50 && rk.data.me?.pos === rk.data.list.findIndex((e) => e.username === 'carla') + 1 && rk.data.me.pos > 2, 'nível, nome e a posição do próprio jogador (Carla abaixo dos dois nível 50)');
  // atualização automática: Carla ganha XP e sobe
  const cRec = (await app.store.getUser(carla.id))!;
  await app.accounts.applyMatch(cRec, { id: carla.id, name: 'carla', role: 'entity', outcome: 'entity', score: 2000, xp: XP_FOR_MAX + 10, coins: 10 }, { matches: 1 }, { matchId: 'm-teste-2', map: 'abissal', winner: 'entity', duration: 300, role: 'entity' });
  const rk2 = await api<{ me: { pos: number; level: number } | null }>('/api/ranking', carla.token);
  check(rk2.data.me?.level === 50, 'ranking atualiza na hora após ganhar XP');

  console.log('[7] Amigos');
  for (const c of [alice, bob, carla]) await c.connect();
  const found = await api<{ users: { id: string; username: string; level: number }[] }>('/api/users/search?q=bo', alice.token);
  check(found.data.users.length === 1 && found.data.users[0].username === 'bob', 'busca por nome encontra o Bob');
  const byId = await api<{ users: { id: string }[] }>(`/api/users/search?q=${bob.id}`, alice.token);
  check(byId.data.users[0]?.id === bob.id, 'busca por ID encontra o Bob');
  const self = await api('/api/friends/request', alice.token, { id: alice.id });
  check(self.status === 400, 'não adiciona a si mesmo');
  const req = await api<{ result: string }>('/api/friends/request', alice.token, { id: bob.id });
  check(req.status === 200 && req.data.result === 'sent', 'Alice envia pedido ao Bob');
  const dup = await api('/api/friends/request', alice.token, { id: bob.id });
  check(dup.status === 400 && dup.data.msg === 'Solicitação já enviada.', 'pedido repetido recusado');
  await sleep(100);
  check(bob.notices.some((n) => n.kind === 'friend_request' && n.from.id === alice.id), 'Bob recebe notificação em tempo real');
  const bobF = await api<{ incoming: { id: string }[] }>('/api/friends', bob.token);
  const aliceF = await api<{ outgoing: { id: string }[] }>('/api/friends', alice.token);
  check(bobF.data.incoming[0]?.id === alice.id && aliceF.data.outgoing[0]?.id === bob.id, 'pedido aparece como recebido (Bob) e enviado (Alice)');
  const acc = await api<{ friends: { id: string; status: string; level: number }[] }>('/api/friends/accept', bob.token, { id: alice.id });
  await sleep(100);
  check(acc.data.friends.some((f) => f.id === alice.id && f.level === 50), 'Bob aceita: Alice na lista com nível');
  check(alice.notices.some((n) => n.kind === 'friend_accept' && n.from.id === bob.id), 'Alice é avisada do aceite');
  await api('/api/friends/request', carla.token, { id: alice.id });
  const rej = await api<{ incoming: unknown[]; friends: { id: string }[] }>('/api/friends/reject', alice.token, { id: carla.id });
  check(rej.data.incoming.length === 0 && !rej.data.friends.some((f) => f.id === carla.id), 'Alice recusa o pedido da Carla');
  await api('/api/friends/request', carla.token, { id: bob.id });
  const canc = await api<{ outgoing: unknown[] }>('/api/friends/cancel', carla.token, { id: bob.id });
  const bobIn = await api<{ incoming: unknown[] }>('/api/friends', bob.token);
  check(canc.data.outgoing.length === 0 && bobIn.data.incoming.length === 0, 'Carla cancela pedido enviado (some dos dois lados)');
  // pedido cruzado vira amizade direto
  await api('/api/friends/request', carla.token, { id: bob.id });
  const cross = await api<{ result: string }>('/api/friends/request', bob.token, { id: carla.id });
  check(cross.data.result === 'accepted', 'pedido cruzado vira amizade automaticamente');
  const rem = await api<{ friends: { id: string }[] }>('/api/friends/remove', bob.token, { id: carla.id });
  const carlaF = await api<{ friends: { id: string }[] }>('/api/friends', carla.token);
  check(!rem.data.friends.some((f) => f.id === carla.id) && !carlaF.data.friends.some((f) => f.id === bob.id), 'remover amizade remove dos dois lados');

  console.log('[8] Presença e convite');
  const st = async (who: Client, of: Client) => (await api<{ friends: { id: string; status: string; roomCode?: string }[] }>('/api/friends', who.token)).data.friends.find((f) => f.id === of.id);
  check((await st(alice, bob))?.status === 'menu', 'Bob conectado no menu: "menu"');
  bob.send({ t: 'room:create', name: 'sala do bob', public: true, map: 'abissal' });
  await sleep(200);
  check((await st(alice, bob))?.status === 'lobby', 'Bob numa sala: "lobby"');
  const nf = await api('/api/friends/invite', bob.token, { id: carla.id });
  check(nf.status === 400, 'não convida quem não é amigo');
  const inv = await api('/api/friends/invite', bob.token, { id: alice.id });
  await sleep(100);
  const n = alice.notices.find((x) => x.kind === 'invite');
  check(inv.status === 200 && n?.code === bob.room?.code, 'Alice recebe convite com o código da sala');
  alice.send({ t: 'room:join', code: n!.code });
  await sleep(200);
  check(alice.room?.code === bob.room?.code, 'Alice entra na sala pelo convite');
  // partida (2 jogadores bastam para iniciar)
  alice.send({ t: 'room:ready', ready: true });
  await sleep(100);
  bob.send({ t: 'room:start' });
  await sleep(900);
  check((await st(carla, alice)) === undefined && (await st(bob, alice))?.status === 'partida', 'em jogo: "partida"');
  alice.disconnect();
  await sleep(200);
  const off = await st(bob, alice);
  check(off?.status === 'offline' || off?.status === 'partida', `após sair: ${off?.status} (a partida guarda o lugar para reconexão)`);
  const aliceSeen = (await app.store.getUser(alice.id))!.lastSeen;
  check(Date.now() - new Date(aliceSeen).getTime() < 5000, '"visto por último" atualizado ao desconectar');

  console.log('[9] Persistência após reiniciar o servidor');
  for (const c of [bob, carla]) c.disconnect();
  await app.close();
  app = await createApp({ port: 0, host: '127.0.0.1', dataFile, publicDir: dir, countdown: 0.2, log: false, adminToken: ADMIN });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const a2 = new Client('alice');
  await a2.login();
  check(a2.profile.level === 50 && a2.profile.totalXp === XP_FOR_MAX, 'nível 50 e XP mantidos');
  check(a2.profile.upgrades.estamina === MAX_UPGRADE_LEVEL && a2.profile.upgrades.m_ataque === 1, 'melhorias mantidas');
  check(a2.profile.coins === aMe.coins, `fragmentos mantidos exatamente (${a2.profile.coins})`);
  check(a2.profile.redeemedCodes.includes('PARAENSE01') && a2.profile.rewardLog.length >= 3, 'códigos resgatados e histórico de recompensas mantidos');
  const again2 = await api('/api/codes/redeem', a2.token, { code: 'PARAENSE01' });
  check(again2.status === 400 && again2.data.msg === 'Você já resgatou este código.', 'depois de reiniciar continua impedindo resgate repetido');
  const f2 = await api<{ friends: { id: string; status: string }[] }>('/api/friends', a2.token);
  check(f2.data.friends.length === 1 && f2.data.friends[0].id === bob.id && f2.data.friends[0].status === 'offline', 'lista de amigos mantida (Bob offline)');
  const b2 = new Client('bob');
  await b2.login();
  check(b2.profile.upgrades.estamina === 0 && b2.profile.coins === 20150, 'conta do Bob intacta e separada');
  const codes2 = await api<{ codes: { code: string; uses: number }[] }>('/api/admin/codes', undefined, undefined, { 'x-admin-token': ADMIN });
  check(codes2.data.codes.find((c) => c.code === 'BONUS2026')?.uses === 1 && codes2.data.codes.length === 2, 'códigos e usos persistidos (sem recriar o PARAENSE01)');
  // senha errada não carrega a conta
  const wrong = await api('/api/login', undefined, { username: 'alice', password: 'errada-123' });
  check(wrong.status === 400 && !('profile' in wrong.data), 'senha errada não carrega conta');
} catch (e) {
  fail++;
  console.error('ERRO', e);
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nResultado: ${pass} verificações aprovadas, ${fail} falhas.`);
process.exit(fail ? 1 : 0);
