import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";
import { kiswahiliReady, voiceNoteText } from "@/lib/kiswahili-server";
import { kiswahiliFail, optionalUser } from "@/lib/kiswahili-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET → { ready }: whether to offer Kiswahili on voice notes (no key details).
export async function GET() {
  return NextResponse.json({ ready: kiswahiliReady() }, { headers: { "Cache-Control": "public, max-age=300" } });
}

// POST form-data { cid, mid, i, mode: transcript | to-english | to-swahili, audio (16 kHz mono WAV, only when not kept yet) }
// → { text }: a voice note in words, for the people in that conversation.
export async function POST(req: NextRequest) {
  try {
    const me = await optionalUser(req);
    if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const limited = await rateLimit(req, "kiswahili-voice", me.uid, 20, 600);
    if (limited) return limited;
    const f = await req.formData();
    const audio = f.get("audio");
    const wav = audio instanceof Blob && audio.size ? (audio.size > 6 * 1024 * 1024 ? null : await audio.arrayBuffer()) : null;
    return NextResponse.json(await voiceNoteText(getAdminDb(), me.uid, { cid: String(f.get("cid") ?? ""), mid: String(f.get("mid") ?? ""), i: Number(f.get("i")), mode: f.get("mode"), wav }, {}));
  } catch (err) { return kiswahiliFail(err); }
}
