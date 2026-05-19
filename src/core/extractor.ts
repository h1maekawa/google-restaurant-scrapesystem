// src/core/extractor.ts

import type { Page } from 'playwright';
import { SELECTORS, serializeSelector } from '../selectors/maps.selectors';
import type { PlaceData, RawExtracted, SearchContext } from '../types';

// ── 検索コンテキスト抽出 ──────────────────────────────────────────────────────

export async function extractSearchContext(page: Page): Promise<SearchContext> {
  const query = await page
    .$eval(SELECTORS.searchBox.primary, (el) => (el as HTMLInputElement).value)
    .catch(() => '');

  return parseSearchQuery(query);
}

export function parseSearchQuery(rawQuery: string): SearchContext {
  const normalized = rawQuery.trim();
  const date = new Date().toISOString().slice(0, 10);
  const parts = normalized.split(/\s+/);

  // 都道府県マッピング
  const prefectureMap: Record<string, string> = {
    '北海道': 'hokkaido',  '青森県': 'aomori',    '岩手県': 'iwate',
    '宮城県': 'miyagi',    '秋田県': 'akita',      '山形県': 'yamagata',
    '福島県': 'fukushima', '茨城県': 'ibaraki',    '栃木県': 'tochigi',
    '群馬県': 'gunma',     '埼玉県': 'saitama',    '千葉県': 'chiba',
    '東京都': 'tokyo',     '神奈川県': 'kanagawa', '新潟県': 'niigata',
    '富山県': 'toyama',    '石川県': 'ishikawa',   '福井県': 'fukui',
    '山梨県': 'yamanashi', '長野県': 'nagano',     '岐阜県': 'gifu',
    '静岡県': 'shizuoka',  '愛知県': 'aichi',      '三重県': 'mie',
    '滋賀県': 'shiga',     '京都府': 'kyoto',      '大阪府': 'osaka',
    '兵庫県': 'hyogo',     '奈良県': 'nara',       '和歌山県': 'wakayama',
    '鳥取県': 'tottori',   '島根県': 'shimane',    '岡山県': 'okayama',
    '広島県': 'hiroshima', '山口県': 'yamaguchi',  '徳島県': 'tokushima',
    '香川県': 'kagawa',    '愛媛県': 'ehime',      '高知県': 'kochi',
    '福岡県': 'fukuoka',   '佐賀県': 'saga',       '長崎県': 'nagasaki',
    '熊本県': 'kumamoto',  '大分県': 'oita',       '宮崎県': 'miyazaki',
    '鹿児島県': 'kagoshima', '沖縄県': 'okinawa',
  };

  // 主要地名・ジャンルのローマ字変換辞書
  const romajiDict: Record<string, string> = {
    // 地名
    '渋谷': 'shibuya',    '新宿': 'shinjuku',   '池袋': 'ikebukuro',
    '銀座': 'ginza',      '品川': 'shinagawa',  '秋葉原': 'akihabara',
    '浅草': 'asakusa',    '上野': 'ueno',       '吉祥寺': 'kichijoji',
    '横浜': 'yokohama',   '梅田': 'umeda',      '難波': 'namba',
    '心斎橋': 'shinsaibashi', '天王寺': 'tennoji',
    // ジャンル
    'カフェ': 'cafe',         'コーヒー': 'coffee',     '喫茶店': 'cafe',
    '居酒屋': 'izakaya',      'ラーメン': 'ramen',      '寿司': 'sushi',
    '焼肉': 'yakiniku',       '美容院': 'beauty_salon', 'ヘアサロン': 'hair_salon',
    'レストラン': 'restaurant', 'ホテル': 'hotel',       'ジム': 'gym',
    '歯科': 'dental',         '薬局': 'pharmacy',       '塾': 'cram_school',
  };

  let prefecture = '';
  let city = '';
  let genre = '';

  // 都道府県を検出
  for (const [jp, en] of Object.entries(prefectureMap)) {
    if (normalized.includes(jp)) {
      prefecture = en;
      break;
    }
  }

  // 市区町村を検出（市・区・町・村で終わる語句）
  const cityMatch = normalized.match(/(\S+[市区町村])/);
  if (cityMatch) {
    const cityJp = cityMatch[1].replace(/[市区町村]$/, '');
    city = romajiDict[cityJp] ?? toRomajiSimple(cityJp);
  }

  // ジャンルは末尾トークン
  const lastPart = parts[parts.length - 1];
  genre = romajiDict[lastPart] ?? toRomajiSimple(lastPart);

  return {
    prefecture: prefecture || toRomajiSimple(parts[0] || 'unknown'),
    city:       city       || toRomajiSimple(parts[1] || 'unknown'),
    genre:      genre      || 'unknown',
    rawQuery:   normalized,
    searchDate: date,
  };
}

function toRomajiSimple(text: string): string {
  // 日本語文字が含まれる場合はアルファベット変換できないのでhex短縮で対応
  if (/[\u3000-\u9FFF]/.test(text)) {
    return `place_${Buffer.from(text, 'utf8').toString('hex').slice(0, 8)}`;
  }
  return text.toLowerCase().replace(/[^\w]/g, '_').replace(/_+/g, '_').replace(/^_|_$/, '');
}

// ── URL座標抽出 ────────────────────────────────────────────────────────────────

export function extractCoordsFromUrl(url: string): { lat: number; lng: number } | null {
  // パターン1: !3d{lat}!4d{lng}（店舗詳細URL）
  const matchD = url.match(/!3d([-+]?\d+\.\d+)!4d([-+]?\d+\.\d+)/);
  if (matchD) return { lat: parseFloat(matchD[1]), lng: parseFloat(matchD[2]) };

  // パターン2: @{lat},{lng}（マップビューURL）
  const matchAt = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (matchAt) return { lat: parseFloat(matchAt[1]), lng: parseFloat(matchAt[2]) };

  return null;
}

// ── 店舗詳細パネルから情報抽出 ───────────────────────────────────────────────

export async function extractPlaceDetail(
  page: Page,
  url: string
): Promise<Omit<PlaceData, 'distanceKm'>> {
  // セレクターをシリアライズしてevaluateに渡す
  const sels = {
    category:      serializeSelector(SELECTORS.category),
    address:       serializeSelector(SELECTORS.address),
    phone:         serializeSelector(SELECTORS.phone),
    businessHours: serializeSelector(SELECTORS.businessHours),
    rating:        serializeSelector(SELECTORS.rating),
    placeName:     serializeSelector(SELECTORS.placeName),
  };

  const raw: RawExtracted = await page.evaluate(async (selectors) => {
    function query(primary: string, fallbacks: string[]): Element | null {
      for (const sel of [primary, ...fallbacks]) {
        try {
          const el = document.querySelector(sel);
          if (el) return el;
        } catch { /* 無効なセレクターは無視 */ }
      }
      return null;
    }

    // 店舗名
    const nameEl = query(selectors.placeName.primary, selectors.placeName.fallbacks);
    const name = nameEl?.textContent?.trim() ?? '';

    // カテゴリ
    const categoryEl = query(selectors.category.primary, selectors.category.fallbacks);
    const category = categoryEl?.textContent?.trim() ?? '';

    // 住所
    const addressEl = query(selectors.address.primary, selectors.address.fallbacks);
    const addressLabel = addressEl?.getAttribute('aria-label') ?? '';
    const address = addressLabel.replace(/^住所:\s*/, '').trim()
      || addressEl?.textContent?.trim()
      || '';

    // 電話番号
    const phoneEl = query(selectors.phone.primary, selectors.phone.fallbacks);
    const phoneLabel = phoneEl?.getAttribute('aria-label') ?? '';
    const phoneText = phoneLabel.replace(/^電話番号:\s*/, '').trim()
      || (phoneEl?.textContent?.trim() ?? '');
    const phoneMatch = phoneText.match(/[\d\-+() ]{10,}/);
    const phone = phoneMatch ? phoneMatch[0].trim() : '';

    // 営業時間
    // 優先的に aria-label="1 週間の営業時間を表示" または "1 週間の営業時間を非表示" などのトグル要素を探します
    let ohEl = document.querySelector(
      '[aria-label="1 週間の営業時間を表示"], [aria-label*="営業時間を表示"], [aria-label*="営業時間を非表示"], button[data-item-id="oh"]'
    ) || query(selectors.businessHours.primary, selectors.businessHours.fallbacks);

    const ohLabel = ohEl?.getAttribute('aria-label') ?? '';
    let businessHours = '';
    if (ohLabel) {
      businessHours = ohLabel
        .replace(/^営業時間:\s*/, '')
        .replace(/^Hours:\s*/, '')
        .replace(/[。.]\s*営業時間情報を編集.*$/, '')
        .replace(/[。.]\s*Edit business hours.*$/, '')
        .trim();
    }
    if (!businessHours && ohEl) {
      businessHours = ohEl.textContent?.trim() ?? '';
    }

    // 定休日と詳細営業時間の抽出
    let regularHoliday = '年中無休';
    let openingHoursDetails = '';

    if (ohEl) {
      // 曜日ごとの時間テーブルを展開するためにボタンをクリックする
      const label = ohEl.getAttribute('aria-label') || '';
      const isAlreadyExpanded = label.includes('非表示') || label.includes('Hide') || label.includes('営業時間を非表示');
      if (!isAlreadyExpanded) {
        try {
          (ohEl as HTMLElement).click();
        } catch (e) {}
        try {
          ohEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } catch (e) {}
        
        // 500msスリープして展開アニメーションを確実に待つ
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const daysJp = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
      const daysEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const daysShort = ['月', '火', '水', '木', '金', '土', '日'];

      const schedule: Record<string, string> = {};
      
      // 全ての tr, li, div 要素を走査して最適な（最も短い）行情報を取得
      const candidates = document.querySelectorAll('tr, li, div');
      for (const el of candidates) {
        if (el.children.length > 5) continue; // 親すぎる大きなコンテナをスキップ
        
        const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
        if (!text || text.length > 80) continue; // 長すぎるテキストはコンテナなのでスキップ

        for (let i = 0; i < 7; i++) {
          const jp = daysJp[i];
          const en = daysEn[i];
          if (text.includes(jp) || text.includes(en)) {
            const cleanText = text.replace(/\s+/g, ' ').trim();
            // 時間情報または定休日を示すキーワードがあるかチェック
            const isValidRow = /[\d：:~～-]|定休|閉|Open|Close/i.test(cleanText);
            if (isValidRow) {
              if (!schedule[jp] || cleanText.length < schedule[jp].length) {
                schedule[jp] = cleanText;
              }
            }
          }
        }
      }

      const holidayDays: string[] = [];
      const scheduleByShortDay: Record<string, string> = {};

      for (let i = 0; i < 7; i++) {
        const fullDay = daysJp[i];
        const shortDay = daysShort[i];
        const dayInfo = schedule[fullDay];

        if (dayInfo) {
          let timeText = dayInfo
            .replace(fullDay, '')
            .replace(new RegExp(daysEn[i], 'i'), '')
            .trim();

          if (timeText.includes('定休日') || timeText.includes('Closed') || timeText.includes('定休')) {
            holidayDays.push(fullDay);
            scheduleByShortDay[shortDay] = '定休日';
          } else {
            scheduleByShortDay[shortDay] = timeText;
          }
        }
      }

      if (holidayDays.length > 0) {
        regularHoliday = holidayDays.join(', ');
      }

      // 曜日をグループ化してわかりやすくする（例：月〜金: 11:30~19:00）
      const groups: { startDay: string, endDay: string, text: string }[] = [];
      let currentGroup: { startDay: string, endDay: string, text: string } | null = null;

      for (const shortDay of daysShort) {
        const text = scheduleByShortDay[shortDay];
        if (!text) {
          if (currentGroup) {
            groups.push(currentGroup);
            currentGroup = null;
          }
          continue;
        }

        if (!currentGroup) {
          currentGroup = { startDay: shortDay, endDay: shortDay, text: text };
        } else {
          if (currentGroup.text === text) {
            currentGroup.endDay = shortDay;
          } else {
            groups.push(currentGroup);
            currentGroup = { startDay: shortDay, endDay: shortDay, text: text };
          }
        }
      }
      if (currentGroup) {
        groups.push(currentGroup);
      }

      if (groups.length > 0) {
        openingHoursDetails = groups.map(g => {
          if (g.startDay === g.endDay) {
            return `${g.startDay}: ${g.text}`;
          } else {
            return `${g.startDay}〜${g.endDay}: ${g.text}`;
          }
        }).join(', ');
      }
    }

    // 評価・レビュー数
    let rating = '';
    let reviewCount = '';
    const allEls = document.querySelectorAll(
      '[aria-label*="星 "], [aria-label*=" stars"], [aria-label*="レビュー"]'
    );
    for (const el of allEls) {
      const label = el.getAttribute('aria-label') ?? '';
      if (label.includes('レビュー') || label.includes('reviews')) {
        const rMatch = label.match(/星\s*([\d.]+)/) ?? label.match(/([\d.]+)\s*stars/);
        if (rMatch) rating = rMatch[1];
        const rvMatch = label.match(/レビュー\s*([\d,]+)\s*件/) ?? label.match(/([\d,]+)\s*reviews/);
        if (rvMatch) reviewCount = rvMatch[1].replace(/,/g, '');
        break;
      }
    }

    return { name, category, address, phone, businessHours, regularHoliday, openingHoursDetails, rating, reviewCount };
  }, sels);

  // 座標抽出: ページURL → 渡されたURL の順で試す
  const coords = extractCoordsFromUrl(page.url()) ?? extractCoordsFromUrl(url);

  return {
    name:                raw.name,
    category:            raw.category,
    address:             raw.address,
    phone:               raw.phone,
    businessHours:       raw.businessHours,
    regularHoliday:      raw.regularHoliday,
    openingHoursDetails: raw.openingHoursDetails,
    rating:              raw.rating,
    reviewCount:         raw.reviewCount,
    latitude:            coords?.lat ?? null,
    longitude:           coords?.lng ?? null,
    url,
    scrapedAt:           new Date().toISOString(),
    source:              'googlemaps',
  };
}
