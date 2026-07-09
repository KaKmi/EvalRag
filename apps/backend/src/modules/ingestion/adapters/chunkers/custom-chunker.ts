import type { ChunkDraftPartial, ChunkerMeta, ChunkerPort } from "../../ports/chunker.port";

// 结构感知切分参数（用户提供的课程导出规则，原样移植）。
const MAX_SECTION = 1200; // 超过此长度触发二次切分
const TARGET = 800; // 二次切分的目标块大小
const MIN_CHUNK = 200; // 低于此长度的块尽量与相邻块合并
const OVERLAP_CAP = 120; // overlap 上限（字）

// 公众号导出文本里指向 mp.weixin.qq.com 的纯导航链接行（如「1. [第一节：xxx](https://mp.weixin.qq.com/...)」）。
const NAV_LINK_RE =
  /^\s*(?:\d+\.|[-*])?\s*\[[^\]]*\]\(https?:\/\/mp\.weixin\.qq\.com[^)]*\)[；;，,。\s]*$/;
const IMAGE_LINE_RE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;
const IMAGE_INLINE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const ORPHAN_RECAP_RE = /^\s*(前情回顾|往期回顾|历史文章)[:：]?\s*$/gm;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

interface FilenameMeta {
  isCourse: boolean;
  lessonNo: number | null;
  topic: string;
}

interface SectionDraft {
  section: string;
  subtitle: string | null;
  part: number | null;
  rawText: string;
}

interface SplitPiece {
  text: string;
  subtitle: string | null;
}

/**
 * 定制模板（用户提供的课程导出内容清洗+切分规则，原样移植；表格保护/子标题溯源/短块合并为后续修订）：
 * - 清洗：删顶部推广引用块、公众号导航链接行、图片、孤立的「前情回顾」标签
 * - 切分：按 ## 一级标题分段，超长再按 ### 二次切，仍超长按段落聚合（表格按行、其余按句子），
 *   全文范围内合并过短块（含开头「引言」向后合并），每片拼「《知识库名》第N课·主题 > 小节标题 [> 子标题]」上下文头
 * 知识库名称即课程名——来自参数 meta.kbName，不写死。
 */
export class CustomChunker implements ChunkerPort {
  chunk(text: string, meta: ChunkerMeta): ChunkDraftPartial[] {
    const cleaned = this.cleanCourseExport(text);
    const fileMeta = this.parseFilename(meta.filename);
    const sections = this.splitSections(cleaned);

    let drafts: SectionDraft[] = [];
    for (const sec of sections) {
      const pieces: SplitPiece[] =
        sec.text.length <= MAX_SECTION
          ? [{ text: sec.text, subtitle: null }]
          : this.splitLong(sec.text);

      // part 编号按子标题分组：同一子标题只有一片时不编号，避免无意义的「（1）」。
      const subtitleTotals = new Map<string | null, number>();
      pieces.forEach((p) => subtitleTotals.set(p.subtitle, (subtitleTotals.get(p.subtitle) ?? 0) + 1));
      const subtitleSeen = new Map<string | null, number>();

      for (const piece of pieces) {
        const total = subtitleTotals.get(piece.subtitle) ?? 1;
        let part: number | null = null;
        if (total > 1) {
          const seen = (subtitleSeen.get(piece.subtitle) ?? 0) + 1;
          subtitleSeen.set(piece.subtitle, seen);
          part = seen;
        }
        drafts.push({ section: sec.title, subtitle: piece.subtitle, part, rawText: piece.text.trim() });
      }
    }

    drafts = this.mergeThinDrafts(drafts);

    return drafts.map((d, seq) => {
      const header = this.buildHeader(meta.kbName, fileMeta, d.section, d.subtitle, d.part);
      return { seq, text: `${header}\n\n${d.rawText}`, section: header };
    });
  }

  // ---- 清洗（规则 1-5，原样移植） ----
  private cleanCourseExport(raw: string): string {
    let lines = raw.split(/\r?\n/);

    // 规则 1：删除文件顶部的引用块（连续 > 开头行 + 空行）——顶部只可能是推广语。
    let start = 0;
    while (
      start < lines.length &&
      (lines[start].trim() === "" || lines[start].trimStart().startsWith(">"))
    ) {
      start++;
    }
    lines = lines.slice(start);

    const kept: string[] = [];
    for (const line of lines) {
      if (NAV_LINK_RE.test(line)) continue; // 规则 2：纯导航链接行
      if (IMAGE_LINE_RE.test(line)) continue; // 规则 4：图片整行
      kept.push(line.replace(IMAGE_INLINE_RE, "")); // 行内图片替换为空
    }

    let text = kept.join("\n");
    text = text.replace(ORPHAN_RECAP_RE, ""); // 规则 3：孤立的「前情回顾」标签
    text = text.replace(/\n{3,}/g, "\n\n").trim(); // 规则 5：压缩空行
    return text;
  }

  // 课程-11人才九宫格_2025-05-27.txt → { lessonNo:11, topic:"人才九宫格" }；兼容 .md.txt 双后缀。
  private parseFilename(filename: string): FilenameMeta {
    const base = filename.replace(/\.(md\.txt|txt|md)$/i, "");
    const m = /^课程-(\d+)(.+?)_(\d{4}-\d{2}-\d{2})$/.exec(base);
    if (m) {
      return { isCourse: true, lessonNo: parseInt(m[1], 10), topic: m[2].trim() };
    }
    return { isCourse: false, lessonNo: null, topic: base };
  }

  private buildHeader(
    kbName: string,
    fileMeta: FilenameMeta,
    sectionTitle: string,
    subtitle: string | null,
    partNo: number | null,
  ): string {
    const doc = fileMeta.isCourse
      ? `《${kbName}》第${fileMeta.lessonNo}课·${fileMeta.topic}`
      : fileMeta.topic;
    const section = subtitle ? `${sectionTitle} > ${subtitle}` : sectionTitle;
    const part = partNo ? `（${partNo}）` : "";
    return `${doc} > ${section}${part}`;
  }

  // ---- 切分（结构原样移植，细节见下方各方法注释） ----
  private splitSections(text: string): Array<{ title: string; text: string }> {
    const lines = text.split("\n");
    const sections: Array<{ title: string; text: string }> = [];
    let title = "引言";
    let buf: string[] = [];

    const flush = (): void => {
      const body = buf.join("\n").trim();
      if (body) sections.push({ title, text: body });
      buf = [];
    };

    for (const line of lines) {
      const m = /^##\s+(.+)$/.exec(line); // 只匹配 ##，### 留给二次切分
      if (m && !line.startsWith("###")) {
        flush();
        title = m[1].trim();
      } else {
        buf.push(line);
      }
    }
    flush();
    return sections;
  }

  private splitLong(text: string): SplitPiece[] {
    // 先按 ### 子标题切（子标题行保留在所属块开头），并记录每个单元归属的子标题——
    // 后续二次切分产生的多个 chunk 才能在 section 里带上真实子标题，而不是退化成「标题（N）」。
    const units: SplitPiece[] = [];
    let buf: string[] = [];
    let subtitle: string | null = null;

    const flushUnit = (): void => {
      const body = buf.join("\n").trim();
      if (body) units.push({ text: body, subtitle });
      buf = [];
    };

    for (const line of text.split("\n")) {
      const m = /^###\s+(.+)$/.exec(line);
      if (m) {
        if (buf.join("\n").trim()) flushUnit();
        subtitle = m[1].trim();
      }
      buf.push(line);
    }
    flushUnit();

    const pieces: SplitPiece[] = [];
    for (const unit of units) {
      if (unit.text.length <= MAX_SECTION) {
        pieces.push(unit);
      } else {
        pieces.push(...this.packParagraphs(unit.text).map((t) => ({ text: t, subtitle: unit.subtitle })));
      }
    }
    return this.mergeSmall(pieces);
  }

  // 相邻小块合并，直到不小于 MIN_CHUNK（且合并结果不超过 MAX_SECTION）；子标题取内容更长的一侧。
  private mergeSmall(pieces: SplitPiece[]): SplitPiece[] {
    const out: SplitPiece[] = [];
    for (const p of pieces) {
      const prev = out[out.length - 1];
      if (
        prev !== undefined &&
        (p.text.length < MIN_CHUNK || prev.text.length < MIN_CHUNK) &&
        prev.text.length + p.text.length <= MAX_SECTION
      ) {
        out[out.length - 1] = {
          text: `${prev.text}\n\n${p.text}`,
          subtitle: prev.text.length >= p.text.length ? prev.subtitle : p.subtitle,
        };
      } else {
        out.push(p);
      }
    }
    return out;
  }

  // 全文范围内合并过短的整块（典型如孤立的「引言/结语」过渡段、图片说明残留）。
  // 与 mergeSmall 的区别：mergeSmall 只在单个 ## 大节的二次切分内部生效；这里跨 ## 大节生效，
  // 因为「引言」这类过渡段本身通常不超 MAX_SECTION，根本不会进入二次切分路径。
  private mergeThinDrafts(drafts: SectionDraft[]): SectionDraft[] {
    const out: SectionDraft[] = [];
    for (const d of drafts) {
      const prev = out[out.length - 1];
      if (
        prev !== undefined &&
        d.rawText.length < MIN_CHUNK &&
        prev.rawText.length + d.rawText.length <= MAX_SECTION
      ) {
        prev.rawText += `\n\n## ${d.section}\n${d.rawText}`;
        continue;
      }
      out.push({ ...d });
    }
    // 文档开头的过短小节（典型如「引言」）没有「上一块」可并，改为并入紧随其后的块。
    while (
      out.length > 1 &&
      out[0].rawText.length < MIN_CHUNK &&
      out[0].rawText.length + out[1].rawText.length <= MAX_SECTION
    ) {
      out[1].rawText = `## ${out[0].section}\n${out[0].rawText}\n\n${out[1].rawText}`;
      out.shift();
    }
    return out;
  }

  private packParagraphs(text: string): string[] {
    // 段落定义：空行分隔；单段超长时，表格按行切、其余按句子硬切（表格没有句末标点，
    // 用句子正则切会把表格行从单元格中间打断）。
    const paras = text
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .flatMap((p) => {
        if (p.length <= MAX_SECTION) return [p];
        return this.isTableBlock(p) ? this.splitTableRows(p) : this.splitBySentence(p);
      });

    const pieces: string[] = [];
    let buf: string[] = [];
    let size = 0;

    for (const p of paras) {
      if (size + p.length > TARGET && buf.length > 0) {
        pieces.push(buf.join("\n\n"));
        // overlap：带上上一块的最后一段（截断）；但表格行不做字符级截断重叠，
        // 否则会在单元格中间截断产生乱码式的残缺行。
        const last = buf[buf.length - 1];
        if (this.endsWithTableRow(last)) {
          buf = [];
          size = 0;
        } else {
          const overlap = last.length > OVERLAP_CAP ? last.slice(-OVERLAP_CAP) : last;
          buf = [`……${overlap}`];
          size = overlap.length;
        }
      }
      buf.push(p);
      size += p.length;
    }
    if (buf.length) pieces.push(buf.join("\n\n"));
    return pieces;
  }

  // 段落多数行是表格行（`|...|`）时判定为表格块，避免逐句硬切打断行。
  private isTableBlock(text: string): boolean {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return false;
    const rowCount = lines.filter((l) => TABLE_ROW_RE.test(l)).length;
    return rowCount >= 2 && rowCount / lines.length >= 0.5;
  }

  private endsWithTableRow(text: string): boolean {
    const lastLine = text.trim().split("\n").pop() ?? "";
    return TABLE_ROW_RE.test(lastLine);
  }

  // 按表格行切分，表头+分隔行（如 |---|---|）在每一片都重复带上，保证单独一片也能看懂列含义。
  // 表格前常有一行引导语（如「这里简单举个例子：」），表头不一定是第一行，需要扫描定位。
  private splitTableRows(text: string): string[] {
    const lines = text.split("\n");
    const headerIdx = lines.findIndex(
      (l, i) => TABLE_ROW_RE.test(l) && TABLE_SEP_RE.test(lines[i + 1] ?? ""),
    );
    if (headerIdx < 0) return [text]; // 找不到规范表头+分隔行，放弃行级切分，保持整体不做字符硬切

    const preamble = lines.slice(0, headerIdx);
    const headRows = lines.slice(headerIdx, headerIdx + 2);
    const bodyRows = lines.slice(headerIdx + 2);
    const headText = headRows.join("\n");

    const pieces: string[] = [];
    let buf = [...preamble, ...headRows];
    let bodyInBuf = 0;
    let size = buf.join("\n").length;
    for (const row of bodyRows) {
      if (bodyInBuf > 0 && size + row.length > TARGET) {
        pieces.push(buf.join("\n"));
        buf = [...headRows, row];
        bodyInBuf = 1;
        size = headText.length + row.length;
      } else {
        buf.push(row);
        bodyInBuf++;
        size += row.length;
      }
    }
    pieces.push(buf.join("\n"));
    return pieces;
  }

  // 按中文句末标点切句后聚合到 TARGET。
  private splitBySentence(text: string): string[] {
    const sentences = text.split(/(?<=[。！？；\n])/);
    const out: string[] = [];
    let buf = "";
    for (const s of sentences) {
      if (buf.length + s.length > TARGET && buf) {
        out.push(buf);
        buf = "";
      }
      buf += s;
    }
    if (buf.trim()) out.push(buf);
    return out;
  }
}
