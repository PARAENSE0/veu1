/**
 * Testes de navegador complementares (Chrome real + servidor real no mesmo processo):
 *  - interface em várias resoluções (celular retrato/paisagem, tablet, notebook, full HD):
 *    nada vaza da tela e o minimapa fica no canto superior esquerdo sem cobrir o HUD;
 *  - assistência de mira no PC e no celular: puxa a câmera para a entidade visível,
 *    não atira sozinha e não age atrás de parede;
 *  - o novo modelo da entidade aparece para o sobrevivente na posição do servidor;
 *  - minimapa atualiza a posição do jogador em tempo real.
 * Uso: npm run build && npx tsx tests/browser-extra.ts
 */
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app';
import { getMap } from '../shared/map';
import { lineOfSight, makeGrid } from '../shared/physics';

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
const SHOTS = process.env.SHOTS ?? join(root, 'tests', 'screenshots', 'extra');
mkdirSync(SHOTS, { recursive: true });
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
type Page = import('playwright').Page;
type W = { __veu: { hud: { state: Record<string, never> }; debugState(): { x: number; z: number; yaw: number; visible: string[]; you: { wpn: { mag: Record<string, number> } } }; lookAt(x: number, z: number): void; minimapInfo(): { me: { x: number; z: number } } } };

const app = await createApp({ port: 0, host: '127.0.0.1', dataFile: null, publicDir: join(root, 'dist', 'public'), countdown: 0.2, log: false });
const BASE = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/?debug`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors: string[] = [];
async function player(name: string, touch: boolean, vw: number, vh: number) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem('veu.settings.v1', JSON.stringify({ touchControls: t ? 'sempre' : 'nunca', quality: 'baixa', aimAssist: 'auto' })), touch);
  await page.goto(BASE);
  await page.getByText('CLIQUE OU PRESSIONE ENTER').waitFor();
  await page.mouse.click(vw / 2, vh / 2);
  await page.getByRole('tab', { name: 'Convidado' }).click();
  await page.fill('#u', name);
  await page.getByRole('button', { name: 'Jogar como convidado' }).click();
  await page.locator('.menu-item', { hasText: 'Perfil' }).waitFor();
  return page;
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

try {
  console.log('[1] Interface em diferentes resoluções');
  const sizes: [string, number, number, boolean][] = [
    ['celular retrato', 390, 844, true],
    ['celular paisagem', 844, 390, true],
    ['tablet', 1024, 768, true],
    ['notebook', 1366, 768, false],
    ['full HD', 1920, 1080, false],
  ];
  for (const [label, w, h, touch] of sizes) {
    const p = await player(`T${w}`, touch, w, h);
    let worst = await overflow(p);
    for (const item of ['Perfil', 'Ranking', 'Amigos', 'Melhorias', 'Código de presente', 'Estatísticas', 'Configurações']) {
      await p.locator('.menu-item', { hasText: item }).first().click();
      await p.locator('.topbar').waitFor();
      await sleep(150);
      worst = Math.max(worst, await overflow(p));
      if (item === 'Melhorias') await p.screenshot({ path: join(SHOTS, `melhorias-${w}x${h}.png`) });
      await p.getByRole('button', { name: '← Voltar' }).click();
    }
    await p.screenshot({ path: join(SHOTS, `menu-${w}x${h}.png`) });
    check(worst <= 1, `${label} ${w}x${h}: nenhuma tela do menu vaza na horizontal (excesso ${worst}px)`);
    await p.context().close();
  }

  console.log('[2] Partida: HUD, minimapa, mira e o novo modelo');
  const a = await player('Ana', false, 1366, 768);
  const t = await player('Tati', true, 844, 390);
  const b = await player('Beto', false, 1280, 720);
  await a.locator('.menu-item', { hasText: 'Jogar' }).click();
  await a.getByRole('button', { name: 'Criar sala' }).click();
  const code = ((await a.locator('.code-box').textContent()) ?? '').trim();
  for (const p of [t, b]) {
    await p.locator('.menu-item', { hasText: 'Jogar' }).click();
    await p.fill('input[placeholder="EX: K7QPM"]', code);
    await p.locator('form').getByRole('button', { name: 'Entrar' }).click();
    await p.locator('.code-box').waitFor();
    if (p === b) await p.getByRole('button', { name: 'Entidade', exact: true }).click();
    await p.getByRole('button', { name: 'Estou pronto' }).click();
  }
  await sleep(400);
  await a.getByRole('button', { name: 'Iniciar partida' }).click();
  for (const p of [a, t, b]) await p.waitForFunction(() => (window as unknown as W).__veu?.hud.state.ready, null, { timeout: 60000 });
  await a.mouse.click(683, 384);
  await b.mouse.click(640, 360);
  await sleep(500);
  const m = app.rooms.rooms.get(code)!.match!;
  const ps = m.debugState().players;
  const entId = ps.find((p) => p.role === 'entity')!.id;
  const idOf = async (p: Page) => (await p.evaluate(() => (window as unknown as { __veu: { intro: { you: string } } }).__veu.intro.you)) as string;
  const aId = await idOf(a);
  const tId = await idOf(t);
  check(ps.find((p) => p.id === entId) && (await idOf(b)) === entId, 'Beto é a entidade');

  // HUD: minimapa no canto superior esquerdo sem sobrepor outros painéis
  for (const [p, label] of [
    [a, 'PC 1366x768'],
    [t, 'celular 844x390'],
  ] as const) {
    const boxes = (await p.evaluate(() => {
      // sem funções nomeadas aqui dentro (o tsx injeta __name, que não existe na página)
      const out: Record<string, unknown> = { vw: innerWidth, vh: innerHeight };
      for (const [k, sel] of [
        ['mm', '.minimap'],
        ['obj', '.objectives'],
        ['tc', '.hud-tc'],
        ['bl', '.hud-bl'],
        ['tr', '.touch-top'],
      ]) {
        const e = document.querySelector(sel);
        if (!e) {
          out[k] = null;
          continue;
        }
        const b = e.getBoundingClientRect();
        out[k] = { x: b.x, y: b.y, w: b.width, h: b.height };
      }
      return out;
    })) as Record<'mm' | 'obj' | 'tc' | 'bl' | 'tr', { x: number; y: number; w: number; h: number } | null> & { vw: number; vh: number };
    const ov = (x: { x: number; y: number; w: number; h: number } | null, y: { x: number; y: number; w: number; h: number } | null) => !!x && !!y && x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h;
    check(boxes.mm && boxes.mm.x < 30 && boxes.mm.y < 30, `${label}: minimapa no canto superior esquerdo (${Math.round(boxes.mm!.x)},${Math.round(boxes.mm!.y)})`);
    check(!ov(boxes.mm, boxes.obj) && !ov(boxes.mm, boxes.tc) && !ov(boxes.mm, boxes.bl) && !ov(boxes.mm, boxes.tr), `${label}: minimapa não cobre objetivos, relógio, vitais ou botões`);
    check(boxes.mm!.x + boxes.mm!.w <= boxes.vw && boxes.mm!.y + boxes.mm!.h <= boxes.vh, `${label}: minimapa cabe na tela`);
  }
  // celular: toque no minimapa amplia e o ✕ reduz
  await t.locator('.minimap').tap();
  await t.locator('.minimap.big').waitFor({ timeout: 2000 });
  const big = await t.locator('.minimap.big canvas').boundingBox();
  check(!!big && big.width <= 844 && big.height <= 390, `celular: toque amplia o minimapa dentro da tela (${Math.round(big!.width)}x${Math.round(big!.height)})`);
  await t.screenshot({ path: join(SHOTS, 'celular-minimapa-ampliado.png') });
  await t.locator('.minimap-close').tap();
  check(await t.locator('.minimap.big').waitFor({ state: 'detached', timeout: 2000 }).then(() => true, () => false), 'celular: ✕ reduz o minimapa');

  // minimapa acompanha a posição real em tempo real
  m.debugSet(aId, { x: 21, z: 23 });
  await sleep(500);
  const p1 = await a.evaluate(() => (window as unknown as W).__veu.minimapInfo().me);
  m.debugSet(aId, { x: 31, z: 23 });
  await sleep(500);
  const p2 = await a.evaluate(() => (window as unknown as W).__veu.minimapInfo().me);
  check(Math.abs(p1.x - 21) < 0.6 && Math.abs(p2.x - 31) < 0.6, `minimapa segue a posição do servidor (${p1.x.toFixed(1)} → ${p2.x.toFixed(1)})`);

  // mira assistida: entidade visível um pouco fora do centro da mira
  const grid = makeGrid(getMap('abissal'));
  const aimCase = async (p: Page, id: string, label: string) => {
    const S = { x: 66, z: 36 };
    const E = { x: 66 + 0.9, z: 36 - 8 }; // ~6° para a direita, 8 m à frente
    check(lineOfSight(grid, S.x, S.z, E.x, E.z), `${label}: linha de visão livre no cenário de teste`);
    m.debugSet(id, { x: S.x, z: S.z, yaw: 0 });
    m.debugSet(entId, { x: E.x, z: E.z, revealUntil: 1e9, camo: false, camoT: 0 } as never);
    await sleep(600);
    await p.evaluate(([x, z]) => {
      const v = (window as unknown as W).__veu;
      v.lookAt(x - 1.6, z); // mira desviada ~11° para a esquerda da entidade
    }, [E.x, E.z]);
    const before = await p.evaluate(() => (window as unknown as W).__veu.debugState());
    const want = Math.atan2(-(E.x - S.x), -(E.z - S.z));
    const err0 = Math.abs(before.yaw - want);
    await sleep(1500);
    const after = await p.evaluate(() => (window as unknown as W).__veu.debugState());
    const err1 = Math.abs(after.yaw - want);
    check(after.visible.includes(entId), `${label}: o novo modelo da entidade está visível/sincronizado para o sobrevivente`);
    check(err1 < err0 * 0.5, `${label}: assistência puxa a mira para a entidade (erro ${(err0 * 57.3).toFixed(1)}° → ${(err1 * 57.3).toFixed(1)}°)`);
    check(JSON.stringify(after.you.wpn.mag) === JSON.stringify(before.you.wpn.mag), `${label}: não atira sozinha (munição inalterada)`);
    await p.screenshot({ path: join(SHOTS, `mira-${label.replace(/\W+/g, '_')}.png`) });
    return err1;
  };
  const gPc = await aimCase(a, aId, 'PC');
  m.debugSet(aId, { x: 21, z: 23 });
  const gTouch = await aimCase(t, tId, 'celular');
  check(gTouch <= gPc + 1e-3, `no celular a mira fica mais perto do alvo que no PC após 1,5 s (erro final ${(gTouch * 57.3).toFixed(1)}° vs ${(gPc * 57.3).toFixed(1)}°)`);
  // atrás de parede: sem ajuda
  m.debugSet(tId, { x: 21, z: 23 });
  const S = { x: 66, z: 36 };
  const W2 = { x: 54.5, z: 36 }; // atrás da parede oeste do laboratório
  check(!lineOfSight(grid, S.x, S.z, W2.x, W2.z), 'cenário: parede entre o sobrevivente e a entidade');
  m.debugSet(aId, { x: S.x, z: S.z });
  m.debugSet(entId, { x: W2.x, z: W2.z, revealUntil: 1e9 } as never);
  await sleep(600);
  await a.evaluate(([x, z]) => (window as unknown as W).__veu.lookAt(x, z + 0.8), [W2.x, W2.z]);
  const y0 = (await a.evaluate(() => (window as unknown as W).__veu.debugState())).yaw;
  await sleep(1200);
  const y1 = (await a.evaluate(() => (window as unknown as W).__veu.debugState())).yaw;
  check(Math.abs(y1 - y0) < 0.002, `atrás de parede a mira não se move sozinha (Δ ${(Math.abs(y1 - y0) * 57.3).toFixed(2)}°)`);
  check(errors.length === 0, `sem erros de JavaScript${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  fail++;
  console.error('ERRO', e);
} finally {
  await browser.close();
  await app.close();
}
console.log(`\nResultado: ${pass} verificações aprovadas, ${fail} falhas.`);
process.exit(fail ? 1 : 0);
