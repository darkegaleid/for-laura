export class BouquetAudioController {
  private audioEl: HTMLAudioElement | null = null;
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;
  private uploadedUrl: string | null = null;

  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBuffer: Uint8Array<ArrayBuffer> | null = null;

  private chimeTimer: number | null = null;
  private chordStep = 0;
  private presetIndex = 0;

  private isPlaying = false;
  private volume = 0.55;
  private hasUploadedTrack = false;

  public readonly BUILTIN_TRACKS = [
    {
      name: 'Starlight Chimes (Built-in)',
      chords: [
        [349.23, 440.0, 523.25, 659.25],
        [329.63, 392.0, 493.88, 587.33],
        [293.66, 349.23, 440.0, 659.25],
        [261.63, 329.63, 392.0, 493.88],
      ],
    },
    {
      name: 'Midnight Lilies (Built-in)',
      chords: [
        [293.66, 349.23, 440.0, 523.25],
        [261.63, 329.63, 392.0, 493.88],
        [220.0, 293.66, 349.23, 440.0],
        [246.94, 329.63, 392.0, 493.88],
      ],
    },
  ];

  private ensureAudioContext() {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctor();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = this.volume * 0.25;

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.audioEl) {
      this.audioEl.volume = this.volume;
    }
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setTargetAtTime(this.volume * 0.25, this.audioCtx.currentTime, 0.08);
    }
  }

  public setBuiltinTrack(index: number): string {
    this.presetIndex =
      ((index % this.BUILTIN_TRACKS.length) + this.BUILTIN_TRACKS.length) %
      this.BUILTIN_TRACKS.length;
    if (this.hasUploadedTrack) {
      this.clearUploadedTrack();
    } else if (this.isPlaying) {
      this.startSynth();
    }
    return this.BUILTIN_TRACKS[this.presetIndex].name;
  }

  public loadRemoteAudioUrl(url: string) {
    if (!url) {
      this.clearUploadedTrack();
      return;
    }
    if (this.uploadedUrl && this.uploadedUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.uploadedUrl);
    }
    this.stopSynth();
    this.uploadedUrl = url;
    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.loop = true;
      this.audioEl.crossOrigin = 'anonymous';
    }
    if (this.audioEl.src !== url && !this.audioEl.src.endsWith(url)) {
      this.audioEl.src = url;
    }
    this.audioEl.volume = this.volume;
    this.hasUploadedTrack = true;

    try {
      this.ensureAudioContext();
      if (this.audioCtx && this.analyser && !this.mediaSourceNode) {
        this.mediaSourceNode = this.audioCtx.createMediaElementSource(this.audioEl);
        this.mediaSourceNode.connect(this.analyser);
      }
    } catch {
      // Fallback safely
    }

    if (this.isPlaying) {
      this.audioEl.play().catch(() => {});
    }
  }

  public cycleBuiltInTrack(delta: 1 | -1): string {
    return this.setBuiltinTrack(this.presetIndex + delta);
  }

  public clearUploadedTrack() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
    }
    if (this.uploadedUrl && this.uploadedUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.uploadedUrl);
    }
    this.uploadedUrl = null;
    this.hasUploadedTrack = false;
    if (this.isPlaying) {
      this.startSynth();
    }
  }

  public async play(): Promise<boolean> {
    this.isPlaying = true;
    this.ensureAudioContext();
    if (this.hasUploadedTrack && this.audioEl) {
      try {
        await this.audioEl.play();
        return true;
      } catch {
        this.isPlaying = false;
        return false;
      }
    }
    return this.startSynth();
  }

  public pause() {
    this.isPlaying = false;
    if (this.audioEl) {
      this.audioEl.pause();
    }
    this.stopSynth();
  }

  public getSpectrumBars(barCount: number, timeSec: number): number[] {
    const out = new Array<number>(barCount).fill(0.08);
    if (!this.isPlaying) return out;

    let hasRealSignal = false;
    if (this.analyser && this.freqBuffer) {
      this.analyser.getByteFrequencyData(this.freqBuffer);
      for (let i = 0; i < barCount; i++) {
        const binIdx = Math.min(this.freqBuffer.length - 1, Math.floor((i / barCount) * 20));
        const norm = this.freqBuffer[binIdx] / 255;
        if (norm > 0.02) hasRealSignal = true;
        out[i] = Math.max(0.1, Math.min(1, norm * 1.35));
      }
    }

    if (!hasRealSignal) {
      for (let i = 0; i < barCount; i++) {
        const centerDist = Math.abs(i - barCount * 0.5) / (barCount * 0.5);
        const envelope = 1 - centerDist * 0.45;
        const wave =
          0.35 +
          0.32 * Math.sin(timeSec * 4.5 + i * 0.55) +
          0.22 * Math.cos(timeSec * 7.2 - i * 0.9);
        out[i] = Math.max(0.12, Math.min(0.95, wave * envelope));
      }
    }
    return out;
  }

  private startSynth(): boolean {
    try {
      this.ensureAudioContext();
      if (this.chimeTimer !== null) {
        window.clearInterval(this.chimeTimer);
      }

      const playArpeggio = () => {
        if (!this.audioCtx || !this.masterGain || !this.isPlaying) return;
        const chords = this.BUILTIN_TRACKS[this.presetIndex].chords;
        const chord = chords[this.chordStep % chords.length];
        this.chordStep++;

        chord.forEach((freq, idx) => {
          if (!this.audioCtx || !this.masterGain) return;
          const now = this.audioCtx.currentTime + idx * 0.36;
          const osc = this.audioCtx.createOscillator();
          const noteGain = this.audioCtx.createGain();

          osc.type = idx === 0 ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(freq, now);

          noteGain.gain.setValueAtTime(0.0001, now);
          noteGain.gain.exponentialRampToValueAtTime(0.3 / (idx + 1), now + 0.14);
          noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.1);

          osc.connect(noteGain);
          noteGain.connect(this.masterGain);

          osc.start(now);
          osc.stop(now + 3.2);
        });
      };

      playArpeggio();
      this.chimeTimer = window.setInterval(playArpeggio, 3300);
      return true;
    } catch {
      this.isPlaying = false;
      return false;
    }
  }

  private stopSynth() {
    if (this.chimeTimer !== null) {
      window.clearInterval(this.chimeTimer);
      this.chimeTimer = null;
    }
  }

  public dispose() {
    this.pause();
    if (this.uploadedUrl && this.uploadedUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.uploadedUrl);
    }
    this.uploadedUrl = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
