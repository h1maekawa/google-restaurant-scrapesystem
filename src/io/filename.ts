// src/io/filename.ts

import type { SearchContext } from '../types';

/**
 * 例: tokyo_shibuya_cafe_2026-05-16.csv
 */
export function generateFilename(
  context: SearchContext,
  format: 'csv' | 'json',
): string {
  const parts = [
    sanitize(context.prefecture),
    sanitize(context.city),
    sanitize(context.genre),
    context.searchDate, // YYYY-MM-DD はそのまま使用
  ].filter(Boolean);

  return `${parts.join('_')}.${format}`;
}

function sanitize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\-]/g, '_')  // 記号をアンダースコアに
    .replace(/_+/g, '_')        // 連続アンダースコアを1つに
    .replace(/^_|_$/g, '');     // 前後のアンダースコアを除去
}
