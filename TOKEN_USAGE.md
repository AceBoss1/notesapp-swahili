# Token use and testing

The NKENNEAi API Hackathon gives each team 1,000 tokens. This is how we spent ours.

## How we tested

- **Code paths, without tokens.** `npm test` checks our side of every call against a stand-in for the API that never touches the network: paths, headers, bodies, error handling, the Markdown reading, the grouping and splitting back, the audio parts and the WAV encoder. NotesApp's own server tests do the same against its database (caching, the author's switch, subscriber-only journals, the "two readers at once" lock, voice notes, the usage log).
- **Live, with tokens.** Only for end-to-end checks of each API, with real text and real voice notes, as listed below.

## Live calls

From the usage log (`.cache/usage.json` in the demo), 23 October 2026. Balance before the first live call: 1,050 tokens. Balance after these calls: 333 tokens, so 717 tokens were used.

| Time (WAT) | API | What for | Size | Calls | Result |
|---|---|---|---|---|---|
| 15:35 | Text → text | The sample journal (title and 6 blocks) as one grouped request | 290 characters | 1 | 200, but our client read no text from the answer: it looked for the documented field only. Fixed: it now reads the other names the API uses and logs the answer when there's no text. |
| 15:55 | Text → text | The same journal, grouped | 290 characters | 1 | 200. The translation came back with its paragraph breaks merged, so it couldn't be split back into the 6 blocks. |
| 15:55 | Text → text | Then each block on its own | 49, 75, 34, 91, 14, 17 characters | 6 | 200 each. The journal reads correctly in Kiswahili. |
| 15:56 | Voices | The Swahili voice list | – | 1 | 200. Kept for a week. |
| 15:56 | Text → speech | The whole translation, female voice | 331 characters | 1 | 200, 24 s of audio. Played again from what was kept: no call. |
| 15:59 | Speech translation (Swahili → English) | A 24.7 s Swahili voice note | 24.7 s of audio | 2 | 500 from NKENNEAi ("CUDA out of memory" on their speech server), reported to the organisers. |
| – | Kept answers | The translation and the audio, asked for again | – | 0 | 2 answers served from what was kept, no tokens. |

**What we learned and changed:**
- **Grouping (fixed):** NKENNEAi merges paragraph breaks in a translation, so a journal sent as one request couldn't be split back into its blocks. Each grouped attempt was a wasted call before falling back to one call per block. Journals are now translated block by block from the start.
- **Answer shape:** the client now accepts the field names the API actually returns and keeps the answer in the log when it has no text, so a surprise costs one call, not several.
- **Where the tokens went:** NKENNEAi's Generation History shows text to speech at 166 tokens per request, so speech is most of the cost. Kept audio is reused for every later listener, and audio is made part by part only as far as people listen.
- **Their errors:** a 500 from NKENNEAi isn't retried automatically. Every call costs tokens, so the member chooses to try again.
