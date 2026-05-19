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
  const suggestedGenresContainer = document.getElementById('suggested-genres');
  const btnFetchGenres = document.getElementById('btn-fetch-genres');
  const currentQuerySpan = document.getElementById('current-query');

  const searchAreaInput = document.getElementById('search-area');
  const searchKeywordInput = document.getElementById('search-keyword');
  const btnOpenMap = document.getElementById('btn-open-map');

  let centerPoint = null; // { lat, lng }

  const PRESET_GENRES = [
    'カフェ', 'スイーツ', 'ラーメン', '居酒屋', '焼肉',
    '寿司', 'イタリアン', 'フレンチ', '和食', '中華',
    '喫茶店', 'ベーカリー', 'お好み焼き', 'たこ焼き'
  ];

  // ── 初期化 ────────────────────────────────────────────────
  chrome.storage.local.get(['scrapingState', 'scrapedData', 'maxItems', 'filterConfig', 'targetGenres', 'searchArea', 'searchKeyword'], (result) => {
    // プリセットチェックボックスを描画
    renderPresetGenres();

    if (result.searchArea) searchAreaInput.value = result.searchArea;
    if (result.searchKeyword) searchKeywordInput.value = result.searchKeyword;

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
      updateGenreChips();
    } else {
      updateGenreChips(); // プリセットチェックの初期同期用
    }

    updateQueryDisplay();
    updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
  });

  async function updateQueryDisplay() {
    const tab = await getCurrentTab();
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'getQuery' }, (response) => {
        if (response && response.query) {
          currentQuerySpan.textContent = response.query;
          chrome.storage.local.set({ lastQuery: response.query });
        } else {
          chrome.storage.local.get(['lastQuery'], (res) => {
            currentQuerySpan.textContent = res.lastQuery || '-';
          });
        }
      });
    }
  }

  // ── スライダー ────────────────────────────────────────────
  maxItemsSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    updateMaxItemsText(val);
    chrome.storage.local.set({ maxItems: parseInt(val, 10) });
  });

  function updateMaxItemsText(val) {
    maxItemsVal.textContent = val == 500 ? '上限なし' : val;
  }

  // ── 検索イベント ─────────────────────────────────────
  searchAreaInput.addEventListener('input', () => {
    chrome.storage.local.set({ searchArea: searchAreaInput.value });
  });

  searchKeywordInput.addEventListener('input', () => {
    chrome.storage.local.set({ searchKeyword: searchKeywordInput.value });
  });

  btnOpenMap.addEventListener('click', () => {
    const area = searchAreaInput.value.trim();
    const kw = searchKeywordInput.value.trim();
    if (!area && !kw) {
      alert('エリアまたはキーワードを入力してください');
      return;
    }
    const query = `${area} ${kw}`.trim();
    chrome.storage.local.set({
      searchArea: area,
      searchKeyword: kw,
      lastQuery: query
    }, () => {
      // 記録したクエリでGoogleマップを開く
      const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
      chrome.tabs.create({ url });
    });
  });

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
    updateGenreChips();
  });

  btnFetchGenres.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab) return;

    btnFetchGenres.textContent = '取得中...';
    chrome.tabs.sendMessage(tab.id, { action: 'getGenresFromPage' }, (response) => {
      btnFetchGenres.textContent = '現在のページからジャンルを読み込む';
      if (response && response.genres) {
        renderGenreChips(response.genres);
      }
    });
  });

  function renderGenreChips(genres) {
    suggestedGenresContainer.innerHTML = '';
    const currentGenres = targetGenresTextarea.value.split(/[\n,]/).map(s => s.trim());
    
    genres.forEach(genre => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      if (currentGenres.includes(genre)) chip.classList.add('active');
      chip.textContent = genre;
      chip.onclick = () => toggleGenre(genre, chip);
      suggestedGenresContainer.appendChild(chip);
    });
  }

  function toggleGenre(genre, chip) {
    let genres = targetGenresTextarea.value
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(s => s !== '');
    
    if (genres.includes(genre)) {
      genres = genres.filter(g => g !== genre);
      chip.classList.remove('active');
    } else {
      genres.push(genre);
      chip.classList.add('active');
    }
    
    targetGenresTextarea.value = genres.join(', ');
    chrome.storage.local.set({ targetGenres: targetGenresTextarea.value });
  }

  function updateGenreChips() {
    const currentGenres = targetGenresTextarea.value.split(/[\n,]/).map(s => s.trim());
    
    // チップの同期
    const chips = suggestedGenresContainer.querySelectorAll('.chip');
    chips.forEach(chip => {
      if (currentGenres.includes(chip.textContent)) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    // プリセットチェックボックスの同期
    const checkboxes = document.querySelectorAll('#preset-genres input[type="checkbox"]');
    checkboxes.forEach(chk => {
      chk.checked = currentGenres.includes(chk.value);
    });
  }

  function renderPresetGenres() {
    const container = document.getElementById('preset-genres');
    if (!container) return;
    container.innerHTML = '';
    
    const currentGenres = targetGenresTextarea.value.split(/[\n,]/).map(s => s.trim());

    PRESET_GENRES.forEach((genre, index) => {
      const div = document.createElement('div');
      div.className = 'preset-item';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = `preset-chk-${index}`;
      chk.value = genre;
      chk.checked = currentGenres.includes(genre);

      chk.addEventListener('change', () => {
        togglePresetGenre(genre, chk.checked);
      });

      const lbl = document.createElement('label');
      lbl.htmlFor = chk.id;
      lbl.textContent = genre;

      div.appendChild(chk);
      div.appendChild(lbl);
      container.appendChild(div);
    });
  }

  function togglePresetGenre(genre, isChecked) {
    let genres = targetGenresTextarea.value
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(s => s !== '');

    if (isChecked) {
      if (!genres.includes(genre)) {
        genres.push(genre);
      }
    } else {
      genres = genres.filter(g => g !== genre);
    }

    targetGenresTextarea.value = genres.join(', ');
    chrome.storage.local.set({ targetGenres: targetGenresTextarea.value });
    updateGenreChips(); // チップの同期およびストレージ反映
  }

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

  // ════════════════════════════════════════════════════════════
  // ファイル名生成ユーティリティ
  // 出力例:
  //   "渋谷区 カフェ"  → 渋谷区_カフェ_Googleマップ_20260516.csv
  //   "札幌市 居酒屋"  → 札幌市_居酒屋_Googleマップ_20260516.csv
  //   "新宿 ラーメン"  → 新宿_ラーメン_Googleマップ_20260516.csv
  //   ""（失敗時）     → Googleマップ_20260516_1423.csv
  // ════════════════════════════════════════════════════════════

  function buildFilename(query, filterConfig) {
    const date = new Date();
    const dateStr =
      `${date.getFullYear()}` +
      `${(date.getMonth() + 1).toString().padStart(2, '0')}` +
      `${date.getDate().toString().padStart(2, '0')}`;
    const timeStr =
      `${date.getHours().toString().padStart(2, '0')}` +
      `${date.getMinutes().toString().padStart(2, '0')}`;

    // 半径フィルターサフィックス
    const radiusSuffix =
      filterConfig && filterConfig.enabled && filterConfig.radius
        ? `_r${filterConfig.radius}m`
        : '';

    const trimmed = (query || '').trim();

    // クエリが空 → フォールバック
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
      // どちらも抽出できない場合はクエリ全体をそのまま使用
      return `${sanitizeFilename(trimmed)}_Googleマップ_${dateStr}${radiusSuffix}.csv`;
    }
  }

  /**
   * 検索クエリ文字列を解析してエリアとジャンルに分割する
   * 対応形式:
   *   「渋谷区 カフェ」「札幌市 居酒屋」「新宿 ラーメン」
   *   「エリア × ジャンル」「エリア ✖️ ジャンル」
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
      // 判定できなければ先頭=エリア、次=ジャンルと仮定
      return { area: parts[0] || '', genre: parts[1] || '' };
    }

    // ② スペース区切り
    const tokens = query.split(/[\s\u3000]+/).filter(Boolean);

    if (tokens.length === 0) return { area: '', genre: '' };

    // トークンが1つのみ → エリアかジャンルかを判定
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

    // エリアが見つからなかった場合: 先頭=エリア、残り=ジャンルとする
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
   * 市・区・町・村・都・府・道・県 で終わる語句、または既知の地名を対象とする
   */
  function isAreaToken(token) {
    // 末尾が行政区分の接尾辞
    if (/[市区町村都府道県]$/.test(token)) return true;

    // 都道府県名（接尾辞なし）
    const prefectures = [
      '北海道', '東京', '大阪', '京都', '神奈川', '愛知', '福岡', '沖縄',
      '埼玉', '千葉', '兵庫', '静岡', '茨城', '広島', '宮城'
    ];
    if (prefectures.includes(token)) return true;

    // 主要都市・地名
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
      .replace(/[\\/:*?"<>|]/g, '')  // ファイル名禁止文字を除去
      .replace(/\s+/g, '_')           // スペースをアンダースコアに
      .replace(/_+/g, '_')            // 連続アンダースコアを統合
      .replace(/^_|_$/g, '')          // 前後のアンダースコアを除去
      .slice(0, 50);                  // 最大50文字でトリミング
  }

  // ── UI更新 ────────────────────────────────────────────────
  function updateUI(state, data) {
    const totalCount = data.length;
    let displayCount = totalCount;
    let filteredData = data;

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
        <td title="${item.businessHours || ''}">${item.businessHours || '-'}</td>
      `;
      previewBody.appendChild(tr);
    });

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
        filterConfig: contentFilterConfig
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
        console.error('Failed to get query:', e);
      }
    }

    chrome.storage.local.get(['scrapedData', 'filterConfig'], (result) => {
      let data = result.scrapedData || [];
      const config = result.filterConfig;

      if (data.length === 0) return;

      // 半径フィルター適用
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

      // CSV生成
      const headers = ['name', 'genre', 'address', 'phone', 'business_hours', 'rating', 'reviews', 'lat', 'lng', 'distance_m', 'url', 'source'];
      let csvContent = '\uFEFF' + headers.join(',') + '\n';

      data.forEach(item => {
        const row = [
          `"${(item.name || '').replace(/"/g, '""')}"`,
          `"${(item.genre || '').replace(/"/g, '""')}"`,
          `"${(item.address || '').replace(/"/g, '""')}"`,
          `"${(item.phone || '').replace(/"/g, '""')}"`,
          `"${(item.businessHours || '').replace(/"/g, '""')}"`,
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
      const filename = buildFilename(query, config);

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