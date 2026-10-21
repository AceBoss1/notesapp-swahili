import { NextRequest, NextResponse } from "next/server";
import { friendlyMessage } from "@/lib/api-errors";
import { getAdminDb, verifyAdminRequest } from "@/lib/firebase-admin";
import { nkenneUsage } from "@/lib/kiswahili-server";

export const dynamic = "force-dynamic";
const bearer = (req: NextRequest) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

// Admin: GET → NKENNEAi usage: totals (calls, failures, characters, audio seconds, reads served from what was kept) and the
// latest 50 calls. Never shows the key.
export async function GET(req: NextRequest) {
  try {
    await verifyAdminRequest(bearer(req), ["product"]);
    return NextResponse.json(await nkenneUsage(getAdminDb()), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const f = friendlyMessage(err, "Couldn't read the NKENNEAi usage");
    return NextResponse.json({ error: f.message }, { status: f.status });
  }
}
