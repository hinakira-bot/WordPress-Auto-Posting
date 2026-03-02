# WordPress 自動投稿ツール

Gemini AI を使って SEO に強いブログ記事を自動生成し、WordPress REST API で自動投稿するツールです。SWELL テーマのデコレーション（Gutenberg ブロック + SWELL CSS クラス）に対応しています。

## 機能

- **AI記事生成（7ステップ）** - Gemini で検索意図分析→見出し構成→タイトル→リード文→本文→まとめ→結合の7段階パイプライン
- **SWELL装飾対応** - Gutenberg ブロック + SWELL CSS クラスで装飾付き記事を生成
- **AI画像生成** - アイキャッチ画像・図解画像を自動生成（別プロンプト設定可）
- **WordPress REST API投稿** - Application Passwords 認証で安全に自動投稿
- **WPメディアライブラリ** - 画像を WP Media Library API 経由でアップロード
- **Web UI** - ブラウザから全機能を操作（ダッシュボード・キーワード管理・設定など）
- **CLI** - コマンドラインからも操作可能
- **スケジュール投稿** - 毎日・平日のみ・1日2回など柔軟に設定
- **ナレッジ管理** - テキスト/PDFをアップロードして記事生成の参考資料に
- **プロンプトカスタマイズ** - リード文・本文・まとめ文など各ステップのテンプレートを自由に編集
- **CTA設定** - Web UI の設定画面から CTA（行動喚起）を自由にカスタマイズ

## 動作要件

- **Node.js 18以上**
- **OS**: Windows / macOS / Linux
- **Gemini APIキー**（[Google AI Studio](https://aistudio.google.com/apikey) で無料取得）
- **WordPress サイト**（WordPress 5.6 以上、Application Passwords 有効）

> ℹ️ **Playwright は不要です。**
> WordPress REST API を使用するため、ブラウザ自動操作の依存はありません。
> ローカルPC、VPS、Docker いずれの環境でも動作します。

---

## クイックスタート（ローカルPC）

```bash
# 1. クローン
git clone https://github.com/hinakira-bot/WordPress-Auto-Posting.git
cd WordPress-Auto-Posting

# 2. インストール
npm install

# 3. Web UIを起動
npm run dev
# → http://localhost:3000 にアクセス
# → 初回は自動でセットアップ画面が表示されます
```

セットアップ画面で以下を入力するだけで使えます：
- Gemini APIキー
- WordPress サイトURL・ユーザー名・アプリケーションパスワード

### Application Passwords の取得方法

1. WordPress 管理画面 → ユーザー → プロフィール
2. 「アプリケーションパスワード」セクションで新しいパスワード名を入力
3. 「新しいアプリケーションパスワードを追加」をクリック
4. 表示されたパスワードを `.env` に設定

---

## Docker でのセットアップ（推奨）

VPS に SSH 接続後、以下の1コマンドで全自動インストールできます：

```bash
curl -fsSL https://raw.githubusercontent.com/hinakira-bot/WordPress-Auto-Posting/main/install.sh | bash
```

対話形式で Gemini APIキー・WordPress接続情報を入力すれば、自動でセットアップが完了します。

### Docker 手動セットアップ

```bash
# クローン
git clone https://github.com/hinakira-bot/WordPress-Auto-Posting.git /opt/wordpress-tool
cd /opt/wordpress-tool

# .env を作成して設定を入力
cp .env.example .env
nano .env

# 起動
docker compose up -d --build
```

### Docker コマンド一覧

```bash
docker compose logs -f        # ログ確認
docker compose restart         # 再起動
docker compose down            # 停止
git pull && docker compose up -d --build  # アップデート
```

---

## VPS へのデプロイ（Docker なし）

### 推奨VPS

| サービス | 最低プラン | 月額目安 |
|---------|-----------|---------|
| Xserver VPS | 2GB | ¥830〜 |
| ConoHa VPS | 1GB | ¥750〜 |
| さくらVPS | 1GB | ¥880〜 |
| AWS Lightsail | 1GB | $5〜 |

Ubuntu 22.04 以上を推奨。

### 1. サーバー初期設定

```bash
# SSH接続
ssh root@your-server-ip

# Node.js インストール（v20推奨）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2（プロセスマネージャー）
sudo npm install -g pm2
```

### 2. アプリのデプロイ

```bash
# クローン
cd /opt
git clone https://github.com/hinakira-bot/WordPress-Auto-Posting.git wordpress-tool
cd wordpress-tool

# インストール
npm install

# ビルド（本番用）
npm run build
```

### 3. 環境変数の設定

```bash
# .envファイルを作成
cp .env.example .env
nano .env
```

`.env` に以下を入力して保存（Ctrl+X → Y → Enter）：

```
GEMINI_API_KEY=AIzaSy...あなたのキー
WORDPRESS_SITE_URL=https://your-wordpress-site.com
WORDPRESS_USERNAME=あなたのユーザー名
WORDPRESS_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

> もしくは Web UI のセットアップ画面からも設定できます。

### 4. PM2 で常時起動

```bash
# 起動（ポート3000）
pm2 start ecosystem.config.cjs

# 自動起動設定（サーバー再起動時も自動復帰）
pm2 startup
pm2 save

# 動作確認
pm2 status
pm2 logs wp-tool
```

### 5. ポート開放・アクセス

```bash
# ファイアウォール設定
sudo ufw allow 3000

# アクセス
# → http://your-server-ip:3000
```

#### （任意）Nginx リバースプロキシ + ドメイン設定

```bash
sudo apt install nginx -y

sudo tee /etc/nginx/sites-available/wordpress-tool > /dev/null << 'NGINX'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

sudo ln -s /etc/nginx/sites-available/wordpress-tool /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS が必要な場合は Let's Encrypt を追加：
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

### 6. アップデート方法

```bash
cd /opt/wordpress-tool
git pull
npm install
npm run build
pm2 restart wp-tool
```

---

## CLI の使い方

Web UI を使わず、コマンドラインからも操作できます。

```bash
# 初期設定（対話式）
npm run setup

# キーワード追加
npm run add "副業 在宅ワーク 始め方"

# キーワード一覧
npm run list

# 1回投稿（ドライラン）
npm run post:dry

# 1回投稿（本番）
npm run post

# 自動投稿開始（cronスケジュール）
npm run start

# テスト
npm run test:gemini       # Gemini API接続テスト
npm run test:search       # 競合分析テスト
npm run test:connection   # WordPress接続テスト
```

---

## ディレクトリ構成

```
├── src/
│   ├── app/              # Next.js Web UI
│   │   ├── api/          # APIルート
│   │   ├── keywords/     # キーワード管理ページ
│   │   ├── knowledge/    # ナレッジ管理ページ
│   │   ├── prompts/      # プロンプト編集ページ
│   │   ├── settings/     # 設定ページ
│   │   ├── setup/        # 初回セットアップ
│   │   └── logs/         # 投稿ログページ
│   ├── components/       # UIコンポーネント
│   ├── lib/              # ユーティリティ
│   ├── index.js          # CLIエントリーポイント
│   ├── pipeline.js       # 7ステップ投稿パイプライン
│   ├── content-generator.js    # AI記事生成（検索意図→見出し→タイトル→リード→本文→まとめ→結合）
│   ├── image-generator.js      # AI画像生成
│   ├── competitor-analyzer.js  # 競合分析
│   ├── wordpress-poster.js     # WordPress REST API投稿
│   └── gutenberg-converter.js  # Gutenberg ブロック + SWELL装飾変換
├── prompts/defaults/     # プロンプトテンプレート（リード文・本文・まとめ文など）
├── knowledge/            # ナレッジファイル
├── data/                 # データ（キーワード・ログ・設定）
├── images/               # 生成画像
└── logs/                 # アプリログ
```

---

## ライセンス

Private - All rights reserved
