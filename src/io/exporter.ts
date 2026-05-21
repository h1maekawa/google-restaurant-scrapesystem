// src/io/exporter.ts

import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';
import type { PlaceData, ExportResult } from '../types';

// ── CSVカラム定義（idはプログラム内部キー、titleが出力される日本語ヘッダー） ───────────────────
const CSV_HEADERS = [
  { id: 'name', title: '店名' },
  { id: 'category', title: 'ジャンル' },
  { id: 'address', title: '住所' },
  { id: 'phone', title: '電話番号' },
  { id: 'regularHoliday', title: '定休日' },
  { id: 'openingHoursDetails', title: '営業時間' },
  { id: 'url', title: 'URL' },
  { id: 'source', title: '媒体' },
];
// ── CSV出力 ───────────────────────────────────────────────────────────────────

export async function exportCsv(
  data: PlaceData[],
  filepath: string,
): Promise<ExportResult> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });

  const writer = createObjectCsvWriter({
    path: filepath,
    header: CSV_HEADERS,
    // BOM付きUTF-8でExcelでも文字化けしないようにする
    encoding: 'utf8',
  });

  // BOMを先頭に付与
  await fs.writeFile(filepath, '\uFEFF', 'utf8');

  // appendモードで書き込み（BOMの後ろから）
  const writerAppend = createObjectCsvWriter({
    path: filepath,
    header: CSV_HEADERS,
    append: true,
  });

  await writerAppend.writeRecords(data);

  return { filepath, count: data.length, format: 'csv' };
}

// ── JSON出力 ──────────────────────────────────────────────────────────────────

export async function exportJson(
  data: PlaceData[],
  filepath: string,
): Promise<ExportResult> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  return { filepath, count: data.length, format: 'json' };
}
