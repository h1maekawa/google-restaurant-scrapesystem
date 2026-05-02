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

  // Initialize UI from storage
  chrome.storage.local.get(['scrapingState', 'scrapedData', 'maxItems'], (result) => {
    if (result.maxItems) {
      maxItemsSlider.value = result.maxItems;
      updateMaxItemsText(result.maxItems);
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

  // Update UI State
  function updateUI(state, data) {
    const count = data.length;
    countDisplay.textContent = count;
    
    // Update preview table (last 5 items)
    previewBody.innerHTML = '';
    const previewData = data.slice(-5).reverse();
    previewData.forEach(item => {
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
      btnDownload.disabled = count === 0;
    } else if (state === 'done') {
      statusIndicator.className = 'indicator done';
      statusText.textContent = `抽出完了: 合計 ${count}件取得しました`;
      btnStart.disabled = false;
      btnStart.textContent = '▶ 再開・追加取得';
      btnStop.disabled = true;
      btnDownload.disabled = count === 0;
    } else {
      // inactive
      statusIndicator.className = 'indicator inactive';
      statusText.textContent = count > 0 ? `停止中: ${count}件保持` : 'Googleマップの検索結果ページを開いてください';
      btnStart.disabled = false;
      btnStart.textContent = count > 0 ? '▶ 再開・追加取得' : '▶ 取得開始';
      btnStop.disabled = true;
      btnDownload.disabled = count === 0;
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
    if (!tab || !tab.url.includes('google.com/maps') && !tab.url.includes('google.co.jp/maps')) {
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

    chrome.storage.local.get(['scrapedData'], (result) => {
      const data = result.scrapedData || [];
      if (data.length === 0) return;

      // Create CSV
      const headers = ['name', 'address', 'phone', 'rating', 'reviews', 'url', 'source'];
      // BOM for Excel
      let csvContent = '\uFEFF' + headers.join(',') + '\n';

      data.forEach(item => {
        const row = [
          `"${(item.name || '').replace(/"/g, '""')}"`,
          `"${(item.address || '').replace(/"/g, '""')}"`,
          `"${(item.phone || '').replace(/"/g, '""')}"`,
          `"${(item.rating || '').replace(/"/g, '""')}"`,
          `"${(item.reviews || '').replace(/"/g, '""')}"`,
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
      
      if (query && (query.includes('✖️') || query.includes('×') || query.includes('x'))) {
        // Handle different multiplication signs
        const separator = query.includes('✖️') ? '✖️' : (query.includes('×') ? '×' : 'x');
        const parts = query.split(separator);
        const area = parts[0] ? parts[0].trim() : '';
        const industry = parts[1] ? parts[1].trim() : '';
        
        if (area && industry) {
          // Format: 検索ワード(Industry) エリア(Area) Googleマップ.csv
          filename = `${industry} ${area} Googleマップ.csv`;
        } else {
          filename = `${query} Googleマップ.csv`;
        }
      } else if (query) {
        filename = `${query} Googleマップ.csv`;
      } else {
        filename = `googlemaps_list_${dateStr}.csv`;
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
