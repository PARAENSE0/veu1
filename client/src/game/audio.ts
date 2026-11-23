/**
 * Motor de áudio 100% sintetizado (Web Audio API) — nenhum arquivo de som
 * externo. Sons posicionais (HRTF), reverberação gerada, ambiente submarino,
 * batimentos cardíacos e música dinâmica de perseguição.
 */
import type { SoundKind } from '../../../shared/protocol';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  voice!: GainNode;
  private reverb: ConvolverNode | null = null;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private hq = true;
  private ambient: { stop(): void } | null = null;
  private chase: { gain: GainNode; stop(): void } | null = null;
  private heartT = 0;
  private creakT = 3;
  private growls = new Map<string, { gain: GainNode; panner: PannerNode; stop(): void }>();

  /** Precisa ser chamado a partir de um gesto do usuário (política dos navegadores). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.voice = ctx.createGain();
    this.voice.connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.setQuality(this.hq);
  }

  setVolumes(master: number, music: number, sfx: number, voice: number) {
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.music.gain.value = music;
    this.sfx.gain.value = sfx;
    this.voice.gain.value = voice;
  }

  setQuality(high: boolean) {
    this.hq = high;
    const ctx = this.ctx;
    if (!ctx) return;
    this.reverbSend.disconnect();
    if (high) {
      if (!this.reverb) {
        // impulso sintético: ruído com decaimento exponencial (casco metálico)
        const len = Math.floor(ctx.sampleRate * 2.4);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const ch = ir.getChannelData(c);
          for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (1 + 0.3 * Math.sin(i / 180));
        }
        this.reverb = ctx.createConvolver();
        this.reverb.buffer = ir;
        this.reverb.connect(this.sfx);
      }
      this.reverbSend.connect(this.reverb);
    }
  }

  setListener(x: number, y: number, z: number, yaw: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(x, t, 0.02);
      l.positionY.setTargetAtTime(y, t, 0.02);
      l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(0, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(a: number, b: number, c: number): void }).setPosition(x, y, z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Cria um nó de destino posicional (ou estéreo central quando pos é nulo). */
  private dest(pos: { x: number; y: number; z: number } | null, gain: number, reverb = 0.25): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = this.hq ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 2;
      p.rolloffFactor = 1.3;
      p.maxDistance = 60;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      g.connect(p);
      p.connect(this.sfx);
      if (this.hq && reverb > 0) {
        const rg = ctx.createGain();
        rg.gain.value = reverb;
        p.connect(rg);
        rg.connect(this.reverbSend);
      }
    } else {
      g.connect(this.sfx);
    }
    return g;
  }

  private noise(out: AudioNode, t0: number, dur: number, f0: number, f1: number, q: number, peak: number, attack = 0.005) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(out);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  private tone(out: AudioNode, t0: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.01) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** Passo (sobrevivente ou entidade). */
  step(pos: { x: number; y: number; z: number } | null, loud: number, heavy: boolean, detune = 1) {
    if (!this.ctx || loud <= 0.01) return;
    const t = this.ctx.currentTime;
    const out = this.dest(pos, loud, 0.2);
    if (heavy) {
      this.tone(out, t, 0.22, 'sine', 70 * detune, 35, 0.9, 0.005);
      this.noise(out, t, 0.12, 2200 * detune, 900, 3, 0.25);
      this.noise(out, t + 0.03, 0.05, 5000, 3000, 8, 0.12);
    } else {
      this.noise(out, t, 0.09, 900 * detune * (0.85 + Math.random() * 0.3), 300, 1.4, 0.6);
      this.tone(out, t, 0.08, 'sine', 120 * detune, 60, 0.35, 0.003);
    }
  }

  play(kind: SoundKind, pos: { x: number; y: number; z: number } | null, v = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'passos': {
        // sequência curta de passos apressados
        for (let i = 0; i < 6; i++) {
          setTimeout(() => this.step(pos, 0.9, false, v), i * 290 + Math.random() * 40);
        }
        break;
      }
      case 'porta': {
        const out = this.dest(pos, 0.8, 0.45);
        this.noise(out, t, 0.7, 1400 * v, 350, 2, 0.5, 0.02);
        this.tone(out, t + 0.65, 0.3, 'triangle', 180 * v, 90, 0.5, 0.002);
        this.noise(out, t + 0.65, 0.15, 3000, 1500, 4, 0.4);
        break;
      }
      case 'radio': {
        const out = this.dest(pos, 0.7, 0.3);
        this.noise(out, t, 1.6, 2500, 2000, 0.8, 0.12, 0.05);
        // "fala" ininteligível: formantes com contorno aleatório
        for (let i = 0; i < 7; i++) {
          const s = t + 0.15 + i * 0.19;
          const f = (180 + Math.random() * 160) * v;
          this.tone(out, s, 0.16, 'sawtooth', f, f * (0.8 + Math.random() * 0.4), 0.06, 0.02);
          this.noise(out, s, 0.15, 900 * v, 1300 * v, 6, 0.08);
        }
        this.tone(out, t + 1.55, 0.12, 'sine', 1200 * v, 1200 * v, 0.1);
        break;
      }
      case 'alarme': {
        const out = this.dest(pos, 0.55, 0.6);
        for (let i = 0; i < 4; i++) {
          this.tone(out, t + i * 0.45, 0.22, 'square', 740 * v, 740 * v, 0.18, 0.01);
          this.tone(out, t + i * 0.45 + 0.22, 0.22, 'square', 560 * v, 560 * v, 0.18, 0.01);
        }
        break;
      }
      case 'grito': {
        const out = this.dest(pos, 1, 0.5);
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(520, t);
        o.frequency.exponentialRampToValueAtTime(260, t + 0.7);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 9;
        const lg = ctx.createGain();
        lg.gain.value = 25;
        lfo.connect(lg).connect(o.frequency);
        const f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass';
        f1.frequency.value = 900;
        f1.Q.value = 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        o.connect(f1).connect(g).connect(out);
        o.start(t);
        lfo.start(t);
        o.stop(t + 0.8);
        lfo.stop(t + 0.8);
        this.tone(out, t, 0.3, 'sine', 90, 40, 0.7, 0.002);
        break;
      }
      case 'impacto':
      case 'queda': {
        const out = this.dest(pos, 1, 0.3);
        this.tone(out, t, 0.5, 'sine', 90, 30, 0.9, 0.003);
        this.noise(out, t, 0.25, 600, 120, 1, 0.5);
        break;
      }
      case 'item': {
        const out = this.dest(pos, 0.4, 0.1);
        this.tone(out, t, 0.12, 'sine', 900, 1400, 0.3);
        this.tone(out, t + 0.08, 0.15, 'sine', 1400, 1800, 0.2);
        break;
      }
      case 'cura': {
        const out = this.dest(pos, 0.4, 0.2);
        [660, 880, 990].forEach((f, i) => this.tone(out, t + i * 0.1, 0.4, 'sine', f, f, 0.15));
        break;
      }
      case 'entrega': {
        const out = this.dest(pos, 0.6, 0.3);
        this.tone(out, t, 0.2, 'triangle', 520, 520, 0.3);
        this.tone(out, t + 0.18, 0.35, 'triangle', 780, 780, 0.3);
        this.noise(out, t, 0.2, 4000, 2000, 3, 0.1);
        break;
      }
      case 'escotilha': {
        const out = this.dest(pos, 0.8, 0.5);
        this.noise(out, t, 1.4, 600, 3000, 0.7, 0.4, 0.2);
        this.tone(out, t + 1.2, 0.4, 'triangle', 120, 60, 0.6);
        break;
      }
      case 'metal': {
        const out = this.dest(pos, 0.5 * v, 0.8);
        const ctx = this.ctx;
        const car = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const mg = ctx.createGain();
        car.type = 'sine';
        car.frequency.setValueAtTime(210 + Math.random() * 120, t);
        car.frequency.linearRampToValueAtTime(140 + Math.random() * 60, t + 2.2);
        mod.frequency.value = 3 + Math.random() * 5;
        mg.gain.value = 40;
        mod.connect(mg).connect(car.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        car.connect(g).connect(out);
        car.start(t);
        mod.start(t);
        car.stop(t + 2.5);
        mod.stop(t + 2.5);
        break;
      }
      case 'ruptura': {
        const out = this.dest(pos, 0.9, 0.3);
        this.noise(out, t, 0.6, 300, 4000, 1.2, 0.6, 0.03);
        this.tone(out, t, 0.5, 'sawtooth', 60, 200, 0.25);
        break;
      }
      case 'parasita': {
        const out = this.dest(pos, 0.8, 0.4);
        for (let i = 0; i < 18; i++) this.noise(out, t + Math.random() * 1.2, 0.03, 5000, 3000, 2, 0.4);
        this.tone(out, t, 1.4, 'sawtooth', 60, 55, 0.12, 0.05);
        this.tone(out, t, 1.4, 'square', 120, 118, 0.05, 0.05);
        break;
      }
      case 'rastro': {
        const out = this.dest(null, 0.6);
        this.noise(out, t, 1.2, 200, 1800, 2, 0.3, 0.9);
        this.tone(out, t, 1.2, 'sine', 80, 160, 0.3, 0.8);
        break;
      }
      case 'ataque': {
        const out = this.dest(pos, 1, 0.3);
        this.noise(out, t, 0.3, 800, 3500, 1, 0.6, 0.05);
        this.tone(out, t, 0.35, 'sawtooth', 300, 900, 0.15, 0.02);
        break;
      }
      case 'armario': {
        const out = this.dest(pos, 0.6, 0.4);
        this.noise(out, t, 0.12, 3000, 2000, 5, 0.4);
        this.tone(out, t + 0.05, 0.3, 'triangle', 300, 150, 0.3);
        break;
      }
      case 'sinalizador': {
        const out = this.dest(pos, 0.7, 0.3);
        this.noise(out, t, 1.5, 4000, 2500, 0.6, 0.35, 0.05);
        break;
      }
      case 'recarga': {
        const out = this.dest(pos, 0.5, 0.1);
        this.noise(out, t, 0.05, 3500, 2500, 6, 0.5);
        this.noise(out, t + 0.45, 0.06, 2500, 1800, 6, 0.5);
        this.tone(out, t + 0.9, 0.05, 'square', 900, 700, 0.15, 0.002);
        this.noise(out, t + 0.95, 0.04, 4000, 3000, 8, 0.6);
        break;
      }
      case 'vazio': {
        const out = this.dest(null, 0.5);
        this.noise(out, t, 0.03, 5000, 4000, 10, 0.5);
        break;
      }
      case 'coleta': {
        const out = this.dest(pos, 0.7, 0.2);
        this.noise(out, t, 0.06, 2000, 1500, 4, 0.5);
        for (let i = 0; i < 5; i++) this.tone(out, t + 0.08 + i * 0.04, 0.05, 'triangle', 2400 + Math.random() * 800, 1800, 0.12, 0.002);
        this.tone(out, t + 0.3, 0.12, 'sine', 880, 1320, 0.15);
        break;
      }
      case 'dor': {
        // guincho da entidade: membrana distorcida
        const out = this.dest(pos, 1, 0.5);
        this.tone(out, t, 0.5, 'sawtooth', 700, 220, 0.25, 0.01);
        this.tone(out, t, 0.5, 'sawtooth', 713, 230, 0.2, 0.01);
        this.noise(out, t, 0.35, 1800, 600, 2, 0.3);
        break;
      }
      case 'morte_entidade': {
        const out = this.dest(pos, 1, 0.9);
        this.tone(out, t, 2.5, 'sawtooth', 300, 40, 0.35, 0.02);
        this.tone(out, t, 2.5, 'sawtooth', 307, 42, 0.3, 0.02);
        this.noise(out, t, 2.2, 1200, 80, 1, 0.5, 0.05);
        this.tone(out, t + 1.6, 1.2, 'sine', 60, 25, 0.9, 0.01);
        break;
      }
      case 'detector': {
        const out = this.dest(pos, 0.6, 0.6);
        this.tone(out, t, 0.6, 'sine', 1500, 1450, 0.3);
        this.tone(out, t + 0.6, 0.6, 'sine', 1500, 1450, 0.12);
        break;
      }
    }
  }

  /** Disparo de arma. own = tiro do próprio jogador (sem posição, mais alto). */
  gunshot(w: 'pistola' | 'fuzil', pos: { x: number; y: number; z: number } | null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.dest(pos, pos ? 1 : 0.7, 0.7);
    if (w === 'pistola') {
      this.noise(out, t, 0.18, 3000, 400, 0.8, 1, 0.001);
      this.tone(out, t, 0.2, 'sine', 140, 45, 0.9, 0.001);
      this.noise(out, t + 0.01, 0.4, 900, 200, 0.5, 0.25, 0.01);
    } else {
      this.noise(out, t, 0.1, 3500, 600, 0.8, 0.8, 0.001);
      this.tone(out, t, 0.12, 'sine', 120, 50, 0.7, 0.001);
    }
  }

  /** Rugido contínuo do lança-chamas (um por jogador). */
  flame(id: string, pos: { x: number; y: number; z: number } | null, on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    let f = this.flames.get(id);
    if (!on) {
      if (f) f.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      return;
    }
    if (!f) {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const panner = ctx.createPanner();
      panner.panningModel = this.hq ? 'HRTF' : 'equalpower';
      panner.refDistance = 2;
      src.connect(lp).connect(gain).connect(panner).connect(this.sfx);
      src.start();
      f = { gain, panner, stop: () => src.stop() };
      this.flames.set(id, f);
    }
    const t = ctx.currentTime;
    const p = pos ?? { x: 0, y: 0, z: 0 };
    if (pos) {
      f.panner.positionX.setTargetAtTime(p.x, t, 0.03);
      f.panner.positionY.setTargetAtTime(p.y, t, 0.03);
      f.panner.positionZ.setTargetAtTime(p.z, t, 0.03);
    }
    f.gain.gain.setTargetAtTime(0.6, t, 0.05);
  }
  private flames = new Map<string, { gain: GainNode; panner: PannerNode; stop(): void }>();

  /** Estrondo de susto quando o jogador é atingido. */
  stinger() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.dest(null, 0.9);
    [233, 247, 311, 466, 494].forEach((f) => this.tone(out, t, 1.6, 'sawtooth', f, f * 0.97, 0.08, 0.005));
    this.noise(out, t, 0.6, 3000, 300, 0.5, 0.6, 0.003);
    this.tone(out, t, 1.2, 'sine', 55, 30, 0.9, 0.003);
  }

  startAmbient() {
    const ctx = this.ctx;
    if (!ctx || this.ambient) return;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 3);
    out.connect(this.music);
    // ronco de pressão: ruído marrom filtrado
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const g1 = ctx.createGain();
    g1.gain.value = 0.5;
    src.connect(lp).connect(g1).connect(out);
    src.start();
    // zumbido grave com batimento lento
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.frequency.value = 41;
    o2.frequency.value = 41.6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o1.connect(g2);
    o2.connect(g2);
    g2.connect(out);
    o1.start();
    o2.start();
    this.ambient = {
      stop: () => {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0.0001, t, 0.4);
        setTimeout(() => {
          src.stop();
          o1.stop();
          o2.stop();
          out.disconnect();
        }, 1500);
      },
    };
  }

  /** Atualizado a cada quadro com o nível de ameaça (0..1). */
  update(dt: number, threat: number, listener: { x: number; y: number; z: number }, role: 'survivor' | 'entity' | 'spectator') {
    const ctx = this.ctx;
    if (!ctx) return;
    // rangidos metálicos aleatórios ao redor
    this.creakT -= dt;
    if (this.creakT <= 0) {
      this.creakT = 7 + Math.random() * 14;
      const a = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 15;
      this.play('metal', { x: listener.x + Math.cos(a) * d, y: 2.5, z: listener.z + Math.sin(a) * d }, 1);
      if (Math.random() < 0.35) this.whale();
    }
    if (role !== 'survivor') {
      this.setChase(0);
      return;
    }
    // batimentos cardíacos
    if (threat > 0.08) {
      this.heartT -= dt;
      const bpm = 60 + threat * 90;
      if (this.heartT <= 0) {
        this.heartT = 60 / bpm;
        const t = ctx.currentTime;
        const out = this.dest(null, 0.25 + threat * 0.6);
        this.tone(out, t, 0.15, 'sine', 60, 40, 0.9, 0.005);
        this.tone(out, t + 0.16, 0.15, 'sine', 55, 38, 0.6, 0.005);
      }
    }
    this.setChase(Math.max(0, (threat - 0.45) / 0.55));
  }

  private whale() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.dest(null, 0.12, 0);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = 180 + Math.random() * 120;
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.6, t + 1.5);
    o.frequency.linearRampToValueAtTime(f * 0.8, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 4);
  }

  private setChase(level: number) {
    const ctx = this.ctx!;
    if (level <= 0.01) {
      if (this.chase) {
        this.chase.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.8);
      }
      return;
    }
    if (!this.chase) {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(this.music);
      // ostinato grave pulsante + cluster dissonante com tremolo
      const bass = ctx.createOscillator();
      bass.type = 'sawtooth';
      bass.frequency.value = 55;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      const pulse = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 3.2;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5;
      pulse.gain.value = 0.5;
      lfo.connect(lfoG).connect(pulse.gain);
      bass.connect(lp).connect(pulse).connect(gain);
      const highs = [622, 659, 698].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.03;
        o.connect(g).connect(gain);
        o.start();
        return o;
      });
      bass.start();
      lfo.start();
      this.chase = {
        gain,
        stop: () => {
          bass.stop();
          lfo.stop();
          highs.forEach((o) => o.stop());
        },
      };
    }
    this.chase.gain.gain.setTargetAtTime(0.45 * level, ctx.currentTime, 0.3);
  }

  /** Rosnado contínuo e posicional da entidade (para sobreviventes). */
  entityGrowl(id: string, pos: { x: number; y: number; z: number } | null, intensity: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    let g = this.growls.get(id);
    if (!pos) {
      if (g) {
        g.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      }
      return;
    }
    if (!g) {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const panner = ctx.createPanner();
      panner.panningModel = this.hq ? 'HRTF' : 'equalpower';
      panner.refDistance = 3;
      panner.rolloffFactor = 1.4;
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'sawtooth';
      o1.frequency.value = 48;
      o2.frequency.value = 49.3;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      lp.Q.value = 6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.4;
      const lg = ctx.createGain();
      lg.gain.value = 160;
      lfo.connect(lg).connect(lp.frequency);
      o1.connect(lp);
      o2.connect(lp);
      lp.connect(gain).connect(panner).connect(this.sfx);
      o1.start();
      o2.start();
      lfo.start();
      g = {
        gain,
        panner,
        stop: () => {
          o1.stop();
          o2.stop();
          lfo.stop();
          panner.disconnect();
        },
      };
      this.growls.set(id, g);
    }
    const t = ctx.currentTime;
    g.panner.positionX.setTargetAtTime(pos.x, t, 0.05);
    g.panner.positionY.setTargetAtTime(pos.y, t, 0.05);
    g.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
    g.gain.gain.setTargetAtTime(0.35 * intensity, t, 0.2);
  }

  stopMatch() {
    this.ambient?.stop();
    this.ambient = null;
    this.chase?.stop();
    this.chase = null;
    for (const g of this.growls.values()) g.stop();
    this.growls.clear();
    for (const f of this.flames.values()) f.stop();
    this.flames.clear();
  }

  /** Sons curtos de interface. */
  ui(kind: 'click' | 'hover' | 'error' | 'ok') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.dest(null, 0.25);
    if (kind === 'click') this.tone(out, t, 0.06, 'square', 900, 700, 0.15, 0.002);
    else if (kind === 'hover') this.tone(out, t, 0.03, 'sine', 1400, 1400, 0.05, 0.002);
    else if (kind === 'error') this.tone(out, t, 0.25, 'sawtooth', 220, 140, 0.2);
    else this.tone(out, t, 0.18, 'triangle', 660, 990, 0.2);
  }
}

export const audio = new AudioEngine();
