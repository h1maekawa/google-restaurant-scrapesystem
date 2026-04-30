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
          const count = result.scrapedData ? result.scrapedData.length : 0;
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '抽出が完了しました',
            message: `合計 ${count} 件のデータを取得しました。CSVをダウンロードできます。`,
            priority: 2
          });
        });
      }
      sendResponse({ success: true });
    });
    return true;
  }
});
