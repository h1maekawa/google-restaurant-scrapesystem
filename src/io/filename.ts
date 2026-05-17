// src/io/filename.ts
//
// 出力例:
//   "渋谷区 カフェ"  → 渋谷区_カフェ_Googleマップ_20260516.csv
//   "札幌市 居酒屋"  → 札幌市_居酒屋_Googleマップ_20260516.csv
//   "新宿 ラーメン"  → 新宿_ラーメン_Googleマップ_20260516.csv
//   ""（失敗時）     → Googleマップ_20260516_1423.csv

import type { SearchContext } from '../types';

// ── メイン関数 ────────────────────────────────────────────────────────────────

/**
 * SearchContext からファイル名を生成する。
 * SearchContext.rawQuery を使ってエリア・ジャンルを日本語のまま抽出し、
 * "{エリア}_{ジャンル}_Googleマップ_{YYYYMMDD}.{ext}" 形式で返す。
 */
export function generateFilename(
  context: SearchContext,
  format: 'csv' | 'json',
  options?: { radiusM?: number },
): string {
  const dateStr = formatDate(new Date());
  const radiusSuffix = options?.radiusM ? `_r${options.radiusM}m` : '';

  const { area, genre } = parseQueryToAreaGenre(context.rawQuery);

  if (area && genre) {
    return `${sanitize(area)}_${sanitize(genre)}_Googleマップ_${dateStr}${radiusSuffix}.${format}`;
  } else if (area) {
    return `${sanitize(area)}_Googleマップ_${dateStr}${radiusSuffix}.${format}`;
  } else if (genre) {
    return `${sanitize(genre)}_Googleマップ_${dateStr}${radiusSuffix}.${format}`;
  } else {
    // クエリから抽出できなかった場合はフォールバック
    const timeStr = formatTime(new Date());
    return `Googleマップ_${dateStr}_${timeStr}${radiusSuffix}.${format}`;
  }
}

// ── クエリ解析 ────────────────────────────────────────────────────────────────

/**
 * 検索クエリ文字列を解析してエリアとジャンルに分割する。
 * 対応形式:
 *   「渋谷区 カフェ」「札幌市 居酒屋」「新宿 ラーメン」
 *   「エリア × ジャンル」「エリア ✖️ ジャンル」
 */
export function parseQueryToAreaGenre(query: string): { area: string; genre: string } {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return { area: '', genre: '' };

  // ① 記号区切り（✖️ ×）対応
  if (trimmed.includes('✖️') || trimmed.includes('×')) {
    const sep = trimmed.includes('✖️') ? '✖️' : '×';
    const parts = trimmed.split(sep).map(s => s.trim());
    const areaIdx = parts.findIndex(p => isAreaToken(p));
    if (areaIdx !== -1) {
      const area = parts[areaIdx];
      const genre = parts.find((_, i) => i !== areaIdx) ?? '';
      return { area, genre };
    }
    return { area: parts[0] ?? '', genre: parts[1] ?? '' };
  }

  // ② スペース区切り（全角スペース含む）
  const tokens = trimmed.split(/[\s\u3000]+/).filter(Boolean);

  if (tokens.length === 0) return { area: '', genre: '' };

  // トークンが1つのみ → エリアかジャンルかを判定
  if (tokens.length === 1) {
    return isAreaToken(tokens[0])
      ? { area: tokens[0], genre: '' }
      : { area: '', genre: tokens[0] };
  }

  // ③ 複数トークン: 先頭側のエリアトークンを収集し、残りをジャンルとする
  const areaTokens: string[] = [];
  const genreTokens: string[] = [];
  let switchedToGenre = false;

  for (const token of tokens) {
    if (!switchedToGenre && isAreaToken(token)) {
      areaTokens.push(token);
    } else {
      switchedToGenre = true;
      genreTokens.push(token);
    }
  }

  // エリアが1件も見つからなかった: 先頭=エリア、残り=ジャンルとして扱う
  if (areaTokens.length === 0) {
    return {
      area: tokens[0],
      genre: tokens.slice(1).join(''),
    };
  }

  return {
    area: areaTokens.join(''),
    genre: genreTokens.join(''),
  };
}

// ── エリア判定 ────────────────────────────────────────────────────────────────

/**
 * トークンがエリア（地名・行政区画）を表すかどうかを判定する。
 */
function isAreaToken(token: string): boolean {
  // 末尾が行政区分の接尾辞
  if (/[市区町村都府道県]$/.test(token)) return true;

  // 都道府県名（接尾辞なし）
  const prefectures = [
    '北海道', '東京', '大阪', '京都', '神奈川', '愛知', '福岡', '沖縄',
    '埼玉', '千葉', '兵庫', '静岡', '茨城', '広島', '宮城',
  ];
  if (prefectures.includes(token)) return true;

  // 主要都市・地名（駅名・エリア名など）
  const cities = [
    '渋谷', '新宿', '池袋', '銀座', '品川', '秋葉原', '浅草', '上野',
    '吉祥寺', '横浜', '梅田', '難波', '心斎橋', '天王寺', '栄', '名古屋',
    '博多', '天神', '札幌', '仙台', '広島', '京都', '神戸', '川崎',
    '千葉', '船橋', '松山', '金沢', '高松', '那覇', '盛岡', '秋田',
    '山形', '水戸', '宇都宮', '前橋', '甲府', '長野', '岐阜', '津',
    '大津', '奈良', '和歌山', '鳥取', '松江', '岡山', '山口', '徳島',
    '高知', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島',
  ];
  if (cities.includes(token)) return true;

  return false;
}

// ── サニタイズ・フォーマット ──────────────────────────────────────────────────

/**
 * ファイル名に使えない文字を除去・変換する。
 * Windows / Mac / Linux すべてで安全なファイル名にする。
 * 日本語（ひらがな・カタカナ・漢字）はそのまま保持する。
 */
function sanitize(str: string): string {
  return str
    .replace(/[\\/:*?"<>|]/g, '')  // ファイル名禁止文字を除去
    .replace(/\s+/g, '_')           // スペースをアンダースコアに
    .replace(/_+/g, '_')            // 連続アンダースコアを統合
    .replace(/^_|_$/g, '')          // 前後のアンダースコアを除去
    .slice(0, 50);                  // 最大50文字でトリミング
}

function formatDate(d: Date): string {
  return (
    `${d.getFullYear()}` +
    `${(d.getMonth() + 1).toString().padStart(2, '0')}` +
    `${d.getDate().toString().padStart(2, '0')}`
  );
}

function formatTime(d: Date): string {
  return (
    `${d.getHours().toString().padStart(2, '0')}` +
    `${d.getMinutes().toString().padStart(2, '0')}`
  );
}