// src/selectors/maps.selectors.ts
//
// Google Maps DOM変更対策の核心ファイル。
// セレクターはすべてここで管理し、変更時はこのファイルのみ修正する。
// primary が壊れた場合、fallbacks を順に試す。

import type { SelectorSet } from '../types';

export const SELECTORS = {

  // 検索ボックス
  searchBox: {
    key: 'searchBox',
    primary: '#searchboxinput',
    fallbacks: [
      'input[aria-label*="検索"]',
      'input[aria-label*="Search"]',
      'input[name="q"]',
    ],
  },

  // 結果リストのスクロールコンテナ
  resultFeed: {
    key: 'resultFeed',
    primary: 'div[role="feed"]',
    fallbacks: [
      'div[aria-label*="検索結果"]',
      'div[aria-label*="Results"]',
    ],
  },

  // 個別店舗リンク（google.com / google.co.jp 両対応）
  placeLink: {
    key: 'placeLink',
    primary: 'a[href^="https://www.google.com/maps/place/"]',
    fallbacks: [
      'a[href^="https://www.google.co.jp/maps/place/"]',
    ],
  },

  // カテゴリ（優先順位高い順）
  category: {
    key: 'category',
    primary: '.DkEaL',
    fallbacks: [
      'button[jsaction*="category"]',
      '[data-attrid*="category"]',
      'span.YhemCb',
      'button[aria-label*="カテゴリ"]',
    ],
  },

  // 住所
  address: {
    key: 'address',
    primary: 'button[data-item-id="address"]',
    fallbacks: [
      '[data-tooltip="住所をコピー"]',
      '[aria-label^="住所:"]',
      'button[aria-label*="番地"]',
    ],
  },

  // 電話番号
  phone: {
    key: 'phone',
    primary: 'button[data-item-id^="phone:tel:"]',
    fallbacks: [
      '[data-tooltip="電話番号をコピー"]',
      '[aria-label^="電話番号:"]',
      'button[aria-label*="tel:"]',
    ],
  },

  // 営業時間
  businessHours: {
    key: 'businessHours',
    primary: 'button[data-item-id="oh"]',
    fallbacks: [
      '[aria-label*="営業時間"]',
      '[data-tooltip*="営業時間"]',
    ],
  },

  // 評価（星）
  rating: {
    key: 'rating',
    primary: '[aria-label*="星 "]',
    fallbacks: [
      '[aria-label*=" stars"]',
      'span.MW4etd',
    ],
  },

  // 店舗名（詳細パネル）
  placeName: {
    key: 'placeName',
    primary: 'h1.DUwDvf',
    fallbacks: [
      'h1[class*="fontHeadlineLarge"]',
      'h1[class*="header"]',
      '[data-attrid="title"]',
    ],
  },

  // 「リストの終端」テキスト（スクロール終了判定）
  endOfList: {
    key: 'endOfList',
    primary: '[class*="HlvSq"]',
    fallbacks: [],
  },

} as const satisfies Record<string, SelectorSet>;

// ── ユーティリティ ────────────────────────────────────────────────────────────

/**
 * primary → fallbacks の順に試し、最初にヒットした要素を返す
 */
export function queryWithFallback(
  root: Document | Element,
  selector: SelectorSet
): Element | null {
  for (const sel of [selector.primary, ...selector.fallbacks]) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // 無効なセレクターは無視
    }
  }
  return null;
}

/**
 * primary → fallbacks の順に試し、最初にヒットした全要素を返す
 */
export function queryAllWithFallback(
  root: Document | Element,
  selector: SelectorSet
): Element[] {
  for (const sel of [selector.primary, ...selector.fallbacks]) {
    try {
      const els = Array.from(root.querySelectorAll(sel));
      if (els.length > 0) return els;
    } catch {
      // 無効なセレクターは無視
    }
  }
  return [];
}

/**
 * page.evaluate に渡せるシリアライズ可能な形式に変換
 */
export function serializeSelector(s: SelectorSet): { primary: string; fallbacks: string[] } {
  return { primary: s.primary, fallbacks: [...s.fallbacks] };
}
