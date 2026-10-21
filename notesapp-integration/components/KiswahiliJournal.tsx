"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { auth } from "@/lib/firebase";
import type { Block } from "@/lib/kiswahili";

type Swahili = { title: string; blocks: Block[]; cut: boolean; madeAt: string; parts: number };
type Voice = "female" | "male";
const RATES = [0.75, 1, 1.25] as const;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const u = auth.currentUser;
  const res = await fetch(path, { ...init, headers: { ...(init?.headers || {}), ...(u ? { Authorization: `Bearer ${await u.getIdToken()}` } : {}) }, cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || "Kiswahili didn't work just now."), { status: res.status });
  return j as T;
}
// A journal being made by another reader at this moment answers 425: wait a few seconds and ask once more.
async function fetchSwahili(id: string): Promise<Swahili> {
  try { return await call<Swahili>(`/api/kiswahili/note?id=${encodeURIComponent(id)}`); }
  catch (e) {
    if ((e as { status?: number }).status !== 425) throw e;
    await new Promise((r) => setTimeout(r, 5000));
    return call<Swahili>(`/api/kiswahili/note?id=${encodeURIComponent(id)}`);
  }
}

// English | 🌍 Kiswahili | 🔊 Sikiliza on a journal its author offers in Kiswahili (NKENNEAi), and the Kiswahili version in
// place of the English one. Nothing is asked of NKENNEAi until a reader taps; what's made is kept for everyone after
// (lib/kiswahili-server.ts). `english` is the journal as the page already shows it.
export default function KiswahiliJournal({ noteId, english }: { noteId: string; english: ReactNode }) {
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [sw, setSw] = useState<Swahili | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);

  async function load(): Promise<Swahili | null> {
    if (sw) return sw;
    setBusy(true); setError("");
    try { const r = await fetchSwahili(noteId); setSw(r); return r; }
    catch (e) { setError(e instanceof Error ? e.message : "Kiswahili didn't work just now."); return null; }
    finally { setBusy(false); }
  }
  const pill = (on: boolean) => `rounded-full border px-3.5 py-1.5 font-ui text-sm font-semibold ${on ? "border-crimson bg-crimson text-white" : "border-rule bg-card text-ink hover:border-crimson"}`;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Language">
        <button type="button" onClick={() => setLang("en")} aria-pressed={lang === "en"} className={pill(lang === "en")}>English</button>
        <button type="button" disabled={busy} onClick={async () => { if (await load()) setLang("sw"); }} aria-pressed={lang === "sw"} className={pill(lang === "sw")}>🌍 {busy && !sw ? "Inatafsiri…" : "Kiswahili"}</button>
        <button type="button" disabled={busy} onClick={async () => { if (await load()) setListening(true); }} aria-pressed={listening} className={pill(listening)}>🔊 Sikiliza<span className="hidden sm:inline"> · Listen</span></button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {lang === "sw" && sw ? (
        <div lang="sw">
          <p className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-crimson/20 bg-crimson/5 px-3 py-2.5 text-sm text-ink">
            <span>🌍 Imetafsiriwa kwa Kiswahili na NKENNEAi</span>
            <span className="text-xs text-slate">· translated by NKENNEAi{sw.cut ? "; the first part of a long journal" : ""}</span>
            <button type="button" onClick={() => setLang("en")} className="ml-auto font-semibold text-crimson hover:underline">Show original</button>
          </p>
          <div className="prose-journal mt-6">
            <h2 className="font-display text-3xl text-ink">{sw.title}</h2>
            {sw.blocks.map((b, i) => b.kind === "h1" || b.kind === "h2" ? <h3 key={i} className="mt-8 font-display text-2xl text-ink">{b.text}</h3>
              : b.kind === "h3" ? <h4 key={i} className="mt-6 font-display text-xl text-ink">{b.text}</h4>
              : b.kind === "li" ? <p key={i} className="mt-2 pl-5 font-serif text-lg leading-relaxed text-ink before:-ml-4 before:mr-2 before:content-['•']">{b.text}</p>
              : b.kind === "quote" ? <blockquote key={i} className="mt-4 border-l-4 border-crimson/40 pl-4 font-serif text-lg italic text-ink/90">{b.text}</blockquote>
              : <p key={i} className="mt-4 font-serif text-lg leading-relaxed text-ink">{b.text}</p>)}
          </div>
        </div>
      ) : english}
      {listening && sw && <SwahiliPlayer noteId={noteId} parts={sw.parts} onClose={() => setListening(false)} />}
    </>
  );
}

// The journal read aloud in Kiswahili, part by part: each part is asked for when it's about to play (and the next one
// just before), so audio nobody reaches is never made. Speed is the player's own, so changing it costs nothing.
function SwahiliPlayer({ noteId, parts, onClose }: { noteId: string; parts: number; onClose: () => void }) {
  const el = useRef<HTMLAudioElement>(null);
  const [voice, setVoice] = useState<Voice>("female");
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [part, setPart] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0); // 0..1 across the whole journal
  const urls = useRef(new Map<string, Promise<string>>());

  const urlFor = (v: Voice, i: number) => {
    const k = `${v}:${i}`;
    if (!urls.current.has(k)) {
      const p = call<{ url: string }>("/api/kiswahili/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: noteId, voice: v, part: i }) }).then((r) => r.url);
      p.catch(() => urls.current.delete(k));
      urls.current.set(k, p);
    }
    return urls.current.get(k)!;
  };
  async function playPart(i: number, v = voice) {
    const a = el.current;
    if (!a) return;
    setLoading(true); setError("");
    try {
      a.src = await urlFor(v, i);
      a.playbackRate = rate;
      await a.play();
      setPart(i); setPlaying(true);
      if (i + 1 < parts) void urlFor(v, i + 1).catch(() => {}); // the next part, ready before this one ends
    } catch (e) {
      // The browser wants a tap of its own before sound plays: the part is ready, so ▶ starts it.
      // A newer part or voice replaced this one before it started (AbortError): nothing went wrong.
      if (e instanceof Error && e.name === "AbortError") return;
      if (!(e instanceof Error && e.name === "NotAllowedError")) setError(e instanceof Error ? e.message : "Couldn't play it.");
      setPart(i); setPlaying(false);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { void playPart(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (el.current) el.current.playbackRate = rate; }, [rate]);

  function toggle() {
    const a = el.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); } else if (a.src) { void a.play(); setPlaying(true); } else void playPart(part);
  }
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${on ? "border-white bg-white text-ink" : "border-white/30 text-white hover:bg-white/10"}`;
  return (
    <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] rounded-2xl bg-[#1a1210] p-3.5 text-white shadow-2xl sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[340px]" role="region" aria-label="Sikiliza kwa Kiswahili">
      <audio ref={el} preload="none" lang="sw"
        onTimeUpdate={(e) => { const a = e.currentTarget; if (a.duration) setProgress((part + a.currentTime / a.duration) / parts); }}
        onEnded={() => { if (part + 1 < parts) void playPart(part + 1); else { setPlaying(false); setProgress(1); } }} />
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} disabled={loading} aria-label={playing ? "Pause" : "Play"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-ink disabled:opacity-60">{loading ? "…" : playing ? "❚❚" : "▶"}</button>
        <div className="min-w-0 flex-1">
          <p className="font-ui text-sm font-bold">Sikiliza kwa Kiswahili</p>
          <p className="text-[11.5px] text-white/70">Part {part + 1} of {parts} · read by NKENNEAi</p>
        </div>
        <button type="button" onClick={() => { el.current?.pause(); onClose(); }} aria-label="Close the player" className="px-1 text-xl leading-none text-white/80 hover:text-white">×</button>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/20"><div className="h-1 rounded-full bg-[#e8608a] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {(["female", "male"] as Voice[]).map((v) => <button key={v} type="button" onClick={() => { if (v !== voice) { setVoice(v); void playPart(part, v); } }} aria-pressed={voice === v} className={chip(voice === v)}>{v === "female" ? "Female" : "Male"}</button>)}
        <span className="ml-auto flex gap-1.5">
          {RATES.map((r) => <button key={r} type="button" onClick={() => setRate(r)} aria-pressed={rate === r} className={chip(rate === r)}>{r}×</button>)}
        </span>
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-red-300">{error}</p>}
    </div>
  );
}
