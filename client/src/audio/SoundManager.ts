import type { GameSettings } from '../utils/settings';

/**
 * All sound effects are synthesized at runtime with the Web Audio API
 * (oscillators + noise + envelopes) rather than sourced from audio files.
 * This avoids any third-party asset licensing entirely — see README's
 * "Audio" section for details.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private settings: GameSettings;

  constructor(settings: GameSettings) {
    this.settings = settings;
  }

  updateSettings(settings: GameSettings): void {
    this.settings = settings;
  }

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private gainFor(category: 'sfx' | 'music'): number {
    const catVolume = category === 'sfx' ? this.settings.sfxVolume : this.settings.musicVolume;
    return this.settings.masterVolume * catVolume;
  }

  private playTone(freq: number, duration: number, type: OscillatorType, peakGain: number): void {
    const ctx = this.getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peakGain * this.gainFor('sfx'), ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  private playNoiseBurst(duration: number, peakGain: number, lowpassHz: number): void {
    const ctx = this.getContext();
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain * this.gainFor('sfx'), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  cueStrike(power: number): void {
    this.playNoiseBurst(0.05, 0.5 + power / 200, 3000);
    this.playTone(180 + power * 3, 0.08, 'triangle', 0.3);
  }

  ballCollision(intensity = 1): void {
    this.playTone(900 + Math.random() * 300, 0.06, 'sine', 0.25 * Math.min(1, intensity));
    this.playNoiseBurst(0.03, 0.15 * Math.min(1, intensity), 4000);
  }

  railCollision(): void {
    this.playTone(300, 0.07, 'square', 0.12);
  }

  pocket(): void {
    this.playTone(520, 0.12, 'sine', 0.3);
    setTimeout(() => this.playTone(680, 0.15, 'sine', 0.25), 70);
  }

  foul(): void {
    this.playTone(160, 0.3, 'sawtooth', 0.2);
  }

  win(): void {
    [523, 659, 784, 1046].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.35, 'triangle', 0.28), i * 110);
    });
  }

  lose(): void {
    [392, 349, 294].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.4, 'sawtooth', 0.2), i * 140);
    });
  }

  click(): void {
    this.playTone(700, 0.04, 'square', 0.15);
  }
}
