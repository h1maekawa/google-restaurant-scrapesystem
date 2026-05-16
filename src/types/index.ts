// src/types/index.ts

// ── スクレイピング設定 ─────────────────────────────────────────────────────────
export interface ScrapeConfig {
  maxItems: number;
  allowedCategories: string[];  // 空配列 = 全カテゴリ許可
  radiusFilter: RadiusFilter | null;
  outputFormat: 'csv' | 'json' | 'both';
  outputDir: string;
}

export interface RadiusFilter {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

// ── 店舗データ ─────────────────────────────────────────────────────────────────
export interface PlaceData {
  name: string;
  category: string;         // Google Maps 内部カテゴリ
  address: string;
  phone: string;
  rating: string;
  reviewCount: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null; // 中心点からの距離
  url: string;
  scrapedAt: string;         // ISO8601
  source: 'googlemaps';
}

// ── 検索コンテキスト（ファイル名生成用）──────────────────────────────────────
export interface SearchContext {
  prefecture: string;   // 例: tokyo
  city: string;         // 例: shibuya
  genre: string;        // 例: cafe
  rawQuery: string;
  searchDate: string;   // 例: 2026-05-16
}

// ── セレクター定義 ────────────────────────────────────────────────────────────
export interface SelectorSet {
  key: string;
  primary: string;
  fallbacks: string[];
}

// ── 出力結果 ──────────────────────────────────────────────────────────────────
export interface ExportResult {
  filepath: string;
  count: number;
  format: 'csv' | 'json';
}

// ── 抽出生データ（page.evaluate内で使用）────────────────────────────────────
export interface RawExtracted {
  name: string;
  category: string;
  address: string;
  phone: string;
  rating: string;
  reviewCount: string;
}
