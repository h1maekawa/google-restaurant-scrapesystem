// content.js (全面的な最適化アップデート)

let isScraping = false;
let maxItemsLimit = 50;
let targetGenresList = [];
let collectedUrls = new Set();
let filterConfig = null;

// Initialize collectedUrls from storage
chrome.storage.local.get(['scrapedData'], (result) => {
  if (result.scrapedData) {
    result.scrapedData.forEach(item => collectedUrls.add(item.url));
  }
});

// ─── 【重要修正】バックグラウンドでも絶対にスロットリングされないsleep関数 ───
const sleep = (ms) => new Promise(resolve => {
  chrome.runtime.sendMessage({ action: 'backgroundSleep', ms: ms }, () => {
    resolve();
  });
});

// ─── 【新規追加】要素がロードされるまで動的に待機する関数（高速化の要） ───
async function waitForElement(selector, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (document.querySelector(selector)) {
      return true; // 要素が見つかったら即座に終了して次へ
    }
    await sleep(40); // 40msごとに高速チェック
  }
  return false;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    isScraping = true;
    maxItemsLimit = request.maxItems || 50;
    targetGenresList = request.targetGenres || [];
    filterConfig = request.filterConfig || null;
    startScrapingLoop();
    sendResponse({ status: 'started' });
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'getQuery') {
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
        try { query = decodeURIComponent(urlMatch[1].replace(/\+/g, ' ')); } catch (e) {}
      }
    }
    if (!query) {
      const titleMatch = document.title.match(/^(.*?) - Google/);
      if (titleMatch && !window.location.href.includes('/maps/place/')) {
        query = titleMatch[1];
      }
    }
    sendResponse({ query: query });
  } else if (request.action === 'getMapCenter') {
    const url = window.location.href;
    const match = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
    if (match) {
      sendResponse({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
    } else {
      sendResponse({ error: '座標が見つかりませんでした。' });
    }
  } else if (request.action === 'getGenresFromPage') {
    const genres = new Set();
    document.querySelectorAll('.DkEaL').forEach(el => {
      const text = el.innerText.trim();
      if (text) genres.add(text);
    });
    document.querySelectorAll('button[jsaction*="category"]').forEach(btn => {
      const text = btn.innerText.trim();
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
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractCoordsFromUrl(url) {
  const matchD = url.match(/!3d([-+]?\d+\.\d+)!4d([-+]?\d+\.\d+)/);
  if (matchD) return { lat: parseFloat(matchD[1]), lng: parseFloat(matchD[2]) };
  const matchAt = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (matchAt) return { lat: parseFloat(matchAt[1]), lng: parseFloat(matchAt[2]) };
  return null;
}

async function startScrapingLoop() {
  let scrollContainer = document.querySelector('div[role="feed"]');
  if (!scrollContainer) {
    const possibleContainers = Array.from(document.querySelectorAll('div')).filter(div => {
      const style = window.getComputedStyle(div);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    });
    possibleContainers.sort((a, b) => b.clientHeight - a.clientHeight);
    if (possibleContainers.length > 0) scrollContainer = possibleContainers[0];
  }

  if (!scrollContainer) {
    alert("リストのスクロールコンテナが見つかりません。");
    chrome.runtime.sendMessage({ action: 'setState', state: 'inactive' });
    return;
  }

  let noNewElementsCount = 0;
  // バックグラウンドでのスクロール遅延・スロットリングを考慮し、10分間（300回×2秒）まで粘るように設定
  const maxNoNewElements = 300; 

  while (isScraping && collectedUrls.size < maxItemsLimit) {
    const feedText = scrollContainer.innerText || "";
    if (
      feedText.includes("リストの最後に到達しました") || 
      feedText.includes("これ以上結果はありません") || 
      feedText.includes("You've reached the end of the list") ||
      feedText.includes("No more results")
    ) {
      console.log("End of list reached detected. Stopping.");
      break;
    }

    const placeLinks = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place/"], a[href^="https://www.google.co.jp/maps/place/"]'));
    const newLinks = placeLinks.filter(a => !collectedUrls.has(a.href));

    if (newLinks.length > 0) {
      noNewElementsCount = 0;
      for (const link of newLinks) {
        if (!isScraping || collectedUrls.size >= maxItemsLimit) break;

        try {
          // バックグラウンド時はauto（即時）で描画負荷を最小に
          link.scrollIntoView({ behavior: 'auto', block: 'center' });
          await sleep(150); // 高速化のため400msから150msに短縮

          const url = link.href;
          const name = link.getAttribute('aria-label') || link.innerText || "";

          link.click();

          // ─── 【高速化の核心】詳細パネルがロードされるまで動的待機（2000ms固定を廃止） ───
          await waitForElement('.DkEaL, button[data-item-id="address"]', 2000);

          const extractedData = await extractDetailData();
          let coords = extractCoordsFromUrl(url) || extractCoordsFromUrl(window.location.href);

          const placeData = {
            url, name,
            genre: extractedData.genre || "",
            rating: extractedData.rating || "",
            reviews: extractedData.reviews || "",
            address: extractedData.address || "",
            phone: extractedData.phone || "",
            businessHours: extractedData.businessHours || "",
            regularHoliday: extractedData.regularHoliday || "年中無休",
            openingHoursDetails: extractedData.openingHoursDetails || "",
            lat: coords ? coords.lat : null,
            lng: coords ? coords.lng : null,
            source: 'googlemaps'
          };

          if (targetGenresList.length > 0) {
            const matches = targetGenresList.some(g => placeData.genre.includes(g));
            if (!matches) {
              collectedUrls.add(url);
              continue;
            }
          }

          if (filterConfig && filterConfig.enabled && filterConfig.centerLat != null) {
            const dist = haversineDistance(filterConfig.centerLat, filterConfig.centerLng, placeData.lat, placeData.lng);
            placeData.distanceMeters = Math.round(dist);
            if (dist > filterConfig.radiusMeters) {
              collectedUrls.add(url);
              continue;
            }
          }

          collectedUrls.add(url);

          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'updateData', data: [placeData] }, resolve);
          });

        } catch (err) {
          console.error("Error processing place:", err);
        }
      }
    } else {
      noNewElementsCount++;
      
      // バックグラウンドでのスクロール読み込み漏れ・停止を防ぐための揺すりロジック
      if (noNewElementsCount >= 20) { // 20回（約40秒）新しい要素が出なければ、念のため「揺すり」を入れる
        scrollContainer.scrollTop = scrollContainer.scrollTop - 200; // 一度少し上に戻す
        await sleep(300);
        scrollContainer.scrollTop = scrollContainer.scrollHeight; // 再度一番下へ
        await sleep(1500);
        
        // 再チェックして本当に新要素がなければ、maxNoNewElementsまで待つか判断
        const reLinks = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place/"], a[href^="https://www.google.co.jp/maps/place/"]'));
        if (reLinks.filter(a => !collectedUrls.has(a.href)).length > 0) {
          noNewElementsCount = 0;
          continue;
        }
      }

      if (noNewElementsCount >= maxNoNewElements) {
        console.log("No new elements found. Stopping.");
        break;
      }

      // 強制スクロールダウン
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(2000); // 新しい店舗リストの読み込み待機
    }
  }

  chrome.runtime.sendMessage({ action: 'setState', state: 'done' });
  isScraping = false;
}

async function extractDetailData() {
  const data = { genre: "", rating: "", reviews: "", address: "", phone: "", businessHours: "", regularHoliday: "年中無休", openingHoursDetails: "" };

  const genreEl = document.querySelector('.DkEaL');
  data.genre = genreEl ? genreEl.innerText.trim() : (document.querySelector('button[jsaction*="category"]')?.innerText.trim() || "");

  const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
  if (phoneBtn) {
    const ariaLabel = phoneBtn.getAttribute('aria-label');
    data.phone = (ariaLabel && ariaLabel.includes("電話番号: ")) ? ariaLabel.replace("電話番号: ", "").trim() : (phoneBtn.innerText.match(/[\d\-]{10,13}/)?.[0] || "");
  }

  const addressBtn = document.querySelector('button[data-item-id="address"]');
  if (addressBtn) {
    const ariaLabel = addressBtn.getAttribute('aria-label');
    data.address = (ariaLabel && ariaLabel.includes("住所: ")) ? ariaLabel.replace("住所: ", "").trim() : addressBtn.innerText.trim();
  }

  const starElements = document.querySelectorAll('[aria-label*="星 "], [aria-label*="stars"]');
  for (const el of starElements) {
    const label = el.getAttribute('aria-label');
    if (label.includes("レビュー") || label.includes("reviews")) {
      data.rating = label.match(/星\s*([\d\.]+)/)?.[1] || label.match(/([\d\.]+)\s*stars/)?.[1] || "";
      data.reviews = label.match(/レビュー\s*([\d,]+)\s*件/)?.[1].replace(/,/g, '') || label.match(/([\d,]+)\s*reviews/)?.[1].replace(/,/g, '') || "";
      break;
    }
  }

  let ohBtn = document.querySelector('[aria-label="1 週間の営業時間を表示"], [aria-label*="営業時間を表示"], [aria-label*="営業時間を非表示"], button[data-item-id="oh"]');
  if (ohBtn) {
    const ariaLabel = ohBtn.getAttribute('aria-label') || '';
    data.businessHours = ariaLabel ? ariaLabel.replace(/^営業時間:\s*/, '').replace(/^Hours:\s*/, '').replace(/[。.]\s*営業時間情報を編集.*$/, '').replace(/[。.]\s*Edit business hours.*$/, '').trim() : ohBtn.innerText.trim();

    const isAlreadyExpanded = ariaLabel.includes('非表示') || ariaLabel.includes('Hide') || ariaLabel.includes('営業時間を非表示');
    if (!isAlreadyExpanded) {
      try { ohBtn.click(); } catch (e) {}
      
      // ─── 【高速化】営業時間のトグル展開を動的に高速待機（500ms固定を廃止） ───
      const startClick = Date.now();
      while (Date.now() - startClick < 500) {
        const hasDays = Array.from(document.querySelectorAll('tr, li, div')).some(el => {
          const t = el.innerText || '';
          return t.includes('月曜日') || t.includes('Monday');
        });
        if (hasDays) break;
        await sleep(30);
      }
    }

    const daysJp = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
    const daysEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const daysShort = ['月', '火', '水', '木', '金', '土', '日'];
    const schedule = {};
    
    const candidates = document.querySelectorAll('tr, li, div');
    for (const el of candidates) {
      if (el.children.length > 5) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length > 80) continue;

      for (let i = 0; i < 7; i++) {
        if (text.includes(daysJp[i]) || text.includes(daysEn[i])) {
          const cleanText = text.replace(/\s+/g, ' ').trim();
          if (/[\d：:~～-]|定休|閉|Open|Close/i.test(cleanText)) {
            if (!schedule[daysJp[i]] || cleanText.length < schedule[daysJp[i]].length) {
              schedule[daysJp[i]] = cleanText;
            }
          }
        }
      }
    }

    const holidayDays = [];
    const scheduleByShortDay = {};

    for (let i = 0; i < 7; i++) {
      const fullDay = daysJp[i];
      const shortDay = daysShort[i];
      const dayInfo = schedule[fullDay];

      if (dayInfo) {
        let timeText = dayInfo.replace(fullDay, '').replace(new RegExp(daysEn[i], 'i'), '').replace(/[\uE000-\uF8FF]/g, '').replace(//g, '').trim();
        timeText = timeText.replace(/(\d{1,2})時(\d{2})分/g, '$1:$2').replace(/(\d{1,2})時/g, '$1:00').replace(/[～-]/g, '〜');

        if (timeText.includes('定休日') || timeText.includes('Closed') || timeText.includes('定休')) {
          holidayDays.push(fullDay);
          scheduleByShortDay[shortDay] = '定休日';
        } else {
          scheduleByShortDay[shortDay] = timeText;
        }
      }
    }

    if (holidayDays.length > 0) data.regularHoliday = holidayDays.join(', ');

    const groups = [];
    let currentGroup = null;

    for (const shortDay of daysShort) {
      const text = scheduleByShortDay[shortDay];
      if (!text) {
        if (currentGroup) { groups.push(currentGroup); currentGroup = null; }
        continue;
      }
      if (!currentGroup) {
        currentGroup = { startDay: shortDay, endDay: shortDay, text: text };
      } else {
        if (currentGroup.text === text) { currentGroup.endDay = shortDay; } else { groups.push(currentGroup); currentGroup = { startDay: shortDay, endDay: shortDay, text: text }; }
      }
    }
    if (currentGroup) groups.push(currentGroup);

    if (groups.length > 0) {
      data.openingHoursDetails = groups.map(g => g.startDay === g.endDay ? `${g.startDay}: ${g.text}` : `${g.startDay}〜${g.endDay}: ${g.text}`).join(', ');
    }
  }

  if (!data.address) {
    const addressMatch = document.body.innerText.match(/(?:東京都|北海道|(?:京都|大阪)府|[^\s]{2,3}県)[^\s]+(?:市|区|町|村)[^\s\n]+/);
    if (addressMatch) data.address = addressMatch[0];
  }
  if (!data.phone) {
    const phoneMatch = document.body.innerText.match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
    if (phoneMatch) data.phone = phoneMatch[0];
  }

  return data;
}