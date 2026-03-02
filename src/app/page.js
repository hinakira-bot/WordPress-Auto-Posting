'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';
import PipelineProgress from '@/components/PipelineProgress';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recentPosts, setRecentPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  // パイプライン実行
  const [keywords, setKeywords] = useState([]);
  const [selectedKeywordId, setSelectedKeywordId] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [execError, setExecError] = useState('');
  const [checkpointInfo, setCheckpointInfo] = useState(null);

  useEffect(() => {
    fetchData();
    fetchKeywords();
    checkPipelineStatus();
    fetchCheckpointInfo();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data.stats);
      setRecentPosts(data.recentPosts || []);
    } catch (err) {
      console.error('データ取得エラー:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchKeywords = async () => {
    try {
      const res = await fetch('/api/keywords?status=pending');
      const data = await res.json();
      setKeywords(data.keywords || []);
    } catch (err) {
      console.error('キーワード取得エラー:', err);
    }
  };

  const checkPipelineStatus = async () => {
    try {
      const res = await fetch('/api/pipeline');
      const data = await res.json();
      if (data.running) {
        setPipelineRunning(true);
        setShowProgress(true);
      }
    } catch { /* ignore */ }
  };

  const fetchCheckpointInfo = async () => {
    try {
      const res = await fetch('/api/pipeline?q=checkpoint');
      const data = await res.json();
      if (data.hasCheckpoint) {
        setCheckpointInfo(data.checkpoint);
      } else {
        setCheckpointInfo(null);
      }
    } catch { /* ignore */ }
  };

  const handleResumePipeline = async () => {
    setExecError('');
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      });

      const data = await res.json();
      if (!res.ok) {
        setExecError(data.error || 'レジュームエラー');
        return;
      }

      setPipelineRunning(true);
      setShowProgress(true);
      setCheckpointInfo(null);
    } catch (err) {
      setExecError(err.message);
    }
  };

  const handleRunPipeline = async () => {
    setExecError('');
    try {
      const body = { dryRun };
      if (selectedKeywordId) {
        body.keywordId = selectedKeywordId;
      }

      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setExecError(data.error || '実行エラー');
        return;
      }

      setPipelineRunning(true);
      setShowProgress(true);
    } catch (err) {
      setExecError(err.message);
    }
  };

  const handleProgressClose = () => {
    setShowProgress(false);
    setPipelineRunning(false);
    // データを再読み込み
    fetchData();
    fetchKeywords();
    fetchCheckpointInfo();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">ダッシュボード</h1>

      {/* 統計カード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="全キーワード" value={stats?.total || 0} color="blue" />
        <StatCard label="未投稿" value={stats?.pending || 0} color="yellow" />
        <StatCard label="投稿済" value={stats?.posted || 0} color="green" />
        <StatCard label="失敗" value={stats?.failed || 0} color="red" />
      </div>

      {/* パイプライン実行パネル */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">記事を投稿する</h2>
        </div>
        <div className="px-6 py-5">
          {showProgress ? (
            <PipelineProgress onClose={handleProgressClose} />
          ) : (
            <div className="space-y-4">
              {/* キーワード選択 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  キーワード選択
                </label>
                <select
                  value={selectedKeywordId}
                  onChange={(e) => setSelectedKeywordId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">自動（次の未投稿キーワード）</option>
                  {keywords.map((kw) => (
                    <option key={kw.id} value={kw.id}>
                      {kw.keyword || kw.description?.slice(0, 50) || '(名称なし)'}
                      {kw.category ? ` [${kw.category}]` : ''}
                    </option>
                  ))}
                </select>
                {keywords.length === 0 && (
                  <p className="text-xs text-yellow-600 mt-1">
                    未投稿のキーワードがありません。キーワードページで追加してください。
                  </p>
                )}
              </div>

              {/* ドライラン切り替え */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">ドライラン（投稿せずテスト）</span>
                </label>
              </div>

              {/* 実行ボタン */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunPipeline}
                  disabled={pipelineRunning || keywords.length === 0}
                  className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {pipelineRunning ? '実行中...' : dryRun ? 'ドライランを実行' : '投稿を実行'}
                </button>
                {execError && (
                  <p className="text-sm text-red-600">{execError}</p>
                )}
              </div>

              {/* チェックポイントからレジューム */}
              {checkpointInfo && !pipelineRunning && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <span className="text-sm font-medium text-amber-800">
                      前回の実行が中断されています
                    </span>
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    {checkpointInfo.keyword && `キーワード: "${checkpointInfo.keyword}" / `}
                    {checkpointInfo.stepLabel || checkpointInfo.step}まで完了
                    {checkpointInfo.savedAt && ` (${new Date(checkpointInfo.savedAt).toLocaleString('ja-JP')})`}
                  </p>
                  <button
                    onClick={handleResumePipeline}
                    className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors cursor-pointer"
                  >
                    前回の続きから再開
                  </button>
                </div>
              )}

              <p className="text-xs text-gray-500">
                ※ 実行には数分かかります（競合分析 → 記事生成 → 画像生成 → 投稿）
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 最近の投稿 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">最近の投稿</h2>
        </div>

        {recentPosts.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <p>まだ投稿がありません</p>
            <p className="text-sm mt-2">
              キーワードを追加して、上の「投稿を実行」ボタンで投稿してください
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentPosts.map((post, i) => (
              <div key={i} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {post.title || '(タイトルなし)'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {post.keyword} ・ {post.elapsedSeconds ? `${post.elapsedSeconds}秒` : ''}
                    {post.dryRun ? ' (ドライラン)' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <span className="text-xs text-gray-400">
                    {post.timestamp ? new Date(post.timestamp).toLocaleDateString('ja-JP') : ''}
                  </span>
                  <StatusBadge status={post.error ? 'failed' : 'posted'} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
