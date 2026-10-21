import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { swahiliAudioPart, type VoiceChoice } from "@/lib/kiswahili-server";
import { kiswahiliDeps, kiswahiliFail, limitReader } from "@/lib/kiswahili-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { id, voice: "female" | "male", part } → { url, part, parts }: one part of a journal's Kiswahili audio.
export async function POST(req: NextRequest) {
  try {
    const limited = await limitReader(req, "kiswahili-audio", 60, 600);
    if (limited) return limited;
    const b = (await req.json().catch(() => ({}))) as { id?: unknown; voice?: unknown; part?: unknown };
    return NextResponse.json(await swahiliAudioPart(getAdminDb(), String(b.id ?? ""), b.voice as VoiceChoice, Number(b.part), kiswahiliDeps));
  } catch (err) { return kiswahiliFail(err); }
}
