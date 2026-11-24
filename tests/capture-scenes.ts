/**
 * Ferramenta de documentação: abre uma partida real (servidor + 2 navegadores),
 * posiciona os jogadores por meio dos ganchos de teste do servidor e salva
 * capturas para docs/capturas (iluminação, criatura, minimapa, celular).
 * Uso: npm run build && npx tsx tests/capture-scenes.ts [pasta]
 */
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app';

// funciona tanto via tsx (tests/) quanto compilado (dist/tests/)
let root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (basename(root) === 'dist') root = join(root, '..');
const require = createRequire(import.meta.url);
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/npm-tools/node_modules/playwright'));
}
const out = process.argv[2] ?? join(root, 'docs', 'capturas');
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const app = await createApp({ port: 0, host: '127.0.0.1', dataFile: null, publicDir: join(root, 'dist', 'public'), countdown: 0.2, log: false });
const BASE = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/?debug`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function player(name: string, touch: boolean, vw = 1280, vh = 720) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem('veu.settings.v1', JSON.stringify({ touchControls: t ? 'sempre' : 'nunca', quality: 'alta', textures: 'alta', grain: false })), touch);
  await page.goto(BASE);
  await page.getByText('CLIQUE OU PRESSIONE ENTER').waitFor();
  await page.mouse.click(vw / 2, vh / 2);
  await page.getByRole('tab', { name: 'Convidado' }).click();
  await page.fill('#u', name);
  await page.getByRole('button', { name: 'Jogar como convidado' }).click();
  await page.locator('.menu-item', { hasText: 'Perfil' }).waitFor();
  return page;
}
try {
  const a = await player('Ana', false);
  const b = await player('Beto', true, 1280, 600);
  await a.locator('.menu-item', { hasText: 'Jogar' }).click();
  await a.getByRole('button', { name: 'Criar sala' }).click();
  const code = ((await a.locator('.code-box').textContent()) ?? '').trim();
  await b.locator('.menu-item', { hasText: 'Jogar' }).click();
  await b.fill('input[placeholder="EX: K7QPM"]', code);
  await b.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await b.locator('.code-box').waitFor();
  await b.getByRole('button', { name: 'Entidade', exact: true }).click();
  await b.getByRole('button', { name: 'Estou pronto' }).click();
  await sleep(300);
  await a.getByRole('button', { name: 'Iniciar partida' }).click();
  for (const p of [a, b]) await p.waitForFunction(() => (window as never as { __veu?: { hud: { state: { ready: boolean } } } }).__veu?.hud.state.ready, null, { timeout: 60000 });
  await a.mouse.click(640, 360); // fecha o aviso "Clique para assumir o controle"
  await sleep(500);
  const m = app.rooms.rooms.get(code)!.match!;
  const ids = m.debugState().players;
  const surv = ids.find((p) => p.role === 'survivor')!.id;
  const ent = ids.find((p) => p.role === 'entity')!.id;
  const place = async (sx: number, sz: number, ex: number, ez: number) => {
    m.debugSet(surv, { x: sx, z: sz });
    m.debugSet(ent, { x: ex, z: ez, yaw: Math.atan2(-(sx - ex), -(sz - ez)), revealUntil: 1e9, camoT: 0, camo: false } as never);
    await sleep(700);
    await a.evaluate(([x, z]) => (window as never as { __veu: { lookAt(x: number, z: number): void } }).__veu.lookAt(x, z), [ex, ez]);
    await b.evaluate(([x, z]) => (window as never as { __veu: { lookAt(x: number, z: number): void } }).__veu.lookAt(x, z), [sx, sz]);
    await sleep(1500);
  };
  // 1) laboratório, energia desligada (luz de emergência), criatura à frente
  await place(70, 36, 75, 36);
  await a.screenshot({ path: join(out, '40-laboratorio-criatura.png') });
  // 2) corredor norte iluminado
  await place(40, 23, 60, 23);
  await a.screenshot({ path: join(out, '41-corredor-iluminado.png') });
  // 3) visão da entidade (celular, modo de toque)
  await place(57, 31, 53, 31);
  await b.screenshot({ path: join(out, '42-celular-entidade.png') });
  // 4) refeitório + minimapa ampliado
  await place(40, 10, 46, 12);
  await a.keyboard.press('KeyM');
  await sleep(600);
  await a.screenshot({ path: join(out, '43-minimapa-ampliado.png') });
  await a.keyboard.press('KeyM');
  // 5) terceira pessoa
  await a.keyboard.press('KeyC');
  await place(30, 37, 34, 37);
  await a.screenshot({ path: join(out, '44-terceira-pessoa.png') });
  console.log('capturas salvas em', out);
} finally {
  await browser.close();
  await app.close();
}
