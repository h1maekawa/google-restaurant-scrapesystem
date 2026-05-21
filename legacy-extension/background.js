// background.js
// 1. ヘッダー定義を日本語に統一
const CSV_HEADERS = [
  '店名',
  'ジャンル',
  '住所',
  '電話番号',
  '定休日',
  '営業時間',
  'URL',
  '媒体'
];

// 2. 出力レコードの内部プロパティ（裏側は英語のまま）
function normalizeExportRecord(item) {
  return {
    name: item?.name || '',
    genre: item?.genre || '',
    address: item?.address || '',
    phone: item?.phone || '',
    regular_holiday: item?.regularHoliday || item?.regular_holiday || '年中無休',
    opening_hours_details: item?.openingHoursDetails || item?.opening_hours_details || '',
    url: item?.url || '',
    source: 'googlemaps'
  };
}

// 3. 日本語ヘッダーの順序に合わせてCSVを組み立てる
function buildCsvContent(data) {
  let csvContent = '\uFEFF' + CSV_HEADERS.join(',') + '\n';

  data.forEach((item) => {
    const row = normalizeExportRecord(item);
    csvContent += [
      escapeCsvValue(row.name),
      escapeCsvValue(row.genre),
      escapeCsvValue(row.address),
      escapeCsvValue(row.phone),
      escapeCsvValue(row.regular_holiday),
      escapeCsvValue(row.opening_hours_details),
      escapeCsvValue(row.url),
      escapeCsvValue(row.source)
    ].join(',') + '\n';
  });

  return csvContent;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    scrapingState: 'inactive',
    scrapedData: [],
    maxItems: 50,
    targetGenres: ''
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'backgroundSleep') {
    setTimeout(() => sendResponse({ success: true }), request.ms);
    return true;
  }

  if (request.action === 'updateData') {
    chrome.storage.local.get(['scrapedData'], (result) => {
      const currentData = Array.isArray(result.scrapedData) ? result.scrapedData : [];
      const newData = Array.isArray(request.data) ? request.data : [];

      const existingUrls = new Set(currentData.map(item => item && item.url).filter(Boolean));
      const uniqueNewData = newData.filter(item => item && item.url && !existingUrls.has(item.url));
      const updatedData = [...currentData, ...uniqueNewData];

      chrome.storage.local.set({ scrapedData: updatedData }, () => {
        sendResponse({ success: true, count: updatedData.length });
      });
    });
    return true;
  }

  if (request.action === 'setState') {
    chrome.storage.local.set({ scrapingState: request.state }, async () => {
      if (request.state === 'active') {
        chrome.power.requestKeepAwake('display');
        chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
      } else {
        chrome.power.releaseKeepAwake();
        chrome.alarms.clear('keepAlive');
      }

      if (request.state === 'done') {
        chrome.storage.local.get(['scrapedData', 'filterConfig'], async (result) => {
          const data = Array.isArray(result.scrapedData) ? result.scrapedData : [];
          const filterConfig = result.filterConfig || null;
          const count = data.length;

          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '抽出が完了しました',
            message: `合計 ${count} 件のデータを取得しました。自動でダウンロードを開始します。`,
            priority: 2
          });

          if (count > 0) {
            const tabId = sender?.tab?.id || await findActiveMapsTabId();
            if (tabId != null) {
              handleAutomaticDownload(tabId, data, filterConfig).catch((error) => {
                console.error('Automatic download failed:', error);
              });
            }
          }
        });
      }

      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepAlive') return;

  chrome.storage.local.get(['scrapingState'], (result) => {
    if (result.scrapingState !== 'active') return;

    chrome.tabs.query({ url: ['https://www.google.com/maps/*', 'https://www.google.co.jp/maps/*'] }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: 'ping' }).catch(() => { });
      });
    });
  });
});

async function findActiveMapsTabId() {
  const tabs = await chrome.tabs.query({ url: ['https://www.google.com/maps/*', 'https://www.google.co.jp/maps/*'] });
  return tabs[0]?.id ?? null;
}

function escapeCsvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function normalizeExportRecord(item) {
  return {
    name: item?.name || '',
    genre: item?.genre || '',
    address: item?.address || '',
    phone: item?.phone || '',
    regularHoliday: item?.regularHoliday || '年中無休',
    openingHoursDetails: item?.openingHoursDetails || '',
    rating: item?.rating || '',
    reviews: item?.reviews || '',
    lat: item?.lat ?? '',
    lng: item?.lng ?? '',
    distanceMeters: item?.distanceMeters ?? '',
    url: item?.url || '',
    source: item?.source || 'googlemaps'
  };
}

function buildCsvContent(data) {
  let csvContent = '\uFEFF' + CSV_HEADERS.join(',') + '\n';

  data.forEach((item) => {
    const row = normalizeExportRecord(item);
    csvContent += [
      escapeCsvValue(row.name),
      escapeCsvValue(row.genre),
      escapeCsvValue(row.address),
      escapeCsvValue(row.phone),
      escapeCsvValue(row.regularHoliday),
      escapeCsvValue(row.openingHoursDetails),
      escapeCsvValue(row.rating),
      escapeCsvValue(row.reviews),
      escapeCsvValue(row.lat),
      escapeCsvValue(row.lng),
      escapeCsvValue(row.distanceMeters),
      escapeCsvValue(row.url),
      escapeCsvValue(row.source)
    ].join(',') + '\n';
  });

  return csvContent;
}

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
  }
  if (area) {
    return `${sanitizeFilename(area)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
  }
  if (genre) {
    return `${sanitizeFilename(genre)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
  }
  return `${sanitizeFilename(trimmed)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
}

function parseQueryToAreaGenre(query) {
  if (query.includes('✖️') || query.includes('×')) {
    const separator = query.includes('✖️') ? '✖️' : '×';
    const parts = query.split(separator).map(s => s.trim()).filter(Boolean);
    const areaIdx = parts.findIndex(p => isAreaToken(p));

    if (areaIdx !== -1) {
      return {
        area: parts[areaIdx],
        genre: parts.find((_, index) => index !== areaIdx) || ''
      };
    }

    return { area: parts[0] || '', genre: parts[1] || '' };
  }

  const tokens = query.split(/[\s\u3000]+/).filter(Boolean);
  if (!tokens.length) return { area: '', genre: '' };
  if (tokens.length === 1) {
    return isAreaToken(tokens[0])
      ? { area: tokens[0], genre: '' }
      : { area: '', genre: tokens[0] };
  }

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

  if (!areaTokens.length) {
    areaTokens = [tokens[0]];
    genreTokens = tokens.slice(1);
  }

  return {
    area: areaTokens.join(''),
    genre: genreTokens.join('')
  };
}

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
  return cities.includes(token);
}

function sanitizeFilename(str) {
  return String(str || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

async function handleAutomaticDownload(tabId, data, filterConfig) {
  let query = '';

  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getQuery' });
    query = response?.query || '';
  } catch (error) {
    console.debug('Failed to get query from content script:', error);
  }

  if (!query) {
    const storageResult = await chrome.storage.local.get(['lastQuery']);
    query = storageResult.lastQuery || '';
  }

  const filename = buildFilename(query, filterConfig);
  const encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(buildCsvContent(data));

  await chrome.downloads.download({
    url: encodedUri,
    filename,
    saveAs: false
  });
}
