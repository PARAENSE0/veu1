/**
 * Comunicação por voz via WebRTC (malha ponto a ponto, áudio apenas).
 *
 * - Sinalização (SDP/ICE) passa pelo servidor do jogo, que só a repassa entre
 *   membros da mesma sala e, durante a partida, apenas entre sobreviventes.
 * - Padrão "perfect negotiation" (lado educado = id menor).
 * - Proximidade: na partida, o volume de cada voz cai com a distância (e é
 *   posicional com HRTF); no lobby todos se ouvem normalmente.
 * - Indicador de quem está falando via AnalyserNode.
 * - Servidores ICE vêm de GET /api/config (configure TURN em produção).
 */
import { apiUrl } from '../config';
import type { Net } from '../net';
import { audio } from './audio';

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  sender: RTCRtpSender | null;
  el: HTMLAudioElement | null;
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
  panner: PannerNode | null;
  analyser: AnalyserNode | null;
  muted: boolean;
}

export type MicState = 'off' | 'pending' | 'on' | 'denied' | 'unsupported' | 'error';

export class Voice {
  private peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private allowed = new Set<string>();
  private ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  micState: MicState = 'off';
  private pttHeld = false;
  pushToTalk = false;
  private inMatch = false;
  private spectator = false;
  private unsub: () => void;
  private listeners = new Set<() => void>();
  private buf = new Uint8Array(512);
  private peerKey = '';
  /** Sinais (oferta/candidatos) que chegaram antes de a sala liberar aquele jogador:
   *  guardados por alguns segundos e reaplicados quando ele entra na lista. Sem isso,
   *  a primeira oferta podia se perder e a conexão ficava parada em "new". */
  private early = new Map<string, { at: number; data: { desc?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit } }[]>();
  private signalChain: Promise<void> = Promise.resolve();

  /** Espectadores (eliminados) ouvem todos os sobreviventes sem atenuação. */
  setSpectator(on: boolean) {
    this.spectator = on;
  }

  constructor(
    private net: Net,
    private myId: string,
  ) {
    this.unsub = net.on((m) => {
      if (m.t === 'rtc') this.queueSignal(m.from, m.data as { desc?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit });
    });
    fetch(apiUrl('/api/config'))
      .then((r) => r.json())
      .then((c: { iceServers?: RTCIceServer[] }) => {
        if (Array.isArray(c.iceServers) && c.iceServers.length) this.ice = c.iceServers;
      })
      .catch(() => {});
  }

  static supported() {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  /** Define com quem posso falar (sala no lobby; só sobreviventes na partida). */
  setPeers(ids: string[], opts: { inMatch: boolean }) {
    const key = `${opts.inMatch}|${[...ids].sort().join(',')}`;
    if (key === this.peerKey) return;
    this.peerKey = key;
    this.inMatch = opts.inMatch;
    this.allowed = new Set(ids.filter((i) => i !== this.myId));
    for (const id of [...this.peers.keys()]) if (!this.allowed.has(id)) this.closePeer(id);
    for (const id of this.allowed) if (!this.peers.has(id)) this.createPeer(id);
    const now = performance.now();
    for (const [id, list] of [...this.early]) {
      this.early.delete(id);
      if (!this.allowed.has(id)) continue;
      for (const e of list) if (now - e.at < 10_000) this.queueSignal(id, e.data);
    }
    this.emit();
  }

  /** Processa os sinais em ordem (oferta antes dos candidatos), um por vez. */
  private queueSignal(from: string, data: { desc?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }) {
    if (!this.allowed.has(from)) {
      const list = this.early.get(from) ?? [];
      if (list.length < 60) list.push({ at: performance.now(), data });
      this.early.set(from, list);
      return;
    }
    this.signalChain = this.signalChain.then(() => this.onSignal(from, data));
  }

  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer: Peer = { id, pc, polite: this.myId < id, makingOffer: false, ignoreOffer: false, sender: null, el: null, source: null, gain: null, panner: null, analyser: null, muted: false };
    this.peers.set(id, peer);
    const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    peer.sender = tr.sender;
    const track = this.local?.getAudioTracks()[0];
    if (track) void tr.sender.replaceTrack(track);
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.net.send({ t: 'rtc', to: id, data: { desc: pc.localDescription } });
      } catch (e) {
        console.warn('[voz] falha ao negociar', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.net.send({ t: 'rtc', to: id, data: { cand: ev.candidate.toJSON() } });
    };
    pc.ontrack = (ev) => this.attachRemote(peer, ev.streams[0] ?? new MediaStream([ev.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.emit();
    };
    return peer;
  }

  private attachRemote(peer: Peer, stream: MediaStream) {
    const ctx = audio.ctx;
    // Chrome só "puxa" áudio remoto para o WebAudio se houver um elemento <audio> associado
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    peer.el = el;
    if (!ctx) return;
    peer.source = ctx.createMediaStreamSource(stream);
    peer.analyser = ctx.createAnalyser();
    peer.analyser.fftSize = 512;
    peer.gain = ctx.createGain();
    peer.panner = ctx.createPanner();
    peer.panner.panningModel = 'HRTF';
    peer.panner.refDistance = 3;
    peer.panner.rolloffFactor = 1;
    peer.source.connect(peer.analyser);
    peer.source.connect(peer.gain);
    peer.gain.connect(peer.panner);
    peer.panner.connect(audio.voice);
    this.applyGain(peer, 1);
  }

  private async onSignal(from: string, data: { desc?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }) {
    if (!this.allowed.has(from)) return;
    const peer = this.peers.get(from) ?? this.createPeer(from);
    const pc = peer.pc;
    try {
      if (data.desc) {
        const collision = data.desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.desc);
        if (data.desc.type === 'offer') {
          await pc.setLocalDescription();
          this.net.send({ t: 'rtc', to: from, data: { desc: pc.localDescription } });
        }
      } else if (data.cand) {
        try {
          await pc.addIceCandidate(data.cand);
        } catch (e) {
          if (!peer.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('[voz] erro de sinalização', e);
    }
  }

  async enableMic(): Promise<MicState> {
    if (!Voice.supported()) {
      this.micState = 'unsupported';
      this.emit();
      return this.micState;
    }
    if (this.local) {
      this.micState = 'on';
      this.updateTrackEnabled();
      this.emit();
      return this.micState;
    }
    this.micState = 'pending';
    this.emit();
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const track = this.local.getAudioTracks()[0];
      for (const p of this.peers.values()) if (p.sender) await p.sender.replaceTrack(track);
      if (audio.ctx) {
        const src = audio.ctx.createMediaStreamSource(this.local);
        this.localAnalyser = audio.ctx.createAnalyser();
        this.localAnalyser.fftSize = 512;
        src.connect(this.localAnalyser);
      }
      this.micState = 'on';
      this.updateTrackEnabled();
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.micState = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error';
    }
    this.emit();
    return this.micState;
  }

  disableMic() {
    if (this.local) for (const t of this.local.getTracks()) t.stop();
    this.local = null;
    this.localAnalyser = null;
    for (const p of this.peers.values()) void p.sender?.replaceTrack(null);
    this.micState = 'off';
    this.emit();
  }

  setPushToTalk(on: boolean) {
    this.pushToTalk = on;
    this.updateTrackEnabled();
  }
  setPtt(held: boolean) {
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    this.updateTrackEnabled();
  }
  private updateTrackEnabled() {
    const t = this.local?.getAudioTracks()[0];
    if (t) t.enabled = !this.pushToTalk || this.pttHeld;
  }

  setMuted(id: string, muted: boolean) {
    const p = this.peers.get(id);
    if (!p) return;
    p.muted = muted;
    this.applyGain(p, p.gain?.gain.value ? 1 : 0);
    this.emit();
  }
  isMuted(id: string) {
    return this.peers.get(id)?.muted ?? false;
  }
  peerState(id: string): RTCPeerConnectionState | 'none' {
    return this.peers.get(id)?.pc.connectionState ?? 'none';
  }

  private applyGain(p: Peer, k: number) {
    if (!p.gain || !audio.ctx) return;
    p.gain.gain.setTargetAtTime(p.muted ? 0 : k, audio.ctx.currentTime, 0.1);
  }

  /** Atualiza volume/posição das vozes (proximidade durante a partida). */
  updateProximity(positions: Map<string, { x: number; z: number }>, me: { x: number; z: number; yaw: number }) {
    for (const p of this.peers.values()) {
      if (!p.panner || !audio.ctx) continue;
      if (!this.inMatch || this.spectator) {
        p.panner.positionX.value = me.x;
        p.panner.positionY.value = 1.6;
        p.panner.positionZ.value = me.z;
        this.applyGain(p, 1);
        continue;
      }
      const pos = positions.get(p.id);
      if (!pos) {
        this.applyGain(p, 0); // morto/fora: vivos não ouvem
        continue;
      }
      const d = Math.hypot(pos.x - me.x, pos.z - me.z);
      p.panner.positionX.value = pos.x;
      p.panner.positionY.value = 1.6;
      p.panner.positionZ.value = pos.z;
      this.applyGain(p, Math.max(0, Math.min(1, 1.15 - d / 22)));
    }
  }

  private level(a: AnalyserNode | null) {
    if (!a) return 0;
    a.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.buf.length);
  }

  /** Ids de quem está falando agora (inclui o próprio jogador). */
  talking(): string[] {
    const out: string[] = [];
    const t = this.local?.getAudioTracks()[0];
    if (t?.enabled && this.level(this.localAnalyser) > 0.03) out.push(this.myId);
    for (const p of this.peers.values()) if (!p.muted && this.level(p.analyser) > 0.03) out.push(p.id);
    return out;
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.source?.disconnect();
    p.panner?.disconnect();
    if (p.el) p.el.srcObject = null;
    this.peers.delete(id);
  }

  dispose() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.early.clear();
    this.disableMic();
    this.unsub();
  }
}
