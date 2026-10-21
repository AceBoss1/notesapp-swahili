// A small demo of the NotesApp Kiswahili features, for judges and anyone trying the integration: the same code NotesApp
// uses (src/), behind a tiny local server so the API key never reaches the browser.
//   npm run demo   →   http://localhost:3500
// Everything NKENNEAi makes is kept in .cache/ (by a hash of what was asked), so asking again costs no tokens, and every
// call is written to .cache/usage.json, which the page shows.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NkenneError, speak, transcribe, translateSpeech, translateText, voices, type NkenneConfig } from "../src/nkenne";
import { audioParts, sourceOf, translateAll } from "../src/kiswahili";
import { wavSeconds } from "../src/wav";

const ROOT = join(__dirname, "..");
// .env, if there is one (KEY=value lines); real environment variables win.
if (existsSync(join(ROOT, ".env"))) for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.NKENNE_API_KEY || "";
const cfg = (): NkenneConfig => { if (!KEY) throw new NkenneError("Set NKENNE_API_KEY in .env first (see .env.example).", 401); return { key: KEY, base: process.env.NKENNE_API_URL || undefined }; };
const CACHE = join(ROOT, ".cache"); mkdirSync(join(CACHE, "audio"), { recursive: true });
const hash = (...p: (string | Buffer)[]) => { const h = createHash("sha256"); for (const x of p) h.update(x); return h.digest("hex").slice(0, 20); };
const readJson = <T>(f: string, d: T): T => { try { return JSON.parse(readFileSync(join(CACHE, f), "utf8")) as T; } catch { return d; } };
const writeJson = (f: string, v: unknown) => writeFileSync(join(CACHE, f), JSON.stringify(v, null, 2));

type Usage = { at: string; api: string; size: string; ok: boolean; status: number; ms: number; detail?: string };
const usage = () => readJson<{ calls: Usage[]; kept: number }>("usage.json", { calls: [], kept: 0 });
async function logged<T>(api: string, size: string, run: () => Promise<T>): Promise<T> {
  const u = usage(), start = Date.now();
  try { const out = await run(); u.calls.push({ at: new Date().toISOString(), api, size, ok: true, status: 200, ms: Date.now() - start }); writeJson("usage.json", u); return out; }
  catch (e) { u.calls.push({ at: new Date().toISOString(), api, size, ok: false, status: e instanceof NkenneError ? e.status : 0, ms: Date.now() - start, detail: e instanceof NkenneError ? e.detail : String(e) }); writeJson("usage.json", u); throw e; }
}
const kept = () => { const u = usage(); u.kept++; writeJson("usage.json", u); };

const body = (req: IncomingMessage) => new Promise<Buffer>((ok, bad) => { const b: Buffer[] = []; req.on("data", (c) => b.push(c)); req.on("end", () => ok(Buffer.concat(b))); req.on("error", bad); });
const send = (res: ServerResponse, status: number, data: unknown, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(type === "application/json" ? JSON.stringify(data) : (data as Buffer)); };

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, readFileSync(join(__dirname, "index.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/usage") return send(res, 200, usage());
    if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
      const f = join(CACHE, "audio", url.pathname.slice(7).replace(/[^\w.-]/g, ""));
      return existsSync(f) ? send(res, 200, readFileSync(f), f.endsWith(".wav") ? "audio/wav" : "audio/mpeg") : send(res, 404, { error: "Not found" });
    }
    // English Markdown → Kiswahili blocks, and the audio parts it would be read in
    if (req.method === "POST" && url.pathname === "/api/translate") {
      const { title = "", markdown = "" } = JSON.parse(String(await body(req)) || "{}");
      const src = sourceOf(String(title), String(markdown));
      const key = hash("t", src.title, ...src.blocks.map((b) => `${b.kind}:${b.text}`));
      const all = readJson<Record<string, unknown>>("translations.json", {});
      if (all[key]) { kept(); return send(res, 200, { ...(all[key] as object), fromKept: true }); }
      const texts = [src.title, ...src.blocks.map((b) => b.text)].filter((t, i) => i > 0 || t);
      const c = cfg();
      const { out, calls } = await translateAll(texts, (t) => logged("text → text", `${t.length} chars`, () => translateText(c, t, "English", "Swahili")));
      const hasTitle = !!src.title;
      const result = { title: hasTitle ? out[0] : "", blocks: src.blocks.map((b, i) => ({ kind: b.kind, text: out[i + (hasTitle ? 1 : 0)] })), cut: src.cut, calls };
      const parts = audioParts(result.title, result.blocks.map((b) => b.text)).filter(Boolean);
      all[key] = { ...result, parts }; writeJson("translations.json", all);
      return send(res, 200, { ...result, parts, fromKept: false });
    }
    // Swahili text → audio (one part), kept by text + voice
    if (req.method === "POST" && url.pathname === "/api/speak") {
      const { text = "", voice = "female" } = JSON.parse(String(await body(req)) || "{}");
      if (!String(text).trim()) return send(res, 400, { error: "Nothing to read." });
      const vs = readJson<{ female?: string; male?: string }>("voices.json", {});
      if (!vs.female) {
        const r = await logged("voices", "swahili", () => voices(cfg()));
        vs.female = r.voices.find((v) => v.gender?.toLowerCase() === "female")?.id || "swahili_female_1";
        vs.male = r.voices.find((v) => v.gender?.toLowerCase() === "male")?.id || "swahili_male_1";
        writeJson("voices.json", vs);
      }
      const id = voice === "male" ? vs.male! : vs.female!;
      const key = hash("s", id, String(text));
      for (const ext of ["mp3", "wav"]) if (existsSync(join(CACHE, "audio", `${key}.${ext}`))) { kept(); return send(res, 200, { url: `/audio/${key}.${ext}`, fromKept: true }); }
      const a = await logged("text → speech", `${String(text).length} chars`, () => speak(cfg(), String(text), id));
      const ext = a.type === "audio/wav" ? "wav" : "mp3";
      writeFileSync(join(CACHE, "audio", `${key}.${ext}`), Buffer.from(a.bytes));
      return send(res, 200, { url: `/audio/${key}.${ext}`, fromKept: false });
    }
    // A voice note (16 kHz mono WAV from the page) → transcript, English or Kiswahili
    if (req.method === "POST" && url.pathname === "/api/voice") {
      const mode = url.searchParams.get("mode");
      if (mode !== "transcript" && mode !== "to-english" && mode !== "to-swahili") return send(res, 400, { error: "Choose transcript, to-english or to-swahili." });
      const wav = await body(req);
      const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
      const secs = wavSeconds(ab);
      if (secs === null) return send(res, 400, { error: "Send 16 kHz mono 16-bit WAV (the page makes it for you)." });
      if (secs > 120) return send(res, 413, { error: "Up to 2 minutes, please." });
      const key = hash("v", mode, wav);
      const all = readJson<Record<string, string>>("voice.json", {});
      if (all[key]) { kept(); return send(res, 200, { text: all[key], fromKept: true }); }
      const blob = new Blob([ab], { type: "audio/wav" });
      const size = `${secs.toFixed(1)} s of audio`;
      const text = mode === "transcript"
        ? (await logged("speech → text (swahili)", size, () => transcribe(cfg(), blob, "swahili"))).text
        : await logged(mode === "to-english" ? "speech translation (swahili → english)" : "speech translation (english → swahili)", size, () => translateSpeech(cfg(), blob, mode === "to-english" ? "swahili-to-english" : "english-to-swahili"));
      all[key] = text; writeJson("voice.json", all);
      return send(res, 200, { text, fromKept: false });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, e instanceof NkenneError && e.status ? (e.status >= 500 ? 502 : e.status) : 500, { error: e instanceof Error ? e.message : "Something went wrong." });
  }
}).listen(Number(process.env.PORT || 3500), () => console.log(`NotesApp Kiswahili demo on http://localhost:${process.env.PORT || 3500}${KEY ? "" : " (set NKENNE_API_KEY in .env to make real calls)"}`));
