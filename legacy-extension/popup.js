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

  const CSV_HEADERS = [
    'name',
    'genre',
    'address',
    'phone',
    'regular_holiday',
    'opening_hours_details',
    'rating',
    'reviews',
    'lat',
    'lng',
    'distance_m',
    'url',
    'source'
  ];

  const PRESET_GENRES = [
    'カフェ', 'スイーツ', 'ラーメン', '居酒屋', '焼肉',
    '寿司', 'イタリアン', 'フレンチ', '和食', '中華',
    '喫茶店', 'ベーカリー', 'お好み焼き', 'たこ焼き', '焼き鳥'
  ];

  let centerPoint = null;

  chrome.storage.local.get(
    ['scrapingState', 'scrapedData', 'maxItems', 'filterConfig', 'targetGenres', 'searchArea', 'searchKeyword'],
    (result) => {
      renderPresetGenres();

      if (result.searchArea) searchAreaInput.value = result.searchArea;
      if (result.searchKeyword) searchKeywordInput.value = result.searchKeyword;

      if (result.maxItems) {
        maxItemsSlider.value = result.maxItems;
        updateMaxItemsText(result.maxItems);
      } else {
        updateMaxItemsText(maxItemsSlider.value);
      }

      if (result.filterConfig) {
        filterEnabled.checked = Boolean(result.filterConfig.enabled);
        filterRadius.value = result.filterConfig.radius || 1000;
        centerPoint = result.filterConfig.center || null;
        if (centerPoint) {
          displayCoords.textContent = `${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)}`;
        }
        toggleFilterUI(Boolean(result.filterConfig.enabled));
      } else {
        toggleFilterUI(false);
      }

      const storedGenres = Array.isArray(result.targetGenres)
        ? result.targetGenres
        : parseGenreInput(result.targetGenres || '');
      setTargetGenres(storedGenres, false);

      updateQueryDisplay();
      updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
    }
  );

  function normalizeWhitespace(text) {
    return String(text || '')
      .normalize('NFKC')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseGenreInput(value) {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map(v => normalizeWhitespace(v)).filter(Boolean)));
    }

    return Array.from(new Set(
      String(value || '')
        .split(/[\n,]/)
        .map(v => normalizeWhitespace(v))
        .filter(Boolean)
    ));
  }

  function setTargetGenres(genres, save = true) {
    const normalizedGenres = parseGenreInput(genres);
    targetGenresTextarea.value = normalizedGenres.join(', ');
    if (save) {
      chrome.storage.local.set({ targetGenres: targetGenresTextarea.value });
    }
    updateGenreChips();
  }

  async function updateQueryDisplay() {
    const tab = await getCurrentTab();
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: 'getQuery' }, (response) => {
      if (response && response.query) {
        currentQuerySpan.textContent = response.query;
        chrome.storage.local.set({ lastQuery: response.query });
        return;
      }

      chrome.storage.local.get(['lastQuery'], (res) => {
        currentQuerySpan.textContent = res.lastQuery || '-';
      });
    });
  }

  maxItemsSlider.addEventListener('input', (event) => {
    const value = event.target.value;
    updateMaxItemsText(value);
    chrome.storage.local.set({ maxItems: parseInt(value, 10) });
  });

  function updateMaxItemsText(value) {
    maxItemsVal.textContent = value == 500 ? '上限なし' : value;
  }

  searchAreaInput.addEventListener('input', () => {
    chrome.storage.local.set({ searchArea: searchAreaInput.value });
  });

  searchKeywordInput.addEventListener('input', () => {
    chrome.storage.local.set({ searchKeyword: searchKeywordInput.value });
  });

  btnOpenMap.addEventListener('click', () => {
    const area = normalizeWhitespace(searchAreaInput.value);
    const keyword = normalizeWhitespace(searchKeywordInput.value);

    if (!area && !keyword) {
      alert('エリアまたはキーワードを入力してください');
      return;
    }

    const query = `${area} ${keyword}`.trim();
    chrome.storage.local.set({
      searchArea: area,
      searchKeyword: keyword,
      lastQuery: query
    }, () => {
      chrome.tabs.create({
        url: `https://www.google.com/maps/search/${encodeURIComponent(query)}`
      });
    });
  });

  filterEnabled.addEventListener('change', (event) => {
    toggleFilterUI(event.target.checked);
    saveFilterConfig();
    refreshUI();
  });

  filterRadius.addEventListener('change', () => {
    saveFilterConfig();
    refreshUI();
  });

  targetGenresTextarea.addEventListener('change', () => {
    setTargetGenres(targetGenresTextarea.value, true);
  });

  btnFetchGenres.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab) return;

    btnFetchGenres.textContent = '取得中...';
    chrome.tabs.sendMessage(tab.id, { action: 'getGenresFromPage' }, (response) => {
      btnFetchGenres.textContent = '現在のページからジャンルを読み込む';
      if (response && Array.isArray(response.genres)) {
        renderGenreChips(response.genres);
      }
    });
  });

  function renderGenreChips(genres) {
    suggestedGenresContainer.innerHTML = '';
    const currentGenres = parseGenreInput(targetGenresTextarea.value);

    Array.from(new Set(genres.map(g => normalizeWhitespace(g)).filter(Boolean))).forEach((genre) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = genre;
      if (currentGenres.includes(genre)) chip.classList.add('active');
      chip.onclick = () => toggleGenre(genre, chip);
      suggestedGenresContainer.appendChild(chip);
    });
  }

  function toggleGenre(genre, chip) {
    const genres = parseGenreInput(targetGenresTextarea.value);
    const nextGenres = genres.includes(genre)
      ? genres.filter(g => g !== genre)
      : [...genres, genre];

    chip.classList.toggle('active', !genres.includes(genre));
    setTargetGenres(nextGenres, true);
  }

  function updateGenreChips() {
    const currentGenres = parseGenreInput(targetGenresTextarea.value);

    suggestedGenresContainer.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('active', currentGenres.includes(chip.textContent));
    });

    document.querySelectorAll('#preset-genres input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = currentGenres.includes(checkbox.value);
    });
  }

  function renderPresetGenres() {
    const container = document.getElementById('preset-genres');
    if (!container) return;

    container.innerHTML = '';
    const currentGenres = parseGenreInput(targetGenresTextarea.value);

    PRESET_GENRES.forEach((genre, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'preset-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `preset-chk-${index}`;
      checkbox.value = genre;
      checkbox.checked = currentGenres.includes(genre);
      checkbox.addEventListener('change', () => {
        togglePresetGenre(genre, checkbox.checked);
      });

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.textContent = genre;

      wrapper.appendChild(checkbox);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
    });
  }

  function togglePresetGenre(genre, isChecked) {
    const currentGenres = parseGenreInput(targetGenresTextarea.value);
    const nextGenres = isChecked
      ? Array.from(new Set([...currentGenres, genre]))
      : currentGenres.filter(g => g !== genre);

    setTargetGenres(nextGenres, true);
  }

  btnGetCenter.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: 'getMapCenter' }, (response) => {
      if (response && response.lat != null && response.lng != null) {
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

  function getDistance(lat1, lng1, lat2, lng2) {
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

  function updateUI(state, data) {
    const totalCount = data.length;
    let displayCount = totalCount;
    let filteredData = data;

    if (filterEnabled.checked && centerPoint) {
      const radius = parseInt(filterRadius.value, 10);
      filteredData = data.filter((item) => {
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

    previewBody.innerHTML = '';
    filteredData.slice(-5).reverse().forEach((item) => {
      const tr = document.createElement('tr');
      const openingHours = item.openingHoursDetails || item.businessHours || '-';
      tr.innerHTML = `
        <td title="${item.name || ''}">${item.name || '-'}</td>
        <td title="${item.genre || ''}">${item.genre || '-'}</td>
        <td title="${item.phone || ''}">${item.phone || '-'}</td>
        <td title="${openingHours}">${openingHours}</td>
        <td title="${item.regularHoliday || '年中無休'}">${item.regularHoliday || '年中無休'}</td>
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

  async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  btnStart.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab || (!tab.url.includes('google.com/maps') && !tab.url.includes('google.co.jp/maps'))) {
      alert('Googleマップの検索結果ページを開いてから実行してください。');
      return;
    }

    const maxItems = maxItemsSlider.value == 500 ? 999999 : parseInt(maxItemsSlider.value, 10);
    const targetGenres = parseGenreInput(targetGenresTextarea.value);

    chrome.storage.local.get(['scrapedData'], (result) => {
      const currentData = Array.isArray(result.scrapedData) ? result.scrapedData : [];
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

    chrome.runtime.sendMessage({ action: 'setState', state: 'active' }, () => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'startScraping',
        maxItems,
        targetGenres,
        filterConfig: contentFilterConfig
      }, () => {
        if (chrome.runtime.lastError) {
          alert('ページの再読み込みが必要です。ページをリロードしてからお試しください。');
          chrome.runtime.sendMessage({ action: 'setState', state: 'inactive' });
        }
      });
    });
  }

  btnReset.addEventListener('click', () => {
    if (!confirm('取得済みのデータをすべて削除しますか？')) return;

    chrome.runtime.sendMessage({ action: 'setState', state: 'inactive' }, () => {
      chrome.storage.local.set({ scrapedData: [] }, () => {
        updateUI('inactive', []);
      });
    });
  });

  btnStop.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    chrome.runtime.sendMessage({ action: 'setState', state: 'inactive' });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'stopScraping' });
    }
  });

  btnDownload.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    let query = '';

    if (tab) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getQuery' });
        query = response?.query || '';
      } catch (error) {
        console.error('Failed to get query:', error);
      }
    }

    chrome.storage.local.get(['scrapedData', 'filterConfig', 'lastQuery'], (result) => {
      let data = Array.isArray(result.scrapedData) ? result.scrapedData : [];
      const config = result.filterConfig;
      query = query || result.lastQuery || '';

      if (!data.length) return;

      if (config && config.enabled && config.center) {
        const radius = config.radius || 1000;
        data = data.filter((item) => {
          if (item.lat == null || item.lng == null) return false;
          return getDistance(config.center.lat, config.center.lng, item.lat, item.lng) <= radius;
        });
      }

      if (!data.length) {
        alert('条件に一致するデータがありません。');
        return;
      }

      const blob = new Blob([buildCsvContent(data)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildFilename(query, config);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    if (changes.targetGenres) {
      setTargetGenres(changes.targetGenres.newValue || '', false);
    }

    chrome.storage.local.get(['scrapingState', 'scrapedData'], (result) => {
      updateUI(result.scrapingState || 'inactive', result.scrapedData || []);
    });
  });
});
