// A voice note as 16 kHz mono 16-bit WAV, the format NKENNEAi recommends for speech: browsers record WebM or MP4, which
// its speech endpoints don't all take, so the browser decodes the note it already plays and sends this instead. Pure
// (no browser APIs) apart from `toWav16k`, so the encoder is tested in Node.
export const WAV_RATE = 16_000;

// Mono samples at any rate → 16 kHz, by averaging (good enough for speech; no aliasing worth hearing at these rates).
export function resample(samples: Float32Array, rate: number, to = WAV_RATE): Float32Array {
  if (rate === to) return samples;
  const ratio = rate / to, n = Math.floor(samples.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = a; j < b; j++) sum += samples[j];
    out[i] = b > a ? sum / (b - a) : samples[a] ?? 0;
  }
  return out;
}

export function encodeWav(samples: Float32Array, rate = WAV_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return buf;
}

// Is this a WAV we made (16-bit PCM mono)? The server checks before it spends a token on it; returns its length in seconds.
export function wavSeconds(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 44) return null;
  const v = new DataView(buf), tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint16(34, true) !== 16) return null;
  const rate = v.getUint32(24, true);
  return rate ? v.getUint32(40, true) / (rate * 2) : null;
}

// In the browser: any audio the browser can play → 16 kHz mono WAV.
export async function toWav16k(audio: ArrayBuffer): Promise<Blob> {
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(audio.slice(0));
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) { const d = decoded.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / decoded.numberOfChannels; }
    return new Blob([encodeWav(resample(mono, decoded.sampleRate))], { type: "audio/wav" });
  } finally { void ctx.close(); }
}
