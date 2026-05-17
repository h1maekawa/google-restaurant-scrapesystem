// src/io/filename.ts

import type { SearchContext } from '../types';

/**
 * 例: tokyo_shibuya_cafe_2026-05-16.csv
 */
export function generateFilename(
  context: SearchContext,
  format: 'csv' | 'json',
): string {
  const query = context.rawQuery ? context.rawQuery.trim() : '';
  if (query) {
    const suffix = query.includes('Googleマップ') ? '' : '　Googleマップ';
    return `${sanitizeFilename(query)}${suffix}.${format}`;
  }
  return `googlemaps_list_${context.searchDate}.${format}`;
}

function sanitizeFilename(name: string): string {
  // OSでファイル名として使用できない文字 (\ / : * ? " < > |) をアンダースコアに置換
  return name.replace(/[\\/:*?"<>|]/g, '_');
}
