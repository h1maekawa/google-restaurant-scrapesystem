// content.js

let isScraping = false;
let maxItemsLimit = 50;
let targetGenresList = [];
let collectedUrls = new Set();

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
    startScrapingLoop();
    sendResponse({ status: 'started' });
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'getQuery') {
    const searchBox = document.getElementById('searchboxinput');
    sendResponse({ query: searchBox ? searchBox.value : '' });
  } else if (request.action === 'getMapCenter') {
    // URLから現在の中心座標を抽出 (@lat,lng,zoom)
    const url = window.location.href;
    const match = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
    if (match) {
      sendResponse({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
    } else {
      sendResponse({ error: '座標が見つかりませんでした。Googleマップの検索結果が表示されているか確認してください。' });
    }
  } else if (request.action === 'ping') {
    sendResponse({ status: 'alive' });
  }
  return true;
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

          const extractedData = extractDetailData();
          
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
            lat: coords ? coords.lat : null,
            lng: coords ? coords.lng : null,
            source: 'googlemaps'
          };

          // Filter by genre if list is provided
          if (targetGenresList.length > 0) {
            const matches = targetGenresList.some(g => placeData.genre.includes(g));
            if (!matches) {
              console.log(`Skipping ${placeData.name} - genre "${placeData.genre}" does not match target list.`);
              collectedUrls.add(url); // Don't process again
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

function extractDetailData() {
  const data = {
    genre: "",
    rating: "",
    reviews: "",
    address: "",
    phone: ""
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
