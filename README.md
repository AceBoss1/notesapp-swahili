# NotesApp in Kiswahili

**Publish once, reach East Africa.** Journals and voice notes in Kiswahili for [#NotesApp](https://www.notesapp.name.ng), built on the [NKENNEAi API](https://nkenne.ai/nkenneai-api) for the NKENNEAi API Hackathon (October 2026).

## The problem

#NotesApp is one home for African creators, professionals and businesses: they publish journals, take bookings, sell, teach and talk to their clients in chat. Almost everything they write is in English. That leaves out the tens of millions of people in East Africa who read, listen and speak most comfortably in Kiswahili: a therapist in Lagos can't easily reach a client in Nairobi, and a client who sends a voice note in Kiswahili can't easily be understood.

**Who it's for**

- **Creators and professionals** who publish journals and want readers beyond English.
- **Readers and listeners** who prefer Kiswahili, or would rather listen than read.
- **Clients and their providers** who talk by voice note in two different languages.

## What we built

Three features, inside the real #NotesApp product.

1. **🌍 Kiswahili: read a journal in Kiswahili.** When an author ticks *Offer this journal in Kiswahili*, every reader gets a Kiswahili button under the journal. One tap shows the journal translated, with *Show original* to switch back.
2. **🔊 Sikiliza: listen in Kiswahili.** The translated journal is read aloud in a female or male voice, at 0.75×, 1× or 1.25×. The player keeps going while the reader scrolls.
3. **Voice notes in Kiswahili.**
   - Under someone's Swahili voice note in a chat: *Transcript* and *Translate to English*.
   - Under your own English voice note: *In Kiswahili*.
   - The words stay on the message, so both people see them.

Admin → *Kiswahili (NKENNEAi)* shows every call we make to NKENNEAi: its size, its result, and how many readers were answered from what we had already made.

## How we use the NKENNEAi API

All four APIs, Kiswahili only, as the hackathon allows. The client is [`src/nkenne.ts`](src/nkenne.ts); the key is sent as the `Authorization` header and never reaches the browser.

| API | Endpoint | Where we use it |
|---|---|---|
| Text → text | `POST /api/translate/with-api-key` (English → Swahili) | A journal's title and words |
| Text → speech | `POST /api/tts/v1/swahili/with-api-key` | Sikiliza, one part at a time |
| Voices | `GET /api/tts/v1/swahili/voices` | The female and male voice ids (asked once, then kept) |
| Speech → text | `POST /api/stt/v1/swahili/with-api-key` | A Swahili voice note's transcript |
| Speech translation | `POST /api/st/v1/swahili-to-english/with-api-key` and `english-to-swahili` | A voice note in the other language, in one call |

### What happens to a journal

1. **Words only.** The journal is Markdown. [`src/kiswahili.ts`](src/kiswahili.ts) reads it into blocks (headings, paragraphs, list items, quotes) and leaves out images, code and link addresses, so a translation can never break the page's markup.
2. **One request per block.** Each heading, paragraph and list item is translated on its own. We first sent a few blocks per request and split the answer back on blank lines, but live testing showed NKENNEAi merges paragraph breaks, so every grouped request was a wasted call. One block per request lines up every time.
3. **Audio in parts.** The translation is cut into parts of about a minute (around 700 characters, at sentence ends). Each part is made only when the listener reaches it, with the next one fetched just before, so a reader who stops after a minute never costs the rest.
4. **Made once, kept for everyone.** The translation is kept under a hash of the journal's words, and each audio part per voice is kept in our media storage. The second reader, and every reader after, costs no tokens. When the author edits the journal, the hash changes and a fresh version is made the next time someone asks.
5. **No double charge.** If two readers open a new journal at the same moment, only the first one translates; the other is asked to wait a few seconds.
6. **Only what may be shared.** Subscriber-only (premium) journals are never sent: those words stay with their subscribers.

### What happens to a voice note

1. **The right format.** Browsers record voice notes as WebM or MP4. Before sending, the browser decodes the note it already plays and re-encodes it as 16 kHz mono 16-bit WAV, the format NKENNEAi recommends ([`src/wav.ts`](src/wav.ts)).
2. **Checked first.** The server checks the WAV header and its length (up to 2 minutes) before spending any token.
3. **Kept on the message.** The transcript or translation is kept on the message, so the other person sees it without a second call.

### Errors

Every NKENNEAi answer is handled:

| Answer | What happens |
|---|---|
| 401/403 | The service refused our key; Kiswahili is shown as unavailable |
| 400/404 | That couldn't be translated |
| 413 | The recording is too long |
| 429 | Busy; try again shortly |
| Timeout or no answer | Try again in a moment |
| Empty or unreadable reply | Treated as a failure |

Members see a plain message; NKENNEAi's own words are kept in the usage log. Nothing retries on its own, because every call costs tokens.

## Token use

We were given 1,000 tokens. The design spends them only when someone asks, and only once:

- Nothing is translated or read aloud until a reader taps.
- Authors choose which journals are offered; the switch is off by default.
- Each block is translated once, on its own, so nothing is sent twice.
- Audio is made part by part, as far as people actually listen.
- Speed changes happen in the player, so they cost nothing.
- Everything made is kept and reused.
- Our tests use a stand-in for the API, so testing costs no tokens. Live calls are kept for the end-to-end checks.

Every live call is logged: in NotesApp on Admin → Kiswahili (NKENNEAi), and in the demo in `.cache/usage.json`. [`TOKEN_USAGE.md`](TOKEN_USAGE.md) records our testing and what it cost.

## Try it: the demo

A small local server and page that use the same code as NotesApp. It needs Node 20 or later and an NKENNEAi API key.

```bash
git clone https://github.com/AceBoss1/notesapp-swahili
cd notesapp-swahili
npm install
cp .env.example .env        # then put your NKENNEAi key in .env
npm run demo                # http://localhost:3500
```

1. **Read a journal in Kiswahili:** edit the sample journal (Markdown) if you like, and press **🌍 Kiswahili**. Press it again: the answer comes from what was kept, with no tokens.
2. **Sikiliza:** press **▶ Female voice** or **▶ Male voice** to hear the translation, part by part; change the speed while it plays.
3. **Voice notes:** record or choose a short voice note. Press **Kiswahili transcript** or **Swahili → English** for a Swahili note, or **English → Kiswahili** for an English one.
4. **Token use:** the table at the bottom lists every call the demo made, and how many answers came from what was kept.

Run the tests (no key, no network, no tokens: the API is a stand-in):

```bash
npm test
npm run typecheck
```

## In NotesApp

The feature ships inside #NotesApp, a Next.js and Firebase platform whose codebase is private. The files that integrate NKENNEAi there are copied into [`notesapp-integration/`](notesapp-integration/), with a table of what each does. In NotesApp the key is a server setting (`NKENNE_API_KEY`); without it the Kiswahili buttons don't show.

## Disclosure

- **Built before the hackathon** (not part of this submission): the #NotesApp platform itself, including journals, chat, voice notes, storage and admin.
- **Built for this hackathon:** everything in this repository, and the Kiswahili features inside NotesApp.
- **External services:**
  - the NKENNEAi API for translation, speech and voices;
  - Cloudflare R2 for audio storage and Firebase for data, inside NotesApp only.
- **Tooling:** no third-party libraries at runtime; TypeScript and `tsx` to run the code.
- **Our own text:** the Swahili wording in our design mockups and in the test stand-in is sample text we wrote to check the layout and the code paths. It is never shown as NKENNEAi output. Live results come only from the NKENNEAi API.

## Known limitations

- **Kiswahili only**, as the hackathon allows; the code is ready for other languages when NKENNEAi offers them.
- **Long journals:** journals over 20,000 characters are translated up to that point, and the page says so.
- **Formatting:** the Kiswahili view shows a journal's words (headings, paragraphs, lists, quotes). Images, embedded video and code stay in the English view.
- **Voice notes:** up to 2 minutes each, and only translated when someone taps.
- **Academy lessons** don't have the Kiswahili switch yet; journals and chat come first.
- **Machine translation:** it can be imperfect, so we show who translated it and a link to the original.

## Licence

MIT © 2026 NOTESAPP TECHNOLOGIES LTD (RC 9825642). #NotesApp and the na logo are trademarks of NOTESAPP TECHNOLOGIES LTD.
