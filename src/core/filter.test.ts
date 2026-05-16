// tests/filter.test.ts

import { describe, it, expect } from 'vitest';
import { haversineKm, matchesCategory, applyFilters } from '../src/core/filter';
import type { PlaceData } from '../src/types';

// ── haversineKm ───────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('同一座標は0km', () => {
    expect(haversineKm(35.6812, 139.7671, 35.6812, 139.7671)).toBe(0);
  });

  it('渋谷〜新宿は約3.5km', () => {
    const dist = haversineKm(35.6580, 139.7016, 35.6938, 139.7034);
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(4.5);
  });

  it('東京〜大阪は約400km', () => {
    const dist = haversineKm(35.6812, 139.7671, 34.6937, 135.5023);
    expect(dist).toBeGreaterThan(390);
    expect(dist).toBeLessThan(420);
  });
});

// ── matchesCategory ───────────────────────────────────────────────────────────

describe('matchesCategory', () => {
  it('allowedCategories が空なら全許可', () => {
    expect(matchesCategory('カフェ', [])).toBe(true);
    expect(matchesCategory('居酒屋', [])).toBe(true);
  });

  it('完全一致', () => {
    expect(matchesCategory('カフェ', ['カフェ'])).toBe(true);
  });

  it('部分一致（allowedが含まれているか）', () => {
    expect(matchesCategory('コーヒーショップ', ['コーヒー'])).toBe(true);
  });

  it('大文字小文字無視', () => {
    expect(matchesCategory('CAFE', ['cafe'])).toBe(true);
  });

  it('一致しない場合は false', () => {
    expect(matchesCategory('居酒屋', ['カフェ', 'コーヒー'])).toBe(false);
  });
});

// ── applyFilters ──────────────────────────────────────────────────────────────

const basPlace: PlaceData = {
  name: 'テストカフェ',
  category: 'カフェ',
  address: '東京都渋谷区...',
  phone: '03-1234-5678',
  rating: '4.2',
  reviewCount: '100',
  latitude: 35.6580,
  longitude: 139.7016,
  distanceKm: null,
  url: 'https://www.google.com/maps/place/test',
  scrapedAt: '2026-05-16T00:00:00.000Z',
  source: 'googlemaps',
};

describe('applyFilters', () => {
  it('カテゴリ一致・半径なし → 通過', () => {
    const result = applyFilters(basPlace, ['カフェ'], null);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('テストカフェ');
  });

  it('カテゴリ不一致 → null', () => {
    const result = applyFilters(basPlace, ['居酒屋'], null);
    expect(result).toBeNull();
  });

  it('半径内 → distanceKmが付与される', () => {
    const result = applyFilters(basPlace, [], {
      centerLat: 35.6580,
      centerLng: 139.7016,
      radiusKm: 1,
    });
    expect(result).not.toBeNull();
    expect(result?.distanceKm).toBe(0);
  });

  it('半径外 → null', () => {
    const result = applyFilters(basPlace, [], {
      centerLat: 34.6937, // 大阪
      centerLng: 135.5023,
      radiusKm: 1,
    });
    expect(result).toBeNull();
  });

  it('座標なしで半径フィルター → null', () => {
    const noCoords = { ...basPlace, latitude: null, longitude: null };
    const result = applyFilters(noCoords, [], {
      centerLat: 35.6580,
      centerLng: 139.7016,
      radiusKm: 100,
    });
    expect(result).toBeNull();
  });
});
