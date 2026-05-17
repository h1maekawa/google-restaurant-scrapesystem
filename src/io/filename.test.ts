// tests/filename.test.ts

import { describe, it, expect } from 'vitest';
import { generateFilename, parseQueryToAreaGenre } from './filename';
import type { SearchContext } from '../types';

// ── parseQueryToAreaGenre ─────────────────────────────────────────────────────

describe('parseQueryToAreaGenre', () => {
  it('「エリア ジャンル」形式', () => {
    expect(parseQueryToAreaGenre('渋谷区 カフェ')).toEqual({ area: '渋谷区', genre: 'カフェ' });
    expect(parseQueryToAreaGenre('札幌市 居酒屋')).toEqual({ area: '札幌市', genre: '居酒屋' });
    expect(parseQueryToAreaGenre('新宿 ラーメン')).toEqual({ area: '新宿', genre: 'ラーメン' });
  });

  it('都道府県名のみのエリア', () => {
    const result = parseQueryToAreaGenre('東京都 カフェ');
    expect(result.area).toBe('東京都');
    expect(result.genre).toBe('カフェ');
  });

  it('記号区切り（×）形式', () => {
    const result = parseQueryToAreaGenre('渋谷区 × カフェ');
    expect(result.area).toBe('渋谷区');
    expect(result.genre).toBe('カフェ');
  });

  it('記号区切り（✖️）形式', () => {
    const result = parseQueryToAreaGenre('新宿区 ✖️ 居酒屋');
    expect(result.area).toBe('新宿区');
    expect(result.genre).toBe('居酒屋');
  });

  it('トークンが1つ: エリア', () => {
    expect(parseQueryToAreaGenre('渋谷区')).toEqual({ area: '渋谷区', genre: '' });
  });

  it('トークンが1つ: ジャンル', () => {
    expect(parseQueryToAreaGenre('カフェ')).toEqual({ area: '', genre: 'カフェ' });
  });

  it('空クエリ', () => {
    expect(parseQueryToAreaGenre('')).toEqual({ area: '', genre: '' });
  });
});

// ── generateFilename ──────────────────────────────────────────────────────────

describe('generateFilename', () => {
  const makeCtx = (rawQuery: string): SearchContext => ({
    prefecture: 'tokyo',
    city: 'shibuya',
    genre: 'cafe',
    rawQuery,
    searchDate: '2026-05-16',
  });

  it('エリア＋ジャンル → 正しいフォーマット', () => {
    const name = generateFilename(makeCtx('渋谷区 カフェ'), 'csv');
    expect(name).toMatch(/^渋谷区_カフェ_Googleマップ_\d{8}\.csv$/);
  });

  it('「Googleマップ」が必ず含まれる', () => {
    const name = generateFilename(makeCtx('新宿 ラーメン'), 'csv');
    expect(name).toContain('Googleマップ');
  });

  it('JSON形式', () => {
    const name = generateFilename(makeCtx('渋谷区 カフェ'), 'json');
    expect(name).toMatch(/\.json$/);
  });

  it('半径サフィックスが付く', () => {
    const name = generateFilename(makeCtx('渋谷区 カフェ'), 'csv', { radiusM: 500 });
    expect(name).toContain('_r500m');
  });

  it('クエリが空のときフォールバック', () => {
    const name = generateFilename(makeCtx(''), 'csv');
    expect(name).toMatch(/^Googleマップ_\d{8}_\d{4}\.csv$/);
  });

  it('ファイル名禁止文字が除去される', () => {
    const name = generateFilename(makeCtx('渋谷区/新宿 カフェ:ラテ'), 'csv');
    expect(name).not.toContain('/');
    expect(name).not.toContain(':');
  });
});