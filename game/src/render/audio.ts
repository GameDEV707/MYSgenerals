// MYS Generals — audio (spec §17). All sounds are synthesized via WebAudio (no asset files,
// required because the offline sandbox cannot bundle external audio). Buses + per-id cooldown.
export type SoundId =
  | "tracer" | "shell" | "rocket" | "artillery" | "energy" | "flak" | "beam" | "flame"
  | "explode" | "bigexplode" | "build" | "ready" | "click" | "deny" | "capture" | "rankup"
  | "ability" | "ultimate" | "alarm";

export class AudioManager {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  uiBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  lastPlayed = new Map<SoundId, number>();
  enabled = true;
  volumes = { master: 0.7, sfx: 0.8, ui: 0.7, music: 0.4 };

  init(): void {
    if (this.ctx) return;
    try {
      const AC = (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
      this.ctx = new (AC.AudioContext || AC.webkitAudioContext!)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volumes.master; this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.volumes.sfx; this.sfxBus.connect(this.master);
      this.uiBus = this.ctx.createGain(); this.uiBus.gain.value = this.volumes.ui; this.uiBus.connect(this.master);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.volumes.music; this.musicBus.connect(this.master);
    } catch { this.enabled = false; }
  }
  resume(): void { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  setVolume(bus: keyof AudioManager["volumes"], v: number): void {
    this.volumes[bus] = v;
    if (bus === "master" && this.master) this.master.gain.value = v;
    if (bus === "sfx" && this.sfxBus) this.sfxBus.gain.value = v;
    if (bus === "ui" && this.uiBus) this.uiBus.gain.value = v;
    if (bus === "music" && this.musicBus) this.musicBus.gain.value = v;
  }

  // distance attenuation (spec §17.2): pan/volume from camera-relative position [-1..1], 0..1 vol
  play(id: SoundId, pan = 0, vol = 1): void {
    if (!this.enabled || !this.ctx || !this.sfxBus) return;
    const now = this.ctx.currentTime;
    const cd = COOLDOWN[id] ?? 0.03;
    const last = this.lastPlayed.get(id) ?? -10;
    if (now - last < cd) return;
    this.lastPlayed.set(id, now);
    const bus = (id === "click" || id === "deny" || id === "ready") ? this.uiBus! : this.sfxBus;
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const out = panner ?? this.ctx.createGain();
    if (panner) panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(bus);
    this.synth(id, out, vol, now);
  }

  private synth(id: SoundId, dest: AudioNode, vol: number, now: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain(); env.connect(dest);
    const mk = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
      env.gain.setValueAtTime(0.0001, now); env.gain.exponentialRampToValueAtTime(peak * vol, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(env); o.start(now); o.stop(now + dur + 0.02);
    };
    const noise = (dur: number, peak: number, lp: number) => {
      const n = Math.floor(ctx.sampleRate * dur); const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = buf.getChannelData(0); for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp;
      const g = ctx.createGain(); g.gain.value = peak * vol;
      src.connect(f); f.connect(g); g.connect(dest); src.start(now); src.stop(now + dur);
    };
    switch (id) {
      case "tracer": mk("square", 900, 300, 0.05, 0.06); break;
      case "shell": mk("sawtooth", 220, 60, 0.18, 0.25); noise(0.12, 0.12, 1200); break;
      case "rocket": mk("sawtooth", 500, 120, 0.25, 0.12); noise(0.2, 0.08, 2500); break;
      case "artillery": mk("triangle", 160, 40, 0.3, 0.2); break;
      case "energy": mk("sine", 700, 1400, 0.12, 0.15); break;
      case "flak": mk("square", 600, 200, 0.08, 0.1); break;
      case "flame": noise(0.3, 0.15, 800); break;
      case "beam": mk("sine", 400, 200, 0.5, 0.2); break;
      case "explode": noise(0.35, 0.4, 900); mk("sine", 120, 40, 0.3, 0.2); break;
      case "bigexplode": noise(0.7, 0.6, 600); mk("sine", 90, 30, 0.6, 0.35); break;
      case "build": mk("square", 200, 260, 0.1, 0.08); break;
      case "ready": mk("sine", 660, 880, 0.12, 0.12); break;
      case "click": mk("square", 440, 520, 0.04, 0.07); break;
      case "deny": mk("square", 180, 120, 0.12, 0.12); break;
      case "capture": mk("sine", 440, 880, 0.25, 0.15); break;
      case "rankup": mk("sine", 600, 1200, 0.2, 0.15); break;
      case "ability": mk("triangle", 500, 1000, 0.2, 0.15); break;
      case "ultimate": mk("sawtooth", 200, 1200, 0.6, 0.3); noise(0.6, 0.3, 1200); break;
      case "alarm": mk("square", 700, 500, 0.3, 0.18); break;
    }
  }
}

const COOLDOWN: Partial<Record<SoundId, number>> = {
  tracer: 0.05, shell: 0.08, rocket: 0.08, energy: 0.06, flak: 0.05, explode: 0.05, bigexplode: 0.2, alarm: 1.5,
};
