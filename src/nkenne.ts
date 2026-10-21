// The NKENNEAi API (https://nkenne.ai/nkenneai-api), as #NotesApp uses it: Kiswahili only, as the NKENNEAi API Hackathon
// allows (Oct 2026). Four calls, all with one API key sent as the Authorization header:
//   text → text      POST /api/translate/with-api-key            { text, fromLanguage, toLanguage } → { translatedText }
//   text → speech    POST /api/tts/v1/swahili/with-api-key       { text, voice_name?, speaking_rate? } → MP3/WAV bytes
//   voices           GET  /api/tts/v1/swahili/voices             → { default_voice, voices: [{ id, name, gender }] }
//   speech → text    POST /api/stt/v1/{swahili|english}/with-api-key        form-data audio_file → { text, duration }
//   speech → text in another language
//                    POST /api/st/v1/{swahili-to-english|english-to-swahili}/with-api-key  audio_file → { translated_text }
// No Firestore and no settings here: the caller passes the key and `fetch`, so this file is the same in the public
// notesapp-swahili repo. Nothing here retries: every call costs tokens, so the caller decides.
export type NkenneConfig = { key: string; base?: string; fetch?: typeof fetch; timeoutMs?: number };
export type Lang = "English" | "Swahili";
export type Voice = { id: string; name: string; gender: string };
export const NKENNE_BASE = "https://developers-api.nkenne.ai";
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024; // the API's limit per file

export class NkenneError extends Error {
  // status: what NKENNEAi answered (0 when the request itself failed). The message is safe to show a member.
  constructor(message: string, public status: number, public detail = "") { super(message); }
}

// What a member sees for each kind of failure; `detail` keeps NKENNEAi's own words for the usage log.
function failure(status: number, detail: string): NkenneError {
  const said = detail.slice(0, 300);
  if (status === 401 || status === 403) return new NkenneError("Kiswahili isn't available right now (the translation service refused our key).", status, said);
  if (status === 402 || status === 429) return new NkenneError("Kiswahili is busy right now. Try again in a little while.", status, said);
  if (status === 413) return new NkenneError("That recording is too long to translate. Try a shorter one.", status, said);
  if (status === 400 || status === 404) return new NkenneError("That couldn't be translated.", status, said);
  return new NkenneError("The translation service didn't answer. Try again in a moment.", status, said);
}

async function send(cfg: NkenneConfig, path: string, init: RequestInit): Promise<Response> {
  const f = cfg.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 60_000);
  try {
    const res = await f(`${(cfg.base || NKENNE_BASE).replace(/\/$/, "")}${path}`, { ...init, headers: { Authorization: cfg.key, ...(init.headers || {}) }, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw failure(res.status, await res.text().catch(() => ""));
    return res;
  } catch (e) {
    if (e instanceof NkenneError) throw e;
    throw new NkenneError("The translation service didn't answer. Try again in a moment.", 0, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
async function json<T>(res: Response): Promise<T> {
  const t = await res.text();
  try { return JSON.parse(t) as T; } catch { throw new NkenneError("The translation service sent something we couldn't read.", res.status, t.slice(0, 300)); }
}

// English ↔ Swahili text. One of the two must be English (the API has no other pairs).
export async function translateText(cfg: NkenneConfig, text: string, from: Lang, to: Lang): Promise<string> {
  if (from === to) throw new NkenneError("Choose two different languages.", 400);
  const res = await send(cfg, "/api/translate/with-api-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, fromLanguage: from, toLanguage: to }) });
  const out = (await json<{ translatedText?: unknown }>(res)).translatedText;
  if (typeof out !== "string" || !out.trim()) throw new NkenneError("The translation came back empty.", res.status);
  return out;
}

// Swahili speech for some text: the audio bytes and their type (audio/mpeg or audio/wav).
export async function speak(cfg: NkenneConfig, text: string, voice?: string, rate?: number): Promise<{ bytes: ArrayBuffer; type: string }> {
  const res = await send(cfg, "/api/tts/v1/swahili/with-api-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, ...(voice ? { voice_name: voice } : {}), ...(rate ? { speaking_rate: rate } : {}) }) });
  const type = (res.headers.get("content-type") || "audio/mpeg").split(";")[0].trim();
  if (!type.startsWith("audio/")) throw new NkenneError("The voice came back in a form we can't play.", res.status, type);
  const bytes = await res.arrayBuffer();
  if (!bytes.byteLength) throw new NkenneError("The voice came back empty.", res.status);
  return { bytes, type };
}

export async function voices(cfg: NkenneConfig): Promise<{ defaultVoice: string; voices: Voice[] }> {
  const r = await json<{ default_voice?: string; voices?: Voice[] }>(await send(cfg, "/api/tts/v1/swahili/voices", { method: "GET" }));
  return { defaultVoice: String(r.default_voice || ""), voices: Array.isArray(r.voices) ? r.voices : [] };
}

function form(audio: Blob, name: string) {
  if (audio.size > AUDIO_MAX_BYTES) throw new NkenneError("That recording is too long to translate. Try a shorter one.", 413);
  const fd = new FormData();
  fd.append("audio_file", audio, name);
  return fd;
}
// What was said, in the language it was said in.
export async function transcribe(cfg: NkenneConfig, audio: Blob, lang: "swahili" | "english", name = "voice-note.wav"): Promise<{ text: string; duration: number | null }> {
  const r = await json<{ text?: unknown; duration?: unknown }>(await send(cfg, `/api/stt/v1/${lang}/with-api-key`, { method: "POST", body: form(audio, name) }));
  if (typeof r.text !== "string") throw new NkenneError("The transcript came back empty.", 200);
  return { text: r.text, duration: typeof r.duration === "number" ? r.duration : null };
}
// What was said, in the other language, in one call.
export async function translateSpeech(cfg: NkenneConfig, audio: Blob, pair: "swahili-to-english" | "english-to-swahili", name = "voice-note.wav"): Promise<string> {
  const r = await json<{ translated_text?: unknown }>(await send(cfg, `/api/st/v1/${pair}/with-api-key`, { method: "POST", body: form(audio, name) }));
  if (typeof r.translated_text !== "string") throw new NkenneError("The translation came back empty.", 200);
  return r.translated_text;
}
