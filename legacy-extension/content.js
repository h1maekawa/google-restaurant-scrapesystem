// content.js

let isScraping = false;
let maxItemsLimit = 50;
let targetGenresList = [];
let collectedUrls = new Set();
let filterConfig = null; // { enabled, centerLat, centerLng, radiusMeters }

// Initialize collectedUrls from storage
chrome.storage.local.get(['scrapedData'], (result) => {
  if (result.scrapedData) {
    result.scrapedData.forEach(item => collectedUrls.add(item.url));
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    isScraping = true;
    maxItemsLimit = request.maxItems || 50;
    targetGenresList = request.targetGenres || [];
    filterConfig = request.filterConfig || null; // ← 追加
    startScrapingLoop();
    sendResponse({ status: 'started' });
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'getQuery') {
    let query = '';
    
    // 1. name="q" の検索ボックス
    const inputQ = document.querySelector('input[name="q"]');
    if (inputQ && inputQ.value) query = inputQ.value;

    // 2. id="searchboxinput" の検索ボックス
    if (!query) {
      const searchBox = document.getElementById('searchboxinput');
      if (searchBox && searchBox.value) query = searchBox.value;
    }
    
    // 3. URLからの抽出 (例: /maps/search/八潮市+お好み焼き/)
    if (!query) {
      const urlMatch = window.location.href.match(/\/maps\/search\/([^\/]+)/);
      if (urlMatch) {
        try {
          query = decodeURIComponent(urlMatch[1].replace(/\+/g, ' '));
        } catch (e) {}
      }
    }

    // 4. タイトルからのフォールバック (店舗詳細ページの場合は避ける)
    if (!query) {
      const titleMatch = document.title.match(/^(.*?) - Google/);
      if (titleMatch) {
        // 店舗詳細だと URLが /maps/place/ になっていることが多い
        if (!window.location.href.includes('/maps/place/')) {
          query = titleMatch[1];
        }
      }
    }
    sendResponse({ query: query });
  } else if (request.action === 'getMapCenter') {
    // URLから現在の中心座標を抽出 (@lat,lng,zoom)
    const url = window.location.href;
    const match = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
    if (match) {
      sendResponse({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
    } else {
      sendResponse({ error: '座標が見つかりませんでした。Googleマップの検索結果が表示されているか確認してください。' });
    }
  } else if (request.action === 'getGenresFromPage') {
    const genres = new Set();
    // 検索結果リストからジャンルを抽出
    const genreElements = document.querySelectorAll('.DkEaL');
    genreElements.forEach(el => {
      const text = el.innerText.trim();
      if (text) genres.add(text);
    });
    // 詳細パネルやカテゴリボタンからも抽出を試みる
    const categoryBtns = document.querySelectorAll('button[jsaction*="category"]');
    categoryBtns.forEach(btn => {
      const text = btn.innerText.trim();
      if (text) genres.add(text);
    });
    sendResponse({ genres: Array.from(genres) });
  } else if (request.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
  return true;
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Haversine formula で2点間の距離(メートル)を計算
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
  // 1. !3d...!4d... 形式 (詳細URLに含まれることが多い)
  const matchD = url.match(/!3d([-+]?\d+\.\d+)!4d([-+]?\d+\.\d+)/);
  if (matchD) {
    return { lat: parseFloat(matchD[1]), lng: parseFloat(matchD[2]) };
  }
  // 2. @lat,lng 形式 (ブラウザのURLに含まれる)
  const matchAt = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (matchAt) {
    return { lat: parseFloat(matchAt[1]), lng: parseFloat(matchAt[2]) };
  }
  return null;
}

async function startScrapingLoop() {
  let scrollContainer = document.querySelector('div[role="feed"]');
  if (!scrollContainer) {
    // If not found by role, try finding the common scrollable container
    const possibleContainers = Array.from(document.querySelectorAll('div')).filter(div => {
      const style = window.getComputedStyle(div);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    });
    // Sort by height to find the main feed
    possibleContainers.sort((a, b) => b.clientHeight - a.clientHeight);
    if (possibleContainers.length > 0) {
      scrollContainer = possibleContainers[0];
    }
  }

  if (!scrollContainer) {
    alert("リストのスクロールコンテナが見つかりません。Googleマップの検索結果画面を開いているか確認してください。");
    chrome.runtime.sendMessage({ action: 'setState', state: 'inactive' });
    return;
  }

  let noNewElementsCount = 0;
  const maxNoNewElements = 5; // 5回スクロールしても新しい要素が出なければ終了

  while (isScraping && collectedUrls.size < maxItemsLimit) {
    // Find all place links
    const placeLinks = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place/"], a[href^="https://www.google.co.jp/maps/place/"]'));

    // Filter unprocessed links
    const newLinks = placeLinks.filter(a => !collectedUrls.has(a.href));

    if (newLinks.length > 0) {
      noNewElementsCount = 0;
      for (const link of newLinks) {
        if (!isScraping || collectedUrls.size >= maxItemsLimit) break;

        try {
          // Scroll to the element to ensure it's loaded
          link.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(500);

          const url = link.href;
          const name = link.getAttribute('aria-label') || link.innerText || "";

          // Click to open details panel
          link.click();

          // Wait for detail panel to load
          await sleep(2000);

          const extractedData = await extractDetailData();

          // URLまたは現在のウィンドウURLから座標を抽出
          let coords = extractCoordsFromUrl(url) || extractCoordsFromUrl(window.location.href);

          const placeData = {
            url: url,
            name: name,
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

          // ── ジャンルフィルター ──────────────────────────────
          if (targetGenresList.length > 0) {
            const matches = targetGenresList.some(g => placeData.genre.includes(g));
            if (!matches) {
              console.log(`Skipping ${placeData.name} - genre "${placeData.genre}" does not match target list.`);
              collectedUrls.add(url); // 再処理しない
              continue;
            }
          }

          // ── 半径フィルター (Haversine) ──────────────────────
          if (filterConfig && filterConfig.enabled && filterConfig.centerLat != null) {
            const dist = haversineDistance(
              filterConfig.centerLat, filterConfig.centerLng,
              placeData.lat, placeData.lng
            );
            placeData.distanceMeters = Math.round(dist); // 距離を付与（CSV出力・デバッグ用）
            if (dist > filterConfig.radiusMeters) {
              console.log(`Skipping ${placeData.name} - distance ${Math.round(dist)}m > ${filterConfig.radiusMeters}m`);
              collectedUrls.add(url); // 再処理しない
              continue;
            }
          }

          collectedUrls.add(url);

          // Send to background to save
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'updateData', data: [placeData] }, (response) => {
              resolve(response);
            });
          });

        } catch (err) {
          console.error("Error processing place:", err);
        }
      }
    } else {
      // Check for "You've reached the end of the list" or similar text
      const feedText = scrollContainer.innerText;
      if (feedText.includes("これ以上結果はありません") || feedText.includes("You've reached the end of the list")) {
        console.log("End of list reached.");
        break;
      }

      noNewElementsCount++;
      if (noNewElementsCount >= maxNoNewElements) {
        console.log("No new elements found after multiple scrolls. Stopping.");
        break;
      }

      // Scroll down
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      await sleep(2000); // Wait for new elements to load
    }
  }

  // Done
  chrome.runtime.sendMessage({ action: 'setState', state: 'done' });
  isScraping = false;
}

async function extractDetailData() {
  const data = {
    genre: "",
    rating: "",
    reviews: "",
    address: "",
    phone: "",
    businessHours: "",
    regularHoliday: "年中無休",
    openingHoursDetails: ""
  };

  // 0. Genre (Category)
  // The user suggested class "DkEaL"
  const genreEl = document.querySelector('.DkEaL');
  if (genreEl) {
    data.genre = genreEl.innerText.trim();
  } else {
    // Alternative: look for the button with category information
    const categoryBtn = document.querySelector('button[jsaction*="category"]');
    if (categoryBtn) {
      data.genre = categoryBtn.innerText.trim();
    }
  }

  // Find all buttons in the detail panel

  // 1. Phone
  // Often buttons have data-item-id="phone:tel:..." or aria-label containing phone number
  const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
  if (phoneBtn) {
    const ariaLabel = phoneBtn.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.includes("電話番号: ")) {
      data.phone = ariaLabel.replace("電話番号: ", "").trim();
    } else {
      // fallback to text content
      const textMatch = phoneBtn.innerText.match(/[\d\-]{10,13}/);
      if (textMatch) data.phone = textMatch[0];
    }
  }

  // 2. Address
  const addressBtn = document.querySelector('button[data-item-id="address"]');
  if (addressBtn) {
    const ariaLabel = addressBtn.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.includes("住所: ")) {
      data.address = ariaLabel.replace("住所: ", "").trim();
    } else {
      data.address = addressBtn.innerText.trim();
    }
  }

  // 3. Rating & Reviews
  // Look for elements with aria-label like "星 4.5、レビュー 120 件"
  const starElements = document.querySelectorAll('[aria-label*="星 "], [aria-label*="stars"]');
  for (const el of starElements) {
    const label = el.getAttribute('aria-label');
    if (label.includes("レビュー") || label.includes("reviews")) {
      const ratingMatch = label.match(/星\s*([\d\.]+)/) || label.match(/([\d\.]+)\s*stars/);
      if (ratingMatch) data.rating = ratingMatch[1];

      const reviewMatch = label.match(/レビュー\s*([\d,]+)\s*件/) || label.match(/([\d,]+)\s*reviews/);
      if (reviewMatch) data.reviews = reviewMatch[1].replace(/,/g, '');
      break;
    }
  }

  // 4. Business Hours
  let ohBtn = document.querySelector(
    '[aria-label="1 週間の営業時間を表示"], [aria-label*="営業時間を表示"], [aria-label*="営業時間を非表示"], button[data-item-id="oh"]'
  );

  if (ohBtn) {
    const ariaLabel = ohBtn.getAttribute('aria-label') || '';
    if (ariaLabel) {
      let cleanLabel = ariaLabel
        .replace(/^営業時間:\s*/, '')
        .replace(/^Hours:\s*/, '')
        .replace(/[。.]\s*営業時間情報を編集.*$/, '')
        .replace(/[。.]\s*Edit business hours.*$/, '')
        .trim();
      data.businessHours = cleanLabel;
    }
    if (!data.businessHours) {
      data.businessHours = ohBtn.innerText.trim();
    }

    // 定休日・詳細営業時間の抽出
    const isAlreadyExpanded = ariaLabel.includes('非表示') || ariaLabel.includes('Hide') || ariaLabel.includes('営業時間を非表示');
    if (!isAlreadyExpanded) {
      try {
        ohBtn.click();
      } catch (e) {}
      try {
        ohBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      } catch (e) {}
      
      // 500msスリープして展開を確実に待つ
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const daysJp = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
    const daysEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const daysShort = ['月', '火', '水', '木', '金', '土', '日'];

    const schedule = {};
    
    // 全ての tr, li, div 要素を走査して最も具体的な行情報を取得
    const candidates = document.querySelectorAll('tr, li, div');
    for (const el of candidates) {
      if (el.children.length > 5) continue; // 親すぎるコンテナを無視
      
      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length > 80) continue; // 長すぎるものはコンテナなので無視

      for (let i = 0; i < 7; i++) {
        const jp = daysJp[i];
        const en = daysEn[i];
        if (text.includes(jp) || text.includes(en)) {
          const cleanText = text.replace(/\s+/g, ' ').trim();
          // 有効な行であるか判定（数値、コロン、チルダ、定休・閉など）
          const isValidRow = /[\d：:~～-]|定休|閉|Open|Close/i.test(cleanText);
          if (isValidRow) {
            if (!schedule[jp] || cleanText.length < schedule[jp].length) {
              schedule[jp] = cleanText;
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
        let timeText = dayInfo
          .replace(fullDay, '')
          .replace(new RegExp(daysEn[i], 'i'), '')
          .replace(/[\uE000-\uF8FF]/g, '') // 特殊文字（コピーアイコン等）を除去
          .replace(//g, '')
          .trim();

        // 11時00分～17時00分 などの表記を 11:00〜17:00 に統一して人間に見やすくする
        timeText = timeText.replace(/(\d{1,2})時(\d{2})分/g, '$1:$2');
        timeText = timeText.replace(/(\d{1,2})時/g, '$1:00');
        timeText = timeText.replace(/[～-]/g, '〜');

        if (timeText.includes('定休日') || timeText.includes('Closed') || timeText.includes('定休')) {
          holidayDays.push(fullDay);
          scheduleByShortDay[shortDay] = '定休日';
        } else {
          scheduleByShortDay[shortDay] = timeText;
        }
      }
    }

    if (holidayDays.length > 0) {
      data.regularHoliday = holidayDays.join(', ');
    }

    // 曜日をグループ化してわかりやすくする（例：月〜金: 11:30~19:00）
    const groups = [];
    let currentGroup = null;

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
      data.openingHoursDetails = groups.map(g => {
        if (g.startDay === g.endDay) {
          return `${g.startDay}: ${g.text}`;
        } else {
          return `${g.startDay}〜${g.endDay}: ${g.text}`;
        }
      }).join(', ');
    }

  } else {
    const altOh = document.querySelector('[aria-label*="営業時間"], [data-tooltip*="営業時間"]');
    if (altOh) {
      const label = altOh.getAttribute('aria-label') || altOh.getAttribute('data-tooltip') || '';
      data.businessHours = label
        .replace(/^営業時間:\s*/, '')
        .replace(/^Hours:\s*/, '')
        .replace(/[。.]\s*営業時間情報を編集.*$/, '')
        .trim();
    }
  }

  // Fallback: If address not found by button, try text matching on common address patterns
  if (!data.address) {
    const bodyText = document.body.innerText;
    // Japanese address format: prefecture + city
    const addressMatch = bodyText.match(/(?:東京都|北海道|(?:京都|大阪)府|[^\s]{2,3}県)[^\s]+(?:市|区|町|村)[^\s\n]+/);
    if (addressMatch) {
      data.address = addressMatch[0];
    }
  }

  if (!data.phone) {
    // try finding standard phone format not in a button
    const bodyText = document.body.innerText;
    const phoneMatch = bodyText.match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
    if (phoneMatch) {
      data.phone = phoneMatch[0];
    }
  }

  return data;
}