import { getNextKeyword, getKeywordById, markAsPosted, markAsFailed } from './keyword-manager.js';
import { analyzeCompetitors, searchLatestNews, searchEvidence } from './competitor-analyzer.js';
import { generateArticle } from './content-generator.js';
import { generateAllImages } from './image-generator.js';
import { postToWordPress } from './wordpress-poster.js';
import { logPost, getArticleIndexForPrompt } from './post-logger.js';
import { loadAllKnowledge } from './knowledge-manager.js';
import { getSetting } from './settings-manager.js';
import { saveCheckpoint, loadCheckpoint, deleteCheckpoint } from './checkpoint-manager.js';
import config from './config.js';
import logger from './logger.js';

/**
 * 1記事分の投稿パイプライン
 *
 * キーワード取得 → ナレッジ読込 → モード判定 → 競合分析 → 記事生成 → 画像生成 → WordPress投稿
 *
 * @param {Object} options
 * @param {boolean} [options.dryRun] - ドライランモード
 * @param {string} [options.keyword] - 特定キーワードを指定（キーワード文字列）
 * @param {string} [options.keywordId] - 特定キーワードをIDで指定
 * @param {boolean} [options.resume] - チェックポイントからレジューム
 * @param {Function} [options.onProgress] - 進捗コールバック ({step, message, progress, keyword, title})
 */
export async function runPipeline(options = {}) {
  const startTime = Date.now();
  const dryRun = options.dryRun ?? config.dryRun;
  const onProgress = options.onProgress;

  try {
    // === レジュームモード判定 ===
    let checkpoint = null;
    if (options.resume) {
      checkpoint = loadCheckpoint();
      if (checkpoint) {
        logger.info('========================================');
        logger.info(`  チェックポイントからレジューム (step: ${checkpoint.step})`);
        logger.info('========================================');
        onProgress?.({ step: 'keyword', message: `レジューム: ${checkpoint.stepLabel || checkpoint.step}から再開`, progress: 5, keyword: checkpoint.keyword });
      } else {
        logger.info('チェックポイントが見つかりません。通常実行にフォールバック。');
        onProgress?.({ step: 'keyword', message: 'チェックポイントなし。通常実行します。', progress: 0 });
      }
    }

    // === レジューム時: チェックポイントからデータ復元 ===
    let keywordData, keyword, description, mode, displayLabel;
    let knowledge, analysisData, latestNews, evidenceData, existingArticles;
    let article, imageFiles;

    if (checkpoint) {
      // チェックポイントから基本データを復元
      keywordData = checkpoint.keywordData;
      keyword = checkpoint.keyword || '';
      description = checkpoint.description || '';
      mode = checkpoint.mode || 'keyword-only';
      displayLabel = keyword || description.slice(0, 40);

      // 各ステップのデータも復元
      knowledge = checkpoint.knowledge || null;
      analysisData = checkpoint.analysisData || null;
      latestNews = checkpoint.latestNews || null;
      evidenceData = checkpoint.evidenceData || null;
      existingArticles = checkpoint.existingArticles || null;

      if (checkpoint.step === 'article-done' || checkpoint.step === 'images-done') {
        article = checkpoint.article;
      }
      if (checkpoint.step === 'images-done') {
        imageFiles = checkpoint.imageFiles;
      }

      onProgress?.({ step: 'keyword', message: `対象: "${displayLabel}"`, progress: 5, keyword: displayLabel });

      // チェックポイントのステップに応じてスキップ
      if (checkpoint.step === 'analysis-done') {
        logger.info('レジューム: 調査データ復元済み → 記事生成から再開');
        onProgress?.({ message: '調査データ復元済み → 記事生成から再開', progress: 36 });
      } else if (checkpoint.step === 'article-done') {
        logger.info('レジューム: 記事データ復元済み → 画像生成から再開');
        onProgress?.({ message: `記事データ復元済み → 画像生成から再開`, progress: 60, title: article?.title });
      } else if (checkpoint.step === 'images-done') {
        logger.info('レジューム: 画像データ復元済み → WordPress投稿から再開');
        onProgress?.({ message: `画像データ復元済み → WordPress投稿から再開`, progress: 80, title: article?.title });
      }
    }

    // === 通常実行（レジュームでないか、チェックポイントがない場合） ===
    if (!checkpoint) {
      // === STEP 0: キーワード取得 ===
      onProgress?.({ step: 'keyword', message: 'キーワード取得中...', progress: 0 });
      logger.info('========================================');
      logger.info('  WordPress 自動投稿パイプライン開始');
      logger.info('========================================');

      if (options.keywordId) {
        keywordData = getKeywordById(options.keywordId);
        if (!keywordData) {
          logger.warn(`指定されたキーワードが見つかりません: ${options.keywordId}`);
          return { success: false, reason: 'keyword_not_found' };
        }
        logger.info(`指定キーワードで実行: "${keywordData.keyword || keywordData.description?.slice(0, 30)}"`);
      } else {
        keywordData = getNextKeyword();
      }
      if (!keywordData) {
        logger.warn('未投稿キーワードがありません。終了します。');
        return { success: false, reason: 'no_keywords' };
      }

      keyword = keywordData.keyword || '';
      description = keywordData.description || '';
      mode = keyword && description ? 'both'
        : keyword ? 'keyword-only'
        : 'description-only';
      displayLabel = keyword || description.slice(0, 40);

      logger.info(`対象: "${displayLabel}"`);
      logger.info(`モード: ${mode}`);
      if (description) logger.info(`説明: "${description.slice(0, 60)}..."`);
      onProgress?.({ step: 'keyword', message: `対象: "${displayLabel}"`, progress: 5, keyword: displayLabel });
    }

    // === STEP 0.5〜1.7: 調査フェーズ（レジュームでスキップ可能） ===
    if (!checkpoint || checkpoint.step === 'none') {
      // === STEP 0.5: ナレッジ読み込み ===
      onProgress?.({ step: 'knowledge', message: 'ナレッジ読み込み中...', progress: 10 });
      logger.info('--- ナレッジ読み込み ---');
      knowledge = await loadAllKnowledge();
      if (knowledge) {
        logger.info(`ナレッジ: ${knowledge.length}文字 読み込み済み`);
        onProgress?.({ message: `ナレッジ: ${knowledge.length}文字 読み込み済み` });
      } else {
        logger.info('ナレッジ: なし');
      }

      // === STEP 1: 競合分析 ===
      analysisData = null;
      if (keyword) {
        onProgress?.({ step: 'analysis', message: '競合分析中...', progress: 15 });
        logger.info('--- STEP 1: 競合分析 ---');
        analysisData = await analyzeCompetitors(keyword);
        onProgress?.({ message: '競合分析完了', progress: 30 });
      } else {
        logger.info('--- STEP 1: 競合分析スキップ (説明のみモード) ---');
        onProgress?.({ step: 'analysis', message: '競合分析スキップ (説明のみモード)', progress: 30 });
        analysisData = {
          keyword: '',
          searchResults: [],
          articles: [],
          summary: {
            keyword: '',
            totalArticles: 0,
            avgCharCount: 0,
            commonH2Count: 0,
            searchIntent: 'informational',
            commonTopics: [],
            topHeadings: [],
          },
        };
      }

      // === STEP 1.5: 最新情報検索 ===
      latestNews = null;
      if (keyword) {
        onProgress?.({ step: 'analysis', message: '最新情報を検索中（日本語+海外）...', progress: 28 });
        logger.info('--- STEP 1.5: 最新情報検索（日本語+海外 並列） ---');
        latestNews = await searchLatestNews(keyword);
        const jaCount = (latestNews?.latestNews || []).filter(n => n.region === 'ja').length;
        const enCount = (latestNews?.latestNews || []).filter(n => n.region === 'en').length;
        logger.info(`最新情報: 国内${jaCount}件 + 海外${enCount}件 = 合計${jaCount + enCount}件`);
        onProgress?.({ message: `最新情報: 国内${jaCount}件 + 海外${enCount}件`, progress: 32 });
      }

      // === STEP 1.6: エビデンス調査（論文・公的文書・統計） ===
      evidenceData = null;
      if (keyword) {
        onProgress?.({ step: 'analysis', message: 'エビデンス情報を検索中...', progress: 33 });
        logger.info('--- STEP 1.6: エビデンス調査 ---');
        evidenceData = await searchEvidence(keyword);
        const evidenceCount = evidenceData?.evidence?.length || 0;
        logger.info(`エビデンス: ${evidenceCount}件取得`);
        onProgress?.({ message: `エビデンス: ${evidenceCount}件取得`, progress: 36 });
      }

      // === STEP 1.7: 投稿済み記事インデックス取得（内部リンク用） ===
      existingArticles = getArticleIndexForPrompt();
      if (existingArticles) {
        logger.info(`内部リンク用記事インデックス: ${existingArticles.split('\n').length - 1}件`);
      }

      // チェックポイント保存: 調査完了
      saveCheckpoint({
        step: 'analysis-done',
        keywordData, keyword, description, mode, dryRun,
        knowledge, analysisData, latestNews, evidenceData, existingArticles,
      });
    }

    // === STEP 2: 記事生成（レジュームでスキップ可能） ===
    if (!checkpoint || checkpoint.step === 'analysis-done') {
      onProgress?.({ step: 'content', message: '記事生成中...', progress: 38 });
      logger.info('--- STEP 2: 記事生成 ---');
      article = await generateArticle(keyword, analysisData, {
        description,
        knowledge,
        latestNews,
        evidence: evidenceData,
        mode,
        existingArticles,
        onProgress,
      });
      onProgress?.({ message: `記事生成完了: ${article.title}`, progress: 60, title: article.title });

      // チェックポイント保存: 記事生成完了
      saveCheckpoint({
        step: 'article-done',
        keywordData, keyword, description, mode, dryRun,
        knowledge, analysisData, latestNews, evidenceData, existingArticles,
        article,
      });
    }

    // === STEP 3: 画像生成（レジュームでスキップ可能） ===
    if (!checkpoint || checkpoint.step === 'analysis-done' || checkpoint.step === 'article-done') {
      onProgress?.({ step: 'image', message: '画像生成中...', progress: 65 });
      logger.info('--- STEP 3: 画像生成 ---');
      imageFiles = await generateAllImages(article);
      onProgress?.({ message: '画像生成完了', progress: 80 });

      // チェックポイント保存: 画像生成完了
      saveCheckpoint({
        step: 'images-done',
        keywordData, keyword, description, mode, dryRun,
        knowledge, analysisData, latestNews, evidenceData, existingArticles,
        article, imageFiles,
      });
    }

    // === STEP 4: 投稿 ===
    onProgress?.({ step: 'posting', message: 'WordPress投稿中...', progress: 85 });
    logger.info('--- STEP 4: WordPress投稿 ---');
    let postResult;

    if (dryRun) {
      logger.info('[ドライラン] 投稿をスキップします');
      logger.info(`タイトル: ${article.title}`);
      logger.info(`見出し数: ${article.outline.length}`);
      logger.info(`本文長: ${article.bodyHtml.length}文字`);
      logger.info(`アイキャッチ: ${imageFiles.eyecatchPath || 'なし'}`);
      logger.info(
        `図解: ${imageFiles.diagrams.filter((d) => d.imagePath).length}枚`
      );
      postResult = { success: true, dryRun: true };
      onProgress?.({ message: '[ドライラン] 投稿スキップ', progress: 95 });
    } else {
      // 設定からハッシュタグを取得
      const defaultHashtags = getSetting('article.defaultHashtags', '');
      const defaultCategory = getSetting('article.defaultCategory', '');
      const hashtags = defaultHashtags || defaultCategory || config.posting.category || '';
      if (hashtags) {
        logger.info(`ハッシュタグ設定: ${hashtags}`);
      }

      postResult = await postToWordPress(article, imageFiles, { hashtags, onProgress });
      if (postResult.success) {
        onProgress?.({ message: '投稿完了', progress: 95 });
      } else {
        onProgress?.({ message: `投稿エラー: ${postResult.error || '不明'}`, progress: 95 });
      }
    }

    // === STEP 5: ステータス更新 ===
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (postResult.success) {
      // 成功時はチェックポイントを削除
      deleteCheckpoint();
      markAsPosted(keyword || keywordData.id, postResult.url || '');
      logPost({
        keyword: keyword || description.slice(0, 40),
        title: article.title,
        url: postResult.url || '',
        slug: postResult.slug || '',
        dryRun,
        elapsedSeconds: elapsed,
        imageCount: imageFiles.diagrams.filter((d) => d.imagePath).length + (imageFiles.eyecatchPath ? 1 : 0),
      });

      logger.info('========================================');
      logger.info(`  投稿完了! (${elapsed}秒)`);
      logger.info(`  タイトル: ${article.title}`);
      logger.info('========================================');
    } else {
      markAsFailed(keyword || keywordData.id, postResult.error || '不明なエラー');
      logPost({
        keyword: keyword || description.slice(0, 40),
        title: article.title,
        error: postResult.error,
        success: false,
        elapsedSeconds: elapsed,
      });
    }

    if (postResult.success) {
      onProgress?.({ step: 'done', message: '完了', progress: 100 });
    } else {
      onProgress?.({ step: 'error', message: `エラー: ${postResult.error || '不明'}`, progress: 95 });
    }

    return {
      success: postResult.success,
      error: postResult.error || undefined,
      keyword: keyword || description.slice(0, 40),
      title: article.title,
      elapsed,
      dryRun,
    };
  } catch (err) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.error(`パイプラインエラー: ${err.message}`);
    logger.error(err.stack);
    onProgress?.({ step: 'error', message: `エラー: ${err.message}`, progress: 0 });

    // 明示的エラー時はチェックポイントを削除しない（レジュームで再利用可能にする）
    // ※ プロセスクラッシュ時もチェックポイントは残る

    // キーワードが取得できていた場合は失敗マーク
    try {
      if (keyword) {
        markAsFailed(keyword || keywordData?.id, err.message);
      } else {
        const kw = getNextKeyword();
        if (kw) {
          markAsFailed(kw.keyword || kw.id, err.message);
        }
      }
    } catch { /* ignore */ }

    return { success: false, error: err.message, elapsed };
  }
}
