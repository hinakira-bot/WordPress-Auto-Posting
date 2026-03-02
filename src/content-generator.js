import { GoogleGenerativeAI } from '@google/generative-ai';
import config from './config.js';
import logger from './logger.js';
import { loadPrompt, renderPrompt } from './prompt-manager.js';
import { formatAnalysisForPrompt, formatLatestNewsForPrompt } from './competitor-analyzer.js';
import { getSetting } from './settings-manager.js';
import { applySWELLDecorations, convertToGutenbergBlocks } from './gutenberg-converter.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const textModel = genAI.getGenerativeModel({ model: config.gemini.textModel });

/**
 * STEP 1: 検索意図を分析
 */
async function analyzeSearchIntent(keyword, analysisData, baseVars) {
  logger.info(`検索意図を分析中: "${keyword || '(説明のみモード)'}"`);

  const template = loadPrompt('article-search-intent');
  const prompt = renderPrompt(template, {
    ...baseVars,
    analysisData: formatAnalysisForPrompt(analysisData),
  });

  const result = await textModel.generateContent(prompt);
  const text = result.response.text();
  return parseJSON(text);
}

/**
 * STEP 2: 見出し構成を作成
 */
async function generateOutline(keyword, analysisData, searchIntent, baseVars) {
  logger.info(`見出し構成を作成中: "${keyword || '(説明のみモード)'}"`);

  const template = loadPrompt('article-outline');
  const prompt = renderPrompt(template, {
    ...baseVars,
    searchIntent: JSON.stringify(searchIntent, null, 2),
    analysisData: formatAnalysisForPrompt(analysisData),
  });

  const result = await textModel.generateContent(prompt);
  const text = result.response.text();
  return parseJSON(text);
}

/**
 * STEP 3: タイトルを生成
 */
async function generateTitle(keyword, outline, searchIntent, baseVars) {
  logger.info(`タイトルを生成中: "${keyword || '(説明のみモード)'}"`);

  const headings = outline.outline.map((o) => o.h2).join(' / ');

  const template = loadPrompt('article-title');
  const prompt = renderPrompt(template, {
    ...baseVars,
    headings,
    userNeeds: searchIntent.userNeeds,
  });

  const result = await textModel.generateContent(prompt);
  const text = result.response.text();
  return parseJSON(text);
}

/**
 * STEP 4: リード文を生成
 */
async function generateLead(keyword, title, outline, searchIntent, baseVars) {
  logger.info(`リード文を生成中: "${keyword || '(説明のみモード)'}"`);
  const template = loadPrompt('article-lead');
  const headings = outline.outline.map((o) => o.h2).join(' / ');
  const prompt = renderPrompt(template, {
    ...baseVars,
    title,
    headings,
    userNeeds: searchIntent.userNeeds,
    targetAudience: baseVars.settingsTargetAudience || searchIntent.targetAudience || '',
  });
  const result = await textModel.generateContent(prompt);
  let leadHtml = result.response.text().replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
  logger.info(`リード文生成完了: ${leadHtml.length}文字`);
  return leadHtml;
}

/**
 * STEP 5: 本文を生成（リード文・まとめ除く）
 */
async function generateBody(keyword, title, outline, searchIntent, baseVars) {
  logger.info(`本文を生成中: "${keyword || '(説明のみモード)'}"`);

  // 「まとめ」セクションを除外
  const filteredOutline = outline.outline.filter((o, i, arr) => {
    if (i === arr.length - 1 && o.h2.includes('まとめ')) return false;
    return true;
  });

  const outlineText = filteredOutline
    .map(
      (o) =>
        `## ${o.h2}\n${o.h3s.map((h3) => `### ${h3}`).join('\n')}`
    )
    .join('\n\n');

  // 設定のターゲット読者が優先、なければAI分析結果を使用
  const targetAudience = baseVars.settingsTargetAudience || searchIntent.targetAudience || '';
  if (baseVars.settingsTargetAudience) {
    logger.info(`ターゲット読者（設定値）: ${baseVars.settingsTargetAudience}`);
  }

  const template = loadPrompt('article-body');
  const prompt = renderPrompt(template, {
    ...baseVars,
    title,
    outline: outlineText,
    userNeeds: searchIntent.userNeeds,
    targetAudience,
  });

  const result = await textModel.generateContent(prompt);
  let bodyHtml = result.response.text().replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

  return bodyHtml;
}

/**
 * STEP 6: まとめ文を生成
 */
async function generateSummary(keyword, title, outline, searchIntent, bodyHtml, baseVars) {
  logger.info(`まとめ文を生成中: "${keyword || '(説明のみモード)'}"`);
  const template = loadPrompt('article-summary');
  const prompt = renderPrompt(template, {
    ...baseVars,
    title,
    userNeeds: searchIntent.userNeeds,
    targetAudience: baseVars.settingsTargetAudience || searchIntent.targetAudience || '',
    bodyPreview: bodyHtml.replace(/<[^>]*>/g, '').slice(0, 1000),
  });
  const result = await textModel.generateContent(prompt);
  let summaryHtml = result.response.text().replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
  logger.info(`まとめ文生成完了: ${summaryHtml.length}文字`);
  return summaryHtml;
}

/**
 * テキストを日本語の文末（。！？）で個別の文に分割
 */
function splitIntoSentences(text) {
  // 。！？!? + 直後の閉じ括弧をキャプチャグループで分割
  const parts = text.split(/([。！？!?][）」』】\)]*)/);
  const sentences = [];
  let current = '';

  for (let i = 0; i < parts.length; i++) {
    current += parts[i];
    // 奇数インデックスは区切り文字（句点+閉じ括弧） → 文の終わり
    if (i % 2 === 1) {
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
    }
  }
  // 最後の残り（句点なしで終わる文）
  const remaining = current.trim();
  if (remaining) sentences.push(remaining);

  return sentences;
}

/**
 * <p>タグ内の複数文を1文ずつ個別の<p>タグに分割
 * スマホでの読みやすさを重視し、各文を独立した段落にする
 *
 * 処理手順:
 * 1. <p>タグで囲まれたテキストの中に複数の文があれば分割
 * 2. ブロック要素間の裸テキスト（<p>なし）も<p>で囲んで分割
 */
function splitSentencesToParagraphs(html) {
  // === Step 1: <p>タグ内の複数文を分割 ===
  let result = html.replace(/<p>([\s\S]*?)<\/p>/gi, (match, content) => {
    // HTMLタグを除去してテキスト部分のみ取得
    const textOnly = content.replace(/<[^>]*>/g, '').trim();

    // 短いテキスト（1文程度）はスキップ
    if (textOnly.length < 40) return match;

    // 文末の数をカウント
    const endCount = (textOnly.match(/[。！？!?]/g) || []).length;
    if (endCount <= 1) return match;

    // 文ごとに分割（テキストベース、インラインHTMLは除去される）
    const sentences = splitIntoSentences(textOnly);
    if (sentences.length <= 1) return match;

    return sentences.map(s => `<p>${s}</p>`).join('\n');
  });

  // === Step 2: ブロック要素間の裸テキストを<p>で囲む ===
  // AIが<p>タグなしでテキストを出力した場合の対策
  // 例: </h2>テキスト。テキスト。<h3> → </h2><p>テキスト。</p><p>テキスト。</p><h3>
  result = result.replace(
    /(<\/h[23]>)\s*\n?((?:(?!<(?:h[23]|p|ul|ol|table|blockquote|div|img)\b)[\s\S])+?)(\s*<(?:h[23]|p|ul|ol|table|blockquote|div|img)\b)/gi,
    (match, closeTag, textBlock, nextTag) => {
      const text = textBlock.replace(/<[^>]*>/g, '').trim();
      if (!text || text.length < 10) return match;

      const sentences = splitIntoSentences(text);
      if (sentences.length === 0) return match;

      const pTags = sentences.map(s => `<p>${s}</p>`).join('\n');
      return `${closeTag}\n${pTags}\n${nextTag}`;
    }
  );

  return result;
}

/**
 * CTA（コールトゥアクション）を記事本文に挿入
 * - 最初の<h2>の直前に短いCTA
 * - 記事末尾に詳細CTA
 * 設定で有効/無効を制御
 */
function insertCTA(html) {
  const ctaEnabled = getSetting('cta.enabled', false);
  if (!ctaEnabled) {
    logger.info('CTA挿入: 無効（設定でOFF）');
    return html;
  }
  const ctaUrl = getSetting('cta.url', '');
  const ctaText = getSetting('cta.text', '詳しくはこちら');
  const ctaDescription = getSetting('cta.description', '');
  if (!ctaUrl) {
    logger.info('CTA挿入: URLが未設定のためスキップ');
    return html;
  }
  // Short CTA before first h2
  const shortCTA = `<p>▶ <a href="${ctaUrl}">${ctaText}</a></p>`;
  const firstH2Match = html.match(/<h2[\s>]/i);
  if (firstH2Match) {
    const insertPos = html.indexOf(firstH2Match[0]);
    html = html.slice(0, insertPos) + shortCTA + '\n' + html.slice(insertPos);
    logger.info('CTA挿入: 最初のh2前');
  }
  // Detailed CTA at end
  let detailedCTA = '';
  if (ctaDescription) {
    detailedCTA = `<p>${ctaDescription}</p>\n<p>▶ <a href="${ctaUrl}">${ctaText}</a></p>`;
  } else {
    detailedCTA = `<p>▶ <a href="${ctaUrl}">${ctaText}</a></p>`;
  }
  html = html + '\n' + detailedCTA;
  logger.info('CTA挿入: 記事末尾');
  return html;
}

/**
 * プレーンURL（<a>タグで囲まれていないURL）をテキストリンクに変換
 * 例: <p>https://example.com</p> → <p><a href="https://example.com">こちらのリンク</a></p>
 * 例: <p>詳しくは https://example.com をご覧ください</p>
 *   → <p>詳しくは <a href="https://example.com">こちら</a> をご覧ください</p>
 */
function convertPlainUrlsToLinks(html) {
  // <a>タグ内のURLはスキップし、それ以外のURLをリンクに変換
  // 1. まず<a>タグ部分を一時的にプレースホルダーに置換
  const aTagPlaceholders = [];
  let processed = html.replace(/<a\s[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    aTagPlaceholders.push(match);
    return `__ATAG_PLACEHOLDER_${aTagPlaceholders.length - 1}__`;
  });

  // 2. プレーンURLを検出してリンクに変換
  const urlRegex = /(https?:\/\/[^\s<>"'）」』】\)]+)/g;
  let convertCount = 0;
  processed = processed.replace(urlRegex, (url) => {
    convertCount++;
    // URLの前後のテキストから適切なリンクテキストを推測
    // シンプルに「こちら」テキストリンクにする
    return `<a href="${url}">こちらのリンク</a>`;
  });

  // 3. <a>タグプレースホルダーを復元
  for (let i = 0; i < aTagPlaceholders.length; i++) {
    processed = processed.replace(`__ATAG_PLACEHOLDER_${i}__`, aTagPlaceholders[i]);
  }

  if (convertCount > 0) {
    logger.info(`プレーンURL→リンク変換: ${convertCount}件`);
  }

  return processed;
}

/**
 * 記事全体を生成するメインフロー
 * @param {string} keyword - キーワード（空の場合あり）
 * @param {object} analysisData - 競合分析データ
 * @param {object} context - {description, knowledge, latestNews, mode}
 */
export async function generateArticle(keyword, analysisData, context = {}) {
  const { description = '', knowledge = '', latestNews = null, mode = 'keyword-only', existingArticles = '' } = context;
  logger.info(`=== 記事生成開始: "${keyword || description.slice(0, 30)}" (${mode}) ===`);

  // 最新情報をテキスト化
  const latestNewsText = latestNews ? formatLatestNewsForPrompt(latestNews) : '';
  if (latestNewsText) {
    logger.info(`最新情報をプロンプトに反映: ${latestNewsText.length}文字`);
  }

  // 設定からターゲット読者を取得
  const settingsTargetAudience = getSetting('article.targetAudience', '');

  // 全ステップ共通の変数
  const baseVars = {
    keyword: keyword || '(キーワード未指定)',
    description,
    knowledge,
    latestNews: latestNewsText,
    existingArticles,
    minLength: String(config.posting.minLength),
    maxLength: String(config.posting.maxLength),
    settingsTargetAudience,
  };

  // STEP 1: 検索意図分析
  const searchIntent = await analyzeSearchIntent(keyword, analysisData, baseVars);
  logger.info(`検索意図: ${searchIntent.searchIntent} - ${searchIntent.userNeeds}`);

  // STEP 2: 見出し構成
  const outline = await generateOutline(keyword, analysisData, searchIntent, baseVars);
  logger.info(`見出し構成: h2 × ${outline.outline.length}個`);

  // STEP 3: タイトル生成
  const titleData = await generateTitle(keyword, outline, searchIntent, baseVars);
  const title = titleData.titles[titleData.recommended || 0];
  logger.info(`タイトル: ${title}`);

  // STEP 4: リード文生成
  const leadHtml = await generateLead(keyword, title, outline, searchIntent, baseVars);

  // STEP 5: 本文生成（リード文・まとめ除く）
  const rawBodyHtml = await generateBody(keyword, title, outline, searchIntent, baseVars);

  // STEP 6: まとめ文生成
  const summaryHtml = await generateSummary(keyword, title, outline, searchIntent, rawBodyHtml, baseVars);

  // STEP 7: 結合 + 後処理
  let bodyHtml = leadHtml + '\n' + rawBodyHtml + '\n' + summaryHtml;

  // 1文ずつ改段落に変換
  const beforePCount = (bodyHtml.match(/<p>/gi) || []).length;
  bodyHtml = splitSentencesToParagraphs(bodyHtml);
  const afterPCount = (bodyHtml.match(/<p>/gi) || []).length;
  logger.info(`1文改段落処理: ${beforePCount}段落 → ${afterPCount}段落`);

  // プレーンURLをテキストリンクに変換
  bodyHtml = convertPlainUrlsToLinks(bodyHtml);

  // CTA挿入（設定ベース）
  bodyHtml = insertCTA(bodyHtml);

  // SWELL装飾変換
  const swellSettings = {
    swell: {
      enabled: getSetting('swell.enabled', true),
      gutenbergBlocks: getSetting('swell.gutenbergBlocks', true),
      captionBox: getSetting('swell.captionBox', true),
      stepBlock: getSetting('swell.stepBlock', true),
      faqBlock: getSetting('swell.faqBlock', true),
      balloonBlock: getSetting('swell.balloonBlock', true),
      checkList: getSetting('swell.checkList', true),
    },
  };
  bodyHtml = applySWELLDecorations(bodyHtml, swellSettings);
  bodyHtml = convertToGutenbergBlocks(bodyHtml, swellSettings);

  logger.info(`本文生成完了: ${bodyHtml.length}文字`);

  return {
    keyword,
    title,
    titleCandidates: titleData.titles,
    outline: outline.outline,
    bodyHtml,
    searchIntent,
  };
}

/** JSONパーサー（コードブロック対応） */
function parseJSON(text) {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // JSON部分を抽出して再試行
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error(`JSON解析エラー: ${e.message}\n元のテキスト: ${cleaned.slice(0, 200)}`);
  }
}
