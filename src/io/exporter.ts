// src/io/exporter.ts

import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';
import type { PlaceData, ExportResult } from '../types';

// ── CSVカラム定義（追加・変更はここだけ）────────────────────────────────────
const CSV_HEADERS = [
  { id: 'name',                title: 'name'                  },
  { id: 'category',            title: 'category'              },
  { id: 'address',             title: 'address'               },
  { id: 'phone',               title: 'phone'                 },
  { id: 'businessHours',       title: 'business_hours'        },
  { id: 'regularHoliday',      title: 'regular_holiday'       },
  { id: 'openingHoursDetails', title: 'opening_hours_details' },
  { id: 'rating',              title: 'rating'                },
  { id: 'reviewCount',         title: 'review_count'          },
  { id: 'latitude',            title: 'latitude'              },
  { id: 'longitude',           title: 'longitude'             },
  { id: 'distanceKm',          title: 'distance_km'           },
  { id: 'url',                 title: 'url'                   },
  { id: 'scrapedAt',           title: 'scraped_at'            },
  { id: 'source',              title: 'source'                },
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
