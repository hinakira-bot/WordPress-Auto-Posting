import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import * as cheerio from 'cheerio';
import config from './config.js';
import logger from './logger.js';
import { getSetting } from './settings-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_UPLOAD_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Helper: sleep
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Helper: Translate WordPress REST API errors into Japanese messages
// ---------------------------------------------------------------------------

function translateApiError(status, body) {
  if (status === 401) {
    return '認証失敗: ユーザー名またはアプリケーションパスワードを確認してください';
  }
  if (status === 403) {
    return '権限不足: 投稿権限のあるユーザーか確認してください';
  }
  if (status === 404) {
    return 'REST APIエンドポイントが見つかりません。パーマリンク設定を「投稿名」に変更してください';
  }

  // Check for rest_no_route in body
  if (body && typeof body === 'object' && body.code === 'rest_no_route') {
    return 'REST APIが無効です。セキュリティプラグインの設定を確認してください';
  }

  return null;
}

function translateNetworkError(err) {
  if (
    err.code === 'ECONNREFUSED' ||
    err.code === 'ENOTFOUND' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNRESET' ||
    err.cause?.code === 'ECONNREFUSED' ||
    err.cause?.code === 'ENOTFOUND' ||
    err.cause?.code === 'ETIMEDOUT' ||
    err.cause?.code === 'ECONNRESET'
  ) {
    return '接続できません。サイトURLとSSL設定を確認してください';
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. getAuthHeader
// ---------------------------------------------------------------------------

function getAuthHeader() {
  const username = config.wordpress?.username || process.env.WP_USERNAME || '';
  const appPassword = config.wordpress?.applicationPassword || process.env.WP_APP_PASSWORD || '';

  if (!username || !appPassword) {
    throw new Error('WordPress認証情報が未設定です。WP_USERNAME と WP_APP_PASSWORD を設定してください');
  }

  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
  return `Basic ${credentials}`;
}

// ---------------------------------------------------------------------------
// 2. getApiBase
// ---------------------------------------------------------------------------

function getApiBase() {
  const siteUrl = config.wordpress?.siteUrl || process.env.WP_SITE_URL || '';

  if (!siteUrl) {
    throw new Error('WordPress サイトURLが未設定です。WP_SITE_URL を設定してください');
  }

  // Remove trailing slash
  const normalized = siteUrl.replace(/\/+$/, '');
  return `${normalized}/wp-json/wp/v2`;
}

// ---------------------------------------------------------------------------
// Helper: Authenticated fetch wrapper
// ---------------------------------------------------------------------------

async function wpFetch(endpoint, options = {}) {
  const apiBase = getApiBase();
  const url = endpoint.startsWith('http') ? endpoint : `${apiBase}${endpoint}`;

  const headers = {
    Authorization: getAuthHeader(),
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    return response;
  } catch (err) {
    const networkMsg = translateNetworkError(err);
    if (networkMsg) {
      throw new Error(networkMsg);
    }
    throw err;
  }
}

async function wpFetchJSON(endpoint, options = {}) {
  const response = await wpFetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const translated = translateApiError(response.status, body);
    if (translated) {
      throw new Error(translated);
    }
    const detail = body?.message || body?.code || response.statusText;
    throw new Error(`WordPress API エラー (${response.status}): ${detail}`);
  }

  return body;
}

// ---------------------------------------------------------------------------
// 3. testWordPressConnection
// ---------------------------------------------------------------------------

export async function testWordPressConnection() {
  logger.info('WordPress接続テスト開始...');

  try {
    const apiBase = getApiBase();
    logger.info(`API Base: ${apiBase}`);

    // GET /users/me to verify connection, auth, and permissions
    const user = await wpFetchJSON('/users/me?context=edit');

    // Also try to get site info
    let siteName = '';
    try {
      const siteUrl = config.wordpress?.siteUrl || process.env.WP_SITE_URL || '';
      const normalized = siteUrl.replace(/\/+$/, '');
      const siteResponse = await fetch(`${normalized}/wp-json`);
      if (siteResponse.ok) {
        const siteInfo = await siteResponse.json();
        siteName = siteInfo.name || '';
      }
    } catch {
      // Site name retrieval is non-critical
      siteName = '';
    }

    const userName = user.name || user.slug || '';
    const capabilities = user.capabilities || {};

    // Check publishing capability
    if (!capabilities.publish_posts && !capabilities.edit_posts) {
      logger.warn(`ユーザー "${userName}" に投稿権限がない可能性があります`);
    }

    logger.info(`WordPress接続成功 - サイト: ${siteName}, ユーザー: ${userName}`);

    return {
      success: true,
      siteName,
      userName,
    };
  } catch (err) {
    logger.error(`WordPress接続テスト失敗: ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// 4. uploadMedia
// ---------------------------------------------------------------------------

async function uploadMedia(filePath, altText = '') {
  const fileName = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  logger.info(`メディアアップロード開始: ${fileName} (${mimeType})`);

  let lastError;

  for (let attempt = 1; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    try {
      const fileBuffer = readFileSync(filePath);
      const blob = new Blob([fileBuffer], { type: mimeType });

      const formData = new FormData();
      formData.append('file', blob, fileName);
      if (altText) {
        formData.append('alt_text', altText);
      }

      const response = await wpFetch('/media', {
        method: 'POST',
        body: formData,
        // Do NOT set Content-Type header; fetch will set multipart boundary automatically
      });

      let body;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        const translated = translateApiError(response.status, body);
        if (translated) {
          throw new Error(translated);
        }
        const detail = body?.message || body?.code || response.statusText;
        throw new Error(`メディアアップロードエラー (${response.status}): ${detail}`);
      }

      logger.info(`メディアアップロード成功: ID=${body.id}, URL=${body.source_url}`);

      return {
        id: body.id,
        url: body.source_url,
      };
    } catch (err) {
      lastError = err;

      // Do not retry on auth/permission errors
      if (
        err.message.includes('認証失敗') ||
        err.message.includes('権限不足')
      ) {
        throw err;
      }

      if (attempt < MAX_UPLOAD_RETRIES) {
        logger.warn(
          `メディアアップロード失敗 (${attempt}/${MAX_UPLOAD_RETRIES}): ${err.message} - ${RETRY_DELAY_MS}ms後にリトライ`
        );
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  logger.error(`メディアアップロード最終失敗: ${lastError.message}`);
  throw lastError;
}

// ---------------------------------------------------------------------------
// 5. getOrCreateCategory
// ---------------------------------------------------------------------------

async function getOrCreateCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;

  logger.debug(`カテゴリ検索: "${trimmed}"`);

  try {
    // Search for existing category
    const categories = await wpFetchJSON(
      `/categories?search=${encodeURIComponent(trimmed)}&per_page=100`
    );

    // Find exact match (case-insensitive)
    const exactMatch = categories.find(
      (cat) => cat.name.toLowerCase() === trimmed.toLowerCase()
    );

    if (exactMatch) {
      logger.debug(`カテゴリ発見: "${trimmed}" → ID=${exactMatch.id}`);
      return exactMatch.id;
    }

    // Create new category
    logger.info(`カテゴリ作成: "${trimmed}"`);
    const created = await wpFetchJSON('/categories', {
      method: 'POST',
      body: JSON.stringify({ name: trimmed }),
    });

    logger.info(`カテゴリ作成成功: "${trimmed}" → ID=${created.id}`);
    return created.id;
  } catch (err) {
    logger.warn(`カテゴリ処理エラー ("${trimmed}"): ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 6. getOrCreateTag
// ---------------------------------------------------------------------------

async function getOrCreateTag(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;

  logger.debug(`タグ検索: "${trimmed}"`);

  try {
    // Search for existing tag
    const tags = await wpFetchJSON(
      `/tags?search=${encodeURIComponent(trimmed)}&per_page=100`
    );

    // Find exact match (case-insensitive)
    const exactMatch = tags.find(
      (tag) => tag.name.toLowerCase() === trimmed.toLowerCase()
    );

    if (exactMatch) {
      logger.debug(`タグ発見: "${trimmed}" → ID=${exactMatch.id}`);
      return exactMatch.id;
    }

    // Create new tag
    logger.info(`タグ作成: "${trimmed}"`);
    const created = await wpFetchJSON('/tags', {
      method: 'POST',
      body: JSON.stringify({ name: trimmed }),
    });

    logger.info(`タグ作成成功: "${trimmed}" → ID=${created.id}`);
    return created.id;
  } catch (err) {
    logger.warn(`タグ処理エラー ("${trimmed}"): ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. resolveTagIds
// ---------------------------------------------------------------------------

async function resolveTagIds(hashtagString) {
  if (!hashtagString || typeof hashtagString !== 'string') return [];

  // Split by comma, space, or hash
  const names = hashtagString
    .split(/[,\s#]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (names.length === 0) return [];

  logger.info(`タグ解決中: ${names.join(', ')}`);

  const ids = [];
  for (const name of names) {
    const id = await getOrCreateTag(name);
    if (id !== null) {
      ids.push(id);
    }
  }

  logger.info(`タグ解決完了: ${ids.length}件`);
  return ids;
}

// ---------------------------------------------------------------------------
// 8. resolveCategoryIds
// ---------------------------------------------------------------------------

async function resolveCategoryIds(categoryString) {
  if (!categoryString || typeof categoryString !== 'string') return [];

  // Split by comma or space
  const names = categoryString
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (names.length === 0) return [];

  logger.info(`カテゴリ解決中: ${names.join(', ')}`);

  const ids = [];
  for (const name of names) {
    const id = await getOrCreateCategory(name);
    if (id !== null) {
      ids.push(id);
    }
  }

  logger.info(`カテゴリ解決完了: ${ids.length}件`);
  return ids;
}

// ---------------------------------------------------------------------------
// 9. embedDiagramImages
// ---------------------------------------------------------------------------

function embedDiagramImages(bodyHtml, diagrams, uploadedDiagrams) {
  if (!diagrams || diagrams.length === 0) return bodyHtml;
  if (!uploadedDiagrams || uploadedDiagrams.length === 0) return bodyHtml;

  const $ = cheerio.load(bodyHtml, { decodeEntities: false });
  const h2Elements = $('h2');

  // Process in reverse order to avoid index shifting
  const diagramsToInsert = [];

  for (let i = 0; i < diagrams.length; i++) {
    const diagram = diagrams[i];
    const uploaded = uploadedDiagrams[i];

    // Skip diagrams with null imagePath (summary sections) or failed uploads
    if (!diagram.imagePath || !uploaded || !uploaded.url) {
      continue;
    }

    const targetIndex = diagram.index !== undefined ? diagram.index : i;
    const h2Text = diagram.h2 || '';

    diagramsToInsert.push({
      targetIndex,
      h2Text,
      url: uploaded.url,
    });
  }

  // Sort by targetIndex descending for reverse-order insertion
  diagramsToInsert.sort((a, b) => b.targetIndex - a.targetIndex);

  for (const { targetIndex, h2Text, url } of diagramsToInsert) {
    const targetH2 = h2Elements.eq(targetIndex);

    if (targetH2.length === 0) {
      logger.warn(`H2要素が見つかりません (index=${targetIndex}): "${h2Text}"`);
      continue;
    }

    const altText = h2Text || 'diagram';
    const figureHtml = `<figure class="wp-block-image size-large"><img src="${url}" alt="${altText}" width="800" /><figcaption>${altText}</figcaption></figure>`;

    targetH2.after(figureHtml);
    logger.debug(`図解挿入: index=${targetIndex}, h2="${h2Text}"`);
  }

  return $.html();
}

// ---------------------------------------------------------------------------
// 10. postToWordPress (Main)
// ---------------------------------------------------------------------------

export async function postToWordPress(article, imageFiles, options = {}) {
  const startTime = Date.now();

  logger.info('========================================');
  logger.info('  WordPress REST API 投稿処理開始');
  logger.info('========================================');
  logger.info(`タイトル: ${article.title}`);

  // --- Dry run check ---
  const isDryRun = options.dryRun ?? config.dryRun;
  if (isDryRun) {
    logger.info('[ドライラン] WordPress投稿をスキップします');
    logger.info(`  タイトル: ${article.title}`);
    logger.info(`  見出し数: ${article.outline?.length || 0}`);
    logger.info(`  本文長: ${article.bodyHtml?.length || 0}文字`);
    logger.info(`  アイキャッチ: ${imageFiles?.eyecatchPath || 'なし'}`);
    const diagramCount = imageFiles?.diagrams?.filter((d) => d.imagePath).length || 0;
    logger.info(`  図解: ${diagramCount}枚`);

    return {
      success: true,
      dryRun: true,
      title: article.title,
    };
  }

  try {
    // --- Step 1: Upload eyecatch (featured image) ---
    let featuredMediaId = null;

    if (imageFiles?.eyecatchPath) {
      logger.info('--- アイキャッチ画像アップロード ---');
      try {
        const eyecatchResult = await uploadMedia(
          imageFiles.eyecatchPath,
          article.title || article.keyword || 'eyecatch'
        );
        featuredMediaId = eyecatchResult.id;
        logger.info(`アイキャッチ設定: ID=${featuredMediaId}`);
      } catch (err) {
        logger.error(`アイキャッチアップロード失敗: ${err.message}`);
        // Continue without featured image rather than failing the entire post
      }
    } else {
      logger.info('アイキャッチ画像なし - スキップ');
    }

    // --- Step 2: Upload diagram images ---
    const uploadedDiagrams = [];

    if (imageFiles?.diagrams && imageFiles.diagrams.length > 0) {
      logger.info('--- 図解画像アップロード ---');

      for (let i = 0; i < imageFiles.diagrams.length; i++) {
        const diagram = imageFiles.diagrams[i];

        if (!diagram.imagePath) {
          logger.debug(`図解 ${i} スキップ (imagePath=null)`);
          uploadedDiagrams.push(null);
          continue;
        }

        try {
          const altText = diagram.h2 || `diagram-${i}`;
          const result = await uploadMedia(diagram.imagePath, altText);
          uploadedDiagrams.push(result);
          logger.info(`図解 ${i} アップロード成功: "${diagram.h2 || ''}" → ID=${result.id}`);
        } catch (err) {
          logger.error(`図解 ${i} アップロード失敗: ${err.message}`);
          uploadedDiagrams.push(null);
        }
      }

      const uploadedCount = uploadedDiagrams.filter((d) => d !== null).length;
      logger.info(`図解アップロード完了: ${uploadedCount}/${imageFiles.diagrams.length}枚`);
    }

    // --- Step 3: Embed diagram images into HTML ---
    let finalHtml = article.bodyHtml || '';

    if (imageFiles?.diagrams && uploadedDiagrams.length > 0) {
      logger.info('--- 図解をHTML本文に埋め込み ---');
      finalHtml = embedDiagramImages(finalHtml, imageFiles.diagrams, uploadedDiagrams);
    }

    // --- Step 4: Resolve tags and categories ---
    let tagIds = [];
    let categoryIds = [];

    // Tags from options.hashtags
    const hashtagString = options.hashtags || '';
    if (hashtagString) {
      logger.info('--- タグ解決 ---');
      tagIds = await resolveTagIds(hashtagString);
    }

    // Categories from settings
    const categoryString = getSetting('article.defaultCategory', '') || config.posting?.category || '';
    if (categoryString) {
      logger.info('--- カテゴリ解決 ---');
      categoryIds = await resolveCategoryIds(categoryString);
    }

    // --- Step 5: Create post ---
    logger.info('--- WordPress投稿作成 ---');

    const postData = {
      title: article.title,
      content: finalHtml,
      status: 'publish',
    };

    if (featuredMediaId) {
      postData.featured_media = featuredMediaId;
    }

    if (tagIds.length > 0) {
      postData.tags = tagIds;
    }

    if (categoryIds.length > 0) {
      postData.categories = categoryIds;
    }

    logger.info(`投稿データ: title="${article.title}", tags=${tagIds.length}件, categories=${categoryIds.length}件, featured_media=${featuredMediaId || 'なし'}`);

    const post = await wpFetchJSON('/posts', {
      method: 'POST',
      body: JSON.stringify(postData),
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    logger.info('========================================');
    logger.info(`  WordPress投稿成功! (${elapsed}秒)`);
    logger.info(`  投稿ID: ${post.id}`);
    logger.info(`  URL: ${post.link}`);
    logger.info(`  タイトル: ${article.title}`);
    logger.info('========================================');

    return {
      success: true,
      url: post.link,
      title: article.title,
    };
  } catch (err) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    logger.error('========================================');
    logger.error(`  WordPress投稿失敗 (${elapsed}秒)`);
    logger.error(`  エラー: ${err.message}`);
    logger.error('========================================');

    if (err.stack) {
      logger.debug(err.stack);
    }

    return {
      success: false,
      error: err.message,
      title: article.title,
    };
  }
}
