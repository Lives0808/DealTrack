import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../core/config.js';
import { ensureDir } from '../core/util.js';

const execFileAsync = promisify(execFile);

/**
 * HTML → PDF.
 *
 * Chrome is used rather than a PDF library because a quotation is a *document*:
 * it needs real typography, CJK, right-to-left Arabic, and print CSS. Chrome
 * gets all of that right today, and every operator already has it or can install
 * it. When Chrome is missing we still emit the HTML — the browser's own
 * "Print to PDF" produces an identical file, so nothing is blocked.
 */

export interface RenderedDocument {
  /** Absolute path to the PDF, when one was produced. */
  pdfPath: string | null;
  /** Absolute path to the HTML source — always produced. */
  htmlPath: string;
  usedChrome: boolean;
  detail: string;
}

export function exportsDir(...parts: string[]): string {
  const dir = path.join(config.exportDir, ...parts);
  ensureDir(dir);
  return dir;
}

export async function renderDocument(input: {
  html: string;
  baseName: string;
  subdir?: string;
}): Promise<RenderedDocument> {
  const dir = exportsDir(input.subdir ?? '');
  const htmlPath = path.join(dir, `${input.baseName}.html`);
  writeFileSync(htmlPath, input.html, 'utf8');

  const pdfPath = path.join(dir, `${input.baseName}.pdf`);
  const chrome = config.docs.chromePath;

  if (!chrome || !existsSync(chrome)) {
    return {
      pdfPath: null,
      htmlPath,
      usedChrome: false,
      detail: '未检测到 Chrome/Chromium（可用 DEALTRACK_CHROME_PATH 指定）。已生成可直接打印的 HTML。',
    };
  }

  try {
    await execFileAsync(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        '--run-all-compositor-stages-before-draw',
        '--virtual-time-budget=4000',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      { timeout: config.docs.renderTimeoutMs, maxBuffer: 8 * 1024 * 1024 },
    );
    if (!existsSync(pdfPath)) {
      return { pdfPath: null, htmlPath, usedChrome: false, detail: 'Chrome 未产出 PDF，已保留 HTML。' };
    }
    return { pdfPath, htmlPath, usedChrome: true, detail: 'PDF 已由 Chrome 渲染。' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pdfPath: null, htmlPath, usedChrome: false, detail: `PDF 渲染失败（${message.slice(0, 200)}），已保留 HTML。` };
  }
}

/** Shared print stylesheet — A4, RTL-safe, CJK-capable. */
export function documentStyles(accent = '#0b5cad'): string {
  return `
  @page { size: A4; margin: 14mm 14mm 18mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
                 "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans Arabic", "Noto Sans", "Helvetica Neue",
                 Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1c1f23;
  }
  h1, h2, h3 { margin: 0; font-weight: 650; }
  .doc { max-width: 190mm; margin: 0 auto; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 12px; border-bottom: 2.5px solid ${accent}; }
  .seller-name { font-size: 15pt; font-weight: 700; color: ${accent}; line-height: 1.25; }
  .seller-meta { font-size: 8.6pt; color: #5a6472; margin-top: 5px; white-space: pre-line; }
  .doc-title { text-align: right; }
  .doc-title .label { font-size: 19pt; font-weight: 700; letter-spacing: 0.06em; color: ${accent}; }
  .doc-title .no { font-size: 11pt; font-weight: 600; margin-top: 4px; }
  .doc-title .date { font-size: 8.8pt; color: #5a6472; }
  .parties { display: flex; gap: 14px; margin-top: 14px; }
  .party { flex: 1; border: 1px solid #dfe4ea; border-radius: 6px; padding: 9px 11px; background: #fafbfc; }
  .party h3 { font-size: 8.2pt; text-transform: uppercase; letter-spacing: 0.09em; color: #7a838f; margin-bottom: 4px; }
  .party .name { font-weight: 650; font-size: 11pt; }
  .party .line { font-size: 9pt; color: #495260; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 15px; }
  table.items thead th { background: ${accent}; color: #fff; font-size: 8.7pt; font-weight: 600; text-align: start; padding: 7px 8px; }
  table.items tbody td { padding: 7px 8px; border-bottom: 1px solid #e6eaef; font-size: 9.6pt; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #f7f9fb; }
  .num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sku { font-size: 8.2pt; color: #7a838f; }
  .totals { margin-top: 12px; width: 100%; display: flex; justify-content: flex-end; }
  .totals table { min-width: 78mm; border-collapse: collapse; }
  .totals td { padding: 4px 8px; font-size: 9.6pt; }
  .totals td.label { color: #5a6472; }
  .totals td.value { text-align: end; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { border-top: 2px solid ${accent}; font-size: 12.5pt; font-weight: 700; color: ${accent}; padding-top: 7px; }
  .terms { margin-top: 16px; border: 1px solid #dfe4ea; border-radius: 6px; padding: 10px 12px; }
  .terms h3 { font-size: 9pt; color: ${accent}; margin-bottom: 6px; }
  .terms dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 9.2pt; }
  .terms dt { color: #6b7480; }
  .terms dd { margin: 0; }
  .notes { margin-top: 12px; font-size: 9pt; color: #495260; }
  .signature { margin-top: 22px; display: flex; justify-content: space-between; align-items: flex-end; }
  .signature .block { font-size: 9.4pt; }
  .signature .stamp { width: 42mm; height: 20mm; border: 1px dashed #c3cad3; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #a9b2bd; font-size: 8pt; }
  .doc-footer { margin-top: 18px; padding-top: 9px; border-top: 1px solid #e6eaef; font-size: 7.8pt; color: #8b949f; text-align: center; }
  .rtl { direction: rtl; text-align: right; }
  /* Mixed Arabic/Latin values (payment terms, notes, port names) must be
     isolated, or the bidi algorithm silently reorders the numbers. */
  bdi { unicode-bidi: isolate; }
  .rtl table.items thead th { text-align: right; }
  .rtl .num { text-align: left; }
  .rtl .doc-title { text-align: left; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 8pt; font-weight: 600; }
  .badge.warn { background: #fff4e5; color: #a75b00; }
  .badge.ok { background: #e8f5ec; color: #1c7a3d; }
  .badge.bad { background: #fdecec; color: #b32424; }
  .checklist { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .checklist th, .checklist td { border: 1px solid #e6eaef; padding: 6px 8px; font-size: 9.3pt; text-align: start; }
  .checklist th { background: #f2f5f8; font-size: 8.7pt; }
  `;
}

export function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function writeFileEnsured(filePath: string, content: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}
