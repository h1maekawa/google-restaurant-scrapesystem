# Google Maps Scraper

Google Mapsから店舗情報を自動収集し、CSV/JSON形式で出力するPlaywright + TypeScriptスクレイパーです。

## 機能

- ① **CSVファイル名自動生成** — 検索クエリから都道府県・市区町村・ジャンル・日付を抽出
- ② **Google Mapsカテゴリ取得** — 各店舗のGoogle Maps内部カテゴリを取得
- ③ **カテゴリフィルター** — 指定カテゴリのみ保存（部分一致対応）
- ④ **半径フィルター** — 中心座標から指定距離内のみ保存（Haversine formula）
- **CSV / JSON 両形式出力**
- **重複チェック** — URL単位で重複排除

## セットアップ

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## 使い方

1. `.env` を編集して設定する
2. スクレイパーを起動する
```bash
npm start
```
3. 自動で開いたChromeでGoogle Mapsを検索し、結果一覧を表示する
4. 自動でスクレイピングが開始される

## 設定（.env）

| 変数 | 説明 | 例 |
|---|---|---|
| `MAX_ITEMS` | 最大取得件数 | `100` |
| `OUTPUT_FORMAT` | 出力形式 (`csv` / `json` / `both`) | `both` |
| `OUTPUT_DIR` | 出力先ディレクトリ | `./output` |
| `ALLOWED_CATEGORIES` | 許可カテゴリ（カンマ区切り、空欄で全許可） | `カフェ,コーヒーショップ` |
| `RADIUS_KM` | 半径（km）。0で無効 | `3` |
| `CENTER_LAT` | 中心点の緯度 | `35.658581` |
| `CENTER_LNG` | 中心点の経度 | `139.745433` |

## テスト

```bash
npm test
```

## ディレクトリ構成

```
src/
├── core/
│   ├── scraper.ts      # メインスクレイピングロジック
│   ├── extractor.ts    # DOM抽出・座標抽出・クエリ解析
│   ├── filter.ts       # カテゴリ・半径フィルター
│   └── navigation.ts   # スクロール・クリック・待機
├── io/
│   ├── exporter.ts     # CSV / JSON出力
│   ├── filename.ts     # ファイル名自動生成
│   └── dedup.ts        # 重複チェック
├── selectors/
│   └── maps.selectors.ts  # DOMセレクター（変更耐性対策）
├── types/
│   └── index.ts        # 型定義
├── config/
│   ├── categories.json # カテゴリマスター
│   └── config.ts       # .env読み込み
└── index.ts            # エントリーポイント
```

## Google Maps DOM変更への対応

`src/selectors/maps.selectors.ts` にすべてのセレクターを集約しています。
Google MapsのDOM構造が変わった場合は、このファイルの `fallbacks` 配列に新しいセレクターを追加するだけで対応できます。

```typescript
category: {
  key: 'category',
  primary: '.DkEaL',           // 現行セレクター
  fallbacks: [
    'button[jsaction*="category"]',
    '.NewSelector',            // ← ここに追加するだけ
  ],
},
```
