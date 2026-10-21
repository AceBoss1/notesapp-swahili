import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { swahiliNote } from "@/lib/kiswahili-server";
import { kiswahiliDeps, kiswahiliFail, limitReader } from "@/lib/kiswahili-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?id= → the Kiswahili version of a journal its author offers in Kiswahili: { title, blocks, cut, madeAt, parts, fromKept }.
export async function GET(req: NextRequest) {
  try {
    const limited = await limitReader(req, "kiswahili-note", 30, 600);
    if (limited) return limited;
    return NextResponse.json(await swahiliNote(getAdminDb(), String(req.nextUrl.searchParams.get("id") ?? ""), kiswahiliDeps), { headers: { "Cache-Control": "no-store" } });
  } catch (err) { return kiswahiliFail(err); }
}
