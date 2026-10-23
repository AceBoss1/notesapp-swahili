// Kiswahili journals (lib/kiswahili.ts), the NKENNEAi client (lib/nkenne.ts) and the WAV encoder (lib/wav.ts). The API is a
// stand-in `fetch` here (no network, no tokens): these test our side of each call. Run: npm run test:kiswahili → "ALL OK".
import assert from "node:assert/strict";
import { audioParts, blocksOf, groupsOf, plainInline, sourceOf, splitBack, translateAll, MAX_SOURCE_CHARS } from "../src/kiswahili";
import { NkenneError, speak, transcribe, translateSpeech, translateText, voices } from "../src/nkenne";
import { encodeWav, resample, wavSeconds } from "../src/wav";

(async () => {
  // Markdown → words only: links keep their text, images and code go, headings/lists/quotes keep their kind
  assert.equal(plainInline("Read **this** and [the guide](https://x.ng/a) ![pic](a.png) `npm i`"), "Read this and the guide npm i");
  const md = "# Five questions\n\nShort, honest answers\nfrom three therapists.\n\n- Ask about fees\n- Ask about *time*\n\n> Be kind to yourself\n\n```\ncode here\n```\n\n![x](y.png)\n\n---\n\n## The first session";
  assert.deepEqual(blocksOf(md), [
    { kind: "h1", text: "Five questions" }, { kind: "p", text: "Short, honest answers from three therapists." },
    { kind: "li", text: "Ask about fees" }, { kind: "li", text: "Ask about time" }, { kind: "quote", text: "Be kind to yourself" }, { kind: "h2", text: "The first session" },
  ]);
  const long = sourceOf("T", Array.from({ length: 50 }, () => "word ".repeat(100)).join("\n\n"));
  assert.equal(long.cut, true); assert.ok(long.blocks.reduce((n, b) => n + b.text.length, 0) <= MAX_SOURCE_CHARS);

  // grouping and lining translations back up
  assert.deepEqual(groupsOf(["a".repeat(500), "b".repeat(500), "c".repeat(500)], 1200), [[0, 1], [2]]);
  assert.deepEqual(groupsOf(["x".repeat(2000), "y"], 1200), [[0], [1]], "a long block goes alone");
  assert.deepEqual(splitBack("Moja\n\nMbili", 2), ["Moja", "Mbili"]); assert.equal(splitBack("Moja Mbili", 2), null);
  let asked: string[] = [];
  const tidy = await translateAll(["One", "Two", "Three"], async (t) => { asked.push(t); return t.split("\n\n").map((s) => `sw:${s}`).join("\n\n"); });
  assert.deepEqual(tidy, { out: ["sw:One", "sw:Two", "sw:Three"], calls: 1 }, "three short blocks, one call");
  asked = [];
  const messy = await translateAll(["One", "Two"], async (t) => { asked.push(t); return t.includes("\n\n") ? "sw:One sw:Two" : `sw:${t}`; });
  assert.deepEqual(messy, { out: ["sw:One", "sw:Two"], calls: 3 }, "paragraphs merged: each block again, alone");

  // audio parts: title first, never over the limit, long blocks cut at sentence ends
  const parts = audioParts("Kichwa", ["Sentensi ya kwanza. Sentensi ya pili.", "x".repeat(900)], 300);
  assert.equal(parts[0].startsWith("Kichwa"), true); assert.ok(parts.every((p) => p.length <= 300));

  // the client: the documented paths, headers and bodies; NKENNEAi's errors become messages a member can read
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (status: number, body: BodyInit, type = "application/json") => (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return new Response(body, { status, headers: { "content-type": type } }); }) as typeof fetch;
  const cfg = (f: typeof fetch) => ({ key: "test-key", fetch: f });
  assert.equal(await translateText(cfg(fake(200, JSON.stringify({ translatedText: "Habari" }))), "Hello", "English", "Swahili"), "Habari");
  assert.equal(calls[0].url, "https://developers-api.nkenne.ai/api/translate/with-api-key");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "test-key");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { text: "Hello", fromLanguage: "English", toLanguage: "Swahili" });
  await assert.rejects(translateText(cfg(fake(401, JSON.stringify({ error: "Unauthorized" }))), "Hi", "English", "Swahili"), (e: unknown) => e instanceof NkenneError && e.status === 401 && /refused our key/.test(e.message));
  await assert.rejects(translateText(cfg(fake(200, "<html>")), "Hi", "English", "Swahili"), /couldn't read/);
  // other answer shapes are read; an answer with no text is a failure (502) that keeps what came back
  for (const body of [{ translated_text: "Habari" }, { data: { translatedText: "Habari" } }, { result: "Habari" }, { translation: "Habari" }])
    assert.equal(await translateText(cfg(fake(200, JSON.stringify(body))), "Hello", "English", "Swahili"), "Habari", JSON.stringify(body));
  await assert.rejects(translateText(cfg(fake(200, JSON.stringify({ status: "ok", tokens: 3 }))), "Hi", "English", "Swahili"), (e: unknown) => e instanceof NkenneError && e.status === 502 && /came back empty/.test(e.message) && /tokens/.test(e.detail));
  await assert.rejects(translateText(cfg(fake(200, "{}")), "Hi", "English", "English"), /two different/);
  const sp = await speak(cfg(fake(200, new Uint8Array([1, 2, 3]), "audio/mpeg")), "Habari", "swahili_female_1");
  assert.equal(sp.type, "audio/mpeg"); assert.equal(sp.bytes.byteLength, 3);
  assert.match(calls.at(-1)!.url, /\/api\/tts\/v1\/swahili\/with-api-key$/);
  await assert.rejects(speak(cfg(fake(200, "{}")), "Habari"), /can't play/);
  const vs = await voices(cfg(fake(200, JSON.stringify({ default_voice: "swahili_female_1", voices: [{ id: "swahili_male_1", name: "M", gender: "Male" }] }))));
  assert.equal(vs.defaultVoice, "swahili_female_1"); assert.equal(vs.voices[0].id, "swahili_male_1");
  const wav = new Blob([encodeWav(new Float32Array(16000))], { type: "audio/wav" });
  assert.deepEqual(await transcribe(cfg(fake(200, JSON.stringify({ text: "Habari", duration: 1 }))), wav, "swahili"), { text: "Habari", duration: 1 });
  assert.match(calls.at(-1)!.url, /\/api\/stt\/v1\/swahili\/with-api-key$/); assert.ok(calls.at(-1)!.init.body instanceof FormData);
  assert.equal(await translateSpeech(cfg(fake(200, JSON.stringify({ translated_text: "Hello" }))), wav, "swahili-to-english"), "Hello");
  assert.match(calls.at(-1)!.url, /\/api\/st\/v1\/swahili-to-english\/with-api-key$/);
  await assert.rejects(transcribe(cfg(fake(413, "{}")), wav, "swahili"), /too long/);
  await assert.rejects(transcribe(cfg((async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch), wav, "swahili"), (e: unknown) => e instanceof NkenneError && e.status === 0);

  // WAV: 16 kHz mono 16-bit, and its length read back; anything else is refused before a token is spent
  const w = encodeWav(resample(new Float32Array(48000 * 2), 48000));
  assert.equal(wavSeconds(w), 2); assert.equal(wavSeconds(new ArrayBuffer(10)), null); assert.equal(wavSeconds(new TextEncoder().encode("x".repeat(60)).buffer), null);

  console.log("ALL OK");
})().catch((e) => { console.error(e); process.exit(1); });
