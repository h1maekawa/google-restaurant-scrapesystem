// src/core/filter.ts

import type { PlaceData, RadiusFilter } from '../types';

// ── Haversine距離計算（km）────────────────────────────────────────────────────

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── カテゴリフィルター ────────────────────────────────────────────────────────

/**
 * 部分一致・大文字小文字無視で判定。
 * allowedCategories が空配列の場合は全件許可。
 */
export function matchesCategory(
  placeCategory: string,
  allowedCategories: string[],
): boolean {
  if (allowedCategories.length === 0) return true;

  const normalized = placeCategory.trim().toLowerCase();
  return allowedCategories.some((allowed) =>
    normalized.includes(allowed.trim().toLowerCase()),
  );
}

// ── 半径フィルター ────────────────────────────────────────────────────────────

/**
 * 半径内であれば distanceKm を付与して返す。
 * 範囲外 or 座標なしは null を返す。
 */
export function applyRadiusFilter(
  place: PlaceData,
  filter: RadiusFilter,
): PlaceData | null {
  if (place.latitude === null || place.longitude === null) {
    // 座標が取得できなかった店舗は除外
    return null;
  }

  const distKm = haversineKm(
    filter.centerLat, filter.centerLng,
    place.latitude,   place.longitude,
  );

  if (distKm > filter.radiusKm) return null;

  return {
    ...place,
    distanceKm: Math.round(distKm * 1000) / 1000, // 小数3桁
  };
}

// ── 統合フィルター ────────────────────────────────────────────────────────────

/**
 * カテゴリ → 半径 の順で適用。
 * いずれかで除外された場合は null を返す。
 */
export function applyFilters(
  place: PlaceData,
  allowedCategories: string[],
  radiusFilter: RadiusFilter | null,
): PlaceData | null {
  if (!matchesCategory(place.category, allowedCategories)) {
    return null;
  }

  if (radiusFilter) {
    return applyRadiusFilter(place, radiusFilter);
  }

  return place;
}
