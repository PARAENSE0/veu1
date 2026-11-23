/**
 * GameClient: liga rede, predição, interpolação, renderização, áudio e HUD.
 *
 * - O jogador local é previsto com o MESMO código de física do servidor
 *   (shared/physics) e reconciliado a cada snapshot (descarta comandos já
 *   confirmados e reaplica os pendentes).
 * - Jogadores remotos são interpolados ~110 ms no passado.
 * - Nada é decidido aqui: ações são enviadas como intenção ao servidor.
 */
import { ABILITIES, CELL, DT, FLAMER, GUNS, SUPPLY_INFO, WEAPON_ORDER, type SupplyKind, type WeaponId, ENT, ENTITY_AUDIBLE_RADIUS, EYE_HEIGHT, CROUCH_EYE, DOWNED_EYE, ENTITY_EYE, INTERACT_RANGE, INTERP_DELAY_MS, ITEM_INFO, PLAYER_RADIUS, SURV, WALL_H, type AbilityId } from '../../../shared/constants';
import { getMap, type MapDef } from '../../../shared/map';
import { BTN, isOpaque, isSolid, lineOfSight, makeGrid, pickTarget, raycast, stepMove, type Grid, type InputCmd, type MoveParams, type MoveState } from '../../../shared/physics';
import { resolveAppearance, type Appearance, type Loadout } from '../../../shared/progression';
import { PF, type EcoType, type GameEvent, type MatchIntro, type ServerMsg, type Snapshot } from '../../../shared/protocol';
import { getSettings, qualityOf, subscribeSettings } from '../settings';
import type { Net } from '../net';
import { audio } from './audio';
import { HudStore, type FeedLine } from './hudstore';
import { Input } from './input';
import { clamp, lerp, lerpAngle, mat4, rotX, rotY, scale, translate, identity } from './math';
import { drawEntity, drawSupply, drawSurvivor, drawWeapon } from './models';
import { Renderer, type Mesh, type PointLight, type SpotLight } from './renderer';
import { LAYER } from './textures';
import { buildWorldGeom } from './world';
import type { Voice } from './voice';

interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number;
  spd: number;
}

interface Remote {
  id: string;
  name: string;
  role: 'survivor' | 'entity';
  ap: Appearance;
  buf: Sample[];
  visible: boolean;
  // estado renderizado
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number;
  spd: number;
  phase: number;
  stepAcc: number;
  lastX: number;
  lastZ: number;
  attackAt: number;
  abilityAt: Partial<Record<AbilityId, number>>;
}

function weaponOf(f: number): WeaponId {
  return f & PF.WPN_FLAME ? 'lanca' : f & PF.WPN_RIFLE ? 'fuzil' : 'pistola';
}

const ECO_ORDER: EcoType[] = ['passos', 'porta', 'radio', 'alarme', 'presenca'];
export const ECO_NAMES: Record<EcoType, string> = { passos: 'Passos', porta: 'Porta', radio: 'Rádio', alarme: 'Alarme', presenca: 'Presença' };

export class GameClient {
  readonly hud = new HudStore();
  readonly map: MapDef;
  readonly grid: Grid;
  renderer: Renderer;
  input: Input;
  private world: Mesh;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private seq = 0;
  private pending: InputCmd[] = [];
  private pred: MoveState;
  private smoothX = 0;
  private smoothZ = 0;
  yaw = 0;
  pitch = 0;
  private snap: Snapshot | null = null;
  private remotes = new Map<string, Remote>();
  private myAp: Appearance;
  private time = 0;
  private doorAnim = new Map<number, number>();
  private particles: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; r: number; g: number; b: number; size: number; grav?: number }[] = [];
  private tracers: { x: number; y: number; z: number; tx: number; ty: number; tz: number; t: number }[] = [];
  private muzzles: { x: number; y: number; z: number; t: number }[] = [];
  private hitT = -9;
  private recoil = 0;
  private dust: Float32Array;
  private pointData = new Float32Array(8 * 2000);
  private pings: { x: number; z: number; t: number; kind: string }[] = [];
  private ghosts: { x: number; z: number; yaw: number; ap: Appearance; until: number; born: number }[] = [];
  private detectorMark: { x: number; z: number; until: number } | null = null;
  private fakeMarks: { x: number; z: number; until: number }[] = [];
  private feedId = 0;
  private feed: FeedLine[] = [];
  private damageFlash = 0;
  private glitch = 0;
  private shake = 0;
  private ecoSel: EcoType = 'passos';
  private thirdPerson: boolean;
  private inventoryOpen = false;
  private menuOpen = false;
  private hudT = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private interactHeld = false;
  private myStepAcc = 0;
  private bob = 0;
  private overlay: CanvasRenderingContext2D;
  private unsub: (() => void)[] = [];
  private prompt: string | null = null;
  private lastSnapAt = 0;
  private flashFlickerSeed = Math.random() * 100;
  voice: Voice | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    readonly intro: MatchIntro,
    private net: Net,
  ) {
    const s = getSettings();
    this.map = getMap(intro.mapId);
    this.grid = makeGrid(this.map);
    this.renderer = new Renderer(canvas, qualityOf(s));
    this.world = this.renderer.upload(buildWorldGeom(this.map));
    this.input = new Input(canvas);
    this.overlay = overlay.getContext('2d')!;
    this.thirdPerson = s.camera === 'terceira';
    const me = intro.players.find((p) => p.id === intro.you)!;
    this.myAp = resolveAppearance(me.loadout);
    for (const p of intro.players) {
      if (p.id === intro.you) continue;
      this.remotes.set(p.id, this.newRemote(p.id, p.name, p.role, p.loadout));
    }
    this.pred = { x: 0, z: 0, yaw: 0, pitch: 0, stamina: SURV.staminaMax, exhausted: false, regenDelay: 0, crouch: false, sprinting: false, speed: 0 };
    this.dust = new Float32Array(qualityOf(s).particles * 3);
    for (let i = 0; i < this.dust.length; i += 3) {
      this.dust[i] = Math.random() * 30 - 15;
      this.dust[i + 1] = Math.random() * WALL_H;
      this.dust[i + 2] = Math.random() * 30 - 15;
    }
    this.unsub.push(net.on((m) => this.onMsg(m)));
    this.unsub.push(
      subscribeSettings(() => {
        const q = qualityOf(getSettings());
        const texChanged = q.texSize !== this.renderer.quality.texSize;
        this.renderer.quality = q;
        if (texChanged) this.renderer.setTextureSize(q.texSize);
        if (this.dust.length !== q.particles * 3) {
          this.dust = new Float32Array(q.particles * 3);
          for (let i = 0; i < this.dust.length; i += 3) {
            this.dust[i] = Math.random() * 30 - 15;
            this.dust[i + 1] = Math.random() * WALL_H;
            this.dust[i + 2] = Math.random() * 30 - 15;
          }
        }
      }),
    );
    const plc = () => {
      if (!this.input.locked && !this.input.isTouch() && this.hud.state.ready && !this.inventoryOpen) {
        this.menuOpen = true;
        this.pushHud();
      }
    };
    document.addEventListener('pointerlockchange', plc);
    this.unsub.push(() => document.removeEventListener('pointerlockchange', plc));
    this.hud.set({ role: intro.role, touch: this.input.isTouch(), thirdPerson: this.thirdPerson, totalSurv: intro.players.filter((p) => p.role === 'survivor').length });
  }

  private newRemote(id: string, name: string, role: 'survivor' | 'entity', loadout: Loadout): Remote {
    return { id, name, role, ap: resolveAppearance(loadout), buf: [], visible: false, x: 0, z: 0, yaw: 0, pitch: 0, f: 0, spd: 0, phase: 0, stepAcc: 0, lastX: 0, lastZ: 0, attackAt: -9, abilityAt: {} };
  }

  get role() {
    return this.intro.role;
  }
  get me() {
    return this.snap?.you;
  }

  start() {
    this.last = performance.now();
    audio.startAmbient();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      try {
        this.frame(dt, now);
      } catch (e) {
        console.error('[jogo] erro no quadro', e);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Estado resumido para testes automatizados. */
  debugState() {
    return { x: this.pred.x, z: this.pred.z, yaw: this.yaw, pending: this.pending.length, you: this.snap?.you, visible: [...this.remotes.values()].filter((r) => r.visible).map((r) => r.id), fps: this.fps, drawCalls: this.renderer.drawCalls, prompt: this.prompt };
  }

  /** Aponta a câmera (usado por testes). */
  lookAt(x: number, z: number) {
    this.yaw = Math.atan2(-(x - this.pred.x), -(z - this.pred.z));
    this.pitch = 0;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const u of this.unsub) u();
    this.input.dispose();
    this.renderer.deleteMesh(this.world);
    audio.stopMatch();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ rede
  private onMsg(m: ServerMsg) {
    if (m.t === 'snap') this.onSnap(m.s);
    else if (m.t === 'ev') for (const e of m.e) this.onEvent(e);
  }

  private onSnap(s: Snapshot) {
    const first = !this.snap;
    this.snap = s;
    this.lastSnapAt = performance.now();
    // portas
    this.grid.doorOpen.fill(0);
    for (const i of s.doors) this.grid.doorOpen[i] = 1;
    // reconciliação do jogador local
    const you = s.you;
    const oldX = this.pred.x + this.smoothX;
    const oldZ = this.pred.z + this.smoothZ;
    this.pred.x = you.x;
    this.pred.z = you.z;
    this.pred.stamina = you.stamina;
    this.pred.exhausted = you.exh;
    this.pred.regenDelay = you.regen;
    this.pending = this.pending.filter((c) => c.seq > you.ack);
    if (!you.hidden && (you.st === 'alive' || you.st === 'downed')) {
      const p = this.params();
      for (const c of this.pending) stepMove(this.grid, this.pred, c, p);
    }
    if (first) {
      this.smoothX = this.smoothZ = 0;
      // olha para o centro do mapa no início
      this.yaw = Math.atan2(-((this.map.w * CELL) / 2 - you.x), -((this.map.h * CELL) / 2 - you.z)) || 0;
      this.hud.set({ ready: true });
    } else {
      const ex = oldX - this.pred.x;
      const ez = oldZ - this.pred.z;
      if (Math.hypot(ex, ez) < 2.5) {
        this.smoothX = ex;
        this.smoothZ = ez;
      } else this.smoothX = this.smoothZ = 0;
    }
    // jogadores remotos
    const now = performance.now();
    const seen = new Set<string>();
    for (const [id, x, z, yaw, pitch, f, spd] of s.pl) {
      if (id === this.intro.you) continue;
      let r = this.remotes.get(id);
      if (!r) continue;
      seen.add(id);
      if (!r.visible) {
        r.buf = [];
        r.x = r.lastX = x;
        r.z = r.lastZ = z;
      }
      r.visible = true;
      r.buf.push({ t: now, x, z, yaw, pitch, f, spd });
      if (r.buf.length > 20) r.buf.shift();
    }
    for (const r of this.remotes.values()) if (!seen.has(r.id)) r.visible = false;
    if (you.eco && !you.eco.includes(this.ecoSel)) this.ecoSel = 'passos';
  }

  private feedLine(text: string, tone: FeedLine['tone'] = 'info') {
    this.feed = [...this.feed.slice(-5), { id: ++this.feedId, text, tone, t: this.time }];
  }

  private nameOf(id: string) {
    if (id === this.intro.you) return 'Você';
    return this.intro.players.find((p) => p.id === id)?.name ?? '???';
  }

  private onEvent(e: GameEvent) {
    switch (e.k) {
      case 'sound':
        audio.play(e.s, { x: e.x, y: 1.3, z: e.z }, e.v ?? 1);
        break;
      case 'hit':
        this.burst(e.x, 1.2, e.z, 18, [0.5, 0.02, 0.02], 3);
        audio.play('impacto', { x: e.x, y: 1, z: e.z });
        if (e.target === this.intro.you) {
          this.damageFlash = 1;
          this.shake = 0.6;
        }
        break;
      case 'shot': {
        const mine = e.id === this.intro.you;
        audio.gunshot(e.w, mine ? null : { x: e.x, y: e.y, z: e.z });
        // origem visual: arma do atirador (na 1ª pessoa, a frente da câmera)
        let ox = e.x;
        let oy = e.y;
        let oz = e.z;
        if (mine) {
          const cp = Math.cos(this.pitch);
          ox = this.pred.x - Math.sin(this.yaw) * cp * 0.6 + Math.cos(this.yaw) * 0.18;
          oz = this.pred.z - Math.cos(this.yaw) * cp * 0.6 - Math.sin(this.yaw) * 0.18;
          oy = e.y - 0.05;
          this.recoil = e.w === 'pistola' ? 1 : 0.6;
        }
        this.tracers.push({ x: ox, y: oy, z: oz, tx: e.tx, ty: e.ty, tz: e.tz, t: this.time });
        this.muzzles.push({ x: ox, y: oy, z: oz, t: this.time });
        if (!e.hit) this.burst(e.tx, e.ty, e.tz, 5, [0.8, 0.75, 0.6], 2);
        break;
      }
      case 'enthit': {
        const glow = [...this.remotes.values()].find((r) => r.role === 'entity')?.ap.entGlow ?? this.myAp.entGlow;
        this.burst(e.x, e.y, e.z, 8, [glow[0] * 0.8, glow[1] * 0.5, glow[2] * 0.5], 3);
        if (e.by === this.intro.you) this.hitT = this.time;
        break;
      }
      case 'supply':
        this.burst(e.x, 0.4, e.z, 14, SUPPLY_INFO[e.kind].color, 2.5);
        break;
      case 'entdeath':
        for (let i = 0; i < 6; i++) this.burst(e.x + (Math.random() - 0.5), 1 + Math.random() * 1.5, e.z + (Math.random() - 0.5), 25, [1, 0.35, 0.2], 6);
        this.feedLine(e.by === this.intro.you ? 'Você destruiu a entidade!' : `${this.nameOf(e.by)} destruiu a entidade!`, 'good');
        this.shake = 1;
        break;
      case 'jumpscare':
        audio.stinger();
        this.damageFlash = 1;
        this.shake = 0.9;
        break;
      case 'down':
        this.feedLine(`${this.nameOf(e.target)} caiu!`, 'bad');
        break;
      case 'death':
        this.deadIds.add(e.target);
        this.feedLine(`${this.nameOf(e.target)} ${e.cause === 'entity' ? 'foi consumido pela entidade' : e.cause === 'bleed' ? 'sangrou até a morte' : e.cause === 'collapse' ? 'foi esmagado pelo colapso' : 'desconectou'}.`, 'bad');
        break;
      case 'revive':
        this.feedLine(`${this.nameOf(e.by)} resgatou ${this.nameOf(e.target)}.`, 'good');
        break;
      case 'escape':
        this.escapedIds.add(e.target);
        this.feedLine(`${this.nameOf(e.target)} escapou!`, 'good');
        break;
      case 'task':
        this.feedLine(`Objetivo concluído: ${e.title}`, 'good');
        break;
      case 'stage':
        this.feedLine(e.text, 'warn');
        break;
      case 'msg':
        this.feedLine(e.text, e.tone === 'warn' ? 'warn' : e.tone === 'good' ? 'good' : 'info');
        break;
      case 'ping':
        this.pings.push({ x: e.x, z: e.z, t: this.time, kind: e.kind });
        break;
      case 'presence':
        this.ghosts.push({ x: e.x, z: e.z, yaw: e.yaw, ap: resolveAppearance(e.loadout), until: this.time + e.dur, born: this.time });
        break;
      case 'parasite': {
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * e.r;
          this.burst(e.x + Math.cos(a) * d, 0.5 + Math.random() * 2.5, e.z + Math.sin(a) * d, 2, [0.6, 0.9, 1], 2);
        }
        const myPos = this.myPos();
        if (Math.hypot(myPos.x - e.x, myPos.z - e.z) < e.r) this.glitch = 1;
        break;
      }
      case 'detector':
        if (Number.isFinite(e.x)) {
          this.detectorMark = { x: e.x, z: e.z, until: this.time + 3.5 };
          this.feedLine(`${e.by === this.intro.players.find((p) => p.id === this.intro.you)?.name ? 'Você' : e.by} usou o detector: ressonância detectada.`, 'warn');
        } else this.feedLine(`${e.by} usou o detector: nada por perto.`, 'info');
        for (const [x, z] of e.fakes) this.fakeMarks.push({ x, z, until: this.time + 4 });
        if (e.fakes.length) this.feedLine(`Detector: ${e.fakes.length} eco(s) FALSO(S) identificado(s).`, 'warn');
        break;
      case 'attack': {
        const r = this.remotes.get(e.id);
        if (r) r.attackAt = this.time;
        if (e.id === this.intro.you) this.myAttackAt = this.time;
        break;
      }
      case 'ability': {
        const r = this.remotes.get(e.id);
        if (r) r.abilityAt[e.a] = this.time;
        if (e.id === this.intro.you) {
          this.myAbilityAt[e.a] = this.time;
          if (e.a === 'rastro') audio.play('rastro', null);
        }
        break;
      }
    }
  }
  private myAttackAt = -9;
  private deadIds = new Set<string>();
  private escapedIds = new Set<string>();
  private myAbilityAt: Partial<Record<AbilityId, number>> = {};

  // ------------------------------------------------------------------ entrada / predição
  private params(): MoveParams {
    const you = this.snap?.you;
    if (this.role === 'entity') {
      return { walk: ENT.speed, sprint: ENT.speed, crouch: ENT.stalkSpeed, mult: you?.mult ?? 1, radius: ENT.radius, useStamina: false, canMove: you?.canMove ?? true, canSprint: false };
    }
    if (you?.st === 'downed') return { walk: SURV.crawl, sprint: SURV.crawl, crouch: SURV.crawl, mult: 1, radius: PLAYER_RADIUS, useStamina: false, canMove: true, canSprint: false };
    return { walk: SURV.walk, sprint: SURV.sprint, crouch: SURV.crouch, mult: you?.mult ?? 1, radius: PLAYER_RADIUS, useStamina: true, canMove: you?.canMove ?? true, canSprint: you?.canSprint ?? true };
  }

  private spectating() {
    const st = this.snap?.you.st;
    return st === 'dead' || st === 'escaped';
  }

  private controlsActive() {
    return !this.menuOpen && (this.input.locked || this.input.isTouch());
  }

  private sampleCmd(): InputCmd {
    const inp = this.input;
    let mx = 0;
    let mz = 0;
    let b = 0;
    if (this.controlsActive() && !this.inventoryOpen) {
      if (inp.isDown('frente')) mz += 1;
      if (inp.isDown('tras')) mz -= 1;
      if (inp.isDown('direita')) mx += 1;
      if (inp.isDown('esquerda')) mx -= 1;
      if (Math.abs(inp.joyX) > 0.05 || Math.abs(inp.joyY) > 0.05) {
        mx = inp.joyX;
        mz = -inp.joyY;
      }
      if (inp.isDown('correr') && this.role === 'survivor') b |= BTN.SPRINT;
      if (inp.isDown('agachar')) b |= BTN.CROUCH;
    }
    return { seq: ++this.seq, mx, mz, yaw: this.yaw, pitch: this.pitch, b };
  }

  private handleActions() {
    const inp = this.input;
    const send = this.net.send.bind(this.net);
    if (!this.controlsActive()) {
      if (this.firing) {
        send({ t: 'act', a: 'fire', on: false });
        this.firing = false;
      }
      if (this.interactHeld) {
        send({ t: 'act', a: 'interact', on: false });
        this.interactHeld = false;
      }
      return;
    }
    if (inp.pressed('camera')) {
      this.thirdPerson = !this.thirdPerson;
    }
    if (this.spectating()) {
      if (inp.mousePressed(0) || inp.pressed('interagir')) send({ t: 'spectate', dir: 1 });
      if (inp.mousePressed(2)) send({ t: 'spectate', dir: -1 });
      return;
    }
    if (inp.pressed('interagir')) {
      send({ t: 'act', a: 'interact', on: true });
      this.interactHeld = true;
    }
    if (inp.released('interagir') && this.interactHeld) {
      send({ t: 'act', a: 'interact', on: false });
      this.interactHeld = false;
    }
    if (this.role === 'survivor') {
      if (inp.pressed('lanterna')) send({ t: 'act', a: 'flashlight' });
      if (inp.pressed('atirar')) {
        send({ t: 'act', a: 'fire', on: true });
        this.firing = true;
      }
      if (inp.released('atirar') && this.firing) {
        send({ t: 'act', a: 'fire', on: false });
        this.firing = false;
      }
      if (inp.pressed('trocarArma') || inp.wheel !== 0) this.cycleWeapon(inp.wheel < 0 ? -1 : 1);
      if (inp.pressed('recarregar')) send({ t: 'act', a: 'reload' });
      if (inp.pressed('inventario')) {
        this.inventoryOpen = !this.inventoryOpen;
        if (this.inventoryOpen) inp.unlock();
      }
      (['item1', 'item2', 'item3', 'item4'] as const).forEach((a, i) => {
        if (inp.pressed(a)) send({ t: 'act', a: 'use', slot: i });
      });
    } else {
      if (inp.mousePressed(0) || this.touchAttack) {
        send({ t: 'act', a: 'attack' });
        this.touchAttack = false;
      }
      if (inp.pressed('rastro')) send({ t: 'act', a: 'ability', id: 'rastro' });
      if (inp.pressed('eco')) send({ t: 'act', a: 'ability', id: 'eco', variant: this.ecoSel });
      if (inp.pressed('ruptura')) send({ t: 'act', a: 'ability', id: 'ruptura' });
      if (inp.pressed('parasita')) send({ t: 'act', a: 'ability', id: 'parasita' });
      if (inp.pressed('ecoProximo') || inp.wheel !== 0) this.cycleEco(inp.wheel < 0 ? -1 : 1);
    }
  }
  touchAttack = false;
  private firing = false;

  /** Troca para a próxima/anterior arma (o servidor confirma pelo snapshot). */
  cycleWeapon(dir: number) {
    const cur = this.snap?.you.wpn?.sel ?? 'pistola';
    const i = WEAPON_ORDER.indexOf(cur);
    this.selectWeapon((i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length);
  }
  selectWeapon(slot: number) {
    this.net.send({ t: 'act', a: 'weapon', slot });
  }
  reload() {
    this.net.send({ t: 'act', a: 'reload' });
  }

  cycleEco(dir: number) {
    const avail = (this.snap?.you.eco ?? ['passos']) as EcoType[];
    const list = ECO_ORDER.filter((e) => avail.includes(e));
    if (!list.length) return;
    const i = list.indexOf(this.ecoSel);
    this.ecoSel = list[(i + dir + list.length) % list.length];
    this.pushHud();
  }

  /** Escolhe diretamente o som do Eco Falso (toque no HUD). */
  setEco(e: EcoType) {
    const avail = (this.snap?.you.eco ?? ['passos']) as EcoType[];
    if (avail.includes(e)) {
      this.ecoSel = e;
      this.pushHud();
    }
  }

  // chamado pela interface
  useSlot(i: number) {
    this.net.send({ t: 'act', a: 'use', slot: i });
  }
  dropSlot(i: number) {
    this.net.send({ t: 'act', a: 'drop', slot: i });
  }
  closeInventory() {
    this.inventoryOpen = false;
    this.pushHud();
  }
  resume() {
    this.menuOpen = false;
    this.inventoryOpen = false;
    if (!this.input.isTouch()) this.canvas.requestPointerLock?.();
    this.pushHud();
  }
  openMenu() {
    this.menuOpen = true;
    this.input.unlock();
    this.pushHud();
  }
  toggleCamera() {
    this.thirdPerson = !this.thirdPerson;
    this.pushHud();
  }

  // ------------------------------------------------------------------ quadro
  private myPos() {
    const you = this.snap?.you;
    if (you && (you.st === 'dead' || you.st === 'escaped') && you.spec) {
      const r = this.remotes.get(you.spec);
      if (r && r.visible) return { x: r.x, z: r.z };
    }
    return { x: this.pred.x + this.smoothX, z: this.pred.z + this.smoothZ };
  }

  private frame(dt: number, now: number) {
    this.time += dt;
    const s = getSettings();
    const inp = this.input;
    // olhar
    if (this.controlsActive() && !this.inventoryOpen) {
      const touch = inp.isTouch();
      const k = touch ? 0.006 * s.touchSens : 0.0022 * s.mouseSens;
      this.yaw -= inp.lookDX * k;
      this.pitch -= inp.lookDY * k * (s.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.4, 1.4);
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    }
    if (inp.keyPressed('Escape')) {
      if (this.inventoryOpen) this.closeInventory();
      else if (!this.menuOpen) this.openMenu();
    }
    this.handleActions();

    // comandos a 30 Hz + predição
    if (this.snap) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 4) {
        this.acc -= DT;
        n++;
        const cmd = this.sampleCmd();
        const you = this.snap.you;
        if (!this.spectating()) {
          this.net.send({ t: 'in', cmds: [cmd] });
          this.pending.push(cmd);
          if (this.pending.length > 90) this.pending.shift();
          if (!you.hidden) stepMove(this.grid, this.pred, cmd, this.params());
        }
      }
      if (this.acc > DT * 4) this.acc = 0;
    }
    const decay = Math.exp(-dt * 12);
    this.smoothX *= decay;
    this.smoothZ *= decay;

    this.updateRemotes(now, dt);
    this.updateParticles(dt);
    this.render(dt);
    this.updateAudio(dt);
    this.computePrompt();

    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
    this.glitch = Math.max(0, this.glitch - dt * 0.6);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.08;
      this.pushHud();
    }
    inp.endFrame();
  }

  private updateRemotes(now: number, dt: number) {
    const rt = now - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      if (!r.visible || !r.buf.length) continue;
      let a = r.buf[0];
      let b = r.buf[r.buf.length - 1];
      for (let i = 0; i < r.buf.length - 1; i++) {
        if (r.buf[i].t <= rt && r.buf[i + 1].t >= rt) {
          a = r.buf[i];
          b = r.buf[i + 1];
          break;
        }
      }
      let k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
      if (rt > b.t) k = 1;
      r.x = lerp(a.x, b.x, k);
      r.z = lerp(a.z, b.z, k);
      r.yaw = lerpAngle(a.yaw, b.yaw, k);
      r.pitch = lerp(a.pitch, b.pitch, k);
      r.f = b.f;
      r.spd = lerp(a.spd, b.spd, k);
      const moved = Math.hypot(r.x - r.lastX, r.z - r.lastZ);
      r.lastX = r.x;
      r.lastZ = r.z;
      r.phase += moved * (r.role === 'entity' ? 2.4 : 3.6);
      // passos remotos
      r.stepAcc += moved;
      const stride = r.role === 'entity' ? 1.5 : r.f & PF.SPRINT ? 1.1 : 0.8;
      if (r.stepAcc >= stride && !(r.f & (PF.HIDDEN | PF.DOWNED))) {
        r.stepAcc = 0;
        let loud = r.f & PF.CROUCH ? 0.12 : r.f & PF.SPRINT ? 1 : 0.5;
        if (r.role === 'entity') loud = r.f & PF.CROUCH ? 0.2 : r.f & PF.DASH ? 1.2 : 0.9;
        audio.step({ x: r.x, y: 0.2, z: r.z }, loud, r.role === 'entity');
      }
      void dt;
    }
  }

  private burst(x: number, y: number, z: number, n: number, c: [number, number, number], speed: number) {
    if (this.renderer.quality.particles === 0 && n > 4) n = 4;
    for (let i = 0; i < n; i++) {
      this.particles.push({ x, y, z, vx: (Math.random() - 0.5) * speed, vy: Math.random() * speed, vz: (Math.random() - 0.5) * speed, life: 0, max: 0.5 + Math.random() * 0.8, r: c[0], g: c[1], b: c[2], size: 0.06 + Math.random() * 0.05 });
    }
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life += dt;
      p.vy -= 6 * (p.grav ?? 1) * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.02, p.y + p.vy * dt);
      p.z += p.vz * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    // faíscas em estações travadas
    if (this.snap)
      for (const id of this.snap.jam) {
        const st = this.map.stations.find((s) => s.id === id);
        if (st && Math.random() < dt * 8) this.burst(st.x + (Math.random() - 0.5), 1.2, st.z + (Math.random() - 0.5), 3, [0.6, 0.85, 1], 3);
      }
  }

  // ------------------------------------------------------------------ câmera
  private camera() {
    const you = this.snap?.you;
    const spec = this.spectating();
    let x = this.pred.x + this.smoothX;
    let z = this.pred.z + this.smoothZ;
    let eye = this.role === 'entity' ? ENTITY_EYE : EYE_HEIGHT;
    if (this.role === 'survivor') {
      if (you?.st === 'downed') eye = DOWNED_EYE;
      else if (this.pred.crouch) eye = CROUCH_EYE;
    } else if (this.pred.crouch) eye = ENTITY_EYE - 0.45;
    let third = this.thirdPerson;
    let yaw = this.yaw;
    if (spec && you?.spec) {
      const r = this.remotes.get(you.spec);
      if (r && r.visible) {
        x = r.x;
        z = r.z;
        eye = r.f & PF.DOWNED ? DOWNED_EYE : r.f & PF.CROUCH ? CROUCH_EYE : EYE_HEIGHT;
      }
      third = true;
    }
    if (you?.hidden) {
      third = false;
      eye = 1.55;
    }
    // balanço da cabeça
    const s = getSettings();
    if (s.headBob && !third && this.pred.speed > 0.5) {
      this.bob += this.pred.speed * 0.016 * 3.4;
      eye += Math.sin(this.bob * 2) * 0.035 * Math.min(1, this.pred.speed / 4);
    }
    let cx = x;
    let cy = eye;
    let cz = z;
    const pitch = this.pitch;
    if (third) {
      const back = this.role === 'entity' ? 3.4 : 2.6;
      const bx = Math.sin(yaw) * Math.cos(pitch * 0.5);
      const bz = Math.cos(yaw) * Math.cos(pitch * 0.5);
      const t = raycast(this.grid, x, z, bx, bz, back, isOpaque);
      const d = Math.max(0.4, t - 0.35);
      cx = x + bx * d;
      cz = z + bz * d;
      cy = eye + 0.35 - Math.sin(pitch) * d * 0.4;
    }
    if (this.shake > 0) {
      cx += (Math.random() - 0.5) * this.shake * 0.08;
      cy += (Math.random() - 0.5) * this.shake * 0.08;
    }
    cy = clamp(cy, 0.25, WALL_H - 0.15);
    return { x: cx, y: cy, z: cz, yaw, pitch, fov: s.fov, third, px: x, pz: z };
  }

  // ------------------------------------------------------------------ renderização
  private render(dt: number) {
    const r = this.renderer;
    const snap = this.snap;
    const cam = this.camera();
    const entityView = this.role === 'entity' && !this.spectating();
    const fog = this.map.fogColor as unknown as number[];
    const ambient = entityView ? [0.3, 0.3, 0.36] : [0.06, 0.066, 0.08];
    r.begin(cam, { ambient, fog, fogDensity: entityView ? 0.02 : 0.048, vision: entityView ? 1 : 0, time: this.time });

    // ---- luzes
    const lights: (PointLight & { d: number })[] = [];
    const lstate = snap?.lights ?? {};
    for (let i = 0; i < this.map.lights.length; i++) {
      const L = this.map.lights[i];
      const st = lstate[L.zone] ?? 0;
      let k = 0;
      if (st === 0) k = L.emergency ? 1.25 + 0.4 * Math.sin(this.time * 2.2 + i) : 0;
      else if (st === 1) k = L.emergency ? 0 : flicker(this.time, i) * 1.15;
      else k = Math.random() < 0.03 ? 0.8 : 0;
      if (k <= 0.01) continue;
      const d = Math.hypot(L.x - cam.x, L.z - cam.z);
      if (d > 34 + L.radius) continue;
      lights.push({ x: L.x, y: L.y, z: L.z, r: L.color[0] * k, g: L.color[1] * k, b: L.color[2] * k, radius: L.radius, d });
    }
    for (const [fx, fz] of snap?.flares ?? []) {
      const k = 2.2 + Math.sin(this.time * 31) * 0.3 + Math.random() * 0.2;
      lights.push({ x: fx, y: 0.5, z: fz, r: 1 * k, g: 0.35 * k, b: 0.12 * k, radius: 10, d: Math.hypot(fx - cam.x, fz - cam.z) - 8 });
    }
    for (const rm of this.remotes.values()) {
      if (rm.role === 'entity' && rm.visible && !(rm.f & PF.CAMO)) {
        const g = rm.ap.entGlow;
        lights.push({ x: rm.x, y: 2.1, z: rm.z, r: g[0] * 0.7, g: g[1] * 0.7, b: g[2] * 0.7, radius: 4.5, d: Math.hypot(rm.x - cam.x, rm.z - cam.z) - 3 });
      }
    }
    // luz de preenchimento suave na 3ª pessoa (para enxergar o próprio personagem)
    if (cam.third) lights.push({ x: cam.x, y: cam.y + 0.3, z: cam.z, r: 0.35, g: 0.38, b: 0.42, radius: 5, d: -1 });
    for (const m of this.muzzles) if (this.time - m.t < 0.07) lights.push({ x: m.x, y: m.y, z: m.z, r: 2.6, g: 1.9, b: 1.0, radius: 7, d: -2 });
    this.muzzles = this.muzzles.filter((m) => this.time - m.t < 0.07);
    for (const fp of this.flamers()) {
      const k = 2 + Math.random() * 0.8;
      lights.push({ x: fp.x - Math.sin(fp.yaw) * 2, y: 1.2, z: fp.z - Math.cos(fp.yaw) * 2, r: 1 * k, g: 0.45 * k, b: 0.12 * k, radius: 8, d: -1.5 });
    }
    for (const rm of this.remotes.values())
      if (rm.visible && rm.role === 'entity' && rm.f & PF.BURNING) lights.push({ x: rm.x, y: 1.5, z: rm.z, r: 1.6, g: 0.6, b: 0.15, radius: 6, d: -1 });
    lights.sort((a, b) => a.d - b.d);
    const spots: SpotLight[] = [];
    const you = snap?.you;
    if (you && this.role === 'survivor' && !this.spectating() && you.flash && !you.hidden && you.st === 'alive') {
      const on = !you.flicker || Math.sin(this.time * 40 + this.flashFlickerSeed) > 0.3;
      if (on) {
        const cp = Math.cos(this.pitch);
        spots.push({ x: cam.px + Math.cos(this.yaw) * 0.18, y: (cam.third ? EYE_HEIGHT : cam.y) - 0.15, z: cam.pz - Math.sin(this.yaw) * 0.18, dx: -Math.sin(this.yaw) * cp, dy: Math.sin(this.pitch), dz: -Math.cos(this.yaw) * cp, cos: 0.85, r: 2.5, g: 2.3, b: 1.9, range: 27 });
      }
    }
    const remoteSpots: (SpotLight & { d: number })[] = [];
    for (const rm of this.remotes.values()) {
      if (!rm.visible || rm.role !== 'survivor' || !(rm.f & PF.FLASH) || rm.f & (PF.HIDDEN | PF.DOWNED)) continue;
      if (rm.f & PF.FLICKER && Math.sin(this.time * 37 + rm.x) < 0.3) continue;
      const cp = Math.cos(rm.pitch);
      remoteSpots.push({ x: rm.x, y: 1.45, z: rm.z, dx: -Math.sin(rm.yaw) * cp, dy: Math.sin(rm.pitch), dz: -Math.cos(rm.yaw) * cp, cos: 0.86, r: 1.7, g: 1.6, b: 1.35, range: 22, d: Math.hypot(rm.x - cam.x, rm.z - cam.z) });
    }
    remoteSpots.sort((a, b) => a.d - b.d);
    spots.push(...remoteSpots);
    r.setLights(lights, spots);

    // ---- mundo
    const M = mat4();
    identity(M);
    r.drawStatic(this.world, M);
    this.drawDynamicWorld(dt, cam);

    // ---- personagens
    const vis = entityView;
    const heat: [number, number, number] = vis ? [0.5, 0.16, 0.05] : [0, 0, 0];
    if (!this.spectating() && (cam.third || this.role === 'entity') && !you?.hidden) {
      if (cam.third) this.drawMe();
    }
    for (const rm of this.remotes.values()) {
      if (!rm.visible || rm.f & PF.HIDDEN) continue;
      if (rm.role === 'survivor') {
        drawSurvivor(r, rm.ap, { x: rm.x, z: rm.z, yaw: rm.yaw, pitch: rm.pitch, speed: rm.spd, phase: rm.phase, crouch: !!(rm.f & PF.CROUCH), downed: !!(rm.f & PF.DOWNED), channel: !!(rm.f & (PF.CHANNEL | PF.HEALING)), flash: !!(rm.f & PF.FLASH), time: this.time, weapon: weaponOf(rm.f), firing: !!(rm.f & PF.FIRE), reloading: !!(rm.f & PF.RELOAD), collecting: !!(rm.f & PF.COLLECT) }, { alpha: 1, emit: heat });
      } else if (!(rm.f & PF.CAMO)) {
        drawEntity(r, rm.ap.entBody, rm.ap.entGlow, this.entityPose(rm), { alpha: 1, emit: [0, 0, 0] });
      }
    }
    // sombras de contato
    if (getSettings().shadows) {
      r.transparent(true);
      const sh = (x: number, z: number, s: number) => {
        identity(M);
        translate(M, x, 0.02, z);
        scale(M, s, 0.01, s);
        r.draw(r.cube, M, { layer: LAYER.DECAL, tint: [0, 0, 0], alpha: 0.55, unlit: 1 });
      };
      for (const rm of this.remotes.values()) if (rm.visible && !(rm.f & (PF.HIDDEN | PF.CAMO))) sh(rm.x, rm.z, rm.role === 'entity' ? 1.6 : 0.9);
      if (cam.third && !this.spectating()) sh(cam.px, cam.pz, this.role === 'entity' ? 1.6 : 0.9);
      r.transparent(false);
    }

    // ---- translúcidos: entidade camuflada, presenças falsas, rastros, sinais
    r.transparent(true);
    for (const rm of this.remotes.values()) {
      if (rm.visible && rm.role === 'entity' && rm.f & PF.CAMO) {
        const a = 0.08 + 0.05 * Math.sin(this.time * 5);
        drawEntity(r, rm.ap.entBody, rm.ap.entGlow, this.entityPose(rm), { alpha: a, emit: [0.02, 0.03, 0.04] });
      }
    }
    for (const g of this.ghosts) {
      if (g.until < this.time) continue;
      const life = (this.time - g.born) / (g.until - g.born);
      const a = Math.min(1, (1 - life) * 3) * 0.75;
      drawSurvivor(r, g.ap, { x: g.x, z: g.z, yaw: g.yaw, pitch: 0, speed: 0.6, phase: this.time * 3, crouch: false, downed: false, channel: false, flash: false, time: this.time }, { alpha: a, emit: [0.02, 0.02, 0.03] });
    }
    this.ghosts = this.ghosts.filter((g) => g.until > this.time);
    r.transparent(false);
    r.additive(true);
    if (snap?.trails?.length) {
      for (const [x, z, age] of snap.trails) {
        identity(M);
        translate(M, x, 0.03, z);
        scale(M, 0.35, 0.01, 0.35);
        const a = clamp(1 - age / 12, 0.1, 1);
        r.draw(r.cube, M, { layer: LAYER.DECAL, tint: [1, 0.15, 0.1], alpha: a, emit: [0.8 * a, 0.08 * a, 0.05 * a], unlit: 1 });
      }
    }
    // traçantes dos disparos
    for (const t of this.tracers) {
      const age = this.time - t.t;
      if (age > 0.06) continue;
      const dx = t.tx - t.x;
      const dy = t.ty - t.y;
      const dz = t.tz - t.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.3) continue;
      identity(M);
      translate(M, (t.x + t.tx) / 2, (t.y + t.ty) / 2, (t.z + t.tz) / 2);
      rotY(M, Math.atan2(dx, dz));
      rotX(M, -Math.atan2(dy, Math.hypot(dx, dz)));
      scale(M, 0.015, 0.015, len);
      r.draw(r.cube, M, { layer: LAYER.PLAIN, tint: [1, 0.85, 0.5], alpha: 0.7, emit: [1, 0.75, 0.4], unlit: 1 });
    }
    this.tracers = this.tracers.filter((t) => this.time - t.t < 0.06);
    // sinais de ruído (entidade): ondas visíveis através das paredes
    r.depthTest(false);
    for (const p of this.pings) {
      const age = this.time - p.t;
      if (age > 2.5) continue;
      const rad = 0.5 + age * 2.4;
      const a = 1 - age / 2.5;
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        identity(M);
        translate(M, p.x + Math.cos(ang) * rad, 1 + Math.sin(this.time * 3 + i) * 0.05, p.z + Math.sin(ang) * rad);
        rotY(M, -ang);
        scale(M, 0.06, 0.06, rad * 0.5);
        r.draw(r.cube, M, { layer: LAYER.PLAIN, tint: [1, 0.25, 0.15], alpha: a * 0.8, emit: [0.9 * a, 0.2 * a, 0.1 * a], unlit: 1 });
      }
    }
    this.pings = this.pings.filter((p) => this.time - p.t < 2.5);
    r.depthTest(true);
    r.additive(false);

    // ---- partículas
    this.emitFireParticles(dt);
    this.drawParticles(cam, fog);
    this.drawViewModel(cam);
    this.drawOverlay(cam);
  }

  private entityPose(rm: { x: number; z: number; yaw: number; pitch: number; spd: number; phase: number; f: number; attackAt: number; abilityAt: Partial<Record<AbilityId, number>> }) {
    const since = (t?: number) => (t === undefined ? 99 : this.time - t);
    const atk = since(rm.attackAt);
    return {
      x: rm.x,
      z: rm.z,
      yaw: rm.yaw,
      pitch: rm.pitch,
      speed: rm.spd,
      phase: rm.phase,
      time: this.time,
      stalk: !!(rm.f & PF.CROUCH),
      attack: atk < ENT.attackWindup ? atk / ENT.attackWindup : atk < ENT.attackWindup + 0.25 ? 1 - (atk - ENT.attackWindup) / 0.25 : 0,
      dash: !!(rm.f & PF.DASH),
      eco: Math.max(0, 1 - since(rm.abilityAt.eco) / 1.5),
      rastro: since(rm.abilityAt.rastro) < ABILITIES.rastro.duration,
      parasite: Math.max(0, 1 - since(rm.abilityAt.parasita) / 2),
    };
  }

  private drawMe() {
    const you = this.snap?.you;
    if (!you) return;
    const x = this.pred.x + this.smoothX;
    const z = this.pred.z + this.smoothZ;
    this.myPhase += this.pred.speed * 0.016 * (this.role === 'entity' ? 2.4 : 3.6);
    if (this.role === 'survivor') {
      const mf = this.myFlags();
      drawSurvivor(this.renderer, this.myAp, { x, z, yaw: this.yaw, pitch: this.pitch, speed: this.pred.speed, phase: this.myPhase, crouch: this.pred.crouch, downed: you.st === 'downed', channel: !!you.ch, flash: you.flash, time: this.time, weapon: you.wpn?.sel, firing: !!(mf & PF.FIRE), reloading: (you.wpn?.reload ?? 0) > 0, collecting: !!(mf & PF.COLLECT) }, { alpha: 1, emit: [0, 0, 0] });
    } else {
      const pose = this.entityPose({ x, z, yaw: this.yaw, pitch: this.pitch, spd: this.pred.speed, phase: this.myPhase, f: (this.pred.crouch ? PF.CROUCH : 0) | ((you.act?.ruptura ?? 0) > 0 ? PF.DASH : 0), attackAt: this.myAttackAt, abilityAt: this.myAbilityAt });
      if (you.camo) {
        this.renderer.transparent(true);
        drawEntity(this.renderer, this.myAp.entBody, this.myAp.entGlow, pose, { alpha: 0.3, emit: [0, 0, 0] });
        this.renderer.transparent(false);
      } else drawEntity(this.renderer, this.myAp.entBody, this.myAp.entGlow, pose, { alpha: 1, emit: [0, 0, 0] });
    }
  }
  private myPhase = 0;

  private myFlags(): number {
    const me = this.snap?.pl.find((p) => p[0] === this.intro.you);
    return me ? me[5] : 0;
  }

  private supplyPrompt(kind: SupplyKind): string {
    const w = this.snap?.you.wpn;
    const info = SUPPLY_INFO[kind];
    let full = false;
    if (w) full = kind === 'mun_pistola' ? w.res.pistola >= GUNS.pistola.maxReserve : kind === 'mun_fuzil' ? w.res.fuzil >= GUNS.fuzil.maxReserve : w.fuel >= FLAMER.maxFuel;
    return full ? `${info.name}: você está no limite` : `Coletar ${info.name.toLowerCase()} (+${info.amount})`;
  }

  /** Jogadores usando o lança-chamas agora (inclui o próprio). */
  private flamers(): { id: string; x: number; z: number; yaw: number; pitch: number; mine: boolean }[] {
    const out: { id: string; x: number; z: number; yaw: number; pitch: number; mine: boolean }[] = [];
    const f = this.myFlags();
    if (this.role === 'survivor' && f & PF.FIRE && f & PF.WPN_FLAME) out.push({ id: this.intro.you, x: this.pred.x, z: this.pred.z, yaw: this.yaw, pitch: this.pitch, mine: true });
    for (const rm of this.remotes.values()) if (rm.visible && rm.role === 'survivor' && rm.f & PF.FIRE && rm.f & PF.WPN_FLAME) out.push({ id: rm.id, x: rm.x, z: rm.z, yaw: rm.yaw, pitch: rm.pitch, mine: false });
    return out;
  }

  private flameIds = new Set<string>();
  private emitFireParticles(dt: number) {
    const fl = this.flamers();
    const now = new Set(fl.map((f) => f.id));
    for (const id of this.flameIds) if (!now.has(id)) audio.flame(id, null, false);
    this.flameIds = now;
    for (const f of fl) {
      audio.flame(f.id, f.mine ? null : { x: f.x, y: 1.3, z: f.z }, true);
      const n = Math.ceil(dt * (this.renderer.quality.particles ? 110 : 30));
      const cp = Math.cos(f.pitch);
      const dx = -Math.sin(f.yaw) * cp;
      const dy = Math.sin(f.pitch);
      const dz = -Math.cos(f.yaw) * cp;
      const ox = f.x + dx * 0.6 + Math.cos(f.yaw) * (f.mine ? 0.18 : 0.08);
      const oz = f.z + dz * 0.6 - Math.sin(f.yaw) * (f.mine ? 0.18 : 0.08);
      for (let i = 0; i < n; i++) {
        const sp = 8 + Math.random() * 3;
        const j = 0.28;
        const hot = Math.random();
        this.particles.push({ x: ox, y: 1.25, z: oz, vx: (dx + (Math.random() - 0.5) * j) * sp, vy: (dy + (Math.random() - 0.3) * j) * sp, vz: (dz + (Math.random() - 0.5) * j) * sp, life: 0, max: (FLAMER.range / sp) * (0.7 + Math.random() * 0.4), r: 1, g: 0.35 + hot * 0.45, b: 0.05 + hot * 0.15, size: 0.25 + Math.random() * 0.3, grav: -0.4 });
      }
    }
    for (const rm of this.remotes.values()) {
      if (!rm.visible || rm.role !== 'entity' || !(rm.f & PF.BURNING)) continue;
      for (let i = 0; i < Math.ceil(dt * 40); i++)
        this.particles.push({ x: rm.x + (Math.random() - 0.5) * 0.8, y: 0.3 + Math.random() * 2.2, z: rm.z + (Math.random() - 0.5) * 0.8, vx: 0, vy: 1 + Math.random(), vz: 0, life: 0, max: 0.4 + Math.random() * 0.3, r: 1, g: 0.45, b: 0.1, size: 0.2 + Math.random() * 0.15, grav: -0.3 });
    }
    if (this.particles.length > 2500) this.particles.splice(0, this.particles.length - 2500);
  }

  /** Arma em primeira pessoa (desenhada por cima do cenário para não atravessar paredes). */
  private drawViewModel(cam: { x: number; y: number; z: number; third: boolean }) {
    const you = this.snap?.you;
    if (!you?.wpn || cam.third || this.role !== 'survivor' || this.spectating() || you.hidden || you.st !== 'alive') return;
    const r = this.renderer;
    r.clearDepth();
    const M = mat4();
    identity(M);
    translate(M, cam.x, cam.y, cam.z);
    rotY(M, this.yaw);
    rotX(M, this.pitch);
    this.recoil = Math.max(0, this.recoil - 0.016 * 9);
    const reloading = you.wpn.reload > 0;
    const lowered = this.pred.sprinting || !!you.ch;
    const bob = Math.sin(this.bob * 2) * 0.012 * Math.min(1, this.pred.speed / 4);
    translate(M, 0.16, -0.15 + bob - (reloading ? 0.08 : 0) - (lowered ? 0.1 : 0), -0.34 + this.recoil * 0.04);
    rotX(M, this.recoil * 0.12 - (reloading ? 0.5 : 0) - (lowered ? 0.4 : 0));
    scale(M, 0.55, 0.55, 0.55);
    const f = this.myFlags();
    drawWeapon(r, M, you.wpn.sel, { alpha: 1, emit: [0.05, 0.05, 0.05] }, !!(f & PF.FIRE) && you.wpn.sel !== 'lanca' && this.recoil > 0.5, this.time);
  }

  private drawDynamicWorld(dt: number, cam: { x: number; z: number }) {
    const r = this.renderer;
    const M = mat4();
    const snap = this.snap;
    const near = (x: number, z: number, d = 40) => Math.abs(x - cam.x) < d && Math.abs(z - cam.z) < d;
    // portas (deslizam para dentro da parede)
    const locked = new Set(snap?.locked ?? []);
    for (const d of this.map.doors) {
      if (!near(d.x, d.z)) continue;
      const target = this.grid.doorOpen[d.idx] ? 1 : 0;
      let a = this.doorAnim.get(d.idx) ?? target;
      a += clamp(target - a, -dt * 3, dt * 3);
      this.doorAnim.set(d.idx, a);
      const off = a * 1.85;
      identity(M);
      if (d.axis === 'x') {
        translate(M, d.x + off, 1.4, d.z);
        scale(M, CELL, 2.8, 0.22);
      } else {
        translate(M, d.x, 1.4, d.z + off);
        rotY(M, Math.PI / 2);
        scale(M, CELL, 2.8, 0.22);
      }
      const lockTint: [number, number, number] = locked.has(d.idx) ? [0.6, 0.85, 1.1] : d.secure ? [1, 0.75, 0.6] : [1, 1, 1];
      r.draw(r.cube, M, { layer: LAYER.DOOR, tint: lockTint, emit: locked.has(d.idx) ? [0.05, 0.1, 0.15] : [0, 0, 0] });
      // luz de status sobre a porta
      identity(M);
      translate(M, d.x, 2.95, d.z);
      scale(M, 0.25, 0.08, 0.25);
      const open = target === 1;
      const c: [number, number, number] = locked.has(d.idx) ? [0.3, 0.7, 1] : d.secure && !open ? [1, 0.1, 0.05] : open ? [0.1, 1, 0.4] : [1, 0.7, 0.1];
      r.draw(r.cube, M, { layer: LAYER.PLAIN, tint: c, emit: c, unlit: 1 });
    }
    // estações de objetivo
    const active = new Map<string, 'active' | 'done'>();
    for (const t of snap?.tasks ?? []) {
      for (const sid of t.stations) active.set(sid, t.doneStations.includes(sid) || t.done ? 'done' : t.active ? 'active' : 'done');
    }
    const jam = new Set(snap?.jam ?? []);
    for (const st of this.map.stations) {
      if (!near(st.x, st.z)) continue;
      identity(M);
      translate(M, st.x, 0, st.z);
      rotY(M, st.facing);
      const body = mat4();
      body.set(M);
      const isPod = st.kind === 'pod';
      const isTx = st.kind === 'tx';
      translate(body, 0, isPod ? 1.3 : isTx ? 1.2 : 0.55, 0.1);
      scale(body, isPod ? 1.9 : isTx ? 0.9 : 1.6, isPod ? 2.6 : isTx ? 2.4 : 1.1, isPod ? 1.9 : 1.0);
      r.draw(r.cube, body, { layer: isPod ? LAYER.HAZARD : LAYER.WALL, uv: [1, 1] });
      // tela
      const scr = mat4();
      scr.set(M);
      translate(scr, 0, isTx ? 1.6 : 1.15, -0.42);
      rotY(scr, 0);
      scale(scr, isTx ? 0.6 : 1.1, isTx ? 0.5 : 0.55, 0.04);
      const state = active.get(st.id);
      const col: [number, number, number] = jam.has(st.id) ? [0.4, 0.7, 1] : state === 'active' ? [1, 0.75, 0.2] : state === 'done' ? [0.2, 1, 0.5] : [0.25, 0.3, 0.35];
      const glow = jam.has(st.id) ? 0.4 + Math.random() * 0.6 : state ? 0.6 + 0.2 * Math.sin(this.time * 3) : 0.15;
      r.draw(r.cube, scr, { layer: LAYER.SCREEN, tint: col, emit: [col[0] * glow * 0.5, col[1] * glow * 0.5, col[2] * glow * 0.5] });
      if (isTx) {
        const ant = mat4();
        ant.set(M);
        translate(ant, 0, 2.7, 0.1);
        scale(ant, 0.06, 0.6, 0.06);
        r.draw(r.cube, ant, { layer: LAYER.PLAIN, tint: [0.6, 0.6, 0.6] });
        const tip = mat4();
        tip.set(M);
        translate(tip, 0, 3.0, 0.1);
        scale(tip, 0.12, 0.12, 0.12);
        const on = state === 'active' && Math.sin(this.time * 6) > 0;
        r.draw(r.cube, tip, { layer: LAYER.PLAIN, tint: [1, 0.2, 0.1], emit: on ? [1, 0.1, 0.05] : [0.1, 0, 0], unlit: 1 });
      }
    }
    // luminárias
    const lstate = snap?.lights ?? {};
    for (let i = 0; i < this.map.lights.length; i++) {
      const L = this.map.lights[i];
      if (!near(L.x, L.z, 34)) continue;
      const st = lstate[L.zone] ?? 0;
      const on = L.emergency ? st === 0 : st === 1;
      const k = on ? (L.emergency ? 0.6 + 0.4 * Math.sin(this.time * 2.2 + i) : flicker(this.time, i)) : 0;
      identity(M);
      translate(M, L.x, L.y + 0.2, L.z);
      scale(M, L.emergency ? 0.25 : 1.1, 0.08, L.emergency ? 0.25 : 0.3);
      const c = L.color;
      r.draw(r.cube, M, { layer: LAYER.LAMP, tint: on ? [c[0], c[1], c[2]] : [0.15, 0.15, 0.15], emit: [c[0] * k * 0.6, c[1] * k * 0.6, c[2] * k * 0.6], unlit: on ? 1 : 0 });
    }
    // caixas de munição e combustível
    for (const [, kind, x, z, claimed] of snap?.sup ?? []) {
      if (!near(x, z, 34)) continue;
      drawSupply(r, kind, x, z, this.time, claimed === 1, { alpha: 1, emit: [0, 0, 0] });
    }
    // itens no chão
    for (const [, kind, x, z] of snap?.items ?? []) {
      const info = ITEM_INFO[kind];
      identity(M);
      translate(M, x, 0.25 + Math.sin(this.time * 2 + x) * 0.05, z);
      rotY(M, this.time + x);
      const sz = kind === 'documento' ? [0.35, 0.05, 0.25] : kind === 'cartao' ? [0.25, 0.03, 0.16] : kind === 'amostra' ? [0.12, 0.3, 0.12] : kind === 'kit' ? [0.35, 0.22, 0.25] : [0.22, 0.22, 0.22];
      scale(M, sz[0], sz[1], sz[2]);
      const c = info.color;
      r.draw(r.cube, M, { layer: kind === 'amostra' ? LAYER.GLASS : LAYER.PLAIN, tint: c as [number, number, number], emit: [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35] });
    }
    // sinalizadores
    for (const [x, z] of snap?.flares ?? []) {
      identity(M);
      translate(M, x, 0.1, z);
      rotY(M, 0.6);
      scale(M, 0.05, 0.05, 0.3);
      r.draw(r.cube, M, { layer: LAYER.PLAIN, tint: [1, 0.3, 0.1], emit: [1, 0.3, 0.1], unlit: 1 });
      if (Math.random() < 0.5) this.burst(x, 0.15, z, 1, [1, 0.5, 0.1], 1.5);
    }
  }

  private drawParticles(cam: { x: number; y: number; z: number }, fog: number[]) {
    let n = 0;
    const d = this.pointData;
    // poeira/partículas em suspensão ao redor da câmera
    const B = 30;
    const wrap = (v: number, c: number) => c - B / 2 + ((((v - (c - B / 2)) % B) + B) % B);
    for (let i = 0; i < this.dust.length && n < 1500; i += 3) {
      const x = wrap(this.dust[i] + Math.sin(this.time * 0.05 + i) * 0.5, cam.x);
      const y = (this.dust[i + 1] + this.time * 0.03) % WALL_H;
      const z = wrap(this.dust[i + 2], cam.z);
      if (isSolid(this.grid, Math.floor(x / CELL), Math.floor(z / CELL))) continue;
      d.set([x, y, z, 0.6, 0.75, 0.8, 0.22, 0.05], n * 8);
      n++;
    }
    for (const p of this.particles) {
      if (n >= 1999) break;
      const a = 1 - p.life / p.max;
      d.set([p.x, p.y, p.z, p.r, p.g, p.b, a, p.size], n * 8);
      n++;
    }
    this.renderer.drawPoints(d, n, fog, true);
  }

  // ------------------------------------------------------------------ sobreposição 2D (nomes, marcadores)
  private drawOverlay(cam: { x: number; y: number; z: number; px: number; pz: number }) {
    const ctx = this.overlay;
    const cv = ctx.canvas;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const snap = this.snap;
    if (!snap) return;
    const r = this.renderer;
    const label = (x: number, y: number, z: number, text: string, color: string, sub?: string, icon?: string) => {
      const p = r.project(x, y, z);
      if (!p) return;
      const px = clamp(p.x, 20, w - 20);
      const py = clamp(p.y, 20, h - 20);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 4;
      if (icon) {
        ctx.fillStyle = color;
        ctx.font = '16px system-ui, sans-serif';
        ctx.fillText(icon, px, py - 14);
        ctx.font = '600 12px system-ui, sans-serif';
      }
      ctx.fillStyle = color;
      ctx.fillText(text, px, py);
      if (sub) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(220,230,235,0.8)';
        ctx.fillText(sub, px, py + 13);
      }
      ctx.restore();
    };
    const meX = cam.px;
    const meZ = cam.pz;
    const dist = (x: number, z: number) => Math.hypot(x - meX, z - meZ);
    const survivorView = this.role === 'survivor' || this.spectating();
    if (survivorView) {
      // companheiros
      for (const rm of this.remotes.values()) {
        if (!rm.visible || rm.role !== 'survivor' || rm.f & PF.HIDDEN) continue;
        const d = dist(rm.x, rm.z);
        if (rm.f & PF.DOWNED) label(rm.x, 1.0, rm.z, rm.name, '#ff5a4a', `CAÍDO · ${d.toFixed(0)} m`, '✚');
        else if (d < 16 && lineOfSight(this.grid, meX, meZ, rm.x, rm.z)) label(rm.x, 2.05, rm.z, rm.name, '#bfe9ff', this.hud.state.talking.includes(rm.id) ? '🔊' : undefined);
      }
      // objetivos ativos
      for (const t of snap.tasks) {
        if (!t.active) continue;
        for (const sid of t.stations) {
          if (t.doneStations.includes(sid)) continue;
          const st = this.map.stations.find((s) => s.id === sid)!;
          const d = dist(st.x, st.z);
          if (d < 3) continue;
          label(st.x, 1.9, st.z, `${d.toFixed(0)} m`, '#ffcf5a', undefined, '◆');
        }
      }
      for (const pod of snap.pods) {
        const ex = this.map.exits[pod];
        label((ex.x0 + ex.x1) / 2, 1.2, (ex.z0 + ex.z1) / 2, 'FUGA', '#5affa0', `${dist((ex.x0 + ex.x1) / 2, (ex.z0 + ex.z1) / 2).toFixed(0)} m`, '⇪');
      }
      if (this.detectorMark && this.detectorMark.until > this.time) label(this.detectorMark.x, 2.2, this.detectorMark.z, 'RESSONÂNCIA', '#c08bff', '± 5 m', '◎');
      for (const f of this.fakeMarks) if (f.until > this.time) label(f.x, 1.5, f.z, 'ECO FALSO', '#9fd7ff', undefined, '✕');
      this.fakeMarks = this.fakeMarks.filter((f) => f.until > this.time);
    } else {
      for (const rm of this.remotes.values()) {
        if (rm.visible && rm.f & PF.DOWNED) label(rm.x, 1.0, rm.z, rm.name, '#ff7a5a', 'caído');
      }
    }
    if (this.spectating() && snap.you.spec) {
      const rm = this.remotes.get(snap.you.spec);
      if (rm?.visible) label(rm.x, 2.3, rm.z, rm.name, '#ffffff', 'assistindo');
    }
  }

  // ------------------------------------------------------------------ áudio
  private updateAudio(dt: number) {
    const s = getSettings();
    audio.setVolumes(s.master, s.music, s.sfx, s.voice);
    const cam = this.camera();
    audio.setListener(cam.x, cam.y, cam.z, cam.yaw);
    const role = this.spectating() ? 'spectator' : this.role;
    audio.update(dt, this.snap?.threat ?? 0, { x: cam.x, y: cam.y, z: cam.z }, role);
    // passos próprios
    if (!this.spectating() && this.snap && !this.snap.you.hidden) {
      this.myStepAcc += this.pred.speed * dt;
      const stride = this.role === 'entity' ? 1.5 : this.pred.sprinting ? 1.1 : 0.8;
      if (this.myStepAcc >= stride) {
        this.myStepAcc = 0;
        const loud = this.role === 'entity' ? (this.pred.crouch ? 0.15 : 0.5) : this.pred.crouch ? 0.1 : this.pred.sprinting ? 0.6 : 0.3;
        audio.step(null, loud, this.role === 'entity');
      }
    }
    // rosnado da entidade
    for (const rm of this.remotes.values()) {
      if (rm.role !== 'entity') continue;
      if (rm.visible && this.role === 'survivor') {
        const d = Math.hypot(rm.x - cam.x, rm.z - cam.z);
        audio.entityGrowl(rm.id, { x: rm.x, y: 2, z: rm.z }, rm.f & PF.CAMO ? 0.15 : clamp(1 - d / (ENTITY_AUDIBLE_RADIUS * 2), 0.1, 1));
      } else audio.entityGrowl(rm.id, null, 0);
    }
    // voz por proximidade
    if (this.voice) {
      this.voice.setSpectator(this.spectating());
      if (getSettings().pushToTalk) this.voice.setPtt(this.input.isDown('falar'));
      const positions = new Map<string, { x: number; z: number }>();
      for (const rm of this.remotes.values()) if (rm.visible) positions.set(rm.id, { x: rm.x, z: rm.z });
      this.voice.updateProximity(positions, { x: cam.x, z: cam.z, yaw: cam.yaw });
    }
  }

  // ------------------------------------------------------------------ prompt de interação
  private computePrompt() {
    const snap = this.snap;
    this.prompt = null;
    if (!snap || this.spectating()) return;
    const you = snap.you;
    const x = this.pred.x;
    const z = this.pred.z;
    type C = { x: number; z: number; prio: number; half?: number; text: string };
    const cands: C[] = [];
    if (this.role === 'survivor') {
      if (you.st !== 'alive') return;
      if (you.hidden) {
        this.prompt = 'Sair do armário';
        return;
      }
      for (const [, kind, ix, iz] of snap.items) cands.push({ x: ix, z: iz, prio: 0.6, text: `Pegar: ${ITEM_INFO[kind].name}` });
      for (const [, kind, sx, sz, claimed] of snap.sup) cands.push({ x: sx, z: sz, prio: 0.7, text: claimed ? 'Alguém já está coletando' : this.supplyPrompt(kind) });
      for (const rm of this.remotes.values()) if (rm.visible && rm.role === 'survivor' && rm.f & PF.DOWNED) cands.push({ x: rm.x, z: rm.z, prio: 1.2, text: `Resgatar ${rm.name} (segure)` });
      const locked = new Set(snap.locked);
      for (const d of this.map.doors) if (!d.secure) cands.push({ x: d.x, z: d.z, half: 1, prio: 0, text: locked.has(d.idx) ? 'Porta travada (interferência)' : this.grid.doorOpen[d.idx] ? 'Fechar porta' : 'Abrir porta' });
      for (const l of this.map.lockers) cands.push({ x: l.x, z: l.z, half: 1, prio: 0.1, text: 'Esconder-se no armário' });
      for (const t of snap.tasks) {
        if (!t.active) continue;
        for (const sid of t.stations) {
          if (t.doneStations.includes(sid)) continue;
          const st = this.map.stations.find((s) => s.id === sid)!;
          let text = '';
          if (t.item) {
            const has = you.inv.includes(t.item);
            text = has ? `Entregar: ${ITEM_INFO[t.item].name}` : `Precisa de ${ITEM_INFO[t.item].name} (${t.count}/${t.required})`;
          } else text = `${st.label} (segure)`;
          if (snap.jam.includes(sid)) text += ' — INTERFERÊNCIA';
          cands.push({ x: st.x, z: st.z, half: 1, prio: 0.8, text });
        }
      }
      const tgt = pickTarget(x, z, this.yaw, INTERACT_RANGE, cands);
      this.prompt = tgt?.text ?? null;
    } else {
      for (const d of this.map.doors) if (!d.secure) cands.push({ x: d.x, z: d.z, half: 1, prio: 0, text: this.grid.doorOpen[d.idx] ? 'Fechar porta' : 'Abrir porta' });
      for (const l of this.map.lockers) cands.push({ x: l.x, z: l.z, half: 1, prio: 0.2, text: 'Vasculhar armário' });
      const tgt = pickTarget(x, z, this.yaw, INTERACT_RANGE + 0.3, cands);
      this.prompt = tgt?.text ?? null;
    }
  }

  private zoneName(): string {
    const p = this.myPos();
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    for (let i = this.map.zones.length - 1; i >= 0; i--) {
      const zn = this.map.zones[i];
      if (cx >= zn.x0 && cx <= zn.x1 && cz >= zn.z0 && cz <= zn.z1) return zn.name;
    }
    return 'Passagem';
  }

  private pushHud() {
    const snap = this.snap;
    if (!snap) return;
    const you = snap.you;
    const survivors = this.intro.players.filter((p) => p.role === 'survivor');
    this.hud.set({
      role: this.role,
      status: you.st,
      hp: you.hp,
      stamina: this.pred.stamina,
      exhausted: this.pred.exhausted,
      inv: you.inv,
      wpn: you.wpn ?? null,
      entHp: snap.eh,
      hit: this.time - this.hitT < 0.2,
      detCharges: you.det,
      channel: you.ch,
      timeLeft: snap.time,
      tasks: snap.tasks,
      zone: this.zoneName(),
      prompt: this.prompt,
      threat: snap.threat,
      flash: you.flash,
      hidden: !!you.hidden,
      bleed: you.bleed,
      cd: you.cd ?? this.hud.state.cd,
      act: you.act ?? this.hud.state.act,
      resonance: you.res ?? this.hud.state.resonance,
      attackCd: you.atk ?? 0,
      ecoAvailable: (you.eco ?? ['passos']) as EcoType[],
      ecoSel: this.ecoSel,
      camo: !!you.camo,
      spectating: this.spectating() ? (you.spec ? this.nameOf(you.spec) : '—') : null,
      feed: this.feed.filter((f) => this.time - f.t < 8),
      fps: this.fps,
      ping: this.net.ping,
      inventoryOpen: this.inventoryOpen,
      menuOpen: this.menuOpen,
      damage: this.damageFlash,
      glitch: this.glitch,
      thirdPerson: this.thirdPerson,
      touch: this.input.isTouch(),
      totalSurv: survivors.length,
      escaped: this.escapedIds.size,
      alive: survivors.length - this.escapedIds.size - this.deadIds.size,
      podsReady: snap.pods.length > 0,
      talking: this.voice?.talking() ?? [],
      drawCalls: this.renderer.drawCalls,
      stale: performance.now() - this.lastSnapAt > 1500,
      locked: this.input.locked,
    });
  }
}

/** Oscilação suave e ocasional das lâmpadas (cada luz tem seu padrão). */
function flicker(t: number, i: number): number {
  const s = Math.sin(t * 0.7 + i * 12.9898) * 43758.5453;
  const n = s - Math.floor(s);
  if (i % 7 === 0 && Math.sin(t * 13 + i) > 0.92) return 0.25;
  return 0.85 + n * 0.0 + 0.15 * Math.sin(t * 1.3 + i);
}

