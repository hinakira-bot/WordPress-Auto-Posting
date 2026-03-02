import { readFileSync, writeFileSync, existsSync } from 'fs';
import config from './config.js';
import logger from './logger.js';

const LOG_PATH = config.paths.postLog;
const KEYWORDS_PATH = config.paths.keywords;

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
 * キーワード一覧からアクティブなキーワードセットを取得
 * （keyword-manager.jsを直接importすると循環参照の恐れがあるため、ファイル直読み）
 */
function getActiveKeywords() {
  try {
    if (!existsSync(KEYWORDS_PATH)) return null;
    const data = JSON.parse(readFileSync(KEYWORDS_PATH, 'utf-8'));
    // keywords.jsonに存在するキーワード文字列のSetを返す
    return new Set(data.keywords.map(k => k.keyword).filter(Boolean));
  } catch {
    return null;
  }
}

/**
 * 投稿済み記事のインデックスを取得（内部リンク用）
 * 成功した投稿のみ、keyword / title / url / slug を返す
 * キーワード一覧から削除されたものは除外する
 * @returns {Array<{keyword: string, title: string, url: string, slug: string}>}
 */
export function getArticleIndex() {
  const posts = loadLog().posts;
  const activeKeywords = getActiveKeywords();

  return posts
    .filter(p => {
      if (!p.url || p.error || p.dryRun) return false;
      // キーワード一覧が読めた場合、削除済みキーワードを除外
      if (activeKeywords && p.keyword) {
        if (!activeKeywords.has(p.keyword)) {
          logger.info(`内部リンク候補から除外（キーワード削除済み）: "${p.keyword}"`);
          return false;
        }
      }
      return true;
    })
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
