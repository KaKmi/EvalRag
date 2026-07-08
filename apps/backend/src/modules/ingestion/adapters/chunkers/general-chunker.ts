import { estimateTokens } from "../../pipeline/estimate-tokens";
import type { ChunkDraftPartial, ChunkerPort } from "../../ports/chunker.port";

const MAX_TOKENS = 512;

interface HeadingLine {
  level: number;
  title: string;
  lineIndex: number;
}

/** 通用模板：按 Markdown 标题层级切段 + 段内贪心合并至 ~512 token 上限，无 overlap。 */
export class GeneralChunker implements ChunkerPort {
  chunk(text: string): ChunkDraftPartial[] {
    const lines = text.split("\n");
    const headings = this.findHeadings(lines);
    if (headings.length === 0) {
      return this.chunkFlat(text, "");
    }

    const sections: Array<{ path: string; body: string }> = [];
    const stack: string[] = [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      stack.splice(h.level - 1);
      stack[h.level - 1] = h.title;
      const path = stack.slice(0, h.level).join(" > ");
      const bodyStart = h.lineIndex + 1;
      const bodyEnd = i + 1 < headings.length ? headings[i + 1].lineIndex : lines.length;
      const body = lines.slice(bodyStart, bodyEnd).join("\n").trim();
      if (body) sections.push({ path, body });
    }

    const drafts: ChunkDraftPartial[] = [];
    for (const s of sections) {
      drafts.push(...this.chunkFlat(s.body, s.path, drafts.length));
    }
    return drafts;
  }

  private findHeadings(lines: string[]): HeadingLine[] {
    const out: HeadingLine[] = [];
    lines.forEach((line, idx) => {
      const m = /^(#{1,6})\s+(.+)$/.exec(line);
      if (m) out.push({ level: m[1].length, title: m[2].trim(), lineIndex: idx });
    });
    return out;
  }

  // 贪心合并：按段落（空行分隔）依次累加，超过 MAX_TOKENS 就切出一片
  private chunkFlat(body: string, section: string, seqStart = 0): ChunkDraftPartial[] {
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) return [];

    const drafts: ChunkDraftPartial[] = [];
    let buffer = "";
    for (const p of paragraphs) {
      const candidate = buffer ? `${buffer}\n\n${p}` : p;
      if (buffer && estimateTokens(candidate) > MAX_TOKENS) {
        drafts.push({ seq: seqStart + drafts.length, text: buffer, section });
        buffer = p;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) drafts.push({ seq: seqStart + drafts.length, text: buffer, section });
    return drafts;
  }
}
