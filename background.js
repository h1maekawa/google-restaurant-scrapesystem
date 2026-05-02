// background.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    scrapingState: 'inactive', // inactive, active, done
    scrapedData: [],
    maxItems: 50
  });
});

// メッセージ中継やバックグラウンドでのデータ保持
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateData') {
    chrome.storage.local.get(['scrapedData'], (result) => {
      const currentData = result.scrapedData || [];
      const newData = request.data;
      
      // 重複排除 (URLをキーにする)
      const existingUrls = new Set(currentData.map(item => item.url));
      const uniqueNewData = newData.filter(item => !existingUrls.has(item.url));
      
      const updatedData = [...currentData, ...uniqueNewData];
      chrome.storage.local.set({ scrapedData: updatedData }, () => {
        sendResponse({ success: true, count: updatedData.length });
      });
    });
    return true; // 非同期レスポンス
  }

  if (request.action === 'setState') {
    chrome.storage.local.set({ scrapingState: request.state }, () => {
      if (request.state === 'done') {
        chrome.storage.local.get(['scrapedData'], (result) => {
          const data = result.scrapedData || [];
          const count = data.length;
          
          // Show notification
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '抽出が完了しました',
            message: `合計 ${count} 件のデータを取得しました。自動でダウンロードを開始します。`,
            priority: 2
          });

          // Trigger automatic download
          if (count > 0 && sender.tab) {
            handleAutomaticDownload(sender.tab.id, data);
          }
        });
      }
      sendResponse({ success: true });
    });
    return true;
  }
});

/**
 * Automatically generates and downloads CSV
 */
async function handleAutomaticDownload(tabId, data) {
  try {
    // Get query from tab
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getQuery' });
    const query = response ? response.query : '';

    // Create CSV content
    const headers = ['name', 'address', 'phone', 'rating', 'reviews', 'url', 'source'];
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

    // Filename construction (same logic as popup.js)
    let filename = '';
    const date = new Date();
    const dateStr = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}_${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}`;
    
    if (query && (query.includes('✖️') || query.includes('×') || query.includes('x'))) {
      const separator = query.includes('✖️') ? '✖️' : (query.includes('×') ? '×' : 'x');
      const parts = query.split(separator);
      const area = parts[0] ? parts[0].trim() : '';
      const industry = parts[1] ? parts[1].trim() : '';
      
      if (area && industry) {
        filename = `${industry} ${area} Googleマップ.csv`;
      } else {
        filename = `${query} Googleマップ.csv`;
      }
    } else if (query) {
      filename = `${query} Googleマップ.csv`;
    } else {
      filename = `googlemaps_list_${dateStr}.csv`;
    }

    // Trigger download
    // Use data URI for background script
    const encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    
    chrome.downloads.download({
      url: encodedUri,
      filename: filename,
      saveAs: false
    });

  } catch (error) {
    console.error('Automatic download failed:', error);
  }
}
