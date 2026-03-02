import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import config from './config.js';
import logger from './logger.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

/** タイムアウト付きPromiseラッパー */
function withTimeout(promise, ms, label = 'API') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} タイムアウト (${ms / 1000}秒経過)`)), ms)
    ),
  ]);
}

/**
 * Gemini + Google Search Grounding で検索意図と競合情報を取得
 */
async function searchWithGemini(keyword) {
  logger.info(`Gemini Google Search で分析中: "${keyword}"`);

  const model = genAI.getGenerativeModel({
    model: config.gemini.textModel,
    tools: [{ googleSearch: {} }],
  });

  const prompt = `以下のキーワードでGoogle検索した場合の上位記事を分析してください。

キーワード: "${keyword}"

以下の情報をJSON形式で出力してください。JSON以外のテキストは不要です。
{
  "searchResults": [
    { "title": "記事タイトル", "url": "URL", "snippet": "概要" }
  ],
  "topHeadings": [
    {
      "articleTitle": "記事タイトル",
      "headings": [
        { "tag": "h2", "text": "見出しテキスト" }
      ]
    }
  ],
  "searchIntent": "informational / navigational / transactional / commercial のいずれか",
  "commonTopics": ["よく扱われているトピック1", "トピック2", "トピック3"],
  "avgWordCount": 3000,
  "avgH2Count": 5
}

上位5〜10件の記事について分析してください。`;

  const result = await withTimeout(model.generateContent(prompt), 60_000, '競合分析');
  const text = result.response.text();
  return parseJSON(text);
}

/**
 * 上位記事のURLから直接見出し構造を抽出（補助）
 */
async function extractHeadings(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    const headings = [];
    $('h1, h2, h3').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      if (text && text.length < 200) {
        headings.push({ tag, text });
      }
    });

    const bodyText = $('article, .entry-content, .post-content, main, .content')
      .first()
      .text()
      .trim();
    const charCount = bodyText.length || $('body').text().trim().length;

    return { url, headings, charCount };
  } catch (err) {
    logger.debug(`ページ取得失敗 (${url}): ${err.message}`);
    return null;
  }
}

/**
 * キーワードの競合分析（メイン）
 */
export async function analyzeCompetitors(keyword) {
  logger.info(`=== 競合分析開始: "${keyword}" ===`);

  // Gemini + Google Search で分析
  const geminiAnalysis = await searchWithGemini(keyword);

  // 上位記事のURLがあれば直接見出しも取得
  const urls = (geminiAnalysis.searchResults || [])
    .map((r) => r.url)
    .filter((u) => u && u.startsWith('http'))
    .slice(0, 3);

  let articles = [];
  if (urls.length > 0) {
    logger.info(`上位${urls.length}記事の見出しを直接取得中...`);
    const results = await Promise.all(urls.map((u) => extractHeadings(u)));
    articles = results.filter(Boolean);
  }

  const summary = {
    keyword,
    totalArticles: geminiAnalysis.searchResults?.length || 0,
    avgCharCount: geminiAnalysis.avgWordCount || 3000,
    commonH2Count: geminiAnalysis.avgH2Count || 5,
    searchIntent: geminiAnalysis.searchIntent || 'informational',
    commonTopics: geminiAnalysis.commonTopics || [],
    topHeadings: geminiAnalysis.topHeadings || [],
  };

  logger.info(
    `分析完了 - 検索意図: ${summary.searchIntent}, 平均文字数: ${summary.avgCharCount}`
  );

  return {
    keyword,
    searchResults: geminiAnalysis.searchResults || [],
    articles,
    summary,
  };
}

/**
 * 競合分析結果をプロンプト用テキストに変換
 */
export function formatAnalysisForPrompt(analysis) {
  let text = `## 競合分析データ\n`;
  text += `キーワード: ${analysis.keyword}\n`;
  text += `分析記事数: ${analysis.summary?.totalArticles || 0}件\n`;
  text += `平均文字数: ${analysis.summary?.avgCharCount || 0}字\n`;
  text += `平均h2数: ${analysis.summary?.commonH2Count || 0}個\n`;
  text += `検索意図: ${analysis.summary?.searchIntent || '不明'}\n`;
  text += `共通トピック: ${(analysis.summary?.commonTopics || []).join(', ')}\n\n`;

  text += `### 検索結果タイトル一覧\n`;
  for (const r of (analysis.searchResults || []).slice(0, 10)) {
    text += `- ${r.title}\n`;
  }

  if (analysis.summary?.topHeadings?.length > 0) {
    text += `\n### 上位記事の見出し構成 (Gemini分析)\n`;
    for (const article of analysis.summary.topHeadings) {
      text += `\n--- ${article.articleTitle} ---\n`;
      for (const h of article.headings || []) {
        const indent = h.tag === 'h3' ? '  ' : '';
        text += `${indent}[${h.tag}] ${h.text}\n`;
      }
    }
  }

  if (analysis.articles?.length > 0) {
    text += `\n### 上位記事の見出し構成 (直接取得)\n`;
    for (const article of analysis.articles) {
      text += `\n--- ${article.url} (${article.charCount}字) ---\n`;
      for (const h of article.headings) {
        const indent = h.tag === 'h3' ? '  ' : '';
        text += `${indent}[${h.tag}] ${h.text}\n`;
      }
    }
  }

  return text;
}

/**
 * Gemini + Google Search Grounding で最新情報を取得（日本語 + 英語の2軸並列検索）
 */
export async function searchLatestNews(keyword) {
  logger.info(`最新情報を検索中（日本語+英語）: "${keyword}"`);

  const currentYear = new Date().getFullYear();
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const recentPeriod = `${threeMonthsAgo.getFullYear()}年${threeMonthsAgo.getMonth() + 1}月〜${now.getFullYear()}年${now.getMonth() + 1}月`;

  // 日本語検索と英語検索を並列実行
  const [jaResult, enResult] = await Promise.all([
    searchLatestNewsJA(keyword, currentYear, recentPeriod),
    searchLatestNewsEN(keyword, currentYear, recentPeriod),
  ]);

  // 結果をマージ
  const merged = mergeLatestNews(jaResult, enResult);
  const totalCount = merged.latestNews?.length || 0;
  logger.info(`最新情報マージ完了: 日本${jaResult.latestNews?.length || 0}件 + 海外${enResult.latestNews?.length || 0}件 = 合計${totalCount}件`);

  return merged;
}

/**
 * 日本語ソースから最新情報を検索
 */
async function searchLatestNewsJA(keyword, currentYear, recentPeriod) {
  const model = genAI.getGenerativeModel({
    model: config.gemini.textModel,
    tools: [{ googleSearch: {} }],
  });

  const prompt = `以下のキーワードに関する「日本国内の最新情報」を調査してください。

キーワード: "${keyword}"

【検索条件】
- 対象期間: ${recentPeriod}（直近3ヶ月以内の情報を最優先）
- 言語: 日本語の情報源を優先
- 重点ソース: 日本のニュースサイト、テックメディア（ITmedia、TechCrunch Japan、CNET Japan、Impress、GIGAZINE等）、プレスリリース、公式ブログ

【調査観点】
- ${currentYear}年の最新ニュース・プレスリリース・リリース情報
- 最新のアップデート・バージョンアップ・新機能
- 日本市場特有の動向・日本語対応・日本向けサービス
- 国内企業・団体の最新の取り組み・発表
- 最新の統計データ・市場調査・利用者数

以下のJSON形式で出力してください。JSON以外のテキストは不要です。
{
  "latestNews": [
    {
      "title": "ニュースのタイトルや要約",
      "detail": "具体的な内容（数値・日付含む）",
      "source": "情報源（サイト名やURL）",
      "date": "発表日・掲載日（わかる範囲）",
      "region": "ja"
    }
  ],
  "trends": ["最新トレンド1", "最新トレンド2"],
  "keyInsights": "日本国内で記事に反映すべき重要な最新ポイントの要約（200字以内）"
}

できるだけ新しい（直近1〜3ヶ月以内の）信頼性の高い情報を5〜10件取得してください。古い情報は含めないでください。`;

  try {
    const result = await withTimeout(model.generateContent(prompt), 60_000, '最新情報検索(日本)');
    const text = result.response.text();
    const parsed = parseJSON(text);
    // regionフラグを付与
    if (parsed.latestNews) {
      parsed.latestNews = parsed.latestNews.map(n => ({ ...n, region: 'ja' }));
    }
    logger.info(`最新情報(日本): ${parsed.latestNews?.length || 0}件取得`);
    return parsed;
  } catch (err) {
    logger.warn(`最新情報検索(日本)エラー: ${err.message}`);
    return { latestNews: [], trends: [], keyInsights: '' };
  }
}

/**
 * 英語（海外）ソースから最新情報を検索
 */
async function searchLatestNewsEN(keyword, currentYear, recentPeriod) {
  const model = genAI.getGenerativeModel({
    model: config.gemini.textModel,
    tools: [{ googleSearch: {} }],
  });

  const prompt = `Search for the latest international news and updates about the following topic. Respond in Japanese.

Topic/Keyword: "${keyword}"

【Search Criteria】
- Period: Last 3 months (${recentPeriod}) - prioritize the most recent information
- Language: Search English-language sources (global tech media, official blogs, release notes)
- Priority Sources: TechCrunch, The Verge, Ars Technica, Wired, official product blogs, GitHub release notes, major tech company announcements (Google, OpenAI, Microsoft, Meta, etc.)

【Investigation Focus】
- Latest product updates, version releases, new features announced in ${currentYear}
- Breaking news and major announcements from the global tech industry
- International market trends and adoption data
- Research papers, benchmarks, and performance comparisons
- Pricing changes, API updates, policy changes
- Information that Japanese articles may not have covered yet

Output in the following JSON format. No text other than JSON is needed.
Respond with Japanese text for title, detail, and keyInsights fields.
{
  "latestNews": [
    {
      "title": "ニュースのタイトルや要約（日本語で）",
      "detail": "具体的な内容（数値・日付含む）（日本語で）",
      "source": "Source name or URL (English OK)",
      "date": "Publication date (if available)",
      "region": "en"
    }
  ],
  "trends": ["グローバルトレンド1（日本語で）", "トレンド2"],
  "keyInsights": "海外情報で記事に反映すべき重要なポイントの要約（日本語200字以内）"
}

Find 5-10 recent and reliable pieces of information. Prioritize news from the last 1-3 months. Do not include outdated information.`;

  try {
    const result = await withTimeout(model.generateContent(prompt), 60_000, '最新情報検索(海外)');
    const text = result.response.text();
    const parsed = parseJSON(text);
    // regionフラグを付与
    if (parsed.latestNews) {
      parsed.latestNews = parsed.latestNews.map(n => ({ ...n, region: 'en' }));
    }
    logger.info(`最新情報(海外): ${parsed.latestNews?.length || 0}件取得`);
    return parsed;
  } catch (err) {
    logger.warn(`最新情報検索(海外)エラー: ${err.message}`);
    return { latestNews: [], trends: [], keyInsights: '' };
  }
}

/**
 * 日本語・英語の最新情報をマージ
 */
function mergeLatestNews(jaResult, enResult) {
  const mergedNews = [
    ...(jaResult.latestNews || []),
    ...(enResult.latestNews || []),
  ];

  const mergedTrends = [
    ...(jaResult.trends || []),
    ...(enResult.trends || []),
  ];
  // トレンドの重複除去
  const uniqueTrends = [...new Set(mergedTrends)];

  // keyInsightsを統合
  const insights = [];
  if (jaResult.keyInsights) insights.push(`【国内】${jaResult.keyInsights}`);
  if (enResult.keyInsights) insights.push(`【海外】${enResult.keyInsights}`);

  return {
    latestNews: mergedNews,
    trends: uniqueTrends,
    keyInsights: insights.join('\n'),
  };
}

/**
 * Gemini + Google Search Grounding でエビデンス（論文・公的文書・統計）を取得
 */
export async function searchEvidence(keyword) {
  logger.info(`エビデンス情報を検索中: "${keyword}"`);

  const model = genAI.getGenerativeModel({
    model: config.gemini.textModel,
    tools: [{ googleSearch: {} }],
  });

  const prompt = `以下のキーワードに関する、記事の根拠・信頼性を高めるエビデンス情報を調査してください。

キーワード: "${keyword}"

以下の情報源を重点的に検索してください：
- 学術論文・研究報告（大学、研究機関の調査結果）
- 公的統計・政府発表（総務省、経産省、厚労省、内閣府、文科省等の統計・白書）
- 業界団体・専門機関の調査報告やレポート
- 国際機関のデータや報告（WHO、OECD、World Bank等）
- 信頼性の高い調査会社のレポート（Gartner、IDC、矢野経済研究所等）

以下のJSON形式で出力してください。JSON以外のテキストは不要です。
{
  "evidence": [
    {
      "title": "エビデンスのタイトル・名称",
      "type": "research|government|industry|international",
      "detail": "具体的な内容・数値データ",
      "source": "情報源（機関名・URL）",
      "year": "発表年"
    }
  ],
  "keyFindings": "記事に盛り込むべき重要な発見や合意事項の要約（200字以内）"
}

信頼性の高いエビデンスを3〜7件取得してください。具体的な数値・統計データが含まれるものを優先してください。`;

  try {
    const result = await withTimeout(model.generateContent(prompt), 60_000, 'エビデンス検索');
    const text = result.response.text();
    const parsed = parseJSON(text);
    logger.info(`エビデンス: ${parsed.evidence?.length || 0}件取得`);
    return parsed;
  } catch (err) {
    logger.warn(`エビデンス検索エラー: ${err.message}`);
    return { evidence: [], keyFindings: '' };
  }
}

/**
 * エビデンス情報をプロンプト用テキストに変換
 */
export function formatEvidenceForPrompt(evidence) {
  if (!evidence || (!evidence.evidence?.length && !evidence.keyFindings)) {
    return '';
  }

  let text = `## エビデンス・出典情報\n`;

  if (evidence.keyFindings) {
    text += `\n### 重要な知見\n${evidence.keyFindings}\n`;
  }

  if (evidence.evidence?.length > 0) {
    text += `\n### 根拠データ・研究結果\n`;
    const typeLabels = {
      research: '学術研究',
      government: '公的統計',
      industry: '業界レポート',
      international: '国際機関',
    };
    for (const ev of evidence.evidence) {
      const typeLabel = typeLabels[ev.type] || '参考資料';
      text += `- 【${typeLabel}】**${ev.title}**: ${ev.detail}`;
      if (ev.source) text += ` (出典: ${ev.source})`;
      if (ev.year) text += ` [${ev.year}年]`;
      text += `\n`;
    }
  }

  return text;
}

/**
 * 最新情報をプロンプト用テキストに変換（日本語/海外を区別）
 */
export function formatLatestNewsForPrompt(latestNews) {
  if (!latestNews || (!latestNews.latestNews?.length && !latestNews.keyInsights)) {
    return '';
  }

  let text = `## 最新情報（${new Date().getFullYear()}年・直近3ヶ月）\n`;

  if (latestNews.keyInsights) {
    text += `\n### 重要ポイント\n${latestNews.keyInsights}\n`;
  }

  if (latestNews.trends?.length > 0) {
    text += `\n### 最新トレンド\n`;
    for (const trend of latestNews.trends) {
      text += `- ${trend}\n`;
    }
  }

  // 日本語ソースと海外ソースを分けて表示
  const jaNews = (latestNews.latestNews || []).filter(n => n.region === 'ja');
  const enNews = (latestNews.latestNews || []).filter(n => n.region === 'en');
  const otherNews = (latestNews.latestNews || []).filter(n => !n.region || (n.region !== 'ja' && n.region !== 'en'));

  if (jaNews.length > 0) {
    text += `\n### 国内の最新ニュース\n`;
    for (const news of jaNews) {
      text += `- **${news.title}**: ${news.detail}`;
      if (news.source) text += ` [出典: ${news.source}]`;
      if (news.date) text += ` (${news.date})`;
      text += `\n`;
    }
  }

  if (enNews.length > 0) {
    text += `\n### 海外の最新ニュース\n`;
    for (const news of enNews) {
      text += `- **${news.title}**: ${news.detail}`;
      if (news.source) text += ` [出典: ${news.source}]`;
      if (news.date) text += ` (${news.date})`;
      text += `\n`;
    }
  }

  if (otherNews.length > 0) {
    text += `\n### その他の最新情報\n`;
    for (const news of otherNews) {
      text += `- **${news.title}**: ${news.detail}`;
      if (news.source) text += ` [出典: ${news.source}]`;
      if (news.date) text += ` (${news.date})`;
      text += `\n`;
    }
  }

  return text;
}

/** JSONパーサー */
function parseJSON(text) {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    logger.warn(`JSON解析失敗、デフォルト値を使用: ${e.message}`);
    return {
      searchResults: [],
      topHeadings: [],
      searchIntent: 'informational',
      commonTopics: [],
      avgWordCount: 3000,
      avgH2Count: 5,
    };
  }
}
