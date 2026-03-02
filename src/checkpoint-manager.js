/**
 * パイプライン チェックポイント管理
 *
 * data/pipeline-checkpoint.json を1ファイルのみ使用。
 * - 成功/明示的失敗時に自動削除
 * - プロセスクラッシュ時のみ残る
 * - 24時間以上古いチェックポイントは無効
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import config from './config.js';
import logger from './logger.js';

const CHECKPOINT_PATH = config.paths.checkpoint;

/**
 * チェックポイントを保存（上書き）
 * @param {Object} data - パイプラインの中間状態
 */
export function saveCheckpoint(data) {
  try {
    writeFileSync(CHECKPOINT_PATH, JSON.stringify({
      ...data,
      savedAt: new Date().toISOString(),
    }, null, 2));
    logger.info(`チェックポイント保存: step=${data.step}`);
  } catch (err) {
    logger.warn(`チェックポイント保存失敗: ${err.message}`);
  }
}

/**
 * チェックポイントを読み込み
 * @returns {Object|null} チェックポイントデータ、なければnull
 */
export function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
    // 24時間以上古いチェックポイントは無効（腐ったデータ防止）
    const age = Date.now() - new Date(raw.savedAt).getTime();
    if (age > 24 * 60 * 60 * 1000) {
      logger.info('チェックポイントが24時間以上古いため無視します');
      deleteCheckpoint();
      return null;
    }
    return raw;
  } catch (err) {
    logger.warn(`チェックポイント読み込みエラー: ${err.message}`);
    deleteCheckpoint();
    return null;
  }
}

/**
 * チェックポイントファイルを削除
 */
export function deleteCheckpoint() {
  try {
    if (existsSync(CHECKPOINT_PATH)) {
      unlinkSync(CHECKPOINT_PATH);
      logger.info('チェックポイント削除');
    }
  } catch { /* ignore */ }
}

/**
 * チェックポイントが存在するか確認
 * @returns {boolean}
 */
export function hasCheckpoint() {
  return existsSync(CHECKPOINT_PATH);
}

/**
 * チェックポイントのサマリー情報を取得（UI表示用）
 * @returns {Object|null} { step, keyword, savedAt } or null
 */
export function getCheckpointSummary() {
  const cp = loadCheckpoint();
  if (!cp) return null;
  const stepLabels = {
    'analysis-done': '調査完了',
    'article-done': '記事生成完了',
    'images-done': '画像生成完了',
  };
  return {
    step: cp.step,
    stepLabel: stepLabels[cp.step] || cp.step,
    keyword: cp.keyword || '',
    savedAt: cp.savedAt,
  };
}
