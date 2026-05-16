// src/core/navigation.ts

import type { Page } from 'playwright';
import { SELECTORS } from '../selectors/maps.selectors';

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ── スクロールコンテナ取得 ────────────────────────────────────────────────────

export async function getScrollContainer(page: Page): Promise<boolean> {
  // role="feed" で探す
  const feed = await page.$(SELECTORS.resultFeed.primary);
  if (feed) return true;

  // fallback: 高さ最大のスクロール可能div
  for (const sel of SELECTORS.resultFeed.fallbacks) {
    const el = await page.$(sel);
    if (el) return true;
  }

  return false;
}

// ── フィードをスクロール ──────────────────────────────────────────────────────

export async function scrollFeed(page: Page): Promise<void> {
  await page.evaluate((sel) => {
    const feed =
      document.querySelector(sel.primary) ??
      document.querySelector(sel.fallbacks[0] ?? '') ??
      null;
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  }, { primary: SELECTORS.resultFeed.primary, fallbacks: [...SELECTORS.resultFeed.fallbacks] });
}

// ── リスト終端判定 ────────────────────────────────────────────────────────────

export async function isEndOfList(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const text = document.querySelector('div[role="feed"]')?.textContent ?? '';
    return (
      text.includes('これ以上結果はありません') ||
      text.includes("You've reached the end of the list") ||
      text.includes('結果がありません')
    );
  });
}

// ── リトライ付きクリック ──────────────────────────────────────────────────────

export async function clickWithRetry(
  page: Page,
  selector: string,
  maxRetries = 3,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.click(selector, { timeout: 5000 });
      return true;
    } catch {
      if (i < maxRetries - 1) await sleep(1000);
    }
  }
  return false;
}

// ── 詳細パネルの読み込み待機 ─────────────────────────────────────────────────

export async function waitForDetailPanel(page: Page, timeoutMs = 5000): Promise<void> {
  try {
    // カテゴリ要素 or 住所要素が出るまで待つ
    await page.waitForSelector(
      [
        SELECTORS.category.primary,
        ...SELECTORS.category.fallbacks,
        SELECTORS.address.primary,
      ].join(', '),
      { timeout: timeoutMs },
    );
  } catch {
    // タイムアウトしても続行（部分的なデータで保存）
  }
}
