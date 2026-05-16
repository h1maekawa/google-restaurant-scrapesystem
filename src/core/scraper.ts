// src/core/scraper.ts

import { chromium, type Page } from 'playwright';
import { extractSearchContext, extractPlaceDetail } from './extractor';
import { applyFilters } from './filter';
import { scrollFeed, isEndOfList, waitForDetailPanel, sleep, getScrollContainer } from './navigation';
import { generateFilename } from '../io/filename';
import { exportCsv, exportJson } from '../io/exporter';
import { deduplicatePlaces, loadExistingUrls } from '../io/dedup';
import { SELECTORS } from '../selectors/maps.selectors';
import type { PlaceData, ScrapeConfig } from '../types';

// ── メインエントリーポイント ──────────────────────────────────────────────────

export async function runScraper(config: ScrapeConfig): Promise<void> {
  console.log('\n🗺  Google Maps Scraper 開始');
  console.log(`   最大取得件数  : ${config.maxItems}`);
  console.log(`   カテゴリフィルター: ${config.allowedCategories.length > 0 ? config.allowedCategories.join(', ') : '（全カテゴリ）'}`);
  if (config.radiusFilter) {
    console.log(`   半径フィルター: ${config.radiusFilter.radiusKm}km以内`);
    console.log(`   中心座標      : ${config.radiusFilter.centerLat}, ${config.radiusFilter.centerLng}`);
  }
  console.log('');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Google Mapsナビゲーションを待つ（手動で検索結果を表示させる場合を考慮）
  console.log('⏳ Google Mapsで検索結果ページを開いてください...');
  await page.waitForURL(/google\.(com|co\.jp)\/maps/, { timeout: 60_000 });
  console.log('✅ Google Mapsページを検出しました\n');

  try {
    const hasContainer = await getScrollContainer(page);
    if (!hasContainer) {
      console.error('❌ リストのスクロールコンテナが見つかりません。検索結果ページを確認してください。');
      return;
    }

    // 検索コンテキスト取得（ファイル名生成用）
    const searchContext = await extractSearchContext(page);
    console.log(`🔍 検索クエリ: "${searchContext.rawQuery}"`);
    console.log(`📁 出力ファイル名ベース: ${searchContext.prefecture}_${searchContext.city}_${searchContext.genre}_${searchContext.searchDate}\n`);

    // 既存データの重複URLを読み込む
    const existingUrls = await loadExistingUrls(config.outputDir);
    const collectedUrls = new Set<string>(existingUrls);
    const results: PlaceData[] = [];

    // スクレイピング実行
    await scrapeLoop(page, config, collectedUrls, results);

    if (results.length === 0) {
      console.log('\n⚠️  保存対象のデータが0件でした。フィルター設定を確認してください。');
      return;
    }

    // 重複除去
    const unique = deduplicatePlaces(results);
    console.log(`\n📊 取得: ${results.length}件 → 重複除去後: ${unique.length}件`);

    // 出力
    if (config.outputFormat === 'csv' || config.outputFormat === 'both') {
      const filename = generateFilename(searchContext, 'csv');
      const filepath = `${config.outputDir}/${filename}`;
      const result = await exportCsv(unique, filepath);
      console.log(`✅ CSV出力: ${result.filepath} (${result.count}件)`);
    }

    if (config.outputFormat === 'json' || config.outputFormat === 'both') {
      const filename = generateFilename(searchContext, 'json');
      const filepath = `${config.outputDir}/${filename}`;
      const result = await exportJson(unique, filepath);
      console.log(`✅ JSON出力: ${result.filepath} (${result.count}件)`);
    }

  } finally {
    await browser.close();
  }
}

// ── スクレイピングループ ──────────────────────────────────────────────────────

async function scrapeLoop(
  page: Page,
  config: ScrapeConfig,
  collectedUrls: Set<string>,
  results: PlaceData[],
): Promise<void> {
  let noNewCount = 0;
  const MAX_NO_NEW = 5;

  while (results.length < config.maxItems) {
    // 全店舗リンクを取得
    const allSelectors = [
      SELECTORS.placeLink.primary,
      ...SELECTORS.placeLink.fallbacks,
    ].join(', ');

    const links = await page.$$(allSelectors);
    const newLinks = [];

    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href && !collectedUrls.has(href)) {
        newLinks.push({ element: link, href });
      }
    }

    if (newLinks.length === 0) {
      // リスト終端チェック
      if (await isEndOfList(page)) {
        console.log('\n📌 リストの終端に達しました。');
        break;
      }

      noNewCount++;
      if (noNewCount >= MAX_NO_NEW) {
        console.log(`\n📌 ${MAX_NO_NEW}回スクロールしても新要素なし。終了します。`);
        break;
      }

      await scrollFeed(page);
      await sleep(2000);
      continue;
    }

    noNewCount = 0;

    for (const { element, href } of newLinks) {
      if (results.length >= config.maxItems) break;

      // 処理済みとして登録（エラーでも再処理しない）
      collectedUrls.add(href);

      try {
        // 画面内にスクロール
        await element.scrollIntoViewIfNeeded();
        await sleep(300);

        // クリックして詳細パネルを開く
        await element.click();
        await waitForDetailPanel(page);

        // 詳細情報を抽出
        const extracted = await extractPlaceDetail(page, href);
        const place: PlaceData = { ...extracted, distanceKm: null };

        // フィルター適用
        const filtered = applyFilters(
          place,
          config.allowedCategories,
          config.radiusFilter,
        );

        if (filtered) {
          results.push(filtered);
          const distStr = filtered.distanceKm !== null ? ` (${filtered.distanceKm}km)` : '';
          console.log(`  [${results.length}/${config.maxItems}] ✅ ${filtered.name} — ${filtered.category}${distStr}`);
        } else {
          console.log(`  [skip] ${place.name} — category="${place.category}"`);
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [error] ${href.slice(0, 60)}... : ${msg}`);
        // 1件のエラーで全体を止めない
      }

      await sleep(500);
    }
  }
}
