# Token use and testing

The NKENNEAi API Hackathon gives each team 1,000 tokens. This is how we spent ours.

## How we tested

- **Code paths, without tokens.** `npm test` checks our side of every call against a stand-in for the API that never touches the network: paths, headers, bodies, error handling, the Markdown reading, the grouping and splitting back, the audio parts and the WAV encoder. NotesApp's own server tests do the same against its database (caching, the author's switch, subscriber-only journals, the "two readers at once" lock, voice notes, the usage log).
- **Live, with tokens.** Only for end-to-end checks of each API, with real text and real voice notes, as listed below.

## Live calls

_Filled in from the usage log during live testing (Admin → Kiswahili (NKENNEAi) in NotesApp, `.cache/usage.json` in the demo)._

| Date | API | What for | Size | Calls | Notes |
|---|---|---|---|---|---|
