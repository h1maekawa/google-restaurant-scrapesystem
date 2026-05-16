// tests/filename.test.ts

import { describe, it, expect } from 'vitest';
import { generateFilename } from '../src/io/filename';
import { parseSearchQuery } from '../src/core/extractor';
import type { SearchContext } from '../src/types';

describe('generateFilename', () => {
  const ctx: SearchContext = {
    prefecture: 'tokyo',
    city: 'shibuya',
    genre: 'cafe',
    rawQuery: '東京都 渋谷 カフェ',
    searchDate: '2026-05-16',
  };

  it('CSV形式', () => {
    expect(generateFilename(ctx, 'csv')).toBe('tokyo_shibuya_cafe_2026-05-16.csv');
  });

  it('JSON形式', () => {
    expect(generateFilename(ctx, 'json')).toBe('tokyo_shibuya_cafe_2026-05-16.json');
  });
});

describe('parseSearchQuery', () => {
  it('都道府県・市・ジャンルを抽出', () => {
    const ctx = parseSearchQuery('東京都 渋谷区 カフェ');
    expect(ctx.prefecture).toBe('tokyo');
    expect(ctx.city).toBe('shibuya');
    expect(ctx.genre).toBe('cafe');
  });

  it('空クエリはデフォルト値', () => {
    const ctx = parseSearchQuery('');
    expect(ctx.prefecture).toBe('unknown');
  });
});
