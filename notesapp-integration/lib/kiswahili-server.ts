import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { setting } from "@/lib/config";
import { NkenneError, speak, translateSpeech, translateText, transcribe, voices as listVoices, type NkenneConfig } from "./nkenne";
import { audioParts, sourceOf, translateAll, type Block } from "./kiswahili";
import { wavSeconds } from "./wav";

// Server-only. Kiswahili journals and voice notes with NKENNEAi (lib/nkenne.ts), made once and kept:
//   swahili/note_{id}   the translation of a journal (sourceHash says which version of it) and its audio parts per voice
//   messages … voiceText.{i}.{mode}   a voice note's transcript or translation, on the message, so both people see it
//   nkenneCalls/{id}    every call we made: what for, how big, how long, what NKENNEAi said (the evidence for token use)
//   nkenneStats/main    running totals: calls, failures, characters, audio seconds, and reads served from what was kept
export class KiswahiliError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const kiswahiliReady = () => !!setting("NKENNE_API_KEY");
const config = (): NkenneConfig => {
  const key = setting("NKENNE_API_KEY");
  if (!key) throw new KiswahiliError("Kiswahili isn't switched on yet.", 409);
  return { key, base: setting("NKENNE_API_URL") || undefined };
};
// Voices when NKENNEAi's list can't be read: their documented naming.
export const FALLBACK_VOICES = { female: "swahili_female_1", male: "swahili_male_1" } as const;
export type VoiceChoice = keyof typeof FALLBACK_VOICES;

export type CallLog = { api: "translate" | "speak" | "voices" | "transcribe" | "translate_speech"; purpose: string; ref: string; chars?: number; seconds?: number };
export type Deps = {
  nkenne?: NkenneConfig;
  // where audio parts go (the public media bucket); returns the address to play
  putAudio: (key: string, bytes: ArrayBuffer, type: string) => Promise<string>;
  now?: () => Date;
};

// One NKENNEAi call, logged whether it worked or not. A failure is logged and thrown again for the caller to show.
async function logged<T>(db: Firestore, log: CallLog, run: () => Promise<T>, now: Date): Promise<T> {
  const start = Date.now();
  const stats = db.doc("nkenneStats/main");
  try {
    const out = await run();
    await Promise.all([
      db.collection("nkenneCalls").add({ ...log, ok: true, httpStatus: 200, ms: Date.now() - start, at: now.toISOString() }),
      stats.set({ calls: FieldValue.increment(1), chars: FieldValue.increment(log.chars ?? 0), audioSeconds: FieldValue.increment(log.seconds ?? 0), updatedAt: now.toISOString() }, { merge: true }),
    ]).catch(() => {});
    return out;
  } catch (e) {
    const status = e instanceof NkenneError ? e.status : 0;
    await Promise.all([
      db.collection("nkenneCalls").add({ ...log, ok: false, httpStatus: status, detail: e instanceof NkenneError ? e.detail : String(e).slice(0, 300), ms: Date.now() - start, at: now.toISOString() }),
      stats.set({ calls: FieldValue.increment(1), failures: FieldValue.increment(1), updatedAt: now.toISOString() }, { merge: true }),
    ]).catch(() => {});
    if (e instanceof NkenneError) throw new KiswahiliError(e.message, status === 0 ? 502 : status >= 500 ? 502 : status === 401 || status === 403 ? 503 : status);
    throw e;
  }
}
const servedFromKept = (db: Firestore) => db.doc("nkenneStats/main").set({ hits: FieldValue.increment(1) }, { merge: true }).catch(() => {});

const hashOf = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);

type NoteDoc = { title?: string; content?: string; status?: string; premium?: boolean; offerSwahili?: boolean; authorUid?: string };
// A journal can be offered in Kiswahili when it is published, free to read (premium posts stay with their subscribers), and
// its author switched it on.
async function offeredNote(db: Firestore, noteId: string) {
  if (!noteId || noteId.includes("/")) throw new KiswahiliError("Which journal?");
  const n = (await db.doc(`notes/${noteId}`).get()).data() as NoteDoc | undefined;
  if (!n || n.status !== "published") throw new KiswahiliError("That journal wasn't found.", 404);
  if (n.premium) throw new KiswahiliError("Subscriber-only journals aren't offered in Kiswahili.", 403);
  if (!n.offerSwahili) throw new KiswahiliError("The author hasn't offered this journal in Kiswahili.", 403);
  if (n.authorUid) {
    const author = (await db.doc(`users/${n.authorUid}`).get()).data();
    if (author?.suspended) throw new KiswahiliError("That journal wasn't found.", 404);
  }
  return { title: String(n.title ?? ""), content: String(n.content ?? "") };
}

export type SwahiliNote = { title: string; blocks: Block[]; cut: boolean; madeAt: string; parts: number; fromKept: boolean };
type Kept = { sourceHash: string; title: string; blocks: Block[]; cut: boolean; madeAt: string; parts: string[]; audio?: Record<string, Record<string, string>>; pendingAt?: string };

// The Kiswahili version of a journal: what was kept if the journal hasn't changed since, otherwise translated now and kept.
export async function swahiliNote(db: Firestore, noteId: string, deps: Deps, countHit = true): Promise<SwahiliNote> {
  const now = deps.now?.() ?? new Date();
  const note = await offeredNote(db, noteId);
  const src = sourceOf(note.title, note.content);
  const sourceHash = hashOf(src.title, ...src.blocks.map((b) => `${b.kind}:${b.text}`));
  const ref = db.doc(`swahili/note_${noteId}`);
  const kept = (await ref.get()).data() as Kept | undefined;
  if (kept?.sourceHash === sourceHash && kept.blocks?.length === src.blocks.length) {
    if (countHit) await servedFromKept(db);
    return { title: kept.title, blocks: kept.blocks, cut: kept.cut, madeAt: kept.madeAt, parts: kept.parts.length, fromKept: true };
  }
  // Two readers arriving together: only the first one translates; the other is asked to wait a moment.
  const claimed = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as Kept | undefined;
    if (cur?.sourceHash === sourceHash && cur.blocks?.length === src.blocks.length) return "done";
    if (cur?.pendingAt && now.getTime() - new Date(cur.pendingAt).getTime() < 90_000) return "busy";
    tx.set(ref, { pendingAt: now.toISOString() }, { merge: true });
    return "mine";
  });
  if (claimed === "done") return swahiliNote(db, noteId, deps, countHit);
  if (claimed === "busy") throw new KiswahiliError("The Kiswahili version is being made. Try again in a few seconds.", 425);
  try {
    const cfg = deps.nkenne ?? config();
    const texts = [src.title, ...src.blocks.map((b) => b.text)];
    const { out } = await translateAll(texts, (text) =>
      logged(db, { api: "translate", purpose: "journal", ref: noteId, chars: text.length }, () => translateText(cfg, text, "English", "Swahili"), now));
    const blocks = src.blocks.map((b, i) => ({ kind: b.kind, text: out[i + 1] }));
    const parts = audioParts(out[0], blocks.map((b) => b.text));
    const doc: Kept = { sourceHash, title: out[0], blocks, cut: src.cut, madeAt: now.toISOString(), parts, audio: {} };
    // A fresh translation replaces the whole document: the old one's audio and the "being made" mark go with it.
    await ref.set(doc);
    return { title: doc.title, blocks, cut: doc.cut, madeAt: doc.madeAt, parts: parts.length, fromKept: false };
  } catch (e) {
    await ref.set({ pendingAt: FieldValue.delete() }, { merge: true }).catch(() => {});
    throw e;
  }
}

// The voices to offer, read from NKENNEAi once and kept for a week (the list rarely changes).
export async function swahiliVoices(db: Firestore, deps: Pick<Deps, "nkenne" | "now">): Promise<Record<VoiceChoice, string>> {
  const now = deps.now?.() ?? new Date();
  const ref = db.doc("swahili/_voices");
  const kept = (await ref.get()).data() as { female?: string; male?: string; at?: string } | undefined;
  if (kept?.female && kept.male && kept.at && now.getTime() - new Date(kept.at).getTime() < 7 * 86_400_000) return { female: kept.female, male: kept.male };
  try {
    const cfg = deps.nkenne ?? config();
    const r = await logged(db, { api: "voices", purpose: "voices", ref: "swahili" }, () => listVoices(cfg), now);
    const pick = (g: string) => r.voices.find((v) => v.gender?.toLowerCase() === g)?.id;
    const out = { female: pick("female") || FALLBACK_VOICES.female, male: pick("male") || FALLBACK_VOICES.male };
    await ref.set({ ...out, at: now.toISOString() });
    return out;
  } catch {
    return { ...FALLBACK_VOICES };
  }
}

// One part of a journal's Kiswahili audio, in one voice: kept, or made now and kept. Parts are asked for one at a time as
// the reader listens, so audio nobody reaches is never made.
export async function swahiliAudioPart(db: Firestore, noteId: string, voice: VoiceChoice, part: number, deps: Deps): Promise<{ url: string; part: number; parts: number; fromKept: boolean }> {
  const now = deps.now?.() ?? new Date();
  if (voice !== "female" && voice !== "male") throw new KiswahiliError("Choose a female or male voice.");
  await offeredNote(db, noteId);
  const t = await swahiliNote(db, noteId, deps, false); // makes sure the kept translation matches the journal as it is now
  if (!Number.isInteger(part) || part < 0 || part >= t.parts) throw new KiswahiliError("That part of the audio doesn't exist.", 404);
  const ref = db.doc(`swahili/note_${noteId}`);
  const kept = (await ref.get()).data() as Kept;
  const have = kept.audio?.[voice]?.[String(part)];
  if (have) { await servedFromKept(db); return { url: have, part, parts: t.parts, fromKept: true }; }
  const cfg = deps.nkenne ?? config();
  const voiceId = (await swahiliVoices(db, deps))[voice];
  const text = kept.parts[part];
  const audio = await logged(db, { api: "speak", purpose: "journal audio", ref: `${noteId}#${part}`, chars: text.length }, () => speak(cfg, text, voiceId), now);
  const ext = audio.type === "audio/wav" ? "wav" : "mp3";
  const url = await deps.putAudio(`swahili/${noteId}/${kept.sourceHash}/${voice}-${part}.${ext}`, audio.bytes, audio.type);
  await ref.update({ [`audio.${voice}.${part}`]: url });
  return { url, part, parts: t.parts, fromKept: false };
}

// A voice note, as words: what a Swahili note says (transcript), a Swahili note in English, or an English note in Kiswahili.
// The browser sends the note as 16 kHz mono WAV (lib/wav.ts); it is checked before any token is spent, and the result is
// kept on the message for both people.
export type VoiceMode = "transcript" | "to-english" | "to-swahili";
export const VOICE_MAX_SECONDS = 120;
export async function voiceNoteText(db: Firestore, me: string, input: { cid: string; mid: string; i: number; mode: unknown; wav: ArrayBuffer | null }, deps: Pick<Deps, "nkenne" | "now">): Promise<{ text: string; fromKept: boolean }> {
  const now = deps.now?.() ?? new Date();
  const { cid, mid, i } = input;
  const mode = input.mode;
  if (mode !== "transcript" && mode !== "to-english" && mode !== "to-swahili") throw new KiswahiliError("Choose transcript, English or Kiswahili.");
  if (!cid || !mid || cid.includes("/") || mid.includes("/") || !Number.isInteger(i) || i < 0) throw new KiswahiliError("Which voice note?");
  const conv = (await db.doc(`conversations/${cid}`).get()).data();
  if (!conv || !(conv.participants as string[] | undefined)?.includes(me)) throw new KiswahiliError("That voice note wasn't found.", 404);
  const msgRef = db.doc(`conversations/${cid}/messages/${mid}`);
  const msg = (await msgRef.get()).data();
  const a = (msg?.attachments as { kind?: string }[] | undefined)?.[i];
  if (!msg || msg.deleted || msg.removed || a?.kind !== "audio") throw new KiswahiliError("That voice note wasn't found.", 404);
  const kept = (msg.voiceText as Record<string, Record<string, string>> | undefined)?.[String(i)]?.[mode];
  if (kept) { await servedFromKept(db); return { text: kept, fromKept: true }; }
  if (!input.wav) throw new KiswahiliError("Send the voice note as audio.");
  const seconds = wavSeconds(input.wav);
  if (seconds === null) throw new KiswahiliError("That recording couldn't be read. Play it once, then try again.");
  if (seconds > VOICE_MAX_SECONDS) throw new KiswahiliError(`Voice notes up to ${VOICE_MAX_SECONDS / 60} minutes can be translated.`, 413);
  const cfg = deps.nkenne ?? config();
  const blob = new Blob([input.wav], { type: "audio/wav" });
  const log: CallLog = { api: mode === "transcript" ? "transcribe" : "translate_speech", purpose: `voice note ${mode}`, ref: `${cid}/${mid}#${i}`, seconds: Math.round(seconds * 10) / 10 };
  const text = mode === "transcript"
    ? (await logged(db, log, () => transcribe(cfg, blob, "swahili"), now)).text
    : await logged(db, log, () => translateSpeech(cfg, blob, mode === "to-english" ? "swahili-to-english" : "english-to-swahili"), now);
  const clean = text.trim().slice(0, 4_000);
  if (!clean) throw new KiswahiliError("Nothing could be heard in that voice note.", 422);
  await msgRef.update({ [`voiceText.${i}.${mode}`]: clean });
  return { text: clean, fromKept: false };
}

// Admin → NKENNEAi: totals and the latest calls.
export async function nkenneUsage(db: Firestore) {
  const [stats, calls] = await Promise.all([db.doc("nkenneStats/main").get(), db.collection("nkenneCalls").orderBy("at", "desc").limit(50).get()]);
  const s = stats.data() ?? {};
  return {
    ready: kiswahiliReady(),
    totals: { calls: Number(s.calls ?? 0), failures: Number(s.failures ?? 0), chars: Number(s.chars ?? 0), audioSeconds: Math.round(Number(s.audioSeconds ?? 0)), hits: Number(s.hits ?? 0) },
    calls: calls.docs.map((d) => {
      const c = d.data();
      return { id: d.id, at: String(c.at), api: String(c.api), purpose: String(c.purpose), ref: String(c.ref ?? ""), chars: c.chars ?? null, seconds: c.seconds ?? null, ok: c.ok === true, httpStatus: Number(c.httpStatus ?? 0), ms: Number(c.ms ?? 0), detail: c.detail ? String(c.detail) : "" };
    }),
  };
}
