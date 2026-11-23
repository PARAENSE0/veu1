/**
 * Teste de navegador (Chrome real via Playwright): dois jogadores percorrem a
 * interface, entram na mesma sala, jogam uma partida real com renderização
 * WebGL2, usam controles, abrem menus, testam a voz (WebRTC com microfone
 * simulado) e terminam com a tela de resultados.
 *
 * Uso: npm run build && node tests/browser-smoke.mjs
 * Variáveis: CHROME=/caminho/do/chrome  SHOTS=pasta-de-capturas
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/npm-tools/node_modules/playwright'));
}
const SHOTS = process.env.SHOTS ?? join(root, 'tests', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}/?debug`;

let passes = 0;
let failures = 0;
const check = (c, m) => {
  if (c) {
    passes++;
    console.log(`  ✔ ${m}`);
  } else {
    failures++;
    console.log(`  ✘ FALHOU: ${m}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'veu-browser-'));
const server = spawn(process.execPath, [join(root, 'dist', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_FILE: join(dir, 'db.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (d) => process.stderr.write('[servidor] ' + d));
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('ouvindo') && res()));

const browser = await chromium.launch({
  // usa o Chrome do sistema se existir; senão o Chromium do Playwright (npx playwright install chromium)
  executablePath: process.env.CHROME || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
async function newPlayer(name, touch) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  await page.addInitScript((t) => localStorage.setItem('veu.settings.v1', JSON.stringify({ touchControls: t ? 'sempre' : 'nunca', quality: 'media', showFps: true })), touch);
  await page.goto(BASE);
  await page.getByText('CLIQUE OU PRESSIONE ENTER').waitFor({ timeout: 8000 });
  return page;
}
const hud = (page) => page.evaluate(() => window.__veu?.hud.state);
const dbg = (page) => page.evaluate(() => window.__veu?.debugState());
const shot = (page, n) => page.screenshot({ path: join(SHOTS, n) });

try {
  console.log('[1] Entrada e contas');
  const a = await newPlayer('Ana', false);
  await a.waitForTimeout(600);
  await shot(a, '01-tela-inicial.png');
  await a.mouse.click(640, 360);
  await a.getByRole('tab', { name: 'Criar conta' }).click();
  await a.fill('#u', 'anabeatriz');
  await a.fill('#p', 'senha-segura-1');
  await a.fill('#p2', 'senha-segura-1');
  await shot(a, '02-cadastro.png');
  await a.getByRole('button', { name: 'Criar conta' }).last().click();
  await a.getByText('Personalização').waitFor({ timeout: 5000 });
  check(true, 'cadastro pela interface leva ao menu principal');
  await shot(a, '03-menu.png');

  const b = await newPlayer('Beto', true);
  await b.mouse.click(640, 360);
  await b.getByRole('tab', { name: 'Convidado' }).click();
  await b.fill('#u', 'Beto');
  await b.getByRole('button', { name: 'Jogar como convidado' }).click();
  await b.getByText('Personalização').waitFor({ timeout: 5000 });
  check(true, 'entrada como convidado');

  console.log('[2] Telas do menu');
  for (const [item, title, file] of [
    ['Loja de cosméticos', 'Loja de cosméticos', '04-loja.png'],
    ['Inventário', 'Inventário', '05-inventario.png'],
    ['Estatísticas', 'Estatísticas e progresso', '06-estatisticas.png'],
    ['Configurações', 'Configurações', '07-configuracoes.png'],
  ]) {
    await a.locator('.menu-item', { hasText: item }).click();
    await a.getByRole('heading', { name: title }).waitFor({ timeout: 3000 });
    await shot(a, file);
    await a.getByRole('button', { name: '← Voltar' }).click();
    check(true, `tela "${title}" abre e volta`);
  }
  await a.locator('.menu-item', { hasText: 'Personalização' }).click();
  await a.locator('.tab', { hasText: 'Roupa' }).click();
  await a.locator('.card', { hasText: 'Jaqueta térmica' }).click();
  await a.getByRole('button', { name: 'Salvar' }).click();
  await a.getByText('Aparência salva.').waitFor({ timeout: 3000 });
  await shot(a, '08-personalizacao.png');
  check(true, 'personalização salva no servidor');
  await a.getByRole('button', { name: '← Voltar' }).click();

  console.log('[3] Sala, código, lobby e voz');
  await a.locator('.menu-item', { hasText: 'Jogar' }).click();
  await a.getByRole('button', { name: 'Criar sala' }).click();
  await a.locator('.code-box').waitFor({ timeout: 4000 });
  const code = (await a.locator('.code-box').textContent()).trim();
  check(/^[A-Z2-9]{5}$/.test(code), `sala criada com código ${code}`);
  await b.locator('.menu-item', { hasText: 'Jogar' }).click();
  await b.fill('input[placeholder="EX: K7QPM"]', code.toLowerCase());
  await b.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await b.locator('.code-box').waitFor({ timeout: 4000 });
  check(true, 'segundo jogador entrou pelo código');
  await b.getByRole('button', { name: 'Entidade', exact: true }).click();
  await b.getByRole('button', { name: 'Estou pronto' }).click();
  await b.fill('input[placeholder="Mensagem…"]', 'boa sorte!');
  await b.getByRole('button', { name: 'Enviar' }).click();
  await a.getByText('boa sorte!').waitFor({ timeout: 3000 });
  check(true, 'chat do lobby entre os jogadores');
  // voz com microfone simulado
  await a.getByRole('button', { name: /Ligar microfone/ }).click();
  await b.getByRole('button', { name: /Ligar microfone/ }).click();
  const ids = await Promise.all([a, b].map((p) => p.evaluate(() => window.__voice && JSON.parse(JSON.stringify(null)))));
  void ids;
  let voiceState = 'none';
  for (let i = 0; i < 40 && voiceState !== 'connected'; i++) {
    await sleep(250);
    voiceState = await a.evaluate(() => {
      const v = window.__voice;
      const peers = v && v['peers'];
      if (!peers) return 'none';
      const first = [...peers.values()][0];
      return first ? first.pc.connectionState : 'none';
    });
  }
  check(voiceState === 'connected', `voz WebRTC conectada entre os dois jogadores (estado: ${voiceState})`);
  await shot(a, '09-lobby.png');

  console.log('[4] Partida');
  await a.getByRole('button', { name: 'Iniciar partida' }).click();
  await a.locator('.countdown').waitFor({ timeout: 3000 });
  check(true, 'contagem regressiva exibida');
  await a.waitForFunction(() => window.__veu?.hud.state.ready, null, { timeout: 30000 });
  await b.waitForFunction(() => window.__veu?.hud.state.ready, null, { timeout: 30000 });
  const ha = await hud(a);
  const hb = await hud(b);
  check(ha.role === 'survivor' && hb.role === 'entity', 'funções: Ana sobrevivente, Beto entidade');
  check(ha.tasks.length === 2, 'objetivos da fase 1 aparecem no HUD');
  await shot(a, '10-partida-clique.png');
  await a.mouse.click(640, 360);
  await sleep(400);
  const p0 = await dbg(a);
  await a.keyboard.down('KeyW');
  await a.keyboard.down('ShiftLeft');
  await sleep(1500);
  await a.keyboard.up('ShiftLeft');
  await a.keyboard.up('KeyW');
  await sleep(500);
  const p1 = await dbg(a);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const srv = Math.hypot(p1.you.x - p1.x, p1.you.z - p1.z);
  check(moved > 2, `movimento WASD + corrida (${moved.toFixed(1)} m)`);
  check(srv < 0.6, `posição prevista confere com a do servidor (diferença ${srv.toFixed(2)} m)`);
  const h2 = await hud(a);
  check(h2.stamina < 100, 'correr consome fôlego');
  await shot(a, '11-sobrevivente-1p.png');
  await a.keyboard.press('KeyC');
  await sleep(400);
  await shot(a, '12-sobrevivente-3p.png');
  await a.keyboard.press('KeyC');
  const fl0 = (await hud(a)).flash;
  await a.keyboard.press('KeyF');
  await sleep(700);
  const fl1 = (await hud(a)).flash;
  check(fl0 === true && fl1 === false, `lanterna desliga (F) [${fl0} -> ${fl1}] ${errors.join('|')}`);
  await a.keyboard.press('KeyF');
  // armas
  check(await a.locator('.weapon-panel').isVisible(), 'painel de arma e munição visível no HUD');
  const w0 = (await hud(a)).wpn;
  await a.mouse.down();
  await sleep(80);
  await a.mouse.up();
  const fired = await a
    .waitForFunction((m) => window.__veu.hud.state.wpn.mag.pistola === m - 1, w0.mag.pistola, { timeout: 4000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  check(fired, `disparo com o mouse gasta munição validada pelo servidor (${w0.mag.pistola} → ${w0.mag.pistola - 1})`);
  await a.keyboard.press('KeyR');
  const reloaded = await a
    .waitForFunction(() => window.__veu.hud.state.wpn.mag.pistola === 8, null, { timeout: 5000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  check(reloaded, 'recarga (R) completa o pente usando a reserva');
  await a.keyboard.press('KeyQ');
  const switched = await a
    .waitForFunction(() => window.__veu.hud.state.wpn.sel === 'fuzil', null, { timeout: 4000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  check(switched, 'troca de arma (Q) para o fuzil');
  await shot(a, '13b-arma-fuzil.png');
  await a.keyboard.press('KeyQ');
  await a.keyboard.press('KeyQ');
  await a.keyboard.press('Tab');
  await a.getByRole('heading', { name: 'Inventário' }).waitFor({ timeout: 2000 });
  await shot(a, '13-inventario-partida.png');
  check(true, 'inventário abre (Tab)');
  await a.getByRole('button', { name: /Fechar/ }).click();
  await sleep(1200);
  await a.mouse.click(640, 360);
  // entidade
  const until = async (page, fn, ms = 4000) => {
    try {
      await page.waitForFunction(fn, null, { timeout: ms, polling: 100 });
      return true;
    } catch {
      return false;
    }
  };
  await b.keyboard.press('KeyQ');
  check(await until(b, () => window.__veu.hud.state.act.rastro > 0), 'entidade ativa RASTRO (Q)');
  await b.keyboard.press('KeyR');
  check(await until(b, () => window.__veu.hud.state.cd.eco > 0), 'entidade usa ECO FALSO (R)');
  await b.keyboard.press('KeyC');
  await b.keyboard.down('KeyW');
  await sleep(800);
  await b.keyboard.press('Space');
  check(await until(b, () => window.__veu.hud.state.cd.ruptura > 0), 'entidade usa RUPTURA (Espaço)');
  await shot(b, '14-entidade-ruptura-3p.png');
  await b.keyboard.up('KeyW');
  await b.keyboard.press('KeyF');
  check(await until(b, () => window.__veu.hud.state.cd.parasita > 0), 'entidade usa PARASITA (F)');
  await shot(b, '15-entidade-toque.png');
  const db = await dbg(b);
  check(db.fps > 0 && db.drawCalls > 10, `renderização ativa (${db.fps} FPS em software, ${db.drawCalls} chamadas)`);
  // menu e configurações durante a partida
  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: 'Voltar ao jogo' }).waitFor({ timeout: 2000 });
  await a.getByRole('button', { name: 'Configurações' }).click();
  await a.locator('.tab', { hasText: 'Gráficos' }).waitFor();
  await shot(a, '16-menu-config-partida.png');
  check(true, 'menu da partida e configurações abrem (Esc)');
  await a.locator('.tab', { hasText: 'Gráficos' }).click();
  await a.getByRole('button', { name: 'Voltar', exact: true }).click();
  await a.getByRole('button', { name: 'Voltar ao jogo' }).click();
  // entidade abandona -> sobreviventes vencem
  await b.getByRole('button', { name: 'Menu' }).dispatchEvent('pointerdown');
  await b.getByRole('button', { name: 'Abandonar partida' }).click();
  await b.getByRole('button', { name: 'Abandonar', exact: true }).click();
  await a.locator('.result-head', { hasText: 'VITÓRIA' }).waitFor({ timeout: 8000 });
  check(true, 'abandono da entidade: tela de VITÓRIA para o sobrevivente');
  await shot(a, '17-resultado.png');
  await a.getByRole('button', { name: 'Voltar ao lobby' }).click();
  await a.locator('.code-box').waitFor({ timeout: 3000 });
  check(true, 'retorno ao lobby após a partida');
  await a.getByRole('button', { name: '← Voltar' }).click();
  await a.locator('.menu-item', { hasText: 'Histórico de partidas' }).click();
  await a.locator('table.list tbody tr').first().waitFor({ timeout: 3000 });
  await shot(a, '18-historico.png');
  check((await a.locator('table.list tbody tr').count()) === 1, 'histórico mostra a partida');
  check(errors.length === 0, `sem erros de JavaScript no console${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  failures++;
  console.error('ERRO:', e);
  if (errors.length) console.error('Erros do console:', errors.join('\n'));
} finally {
  await browser.close();
  server.kill();
}
console.log(`\nResultado: ${passes} verificações aprovadas, ${failures} falhas.`);
process.exit(failures ? 1 : 0);
