'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STEPS = [
  { id: 'welcome', title: 'ようこそ' },
  { id: 'gemini', title: 'Gemini API' },
  { id: 'wordpress', title: 'WordPress' },
  { id: 'complete', title: '完了' },
];

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    geminiApiKey: '',
    wordpressSiteUrl: '',
    wordpressUsername: '',
    wordpressAppPassword: '',
  });

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '保存に失敗しました');
        setSaving(false);
        return;
      }

      setStep(3); // 完了ステップへ
    } catch (err) {
      setError('接続エラー: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const currentStep = STEPS[step];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        {/* ステップインジケーター */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    i < step
                      ? 'bg-green-500 text-white'
                      : i === step
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-0.5 mx-1 ${i < step ? 'bg-green-500' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Step 0: ようこそ */}
          {step === 0 && (
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-3">
                WordPress 自動投稿ツールへようこそ！
              </h1>
              <p className="text-gray-600 mb-6 leading-relaxed">
                このツールはGemini AIを使って、SEOに強いブログ記事を自動生成・投稿します。
                <br /><br />
                初回セットアップとして、以下の情報が必要です：
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-blue-500">✦</span>
                  <strong>Gemini APIキー</strong>（必須）
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-blue-500">✦</span>
                  <strong>WordPress サイト + アプリケーションパスワード</strong>（必須）
                </li>
              </ul>
              <button
                onClick={() => setStep(1)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors cursor-pointer"
              >
                セットアップを始める →
              </button>
            </div>
          )}

          {/* Step 1: Gemini API */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Gemini APIキーの設定</h2>
              <p className="text-sm text-gray-500 mb-4">
                Google AI Studio でAPIキーを取得してください
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gemini APIキー <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={form.geminiApiKey}
                  onChange={(e) => updateForm('geminiApiKey', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="AIzaSy..."
                />
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:text-blue-700 mt-1 inline-block"
                >
                  → Google AI Studio でAPIキーを取得
                </a>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(0)}
                  className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
                >
                  ← 戻る
                </button>
                <button
                  onClick={() => {
                    if (!form.geminiApiKey) {
                      setError('Gemini APIキーを入力してください');
                      return;
                    }
                    setError('');
                    setStep(2);
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors cursor-pointer"
                >
                  次へ →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: WordPress */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">WordPress 接続設定</h2>
              <p className="text-sm text-gray-500 mb-4">
                記事の投稿先となる WordPress サイトの情報を設定してください
              </p>

              <div className="space-y-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    WordPress サイトURL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={form.wordpressSiteUrl}
                    onChange={(e) => updateForm('wordpressSiteUrl', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://your-site.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ユーザー名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.wordpressUsername}
                    onChange={(e) => updateForm('wordpressUsername', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="ユーザー名"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    アプリケーションパスワード <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.wordpressAppPassword}
                    onChange={(e) => updateForm('wordpressAppPassword', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="アプリケーションパスワード"
                    required
                  />
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-amber-700">
                  WordPress管理画面 → ユーザー → プロフィール → アプリケーションパスワード で新規作成してください
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
                >
                  ← 戻る
                </button>
                <button
                  onClick={() => {
                    if (!form.wordpressSiteUrl || !form.wordpressUsername || !form.wordpressAppPassword) {
                      setError('WordPress サイトURL・ユーザー名・アプリケーションパスワードを入力してください');
                      return;
                    }
                    setError('');
                    handleSave();
                  }}
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {saving ? '保存中...' : '設定を保存 →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 完了 */}
          {step === 3 && (
            <div className="text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">セットアップ完了！</h2>
              <p className="text-gray-600 mb-6">
                すべての設定が保存されました。<br />
                ダッシュボードからキーワードを追加して、記事の自動投稿を始めましょう。
              </p>
              <button
                onClick={() => router.push('/')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors cursor-pointer"
              >
                ダッシュボードへ →
              </button>
            </div>
          )}

          {/* エラーメッセージ */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
