// Kiswahili versions of #NotesApp journals (pure: the server side is lib/kiswahili-server.ts, the API client lib/nkenne.ts).
//
// A journal is Markdown. Only its words go to NKENNEAi: it is read into blocks (headings, paragraphs, list items, quotes),
// with images, code and link addresses left out, so no markup can be mangled by a translation. Blocks are sent a few at a
// time, joined by blank lines; if a translation doesn't come back with the same number of paragraphs, that group is sent
// again one block at a time, so every block lines up with its own translation.
// Audio is made in parts of about a minute, each the first time someone listens that far, so a reader who stops early never
// costs the rest. Everything made is kept for every later reader (and made again only when the journal changes).
export type Block = { kind: "h1" | "h2" | "h3" | "p" | "li" | "quote"; text: string };
export const GROUP_CHARS = 1_200; // per translation request
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

// Consecutive blocks, a few at a time: each group is at most GROUP_CHARS (a longer block goes on its own).
export function groupsOf(texts: string[], max = GROUP_CHARS): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [], size = 0;
  texts.forEach((t, i) => {
    if (cur.length && size + t.length + 2 > max) { groups.push(cur); cur = []; size = 0; }
    cur.push(i); size += t.length + 2;
  });
  if (cur.length) groups.push(cur);
  return groups;
}
// A group's translation back into its blocks; null when the paragraph count doesn't match (then each block goes alone).
export function splitBack(translated: string, count: number): string[] | null {
  const parts = translated.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return parts.length === count ? parts : null;
}

// Translate every text with as few requests as the rules above allow. `translate` is one NKENNEAi call.
export async function translateAll(texts: string[], translate: (text: string) => Promise<string>): Promise<{ out: string[]; calls: number }> {
  const out: string[] = new Array(texts.length).fill("");
  let calls = 0;
  for (const g of groupsOf(texts)) {
    if (g.length > 1) {
      calls++;
      const back = splitBack(await translate(g.map((i) => texts[i]).join("\n\n")), g.length);
      if (back) { g.forEach((i, k) => { out[i] = back[k]; }); continue; }
    }
    for (const i of g) { calls++; out[i] = (await translate(texts[i])).trim(); }
  }
  return { out, calls };
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
