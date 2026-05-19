// background.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    scrapingState: 'inactive', // inactive, active, done
    scrapedData: [],
    maxItems: 50
  });
});

// メッセージ中継やバックグラウンドでのデータ保持
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateData') {
    chrome.storage.local.get(['scrapedData'], (result) => {
      const currentData = result.scrapedData || [];
      const newData = request.data;

      // 重複排除 (URLをキーにする)
      const existingUrls = new Set(currentData.map(item => item.url));
      const uniqueNewData = newData.filter(item => !existingUrls.has(item.url));

      const updatedData = [...currentData, ...uniqueNewData];
      chrome.storage.local.set({ scrapedData: updatedData }, () => {
        sendResponse({ success: true, count: updatedData.length });
      });
    });
    return true; // 非同期レスポンス
  }

  if (request.action === 'setState') {
    chrome.storage.local.set({ scrapingState: request.state }, () => {
      if (request.state === 'active') {
        chrome.power.requestKeepAwake('display');
        chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
      } else {
        chrome.power.releaseKeepAwake();
        chrome.alarms.clear('keepAlive');
      }

      if (request.state === 'done') {
        chrome.storage.local.get(['scrapedData', 'filterConfig'], (result) => {
          const data = result.scrapedData || [];
          const count = data.length;
          const filterConfig = result.filterConfig || null;

          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '抽出が完了しました',
            message: `合計 ${count} 件のデータを取得しました。自動でダウンロードを開始します。`,
            priority: 2
          });

          if (count > 0 && sender.tab) {
            handleAutomaticDownload(sender.tab.id, data, filterConfig);
          }
        });
      }
      sendResponse({ success: true });
    });
    return true;
  }
});

// Service Workerを生かし続けるアラーム
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    chrome.storage.local.get(['scrapingState'], (result) => {
      if (result.scrapingState === 'active') {
        chrome.tabs.query({ url: ['https://www.google.com/maps/*', 'https://www.google.co.jp/maps/*'] }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'ping' }).catch(() => { });
          });
        });
      }
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ファイル名生成ユーティリティ（popup.jsと同一ロジック）
//
// 出力例:
//   "渋谷区 カフェ"  → 渋谷区_カフェ_Googleマップ_20260516.csv
//   "札幌市 居酒屋"  → 札幌市_居酒屋_Googleマップ_20260516.csv
//   "新宿 ラーメン"  → 新宿_ラーメン_Googleマップ_20260516.csv
//   ""（失敗時）     → Googleマップ_20260516_1423.csv
// ════════════════════════════════════════════════════════════════════════════

/**
 * クエリとフィルター設定からCSVファイル名を生成する
 */
function buildFilename(query, filterConfig) {
  const date = new Date();
  const dateStr =
    `${date.getFullYear()}` +
    `${(date.getMonth() + 1).toString().padStart(2, '0')}` +
    `${date.getDate().toString().padStart(2, '0')}`;
  const timeStr =
    `${date.getHours().toString().padStart(2, '0')}` +
    `${date.getMinutes().toString().padStart(2, '0')}`;

  const radiusSuffix =
    filterConfig && filterConfig.enabled && filterConfig.radius
      ? `_r${filterConfig.radius}m`
      : '';

  const trimmed = (query || '').trim();

  if (!trimmed) {
    return `Googleマップ_${dateStr}_${timeStr}${radiusSuffix}.csv`;
  }

  const { area, genre } = parseQueryToAreaGenre(trimmed);

  if (area && genre) {
    return `${sanitizeFilename(area)}_${sanitizeFilename(genre)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
  } else if (area) {
    return `${sanitizeFilename(area)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
  } else if (genre) {
    return `${sanitizeFilename(genre)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
  } else {
    return `${sanitizeFilename(trimmed)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
  }
}

/**
 * 検索クエリ文字列を解析してエリアとジャンルに分割する
 */
function parseQueryToAreaGenre(query) {
  // ① 記号区切り（✖️ ×）対応
  if (query.includes('✖️') || query.includes('×')) {
    const sep = query.includes('✖️') ? '✖️' : '×';
    const parts = query.split(sep).map(s => s.trim());
    const areaIdx = parts.findIndex(p => isAreaToken(p));
    if (areaIdx !== -1) {
      const area = parts[areaIdx];
      const genre = parts.find((_, i) => i !== areaIdx) || '';
      return { area, genre };
    }
    return { area: parts[0] || '', genre: parts[1] || '' };
  }

  // ② スペース区切り
  const tokens = query.split(/[\s\u3000]+/).filter(Boolean);

  if (tokens.length === 0) return { area: '', genre: '' };

  if (tokens.length === 1) {
    return isAreaToken(tokens[0])
      ? { area: tokens[0], genre: '' }
      : { area: '', genre: tokens[0] };
  }

  // ③ 複数トークン: 先頭側のエリアトークンを収集し、残りをジャンルとする
  let areaTokens = [];
  let genreTokens = [];
  let switchedToGenre = false;

  for (const token of tokens) {
    if (!switchedToGenre && isAreaToken(token)) {
      areaTokens.push(token);
    } else {
      switchedToGenre = true;
      genreTokens.push(token);
    }
  }

  if (areaTokens.length === 0) {
    areaTokens = [tokens[0]];
    genreTokens = tokens.slice(1);
  }

  return {
    area: areaTokens.join(''),
    genre: genreTokens.join('')
  };
}

/**
 * エリアトークンかどうかを判定する
 */
function isAreaToken(token) {
  if (/[市区町村都府道県]$/.test(token)) return true;

  const prefectures = [
    '北海道', '東京', '大阪', '京都', '神奈川', '愛知', '福岡', '沖縄',
    '埼玉', '千葉', '兵庫', '静岡', '茨城', '広島', '宮城'
  ];
  if (prefectures.includes(token)) return true;

  const cities = [
    '渋谷', '新宿', '池袋', '銀座', '品川', '秋葉原', '浅草', '上野',
    '吉祥寺', '横浜', '梅田', '難波', '心斎橋', '天王寺', '栄', '名古屋',
    '博多', '天神', '札幌', '仙台', '広島', '京都', '神戸', '川崎',
    '千葉', '船橋', '松山', '金沢', '高松', '那覇', '盛岡', '秋田',
    '山形', '水戸', '宇都宮', '前橋', '甲府', '長野', '岐阜', '津',
    '大津', '奈良', '和歌山', '鳥取', '松江', '岡山', '山口', '徳島',
    '高知', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島'
  ];
  if (cities.includes(token)) return true;

  return false;
}

/**
 * ファイル名に使えない文字を除去・変換する
 */
function sanitizeFilename(str) {
  return str
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

// ════════════════════════════════════════════════════════════════════════════

/**
 * スクレイピング完了時に自動でCSVをダウンロードする
 */
async function handleAutomaticDownload(tabId, data, filterConfig) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getQuery' });
    let query = response ? response.query : '';

    if (!query) {
      const storageResult = await new Promise(resolve => {
        chrome.storage.local.get(['lastQuery'], resolve);
      });
      if (storageResult.lastQuery) {
        query = storageResult.lastQuery;
      }
    }

    // CSV生成
    const headers = ['name', 'genre', 'address', 'phone', 'regular_holiday', 'opening_hours_details', 'rating', 'reviews', 'lat', 'lng', 'distance_m', 'url', 'source'];
    let csvContent = '\uFEFF' + headers.join(',') + '\n';

    data.forEach(item => {
      const row = [
        `"${(item.name || '').replace(/"/g, '""')}"`,
        `"${(item.genre || '').replace(/"/g, '""')}"`,
        `"${(item.address || '').replace(/"/g, '""')}"`,
        `"${(item.phone || '').replace(/"/g, '""')}"`,
        `"${(item.regularHoliday || '年中無休').replace(/"/g, '""')}"`,
        `"${(item.openingHoursDetails || '').replace(/"/g, '""')}"`,
        `"${(item.rating || '').replace(/"/g, '""')}"`,
        `"${(item.reviews || '').replace(/"/g, '""')}"`,
        `"${item.lat ?? ''}"`,
        `"${item.lng ?? ''}"`,
        `"${item.distanceMeters ?? ''}"`,
        `"${(item.url || '').replace(/"/g, '""')}"`,
        `"googlemaps"`
      ];
      csvContent += row.join(',') + '\n';
    });

    // ── ファイル名生成（新方式）────────────────────────────
    const filename = buildFilename(query, filterConfig);

    const encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);

    chrome.downloads.download({
      url: encodedUri,
      filename: filename,
      saveAs: false
    });

  } catch (error) {
    console.error('Automatic download failed:', error);
  }
}