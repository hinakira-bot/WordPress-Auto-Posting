# ============================================
# WordPress自動投稿ツール - Docker イメージ
# ============================================

# --- ステージ1: ビルド ---
FROM node:20-slim AS builder

WORKDIR /app

# 依存関係のインストール
COPY package.json package-lock.json* ./
RUN npm ci

# ソースコードをコピーしてビルド
COPY . .
RUN npm run build

# --- ステージ2: 本番 ---
FROM node:20-slim AS runner

WORKDIR /app

# 本番依存関係のみインストール
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ビルド成果物をコピー
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/ecosystem.config.cjs ./ecosystem.config.cjs
COPY --from=builder /app/.env.example ./.env.example

# データ・ログ・画像・ナレッジ用ディレクトリ（ボリュームマウント用）
RUN mkdir -p data logs images knowledge

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Next.js 本番サーバー起動
CMD ["npx", "next", "start", "-p", "3000"]
