// src/io/dedup.ts

import fs from 'fs/promises';
import path from 'path';
import type { PlaceData } from '../types';

/**
 * URLをキーに重複を除去する（後勝ち）
 */
export function deduplicatePlaces(places: PlaceData[]): PlaceData[] {
  const map = new Map<string, PlaceData>();
  for (const place of places) {
    map.set(place.url, place);
  }
  return Array.from(map.values());
}

/**
 * 出力ディレクトリ内の既存JSONファイルからURLセットを読み込む。
 * 追加取得時に重複スキップするために使用。
 */
export async function loadExistingUrls(outputDir: string): Promise<Set<string>> {
  const urls = new Set<string>();

  try {
    const files = await fs.readdir(outputDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(outputDir, file), 'utf-8');
        const data = JSON.parse(content) as PlaceData[];
        if (Array.isArray(data)) {
          data.forEach((item) => {
            if (item.url) urls.add(item.url);
          });
        }
      } catch {
        // 破損ファイルはスキップ
      }
    }
  } catch {
    // ディレクトリが存在しない場合はスキップ
  }

  return urls;
}
