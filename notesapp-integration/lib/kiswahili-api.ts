import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { verifySignedInRequest } from "@/lib/firebase-admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getR2Client, R2_BUCKET, r2PublicUrl } from "@/lib/r2";
import { KiswahiliError, type Deps } from "@/lib/kiswahili-server";

// Shared by the /api/kiswahili routes. Server-only.
export const kiswahiliDeps: Deps = {
  // Kiswahili audio is public like the journal it reads, and never changes at its address (a new version gets a new one).
  putAudio: async (key, bytes, type) => {
    await getR2Client().send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: new Uint8Array(bytes), ContentType: type, CacheControl: "public, max-age=31536000, immutable" }));
    return r2PublicUrl(key);
  },
};
export const optionalUser = (req: NextRequest) => verifySignedInRequest(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")).catch(() => null);
// Signed-in readers are limited by account, everyone else by address; what was kept costs nothing, but the first reader
// of a journal spends tokens.
export const limitReader = async (req: NextRequest, bucket: string, max: number, windowSec: number) => {
  const user = await optionalUser(req);
  return rateLimit(req, bucket, user?.uid ?? `ip:${clientIp(req)}`, max, windowSec);
};
export function kiswahiliFail(err: unknown) {
  if (err instanceof KiswahiliError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[kiswahili]", err);
  return NextResponse.json({ error: "Kiswahili didn't work just now. Try again in a moment." }, { status: 500 });
}
