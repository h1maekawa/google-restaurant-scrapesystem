// content.js

let isScraping = false;
let maxItemsLimit = 50;
let targetGenresList = [];
let collectedUrls = new Set();
let filterConfig = null;

const DAY_DEFS = [
  { jp: '月曜日', en: 'Monday', short: '月' },
  { jp: '火曜日', en: 'Tuesday', short: '火' },
  { jp: '水曜日', en: 'Wednesday', short: '水' },
  { jp: '木曜日', en: 'Thursday', short: '木' },
  { jp: '金曜日', en: 'Friday', short: '金' },
  { jp: '土曜日', en: 'Saturday', short: '土' },
  { jp: '日曜日', en: 'Sunday', short: '日' }
];

const GENRE_KEYWORD_MAP = {
  'スイーツ': ['スイーツ', 'ケーキ', 'デザート', '洋菓子', '和菓子', 'ペーストリー', '菓子', 'アイスクリーム', 'ジェラート', 'ショコラ', 'ドーナツ', 'パティスリー', 'ベーカリー', 'パン屋'],
  'カフェ': ['カフェ', 'コーヒー', '喫茶', '珈琲', 'cafe', 'coffee'],
  '喫茶店': ['喫茶', '珈琲', 'カフェ', '喫茶店'],
  '中華': ['中華', 'ラーメン', '餃子', 'チャーハン', '四川', '広東', '上海', '台湾', '中華料理'],
  '焼肉': ['焼肉', 'ホルモン', '肉料理', 'ステーキ', 'バーベキュー', 'やきにく', '焼肉店'],
  '焼き鳥': ['焼き鳥', '鳥料理', 'とり料理', '串焼き', 'やきとり', '焼き鳥店'],
  'お好み焼き': ['お好み焼き', 'たこ焼き', 'もんじゃ', '鉄板焼', 'お好み焼き屋', 'たこ焼き屋'],
  '居酒屋': ['居酒屋', 'バル', 'バー', '酒場', '立ち飲み', 'ダイニングバー', '小料理']
};

syncCollectedUrlsFromStorage();

function syncCollectedUrlsFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['scrapedData'], (result) => {
      const scrapedData = Array.isArray(result.scrapedData) ? result.scrapedData : [];
      collectedUrls = new Set(scrapedData.map(item => item && item.url).filter(Boolean));
      resolve(collectedUrls);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ action: 'backgroundSleep', ms }, () => resolve());
});

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function normalizeWhitespace(text) {
  return (text || '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMatchText(text) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[・･\-ー―‐－_、,，.。()（）\[\]【】「」『』\s]/g, '');
}

function uniqueArray(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function waitForCondition(checker, { timeout = 2000, interval = 40 } = {}) {
  const startedAt = Date.now();

  try {
    const initial = checker();
    if (initial) return initial;
  } catch (error) {
    console.debug('waitForCondition initial check failed', error);
  }

  return new Promise((resolve) => {
    let settled = false;
    let intervalId = null;
    let timeoutId = null;
    let observer = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (observer) observer.disconnect();
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
      resolve(value || null);
    };

    const runCheck = () => {
      if (Date.now() - startedAt >= timeout) {
        finish(null);
        return;
      }

      try {
        const result = checker();
        if (result) {
          finish(result);
        }
      } catch (error) {
        console.debug('waitForCondition check failed', error);
      }
    };

    observer = new MutationObserver(runCheck);
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    intervalId = setInterval(runCheck, interval);
    timeoutId = setTimeout(() => finish(null), timeout + 20);
  });
}

async function waitForElement(selector, timeout = 2000, root = document) {
  return waitForCondition(() => root.querySelector(selector), { timeout, interval: 40 });
}

function getCurrentQueryFromPage() {
  let query = '';

  const inputQ = document.querySelector('input[name="q"]');
  if (inputQ && inputQ.value) query = inputQ.value;

  if (!query) {
    const searchBox = document.getElementById('searchboxinput');
    if (searchBox && searchBox.value) query = searchBox.value;
  }

  if (!query) {
    const urlMatch = window.location.href.match(/\/maps\/search\/([^\/]+)/);
    if (urlMatch) {
      try {
        query = decodeURIComponent(urlMatch[1].replace(/\+/g, ' '));
      } catch (error) {
        console.debug('Failed to decode query from URL', error);
      }
    }
  }

  if (!query) {
    const titleMatch = document.title.match(/^(.*?) - Google/);
    if (titleMatch && !window.location.href.includes('/maps/place/')) {
      query = titleMatch[1];
    }
  }

  return query;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    isScraping = true;
    maxItemsLimit = request.maxItems || 50;
    targetGenresList = Array.isArray(request.targetGenres) ? request.targetGenres : [];
    filterConfig = request.filterConfig || null;

    syncCollectedUrlsFromStorage().then(() => {
      startScrapingLoop().catch((error) => {
        console.error('Scraping loop failed:', error);
        isScraping = false;
        chrome.runtime.sendMessage({ action: 'setState', state: 'done' });
      });
    });

    sendResponse({ status: 'started' });
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'getQuery') {
    sendResponse({ query: getCurrentQueryFromPage() });
  } else if (request.action === 'getMapCenter') {
    const match = window.location.href.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
    if (match) {
      sendResponse({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
    } else {
      sendResponse({ error: '座標が見つかりませんでした。' });
    }
  } else if (request.action === 'getGenresFromPage') {
    const genres = new Set();
    document.querySelectorAll('.DkEaL, button[jsaction*="category"], h1.DUwDvf').forEach((el) => {
      const text = normalizeWhitespace(el.innerText || el.textContent || '');
      if (text) genres.add(text);
    });
    sendResponse({ genres: Array.from(genres) });
  } else if (request.action === 'ping') {
    sendResponse({ status: 'alive' });
  }

  return true;
});

function haversineDistance(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractCoordsFromUrl(url) {
  if (!url) return null;

  const matchD = url.match(/!3d([-+]?\d+\.\d+)!4d([-+]?\d+\.\d+)/);
  if (matchD) return { lat: parseFloat(matchD[1]), lng: parseFloat(matchD[2]) };

  const matchAt = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (matchAt) return { lat: parseFloat(matchAt[1]), lng: parseFloat(matchAt[2]) };

  return null;
}

function getScrollContainer() {
  let container = document.querySelector('div[role="feed"]');
  if (container) return container;

  const candidates = Array.from(document.querySelectorAll('div')).filter((div) => {
    const style = window.getComputedStyle(div);
    const canScroll = ['auto', 'scroll'].includes(style.overflowY);
    return canScroll && div.scrollHeight > div.clientHeight + 200 && div.clientHeight > 200;
  });

  candidates.sort((a, b) => (b.clientHeight * b.scrollHeight) - (a.clientHeight * a.scrollHeight));
  return candidates[0] || null;
}

function getPlaceLinks() {
  return Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place/"], a[href^="https://www.google.co.jp/maps/place/"]'));
}

function isEndOfList(container) {
  const feedText = normalizeWhitespace(container?.innerText || '');
  return [
    'リストの最後に到達しました',
    'これ以上結果はありません',
    "You've reached the end of the list",
    'No more results'
  ].some(text => feedText.includes(text));
}

async function waitForFeedGrowth(container, previousLinkCount, timeout = 1400) {
  return waitForCondition(() => {
    const currentCount = getPlaceLinks().length;
    if (currentCount > previousLinkCount) return currentCount;
    if (isEndOfList(container)) return 'end';
    return null;
  }, { timeout, interval: 50 });
}

function dispatchSyntheticScrollSignals(container, deltaY) {
  try {
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
  } catch (error) {
    console.debug('scroll event dispatch failed', error);
  }

  try {
    container.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY,
      clientX: Math.max(0, Math.floor(container.clientWidth / 2)),
      clientY: Math.max(0, Math.floor(container.clientHeight / 2))
    }));
  } catch (error) {
    console.debug('wheel event dispatch failed', error);
  }
}

async function jiggleScrollContainer(container) {
  if (!container) return;

  const currentTop = container.scrollTop;
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const pullbackTop = Math.max(0, currentTop - Math.max(180, Math.floor(container.clientHeight * 0.35)));
  const forwardTop = Math.min(maxTop, Math.max(currentTop + Math.floor(container.clientHeight * 0.9), container.scrollTop + 360));

  container.scrollTo({ top: pullbackTop, behavior: 'auto' });
  dispatchSyntheticScrollSignals(container, -240);
  await nextFrame();
  await nextFrame();

  container.scrollTo({ top: forwardTop, behavior: 'auto' });
  dispatchSyntheticScrollSignals(container, 360);
  await nextFrame();
  await nextFrame();

  container.scrollTo({ top: maxTop, behavior: 'auto' });
  dispatchSyntheticScrollSignals(container, 420);
}

function getPlaceTitle() {
  const titleSelectors = [
    'h1.DUwDvf',
    'h1.fontHeadlineLarge',
    '[role="main"] h1',
    'h1'
  ];

  for (const selector of titleSelectors) {
    const el = document.querySelector(selector);
    const text = normalizeWhitespace(el?.innerText || el?.textContent || '');
    if (text) return text;
  }
  return '';
}

function safeClick(element) {
  if (!element) return false;
  try {
    element.click();
    return true;
  } catch (error) {
    try {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (dispatchError) {
      console.debug('Failed to click element', dispatchError);
      return false;
    }
  }
}

async function waitForPlaceDetail(expectedName, previousName, previousUrl) {
  const normalizedExpectedName = normalizeMatchText(expectedName);
  const normalizedPreviousName = normalizeMatchText(previousName);

  return waitForCondition(() => {
    const currentTitle = getPlaceTitle();
    const normalizedCurrentTitle = normalizeMatchText(currentTitle);
    const currentUrl = window.location.href;

    const detailReady = Boolean(
      document.querySelector('button[data-item-id="address"], button[data-item-id^="phone:tel:"], button[data-item-id="oh"], .DkEaL, button[jsaction*="category"]')
    );

    const titleMatched = normalizedExpectedName && normalizedCurrentTitle && (
      normalizedCurrentTitle.includes(normalizedExpectedName) ||
      normalizedExpectedName.includes(normalizedCurrentTitle)
    );

    const titleChanged = normalizedCurrentTitle && normalizedCurrentTitle !== normalizedPreviousName;
    const urlChanged = currentUrl !== previousUrl && /\/maps\/place\//.test(currentUrl);

    if (detailReady && (titleMatched || titleChanged || urlChanged)) {
      return true;
    }

    return null;
  }, { timeout: 4000, interval: 40 });
}

function getTextFromElement(element) {
  if (!element) return '';
  const aria = normalizeWhitespace(element.getAttribute('aria-label') || '');
  const text = normalizeWhitespace(element.innerText || element.textContent || '');
  return text || aria;
}

function cleanLabeledValue(text, prefixes) {
  let cleaned = normalizeWhitespace(text);
  prefixes.forEach((prefix) => {
    cleaned = cleaned.replace(new RegExp(`^${prefix}\\s*[:：]?\\s*`, 'i'), '');
  });
  return cleaned.trim();
}

function extractFirstMatchingText(selectors, prefixes = []) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const text = cleanLabeledValue(getTextFromElement(element), prefixes);
      if (text) return text;
    }
  }
  return '';
}

function parseRatingAndReviews() {
  const result = { rating: '', reviews: '' };
  const elements = document.querySelectorAll('[aria-label*="星"], [aria-label*="stars"], [role="img"][aria-label], button[aria-label]');

  for (const element of elements) {
    const label = normalizeWhitespace(element.getAttribute('aria-label') || '');
    if (!label) continue;

    const ratingMatch = label.match(/星\s*([\d.]+)/i) || label.match(/([\d.]+)\s*stars?/i);
    const reviewsMatch = label.match(/レビュー\s*([\d,]+)\s*件/i) || label.match(/([\d,]+)\s*reviews?/i);

    if (ratingMatch) result.rating = ratingMatch[1];
    if (reviewsMatch) result.reviews = reviewsMatch[1].replace(/,/g, '');

    if (result.rating || result.reviews) return result;
  }

  const ratingText = normalizeWhitespace(document.body.innerText || '');
  const fallbackRating = ratingText.match(/([\d.]+)\s*\(\s*([\d,]+)\s*\)/);
  if (fallbackRating) {
    result.rating = fallbackRating[1];
    result.reviews = fallbackRating[2].replace(/,/g, '');
  }

  return result;
}

function findHoursButton() {
  const selectors = [
    'button[data-item-id="oh"]',
    '[aria-label="1 週間の営業時間を表示"]',
    '[aria-label*="営業時間を表示"]',
    '[aria-label*="営業時間を非表示"]',
    '[aria-label*="Show open hours"]',
    '[aria-label*="Hide open hours"]',
    '[aria-label*="Hours"]'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }

  return null;
}

function getHoursRoot() {
  return document.querySelector('[role="main"]') || document.body;
}

function matchDayDefinition(text) {
  const normalized = normalizeWhitespace(text);
  return DAY_DEFS.find(day => normalized.includes(day.jp) || normalized.includes(day.en)) || null;
}

function isClosedText(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return /定休日|休業日|休み|closed|close|休業/.test(normalized);
}

function normalizeTimeText(text) {
  let normalized = normalizeWhitespace(text);
  if (!normalized) return '';

  normalized = normalized
    .replace(/通常と異なる営業時間/g, '')
    .replace(/祝日営業時間/g, '')
    .replace(/営業時間外/g, '')
    .replace(/営業中/g, '')
    .replace(/営業開始[:：]?/g, '')
    .replace(/営業終了[:：]?/g, '')
    .replace(/最終入店[:：]?/g, '')
    .replace(/ラストオーダー[:：]?/g, 'L.O. ')
    .replace(/午前/g, 'AM ')
    .replace(/午後/g, 'PM ')
    .replace(/（.*?）/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/・/g, ' ')
    .replace(/;/g, ' ')
    .replace(/\s*[、,，]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = normalized.replace(/(\d{1,2})時(\d{1,2})分/g, (_, h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  normalized = normalized.replace(/(\d{1,2})時半/g, (_, h) => `${String(h).padStart(2, '0')}:30`);
  normalized = normalized.replace(/(\d{1,2})時/g, (_, h) => `${String(h).padStart(2, '0')}:00`);
  normalized = normalized.replace(/(\d{1,2})\.(\d{2})/g, '$1:$2');
  normalized = normalized.replace(/\s*[~～-]\s*/g, '〜');
  normalized = normalized.replace(/\s*\/\s*/g, ' / ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  if (/24\s*hours|24時間/.test(normalized.toLowerCase())) return '24時間営業';
  if (isClosedText(normalized)) return '定休日';

  return normalized;
}

function parseRowToDayEntry(dayDef, rowText) {
  if (!dayDef) return null;

  let value = normalizeWhitespace(rowText)
    .replace(new RegExp(dayDef.jp, 'g'), '')
    .replace(new RegExp(dayDef.en, 'ig'), '')
    .replace(/^[\s:：-]+/, '')
    .trim();

  value = normalizeTimeText(value);
  if (!value) return null;

  return { day: dayDef.jp, value };
}

function collectHoursRowsFromTable(root) {
  const entries = [];
  const rows = root.querySelectorAll('table tr');

  rows.forEach((row) => {
    const cells = Array.from(row.querySelectorAll('th, td')).map(cell => normalizeWhitespace(cell.innerText || cell.textContent || '')).filter(Boolean);
    if (!cells.length) return;

    const dayDef = matchDayDefinition(cells[0] || cells.join(' '));
    if (!dayDef) return;

    const timeText = normalizeTimeText(cells.slice(1).join(' '));
    if (!timeText) return;

    entries.push({ day: dayDef.jp, value: timeText });
  });

  return entries;
}

function collectHoursRowsFromGenericNodes(root) {
  const entries = [];
  const nodes = root.querySelectorAll('li, div');

  nodes.forEach((node) => {
    if (node.children.length > 8) return;

    const text = normalizeWhitespace(node.innerText || node.textContent || '');
    if (!text || text.length > 120) return;

    const dayDef = matchDayDefinition(text);
    if (!dayDef) return;
    if (!/[\d:時]|24時間|定休日|休業|closed/i.test(text)) return;

    const parsed = parseRowToDayEntry(dayDef, text);
    if (parsed) entries.push(parsed);
  });

  return entries;
}

function parseWeeklyScheduleFromText(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const dayPattern = /(月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/g;
  const matches = Array.from(normalized.matchAll(dayPattern));
  if (!matches.length) return [];

  const entries = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const dayText = match[0];
    const dayDef = DAY_DEFS.find(day => day.jp === dayText || day.en === dayText);
    if (!dayDef) continue;

    const start = match.index + dayText.length;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    const value = normalizeTimeText(normalized.slice(start, end).replace(/^[\s:：.。]+/, ''));

    if (value) entries.push({ day: dayDef.jp, value });
  }

  return entries;
}

function dedupeDayEntries(entries) {
  const result = {};
  entries.forEach((entry) => {
    if (!entry || !entry.day || !entry.value) return;
    const current = result[entry.day];
    if (!current || entry.value.length < current.length) {
      result[entry.day] = entry.value;
    }
  });
  return result;
}

function compressDayIndexes(indexes) {
  if (!indexes.length) return '';

  const ranges = [];
  let start = indexes[0];
  let prev = indexes[0];

  for (let i = 1; i < indexes.length; i++) {
    const current = indexes[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push([start, prev]);
    start = current;
    prev = current;
  }
  ranges.push([start, prev]);

  return ranges
    .map(([rangeStart, rangeEnd]) => rangeStart === rangeEnd
      ? DAY_DEFS[rangeStart].short
      : `${DAY_DEFS[rangeStart].short}〜${DAY_DEFS[rangeEnd].short}`)
    .join('・');
}

function buildOpeningHoursSummary(dayValueMap) {
  const closedDays = [];
  const openGroups = new Map();

  DAY_DEFS.forEach((day, index) => {
    const value = dayValueMap[day.jp];
    if (!value) return;

    if (isClosedText(value)) {
      closedDays.push(day.jp);
      return;
    }

    if (!openGroups.has(value)) {
      openGroups.set(value, []);
    }
    openGroups.get(value).push(index);
  });

  const openingHoursDetails = Array.from(openGroups.entries())
    .map(([value, indexes]) => ({ value, indexes, firstIndex: indexes[0] }))
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map(group => `${compressDayIndexes(group.indexes)}: ${group.value}`)
    .join(', ');

  return {
    regularHoliday: closedDays.length ? closedDays.join(', ') : '年中無休',
    openingHoursDetails
  };
}

async function extractOpeningHoursData() {
  const hoursButton = findHoursButton();
  if (!hoursButton) {
    return {
      businessHoursSummary: '',
      regularHoliday: '年中無休',
      openingHoursDetails: ''
    };
  }

  const rawSummary = cleanLabeledValue(
    hoursButton.getAttribute('aria-label') || hoursButton.innerText || '',
    ['営業時間', 'Hours', 'Open hours', '1 週間の営業時間を表示', '1 週間の営業時間を非表示']
  );

  const root = getHoursRoot();
  const beforeRows = collectHoursRowsFromTable(root);
  const alreadyExpanded = beforeRows.length >= 3 || /非表示|hide/i.test(hoursButton.getAttribute('aria-label') || '');

  if (!alreadyExpanded) {
    safeClick(hoursButton);
    await waitForCondition(() => {
      const rows = collectHoursRowsFromTable(root);
      if (rows.length >= 3) return rows;
      const genericRows = collectHoursRowsFromGenericNodes(root);
      if (genericRows.length >= 3) return genericRows;
      return null;
    }, { timeout: 2500, interval: 35 });
  }

  let entries = collectHoursRowsFromTable(root);
  if (entries.length < 3) {
    entries = collectHoursRowsFromGenericNodes(root);
  }
  if (entries.length < 3) {
    entries = parseWeeklyScheduleFromText(rawSummary);
  }

  const dayValueMap = dedupeDayEntries(entries);
  const { regularHoliday, openingHoursDetails } = buildOpeningHoursSummary(dayValueMap);

  return {
    businessHoursSummary: openingHoursDetails || normalizeTimeText(rawSummary),
    regularHoliday,
    openingHoursDetails
  };
}

function resolveGenreText() {
  const candidates = uniqueArray([
    extractFirstMatchingText(['.DkEaL']),
    extractFirstMatchingText(['button[jsaction*="category"]']),
    extractFirstMatchingText(['a[href*="/search/"][aria-label*="カテゴリ"]']),
    extractFirstMatchingText(['button[aria-label*="カテゴリ"]'])
  ]);

  return candidates[0] || '';
}

function expandGenreKeywords(genre) {
  const normalized = normalizeWhitespace(genre);
  if (!normalized) return [];
  return uniqueArray([normalized, ...(GENRE_KEYWORD_MAP[normalized] || [])]);
}

function matchesTargetGenres(placeGenre, targets) {
  if (!targets.length) return true;
  const normalizedGenre = normalizeMatchText(placeGenre);
  if (!normalizedGenre) return false;

  return targets.some((target) => {
    return expandGenreKeywords(target).some((keyword) => {
      const normalizedKeyword = normalizeMatchText(keyword);
      return normalizedKeyword && (
        normalizedGenre.includes(normalizedKeyword) ||
        normalizedKeyword.includes(normalizedGenre)
      );
    });
  });
}

async function startScrapingLoop() {
  const scrollContainer = getScrollContainer();
  if (!scrollContainer) {
    alert('リストのスクロールコンテナが見つかりません。');
    chrome.runtime.sendMessage({ action: 'setState', state: 'inactive' });
    return;
  }

  let idleRounds = 0;
  const maxIdleRounds = 180;

  while (isScraping && collectedUrls.size < maxItemsLimit) {
    if (isEndOfList(scrollContainer)) break;

    const allLinks = getPlaceLinks();
    const newLinks = allLinks.filter(link => link.href && !collectedUrls.has(link.href));

    if (newLinks.length) {
      idleRounds = 0;

      for (const link of newLinks) {
        if (!isScraping || collectedUrls.size >= maxItemsLimit) break;

        const url = link.href;
        const labelName = normalizeWhitespace(link.getAttribute('aria-label') || link.innerText || '');
        const previousTitle = getPlaceTitle();
        const previousUrl = window.location.href;

        try {
          link.scrollIntoView({ behavior: 'auto', block: 'center' });
          await nextFrame();

          safeClick(link);
          await waitForPlaceDetail(labelName, previousTitle, previousUrl);

          const extractedData = await extractDetailData();
          const coords = extractCoordsFromUrl(url) || extractCoordsFromUrl(window.location.href);
          const placeData = {
            url,
            name: extractedData.name || labelName || '',
            genre: extractedData.genre || '',
            address: extractedData.address || '',
            phone: extractedData.phone || '',
            businessHours: extractedData.businessHours || '',
            regularHoliday: extractedData.regularHoliday || '年中無休',
            openingHoursDetails: extractedData.openingHoursDetails || '',
            rating: extractedData.rating || '',
            reviews: extractedData.reviews || '',
            lat: coords ? coords.lat : null,
            lng: coords ? coords.lng : null,
            source: 'googlemaps'
          };

          if (!matchesTargetGenres(placeData.genre, targetGenresList)) {
            collectedUrls.add(url);
            continue;
          }

          if (filterConfig && filterConfig.enabled && filterConfig.centerLat != null && filterConfig.centerLng != null) {
            const distance = haversineDistance(filterConfig.centerLat, filterConfig.centerLng, placeData.lat, placeData.lng);
            placeData.distanceMeters = Math.round(distance);
            if (distance > filterConfig.radiusMeters) {
              collectedUrls.add(url);
              continue;
            }
          }

          collectedUrls.add(url);

          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'updateData', data: [placeData] }, () => resolve());
          });
        } catch (error) {
          console.error('Error processing place:', error);
        }
      }

      continue;
    }

    idleRounds += 1;

    const previousCount = allLinks.length;
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
    dispatchSyntheticScrollSignals(scrollContainer, 320);

    const growth = await waitForFeedGrowth(scrollContainer, previousCount, 1100);
    if (growth === 'end') break;
    if (growth) continue;

    await jiggleScrollContainer(scrollContainer);
    const postJiggleGrowth = await waitForFeedGrowth(scrollContainer, previousCount, 1400);
    if (postJiggleGrowth === 'end') break;
    if (postJiggleGrowth) {
      idleRounds = 0;
      continue;
    }

    if (idleRounds >= maxIdleRounds) {
      console.log('No new elements found after extended retries. Stopping.');
      break;
    }
  }

  chrome.runtime.sendMessage({ action: 'setState', state: 'done' });
  isScraping = false;
}

async function extractDetailData() {
  const data = {
    name: getPlaceTitle(),
    genre: '',
    rating: '',
    reviews: '',
    address: '',
    phone: '',
    businessHours: '',
    regularHoliday: '年中無休',
    openingHoursDetails: ''
  };

  data.genre = resolveGenreText();

  data.phone = extractFirstMatchingText(
    [
      'button[data-item-id^="phone:tel:"]',
      'a[data-item-id^="phone:tel:"]',
      'button[aria-label*="電話番号"]',
      'button[aria-label*="Phone"]'
    ],
    ['電話番号', 'Phone']
  );

  data.address = extractFirstMatchingText(
    [
      'button[data-item-id="address"]',
      'button[aria-label*="住所"]',
      'button[aria-label*="Address"]'
    ],
    ['住所', 'Address']
  );

  const { rating, reviews } = parseRatingAndReviews();
  data.rating = rating;
  data.reviews = reviews;

  const openingHoursData = await extractOpeningHoursData();
  data.businessHours = openingHoursData.businessHoursSummary || '';
  data.regularHoliday = openingHoursData.regularHoliday || '年中無休';
  data.openingHoursDetails = openingHoursData.openingHoursDetails || '';

  if (!data.address) {
    const bodyText = normalizeWhitespace(document.body.innerText || '');
    const addressMatch = bodyText.match(/(?:東京都|北海道|(?:京都|大阪)府|[^\s]{2,3}県)[^\n]+?(?:\d{1,4}(?:-\d{1,4}){1,3})?/);
    if (addressMatch) data.address = addressMatch[0];
  }

  if (!data.phone) {
    const phoneMatch = normalizeWhitespace(document.body.innerText || '').match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
    if (phoneMatch) data.phone = phoneMatch[0];
  }

  return data;
}
