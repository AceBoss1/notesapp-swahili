"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { toWav16k } from "@/lib/wav";
import { fileQuery } from "./MediaViewer";

type Mode = "transcript" | "to-english" | "to-swahili";
const LABEL: Record<Mode, string> = { transcript: "Kiswahili · transcript", "to-english": "English", "to-swahili": "Kiswahili" };
let ready: Promise<boolean> | null = null; // whether Kiswahili is switched on, asked once per visit
const isReady = () => (ready ??= fetch("/api/kiswahili/voice", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ready === true).catch(() => false));

// Under a voice note: someone else's Swahili note as a transcript and in English, or your own English note in Kiswahili
// (NKENNEAi). Only when someone taps; the result is kept on the message for both people, so it is never asked twice.
// The note goes as 16 kHz mono WAV, decoded from the copy this site already plays (lib/wav.ts).
export default function VoiceNoteKiswahili({ cid, mid, i, mine, kept }: { cid: string; mid: string; i: number; mine: boolean; kept?: Partial<Record<Mode, string>> }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState("");
  const [made, setMade] = useState<Partial<Record<Mode, string>>>({});
  useEffect(() => { void isReady().then(setOn); }, []);
  const texts = { ...kept, ...made };
  const offer: Mode[] = mine ? ["to-swahili"] : ["transcript", "to-english"];
  const shown = (Object.keys(LABEL) as Mode[]).filter((m) => texts[m]);
  if (!on && !shown.length) return null;

  async function ask(mode: Mode) {
    const u = auth.currentUser;
    if (!u) return;
    setBusy(mode); setError("");
    try {
      const token = await u.getIdToken();
      const q = fileQuery(cid, { mid, i });
      const raw = await fetch(`${q}&raw=1`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!raw.ok) throw new Error("Couldn't get the voice note.");
      const wav = await toWav16k(await raw.arrayBuffer());
      const fd = new FormData();
      fd.append("cid", cid); fd.append("mid", mid); fd.append("i", String(i)); fd.append("mode", mode); fd.append("audio", wav, "voice-note.wav");
      const r = await fetch("/api/kiswahili/voice", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "That didn't work.");
      setMade((m) => ({ ...m, [mode]: String(j.text) }));
    } catch (e) { setError(e instanceof Error ? e.message : "That didn't work."); }
    finally { setBusy(null); }
  }
  const line = mine ? "border-white/30" : "border-rule";
  return (
    <div className="mt-1.5 max-w-[16rem]">
      {shown.map((m) => (
        <div key={m} className={`mt-1.5 border-t pt-1.5 text-[13px] leading-snug ${line}`} lang={m === "to-english" ? "en" : "sw"}>
          <p className={`font-mono text-[10px] uppercase tracking-eyebrow ${mine ? "text-white/80" : "text-slate"}`}>{LABEL[m]}</p>
          <p>{texts[m]}</p>
        </div>
      ))}
      {on && offer.some((m) => !texts[m]) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {offer.filter((m) => !texts[m]).map((m) => (
            <button key={m} type="button" disabled={!!busy} onClick={() => void ask(m)}
              className={`rounded-full border px-2.5 py-0.5 font-ui text-[11.5px] font-semibold disabled:opacity-50 ${mine ? "border-white/50 text-white hover:bg-white/10" : "border-rule text-crimson hover:border-crimson"}`}>
              {busy === m ? "Listening…" : m === "transcript" ? "Transcript" : m === "to-english" ? "Translate to English" : "In Kiswahili"}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className={`mt-1 text-[11.5px] ${mine ? "text-white" : "text-red-700"}`}>{error}</p>}
    </div>
  );
}
