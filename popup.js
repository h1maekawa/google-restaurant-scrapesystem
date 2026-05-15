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

  // Filter UI Elements
  const filterEnabled = document.getElementById('filter-enabled');
  const filterSettings = document.getElementById('filter-settings');
  const filterRadius = document.getElementById('filter-radius');
  const btnGetCenter = document.getElementById('btn-get-center');
  const displayCoords = document.getElementById('display-coords');
  const targetGenresTextarea = document.getElementById('target-genres');

  let centerPoint = null; // { lat, lng }

  // ── 初期化 ────────────────────────────────────────────────
  chrome.storage.local.get(['scrapingState', 'scrapedData', 'maxItems', 'filterConfig', 'targetGenres'], (result) => {
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

    if (result.targetGenres) {
      targetGenresTextarea.value = result.targetGenres;
    }

    updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
  });

  // ── スライダー ────────────────────────────────────────────
  maxItemsSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    updateMaxItemsText(val);
    chrome.storage.local.set({ maxItems: parseInt(val, 10) });
  });

  function updateMaxItemsText(val) {
    maxItemsVal.textContent = val == 500 ? '上限なし' : val;
  }

  // ── フィルターイベント ─────────────────────────────────────
  filterEnabled.addEventListener('change', (e) => {
    toggleFilterUI(e.target.checked);
    saveFilterConfig();
    refreshUI();
  });

  filterRadius.addEventListener('change', () => {
    saveFilterConfig();
    refreshUI();
  });

  targetGenresTextarea.addEventListener('change', () => {
    chrome.storage.local.set({ targetGenres: targetGenresTextarea.value });
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
    filterSettings.classList.toggle('disabled', !enabled);
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

  // ── Haversine距離計算 ─────────────────────────────────────
  function getDistance(lat1, lng1, lat2, lng2) {
    if (!lat1 || !lng1 || !lat2 || !lng2) return Infinity;
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── UI更新 ────────────────────────────────────────────────
  function updateUI(state, data) {
    const totalCount = data.length;
    let displayCount = totalCount;
    let filteredData = data;

    // 半径フィルターが有効な場合はpopup側でも表示件数を絞る（storageには範囲内のみ保存済みだが念のため）
    if (filterEnabled.checked && centerPoint) {
      const radius = parseInt(filterRadius.value, 10);
      filteredData = data.filter(item => {
        if (item.lat == null || item.lng == null) return false;
        return getDistance(centerPoint.lat, centerPoint.lng, item.lat, item.lng) <= radius;
      });
      displayCount = filteredData.length;
      countDisplay.innerHTML =
        `<span style="color:#1a73e8;font-weight:bold">${displayCount}件</span>` +
        `<span style="font-size:0.8em;color:#666"> (半径${radius}m以内) / 全取得 ${totalCount}件</span>`;
    } else {
      countDisplay.textContent = totalCount;
    }

    // プレビューテーブル（最新5件）
    previewBody.innerHTML = '';
    filteredData.slice(-5).reverse().forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td title="${item.name}">${item.name || '-'}</td>
        <td title="${item.genre}">${item.genre || '-'}</td>
        <td>${item.phone || '-'}</td>
      `;
      previewBody.appendChild(tr);
    });

    // ボタン・ステータス表示
    if (state === 'active') {
      statusIndicator.className = 'indicator active';
      statusText.textContent = `リストを自動スクロール中... ${totalCount}件取得済み`;
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnDownload.disabled = displayCount === 0;
    } else if (state === 'done') {
      statusIndicator.className = 'indicator done';
      statusText.textContent = `抽出完了: 合計 ${totalCount}件取得しました`;
      btnStart.disabled = false;
      btnStart.textContent = '▶ 再開・追加取得';
      btnStop.disabled = true;
      btnDownload.disabled = displayCount === 0;
    } else {
      // inactive
      statusIndicator.className = 'indicator inactive';
      statusText.textContent = totalCount > 0
        ? `停止中: ${totalCount}件保持`
        : 'Googleマップの検索結果ページを開いてください';
      btnStart.disabled = false;
      btnStart.textContent = totalCount > 0 ? '▶ 再開・追加取得' : '▶ 取得開始';
      btnStop.disabled = true;
      btnDownload.disabled = displayCount === 0;
    }
  }

  // ── タブ取得 ──────────────────────────────────────────────
  async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // ── 取得開始 ──────────────────────────────────────────────
  btnStart.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab || (!tab.url.includes('google.com/maps') && !tab.url.includes('google.co.jp/maps'))) {
      alert('Googleマップの検索結果ページを開いてから実行してください。');
      return;
    }

    const maxItems = maxItemsSlider.value == 500 ? 999999 : parseInt(maxItemsSlider.value, 10);
    const targetGenres = targetGenresTextarea.value
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(s => s !== '');

    chrome.storage.local.get(['scrapedData'], (result) => {
      const currentData = result.scrapedData || [];
      if (currentData.length > 0) {
        if (confirm('既存のデータをクリアして新しく開始しますか？\n（「キャンセル」で既存データに追加取得します）')) {
          chrome.storage.local.set({ scrapedData: [] }, () => {
            startScraping(tab, maxItems, targetGenres);
          });
          return;
        }
      }
      startScraping(tab, maxItems, targetGenres);
    });
  });

  function startScraping(tab, maxItems, targetGenres) {
    // content.js へ渡す形式に変換
    const contentFilterConfig = (filterEnabled.checked && centerPoint)
      ? {
        enabled: true,
        centerLat: centerPoint.lat,
        centerLng: centerPoint.lng,
        radiusMeters: parseInt(filterRadius.value, 10)
      }
      : { enabled: false };

    chrome.storage.local.set({ scrapingState: 'active' }, () => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'startScraping',
        maxItems: maxItems,
        targetGenres: targetGenres,
        filterConfig: contentFilterConfig  // ← 追加
      }, (response) => {
        if (chrome.runtime.lastError) {
          alert('ページの再読み込みが必要です。ページをリロードしてからお試しください。');
          chrome.storage.local.set({ scrapingState: 'inactive' });
        }
      });
    });
  }

  // ── リセット ──────────────────────────────────────────────
  btnReset.addEventListener('click', () => {
    if (confirm('取得済みのデータをすべて削除しますか？')) {
      chrome.storage.local.set({ scrapedData: [], scrapingState: 'inactive' }, () => {
        updateUI('inactive', []);
      });
    }
  });

  // ── 停止 ──────────────────────────────────────────────────
  btnStop.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    chrome.storage.local.set({ scrapingState: 'inactive' });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'stopScraping' });
    }
  });

  // ── CSVダウンロード ───────────────────────────────────────
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

      // ダウンロード時も念のため半径フィルターを適用
      if (config && config.enabled && config.center) {
        const radius = config.radius || 1000;
        data = data.filter(item => {
          if (!item.lat || !item.lng) return false;
          return getDistance(config.center.lat, config.center.lng, item.lat, item.lng) <= radius;
        });
      }

      if (data.length === 0) {
        alert('条件に一致するデータがありません。');
        return;
      }

      // CSV生成（distanceMetersカラムを追加）
      const headers = ['name', 'genre', 'address', 'phone', 'rating', 'reviews', 'lat', 'lng', 'distance_m', 'url', 'source'];
      let csvContent = '\uFEFF' + headers.join(',') + '\n';

      data.forEach(item => {
        const row = [
          `"${(item.name || '').replace(/"/g, '""')}"`,
          `"${(item.genre || '').replace(/"/g, '""')}"`,
          `"${(item.address || '').replace(/"/g, '""')}"`,
          `"${(item.phone || '').replace(/"/g, '""')}"`,
          `"${(item.rating || '').replace(/"/g, '""')}"`,
          `"${(item.reviews || '').replace(/"/g, '""')}"`,
          `"${item.lat ?? ''}"`,
          `"${item.lng ?? ''}"`,
          `"${item.distanceMeters ?? ''}"`,   // ← 追加
          `"${(item.url || '').replace(/"/g, '""')}"`,
          `"googlemaps"`
        ];
        csvContent += row.join(',') + '\n';
      });

      // ファイル名生成
      const date = new Date();
      const dateStr =
        `${date.getFullYear()}` +
        `${(date.getMonth() + 1).toString().padStart(2, '0')}` +
        `${date.getDate().toString().padStart(2, '0')}_` +
        `${date.getHours().toString().padStart(2, '0')}` +
        `${date.getMinutes().toString().padStart(2, '0')}`;

      const filterSuffix = (config && config.enabled) ? `_r${config.radius}m` : '';
      let filename = '';

      if (query && (query.includes('✖️') || query.includes('×') || query.includes('x'))) {
        const separator = query.includes('✖️') ? '✖️' : (query.includes('×') ? '×' : 'x');
        const parts = query.split(separator);
        const area = parts[0] ? parts[0].trim() : '';
        const industry = parts[1] ? parts[1].trim() : '';
        filename = (area && industry)
          ? `${industry} ${area}${filterSuffix} Googleマップ.csv`
          : `${query}${filterSuffix} Googleマップ.csv`;
      } else if (query) {
        filename = `${query}${filterSuffix} Googleマップ.csv`;
      } else {
        filename = `googlemaps_list_${dateStr}${filterSuffix}.csv`;
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  });

  // ── ストレージ変更を監視してリアルタイム更新 ──────────────
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      chrome.storage.local.get(['scrapingState', 'scrapedData'], (result) => {
        updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
      });
    }
  });
});