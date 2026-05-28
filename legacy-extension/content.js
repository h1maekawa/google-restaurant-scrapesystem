// content.js
// 高速化版: 1件あたり約5-6秒 → 約2-3秒を目標
// 高速化のポイント:
//   1. クリック後の固定待機(2500ms)を廃止 → waitForDetailPanel のポーリングで代替
//   2. scrapeDetailPanel内のsleep(600)を200msに短縮
//   3. 営業時間トグル待機(900ms)を500msに短縮
//   4. closeDetailPanel後のwaitForListPanel完了を確認したらすぐ次へ(800ms固定待機を廃止)
//   5. ループ末尾の固定待機(300ms)を廃止
//   6. スクロール後の待機(1800ms)を1000msに短縮

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function backgroundSleep(ms) {
  return new Promise(r => {
    chrome.runtime.sendMessage({ action: 'backgroundSleep', ms }, () => r());
  });
}

function getCurrentQuery() {
  return document.querySelector('input#searchboxinput')?.value?.trim() || '';
}

function extractNameFromUrl(url) {
  try {
    const match = url.match(/\/maps\/place\/([^/]+)\//);
    if (!match) return '';
    return decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
  } catch (e) { return ''; }
}

// =====================================================================
// 詳細パネル判定
// =====================================================================
function isDetailPanelOpen() {
  return !!document.querySelector('button[data-item-id="address"]');
}

async function waitForDetailPanel(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isDetailPanelOpen()) return true;
    await sleep(200); // 300ms → 200ms
  }
  return false;
}

async function waitForListPanel(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isDetailPanelOpen()) return true;
    await sleep(200); // 300ms → 200ms
  }
  return false;
}

async function closeDetailPanel() {
  const selectors = [
    'button[aria-label="前に戻ります"]',
    'button[jsaction*="omnibox.back"]',
    'button[aria-label="検索結果に戻る"]',
    'button[aria-label="Back to results"]',
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) { btn.click(); return true; }
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return false;
}

// =====================================================================
// 営業時間パース
// =====================================================================
const WEEKDAY_IDX = { '月':0,'火':1,'水':2,'木':3,'金':4,'土':5,'日':6 };
const IDX_TO_DAY  = ['月','火','水','木','金','土','日'];

function parseOpeningHours(rows) {
  if (!rows || !rows.length) return { businessDays:'', openTime:'', closeTime:'', regularHoliday:'' };

  const blocks = [], closedIdx = [];

  for (const row of rows) {
    const dayMatch = row.match(/^([月火水木金土日])曜日/);
    if (!dayMatch) continue;
    const dayIdx = WEEKDAY_IDX[dayMatch[1]];
    if (dayIdx === undefined) continue;

    if (row.includes('定休日') || row.includes('休業')) {
      closedIdx.push(dayIdx);
      continue;
    }

    const times = [];
    let m;
    const re1 = /(\d{1,2})時(\d{2})分[〜～]\s*(\d{1,2})時(\d{2})分/g;
    while ((m = re1.exec(row)) !== null) {
      let open = parseInt(m[1]), close = parseInt(m[3]);
      if (close < open) close += 24;
      times.push({ open, close });
    }
    if (!times.length) {
      const re2 = /(\d{1,2}):(\d{2})\s*[〜～－\-]\s*(\d{1,2}):(\d{2})/g;
      while ((m = re2.exec(row)) !== null) {
        let open = parseInt(m[1]), close = parseInt(m[3]);
        if (close < open) close += 24;
        times.push({ open, close });
      }
    }
    if (times.length) blocks.push({ dayIdx, open: times[0].open, close: times[times.length-1].close });
  }

  if (!blocks.length) return { businessDays:'', openTime:'', closeTime:'', regularHoliday: closedIdx.map(i=>IDX_TO_DAY[i]).join('・') };

  const todayIdx   = (new Date().getDay() + 6) % 7;
  const todayBlock = blocks.find(b => b.dayIdx === todayIdx) || blocks[0];
  const activeDays = new Set(blocks.map(b => b.dayIdx));
  const regularHoliday = closedIdx.length
    ? closedIdx.map(i => IDX_TO_DAY[i]).join('・')
    : IDX_TO_DAY.filter((_,i) => !activeDays.has(i)).join('・');

  return {
    businessDays:  [...activeDays].sort().map(i => IDX_TO_DAY[i]).join('・'),
    openTime:      String(todayBlock.open),
    closeTime:     String(todayBlock.close),
    regularHoliday
  };
}

// =====================================================================
// 詳細パネルスクレイピング
// =====================================================================
async function scrapeDetailPanel(placeUrl) {
  await sleep(200); // 600ms → 200ms（パネルはwaitForDetailPanelで確認済み）

  const h1Text = document.querySelector('[role="main"] h1')?.textContent?.trim() || '';
  const name   = (h1Text && h1Text !== '結果') ? h1Text : extractNameFromUrl(placeUrl);

  // ジャンル
  let genre = '';
  const h1El = document.querySelector('[role="main"] h1');
  if (h1El) {
    let el = h1El.parentElement;
    for (let depth = 0; depth < 3 && !genre; depth++) {
      if (!el) break;
      const siblings = Array.from(el.children);
      const h1Idx   = siblings.findIndex(c => c.contains(h1El));
      for (let i = h1Idx + 1; i < Math.min(h1Idx + 4, siblings.length); i++) {
        const text = siblings[i]?.textContent?.trim() || '';
        if (
          text.length >= 2 && text.length <= 40 &&
          !/^[\d¥￥,円〜～\s・]+$/.test(text) &&
          !text.includes('クチコミ') && !text.includes('★') &&
          !text.includes('営業') && !text.includes('定休')
        ) { genre = text; break; }
      }
      el = el.parentElement;
    }
  }

  // 住所
  let address = '';
  const addrBtn = document.querySelector('button[data-item-id="address"]');
  if (addrBtn) {
    const raw = addrBtn.getAttribute('aria-label') || addrBtn.textContent.trim();
    address = raw.replace(/^住所[：:]\s*/, '').trim();
  }

  // 電話番号
  let phone = '';
  const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
  if (phoneBtn) {
    const itemId = phoneBtn.getAttribute('data-item-id') || '';
    phone = itemId.replace('phone:tel:', '').trim() || phoneBtn.textContent.trim();
  }

  // 営業時間トグル
  const hoursToggle = document.querySelector('button[data-item-id="oh"]');
  if (hoursToggle && hoursToggle.getAttribute('aria-expanded') !== 'true') {
    hoursToggle.click();
    await sleep(500); // 900ms → 500ms
  }

  const hourRows = Array.from(document.querySelectorAll('tr'))
    .map(tr => tr.textContent.replace(/\s+/g, '').trim())
    .filter(t => /^[月火水木金土日]曜日/.test(t));

  const parsed = parseOpeningHours(hourRows);

  return { name, genre, address, phone, ...parsed };
}

// =====================================================================
// コンテナ取得
// =====================================================================
function getScrollContainer() {
  const byClass = document.querySelector('.m6QErb.ecceSd');
  if (byClass && byClass.querySelectorAll('a[href*="/maps/place/"]').length > 0) return byClass;

  const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
  if (!links.length) return null;
  let el = links[0].parentElement;
  while (el && el !== document.body) {
    const count = el.querySelectorAll('a[href*="/maps/place/"]').length;
    if (count >= Math.min(links.length, 5)) {
      const s = window.getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll' || el.scrollHeight > el.clientHeight + 50) return el;
    }
    el = el.parentElement;
  }
  return null;
}

// =====================================================================
// カード情報取得
// =====================================================================
function extractCardInfo(linkEl) {
  const url  = linkEl.href.split('?')[0];
  let name   = linkEl.querySelector('.Nv2PK')?.textContent?.trim() || '';
  if (!name) {
    const label = linkEl.getAttribute('aria-label') || '';
    if (label && !/(^結果|について$|のルート|^地図|口コミ$)/.test(label)) name = label.trim();
  }
  if (!name) name = extractNameFromUrl(url);
  return { url, name };
}

// =====================================================================
// メインループ
// =====================================================================
let isScrapingActive = false;

async function startScraping(maxItems) {
  isScrapingActive = true;
  await sleep(500);

  if (isDetailPanelOpen()) {
    await closeDetailPanel();
    await waitForListPanel(4000);
  }

  const container = getScrollContainer();
  if (!container) {
    console.error('[Scraper] コンテナが見つかりません');
    await reportState('done');
    return;
  }
  console.log('[Scraper] 開始 | コンテナ:', container.className.slice(0, 50), '| links:', container.querySelectorAll('a[href*="/maps/place/"]').length);

  const processedUrls = new Set();
  let noNewCount = 0;
  const MAX_NO_NEW = 6;
  let totalProcessed = 0;
  const startTime = Date.now();

  while (isScrapingActive) {
    if (isDetailPanelOpen()) {
      await closeDetailPanel();
      await waitForListPanel(5000);
      continue; // 固定待機なしですぐ次へ
    }

    const allLinks = Array.from(container.querySelectorAll('a[href*="/maps/place/"]'));
    const newLinks  = allLinks.filter(a => {
      const url = a.href.split('?')[0];
      return url && !processedUrls.has(url);
    });

    if (!newLinks.length) {
      noNewCount++;
      if (noNewCount >= MAX_NO_NEW) break;
      container.scrollBy({ top: 600, behavior: 'smooth' });
      await backgroundSleep(1000); // 1800ms → 1000ms
      continue;
    }

    noNewCount = 0;

    for (const linkEl of newLinks) {
      if (!isScrapingActive) break;
      if (processedUrls.size >= maxItems) { isScrapingActive = false; break; }

      const { url, name: cardName } = extractCardInfo(linkEl);
      if (!url || processedUrls.has(url)) continue;
      processedUrls.add(url);

      try {
        linkEl.click();
        // 固定待機なし → waitForDetailPanelのポーリングで判定
        const panelReady = await waitForDetailPanel(8000);
        if (!panelReady) {
          console.warn('[Scraper] パネルが開かなかった:', cardName);
          await closeDetailPanel();
          await waitForListPanel(4000);
          continue;
        }

        const detail = await scrapeDetailPanel(url);

        if (!detail.phone) {
          console.log('[Scraper] TELなし → スキップ:', detail.name);
          await closeDetailPanel();
          await waitForListPanel(4000);
          continue;
        }

        const record = {
          name:           detail.name,
          genre:          detail.genre,
          address:        detail.address,
          phone:          detail.phone,
          regularHoliday: detail.regularHoliday,
          businessDays:   detail.businessDays,
          openTime:       detail.openTime,
          closeTime:      detail.closeTime,
          url,
          source:         'googlemaps'
        };

        totalProcessed++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const perItem = totalProcessed > 0 ? (elapsed / totalProcessed).toFixed(1) : '-';
        console.log(`[Scraper] ✓ ${record.name} | TEL:${record.phone} | 営業:${record.openTime}-${record.closeTime} | 定休:${record.regularHoliday} | ${totalProcessed}件目 ${perItem}秒/件`);

        await new Promise(res => chrome.runtime.sendMessage({ action: 'updateData', data: [record] }, () => res()));
        chrome.runtime.sendMessage({ action: 'progress', count: processedUrls.size }).catch(() => {});

        await closeDetailPanel();
        await waitForListPanel(5000);
        // 固定待機なし → すぐ次へ

      } catch (err) {
        console.error('[Scraper] エラー:', err);
        await closeDetailPanel();
        await sleep(500);
      }
    }

    container.scrollBy({ top: 600, behavior: 'smooth' });
    await backgroundSleep(1000); // 1800ms → 1000ms
  }

  console.log(`[Scraper] 完了 | 合計${totalProcessed}件 | ${((Date.now()-startTime)/1000).toFixed(0)}秒`);
  await reportState('done');
}

async function reportState(state) {
  return new Promise(r => chrome.runtime.sendMessage({ action: 'setState', state }, () => r()));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') { sendResponse({ alive: true }); return false; }
  if (request.action === 'getQuery') { sendResponse({ query: getCurrentQuery() }); return false; }

  if (request.action === 'startScraping') {
    if (isScrapingActive) { sendResponse({ success: false, reason: 'already running' }); return false; }
    startScraping(request.maxItems || 50).catch(err => {
      console.error('[Scraper] 致命的エラー:', err);
      reportState('done');
    });
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'stopScraping') {
    isScrapingActive = false;
    reportState('done');
    sendResponse({ success: true });
    return false;
  }

  return false;
});