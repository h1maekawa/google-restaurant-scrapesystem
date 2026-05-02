// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const maxItemsSlider = document.getElementById('max-items');
  const maxItemsVal = document.getElementById('max-items-val');
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnReset = document.getElementById('btn-reset');
  const btnDownload = document.getElementById('btn-download');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const countDisplay = document.getElementById('count-display');
  const previewBody = document.getElementById('preview-body');
  
  // New UI Elements
  const filterEnabled = document.getElementById('filter-enabled');
  const filterSettings = document.getElementById('filter-settings');
  const filterRadius = document.getElementById('filter-radius');
  const btnGetCenter = document.getElementById('btn-get-center');
  const displayCoords = document.getElementById('display-coords');

  let centerPoint = null; // {lat, lng}

  // Initialize UI from storage
  chrome.storage.local.get(['scrapingState', 'scrapedData', 'maxItems', 'filterConfig'], (result) => {
    if (result.maxItems) {
      maxItemsSlider.value = result.maxItems;
      updateMaxItemsText(result.maxItems);
    }
    
    if (result.filterConfig) {
      filterEnabled.checked = result.filterConfig.enabled;
      filterRadius.value = result.filterConfig.radius || 1000;
      centerPoint = result.filterConfig.center;
      if (centerPoint) {
        displayCoords.textContent = `${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)}`;
      }
      toggleFilterUI(result.filterConfig.enabled);
    } else {
      toggleFilterUI(false);
    }

    updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
  });

  // Slider change
  maxItemsSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    updateMaxItemsText(val);
    chrome.storage.local.set({ maxItems: parseInt(val, 10) });
  });

  function updateMaxItemsText(val) {
    if (val == 500) {
      maxItemsVal.textContent = '上限なし';
    } else {
      maxItemsVal.textContent = val;
    }
  }

  // Filter Event Listeners
  filterEnabled.addEventListener('change', (e) => {
    toggleFilterUI(e.target.checked);
    saveFilterConfig();
    refreshUI();
  });

  filterRadius.addEventListener('change', () => {
    saveFilterConfig();
    refreshUI();
  });

  btnGetCenter.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: 'getMapCenter' }, (response) => {
      if (response && response.lat && response.lng) {
        centerPoint = { lat: response.lat, lng: response.lng };
        displayCoords.textContent = `${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)}`;
        saveFilterConfig();
        refreshUI();
      } else if (response && response.error) {
        alert(response.error);
      }
    });
  });

  function toggleFilterUI(enabled) {
    if (enabled) {
      filterSettings.classList.remove('disabled');
    } else {
      filterSettings.classList.add('disabled');
    }
  }

  function saveFilterConfig() {
    chrome.storage.local.set({
      filterConfig: {
        enabled: filterEnabled.checked,
        radius: parseInt(filterRadius.value, 10),
        center: centerPoint
      }
    });
  }

  function refreshUI() {
    chrome.storage.local.get(['scrapingState', 'scrapedData'], (result) => {
      updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
    });
  }

  // Distance calculation (Haversine formula)
  function getDistance(lat1, lng1, lat2, lng2) {
    if (!lat1 || !lng1 || !lat2 || !lng2) return Infinity;
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Update UI State
  function updateUI(state, data) {
    const count = data.length;
    let displayCount = count;
    let filteredData = data;

    // Apply Filter if enabled
    if (filterEnabled.checked && centerPoint) {
      const radius = parseInt(filterRadius.value, 10);
      filteredData = data.filter(item => {
        if (!item.lat || !item.lng) return false;
        const dist = getDistance(centerPoint.lat, centerPoint.lng, item.lat, item.lng);
        return dist <= radius;
      });
      displayCount = filteredData.length;
      countDisplay.innerHTML = `${displayCount} <span style="font-size: 0.8em; color: #666;">/ 全体 ${count}</span>`;
    } else {
      countDisplay.textContent = count;
    }
    
    // Update preview table (last 5 items from filtered set if possible, otherwise last 5 from all)
    previewBody.innerHTML = '';
    const previewItems = filteredData.slice(-5).reverse();
    previewItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td title="${item.name}">${item.name || '-'}</td>
        <td>${item.rating || '-'}</td>
        <td>${item.phone || '-'}</td>
      `;
      previewBody.appendChild(tr);
    });

    if (state === 'active') {
      statusIndicator.className = 'indicator active';
      statusText.textContent = `リストを自動スクロール中... ${count}件取得済み`;
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnDownload.disabled = displayCount === 0;
    } else if (state === 'done') {
      statusIndicator.className = 'indicator done';
      statusText.textContent = `抽出完了: 合計 ${count}件取得しました`;
      btnStart.disabled = false;
      btnStart.textContent = '▶ 再開・追加取得';
      btnStop.disabled = true;
      btnDownload.disabled = displayCount === 0;
    } else {
      // inactive
      statusIndicator.className = 'indicator inactive';
      statusText.textContent = count > 0 ? `停止中: ${count}件保持` : 'Googleマップの検索結果ページを開いてください';
      btnStart.disabled = false;
      btnStart.textContent = count > 0 ? '▶ 再開・追加取得' : '▶ 取得開始';
      btnStop.disabled = true;
      btnDownload.disabled = displayCount === 0;
    }
  }

  // Check if current tab is Google Maps
  async function getCurrentTab() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // Start Button
  btnStart.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab || (!tab.url.includes('google.com/maps') && !tab.url.includes('google.co.jp/maps'))) {
      alert('Googleマップの検索結果ページを開いてから実行してください。');
      return;
    }

    const maxItems = maxItemsSlider.value == 500 ? 999999 : parseInt(maxItemsSlider.value, 10);
    
    // Clear data if starting a fresh session
    chrome.storage.local.get(['scrapedData'], (result) => {
      const currentData = result.scrapedData || [];
      if (currentData.length > 0) {
        if (confirm('既存のデータをクリアして新しく開始しますか？\n（「キャンセル」で既存データに追加取得します）')) {
          chrome.storage.local.set({ scrapedData: [] }, () => {
            startScraping(tab, maxItems);
          });
          return;
        }
      }
      startScraping(tab, maxItems);
    });
  });

  function startScraping(tab, maxItems) {
    chrome.storage.local.set({ scrapingState: 'active' }, () => {
      chrome.tabs.sendMessage(tab.id, { action: 'startScraping', maxItems: maxItems }, (response) => {
        if (chrome.runtime.lastError) {
          alert('ページの再読み込みが必要です。ページをリロードしてからお試しください。');
          chrome.storage.local.set({ scrapingState: 'inactive' });
        }
      });
    });
  }

  // Reset Button
  btnReset.addEventListener('click', () => {
    if (confirm('取得済みのデータをすべて削除しますか？')) {
      chrome.storage.local.set({ 
        scrapedData: [], 
        scrapingState: 'inactive' 
      }, () => {
        updateUI('inactive', []);
      });
    }
  });

  // Stop Button
  btnStop.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    chrome.storage.local.set({ scrapingState: 'inactive' });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'stopScraping' });
    }
  });

  // Download Button
  btnDownload.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    let query = '';
    
    if (tab) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getQuery' });
        query = response ? response.query : '';
      } catch (e) {
        console.error("Failed to get query:", e);
      }
    }

    chrome.storage.local.get(['scrapedData', 'filterConfig'], (result) => {
      let data = result.scrapedData || [];
      const config = result.filterConfig;

      if (data.length === 0) return;

      // Apply filter for download
      if (config && config.enabled && config.center) {
        const radius = config.radius || 1000;
        data = data.filter(item => {
          if (!item.lat || !item.lng) return false;
          const dist = getDistance(config.center.lat, config.center.lng, item.lat, item.lng);
          return dist <= radius;
        });
      }

      if (data.length === 0) {
        alert('条件に一致するデータがありません。');
        return;
      }

      // Create CSV
      const headers = ['name', 'address', 'phone', 'rating', 'reviews', 'lat', 'lng', 'url', 'source'];
      // BOM for Excel
      let csvContent = '\uFEFF' + headers.join(',') + '\n';

      data.forEach(item => {
        const row = [
          `"${(item.name || '').replace(/"/g, '""')}"`,
          `"${(item.address || '').replace(/"/g, '""')}"`,
          `"${(item.phone || '').replace(/"/g, '""')}"`,
          `"${(item.rating || '').replace(/"/g, '""')}"`,
          `"${(item.reviews || '').replace(/"/g, '""')}"`,
          `"${item.lat || ''}"`,
          `"${item.lng || ''}"`,
          `"${(item.url || '').replace(/"/g, '""')}"`,
          `"googlemaps"`
        ];
        csvContent += row.join(',') + '\n';
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      
      // Filename construction
      let filename = '';
      const date = new Date();
      const dateStr = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}_${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}`;
      
      let filterSuffix = (config && config.enabled) ? `_r${config.radius}m` : '';

      if (query && (query.includes('✖️') || query.includes('×') || query.includes('x'))) {
        const separator = query.includes('✖️') ? '✖️' : (query.includes('×') ? '×' : 'x');
        const parts = query.split(separator);
        const area = parts[0] ? parts[0].trim() : '';
        const industry = parts[1] ? parts[1].trim() : '';
        
        if (area && industry) {
          filename = `${industry} ${area}${filterSuffix} Googleマップ.csv`;
        } else {
          filename = `${query}${filterSuffix} Googleマップ.csv`;
        }
      } else if (query) {
        filename = `${query}${filterSuffix} Googleマップ.csv`;
      } else {
        filename = `googlemaps_list_${dateStr}${filterSuffix}.csv`;
      }

      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  });

  // Listen for storage changes to update UI in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      chrome.storage.local.get(['scrapingState', 'scrapedData'], (result) => {
        updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
      });
    }
  });
});
