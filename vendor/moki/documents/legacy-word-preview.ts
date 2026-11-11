import WordExtractor from "word-extractor";
import type { WorkbenchOfficePreview } from "./workbench-file-preview.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Read-only text preview of OLE Word files; never execute macros or rewrite the source. */
export async function parseLegacyWordPreview(contents: Uint8Array): Promise<WorkbenchOfficePreview> {
  const document = await new WordExtractor().extract(Buffer.from(contents));
  const sections: Array<[string, string]> = [
    ["", document.getBody()],
    ["页眉", document.getHeaders({ includeFooters: false })],
    ["页脚", document.getFooters()],
    ["文本框", document.getTextboxes()],
    ["脚注", document.getFootnotes()],
    ["尾注", document.getEndnotes()],
    ["批注", document.getAnnotations()],
  ];
  const paragraphs: string[] = [];
  for (const [title, source] of sections) {
    const lines = source.replace(/\u0000/gu, "").replace(/\r\n?/gu, "\n")
      .split("\n").filter((line) => line.trim());
    if (!lines.length) continue;
    if (title) paragraphs.push(`【${title}】`);
    paragraphs.push(...lines);
  }
  return {
    kind: "document",
    paragraphs,
    html: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(""),
  };
}
