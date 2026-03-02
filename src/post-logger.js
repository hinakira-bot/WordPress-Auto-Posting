import { readFileSync, writeFileSync, existsSync } from 'fs';
import config from './config.js';

const LOG_PATH = config.paths.postLog;

function loadLog() {
  if (!existsSync(LOG_PATH)) {
    writeFileSync(LOG_PATH, JSON.stringify({ posts: [] }, null, 2), 'utf-8');
    return { posts: [] };
  }
  return JSON.parse(readFileSync(LOG_PATH, 'utf-8'));
}

/** 投稿ログを記録 */
export function logPost(entry) {
  const data = loadLog();
  data.posts.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  writeFileSync(LOG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/** 投稿ログ一覧を取得 */
export function getPostLog() {
  return loadLog().posts;
}

/**
 * 投稿済み記事のインデックスを取得（内部リンク用）
 * 成功した投稿のみ、keyword / title / url / slug を返す
 * @returns {Array<{keyword: string, title: string, url: string, slug: string}>}
 */
export function getArticleIndex() {
  const posts = loadLog().posts;
  return posts
    .filter(p => p.url && !p.error && !p.dryRun)
    .map(p => ({
      keyword: p.keyword || '',
      title: p.title || '',
      url: p.url || '',
      slug: p.slug || '',
    }));
}

/**
 * 内部リンク用のテキスト表現を生成
 * プロンプトに渡すためのフォーマット済み文字列
 * @returns {string}
 */
export function getArticleIndexForPrompt() {
  const articles = getArticleIndex();
  if (articles.length === 0) return '';

  const lines = articles.map(a =>
    `- 「${a.title}」: ${a.url}`
  );

  return `以下は自サイトの既存記事一覧です。関連する記事があれば内部リンクとして挿入してください：\n${lines.join('\n')}`;
}
