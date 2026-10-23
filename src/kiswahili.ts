// Kiswahili versions of #NotesApp journals (pure: the server side is lib/kiswahili-server.ts, the API client lib/nkenne.ts).
//
// A journal is Markdown. Only its words go to NKENNEAi: it is read into blocks (headings, paragraphs, list items, quotes),
// with images, code and link addresses left out, so no markup can be mangled by a translation. Each block is sent on its
// own: NKENNEAi merges paragraph breaks in a translation, so blocks sent together can't be lined up again (found in live
// testing, 23 Oct 2026), and a grouped request was a wasted call every time.
// Audio is made in parts of about a minute, each the first time someone listens that far, so a reader who stops early never
// costs the rest. Everything made is kept for every later reader (and made again only when the journal changes).
export type Block = { kind: "h1" | "h2" | "h3" | "p" | "li" | "quote"; text: string };
export const PART_CHARS = 700; // per audio part (about a minute of speech)
export const MAX_SOURCE_CHARS = 20_000; // longer journals are translated up to here, and say so

// Inline Markdown to its words: **bold**, _italic_, `code`, [text](address) → text, ![alt](image) → nothing, <html> → nothing.
export function plainInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function blocksOf(markdown: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let fenced = false;
  const flush = () => { const t = plainInline(para.join(" ")); if (t) out.push({ kind: "p", text: t }); para = []; };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { flush(); fenced = !fenced; continue; }
    if (fenced) continue;
    if (!line) { flush(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    const q = line.match(/^>\s?(.*)$/);
    if (h || li || q || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) flush();
    if (h) { const t = plainInline(h[2]); if (t) out.push({ kind: h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3", text: t }); continue; }
    if (li) { const t = plainInline(li[1]); if (t) out.push({ kind: "li", text: t }); continue; }
    if (q) { const t = plainInline(q[1]); if (t) out.push({ kind: "quote", text: t }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    para.push(line);
  }
  flush();
  return out;
}

// Up to MAX_SOURCE_CHARS of a journal's words (title first), and whether anything was left out.
export function sourceOf(title: string, markdown: string): { title: string; blocks: Block[]; cut: boolean } {
  const all = blocksOf(markdown);
  const blocks: Block[] = [];
  let n = title.length;
  for (const b of all) { if (n + b.text.length > MAX_SOURCE_CHARS) return { title, blocks, cut: true }; blocks.push(b); n += b.text.length; }
  return { title, blocks, cut: false };
}

// Translate every text, one NKENNEAi call each (`translate`), in order.
export async function translateAll(texts: string[], translate: (text: string) => Promise<string>): Promise<{ out: string[]; calls: number }> {
  const out: string[] = [];
  for (const t of texts) out.push((await translate(t)).trim());
  return { out, calls: texts.length };
}

// What is read aloud, in parts: the title, then the blocks, cut at sentence ends where a block is long.
export function audioParts(title: string, blocks: string[], max = PART_CHARS): string[] {
  const sentences = [title, ...blocks].flatMap((t) => t.length <= max ? [t] : t.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [t]);
  const parts: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const piece = s.length > max ? s.slice(0, max) : s;
    if (cur && cur.length + piece.length + 1 > max) { parts.push(cur); cur = ""; }
    cur = cur ? `${cur} ${piece}` : piece;
  }
  if (cur) parts.push(cur);
  return parts;
}
