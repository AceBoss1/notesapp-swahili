# The integration inside NotesApp

These files are copied from the NotesApp platform (a private codebase) so judges can see exactly how the NKENNEAi API is
used in the live product. They import NotesApp's own modules (Firebase, storage, rate limits, sign-in), so they don't run
on their own here; the runnable pieces are in `src/` and `demo/`.

| File | In NotesApp | What it does |
|---|---|---|
| `lib/kiswahili-server.ts` | `lib/kiswahili-server.ts` | Translates a journal once and keeps it (re-made only when the journal changes); makes audio one part at a time as a reader listens; translates voice notes and keeps the words on the message; logs every NKENNEAi call |
| `lib/kiswahili-api.ts` | `lib/kiswahili-api.ts` | Shared route helpers: audio storage, rate limits, error replies |
| `app-api/note.route.ts` | `app/api/kiswahili/note/route.ts` | `GET ?id=`: a journal in Kiswahili |
| `app-api/audio.route.ts` | `app/api/kiswahili/audio/route.ts` | `POST { id, voice, part }`: one part of the audio |
| `app-api/voice.route.ts` | `app/api/kiswahili/voice/route.ts` | `POST` form-data: a voice note as a transcript, in English or in Kiswahili |
| `app-api/admin-nkenne.route.ts` | `app/api/admin/nkenne/route.ts` | Usage totals and the latest calls, for the admin page |
| `components/KiswahiliJournal.tsx` | `components/KiswahiliJournal.tsx` | English / 🌍 Kiswahili / 🔊 Sikiliza on a journal, the Kiswahili view, the player |
| `components/VoiceNoteKiswahili.tsx` | `components/messages/VoiceNoteKiswahili.tsx` | Transcript / Translate to English / In Kiswahili under a voice note |
| `admin/page.tsx` | `app/(main)/admin/nkenne/page.tsx` | Admin → Kiswahili (NKENNEAi): every call, its size and result |
