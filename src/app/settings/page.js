'use client';

import { useState, useEffect, useRef } from 'react';

const FREQUENCY_OPTIONS = [
  { value: 'daily1', label: '毎日1回' },
  { value: 'daily2', label: '毎日2回' },
  { value: 'weekday', label: '平日のみ' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 10, 20, 30, 40, 50];

const IMAGE_MODELS = [
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (推奨・高速)' },
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (高品質)' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // APIキー管理用
  const [credentials, setCredentials] = useState(null);
  const [credForm, setCredForm] = useState({
    geminiApiKey: '',
    geminiTextModel: '',
    geminiImageModel: '',
    wordpressSiteUrl: '',
    wordpressUsername: '',
    wordpressAppPassword: '',
  });
  const [credSaving, setCredSaving] = useState(false);
  const [credMessage, setCredMessage] = useState('');

  // 接続テスト用
  const [testingConnection, setTestingConnection] = useState(false);
  const [testConnectionMsg, setTestConnectionMsg] = useState('');

  // スケジュールUI用
  const [frequency, setFrequency] = useState('daily1');
  const [hour1, setHour1] = useState(9);
  const [min1, setMin1] = useState(0);
  const [hour2, setHour2] = useState(15);
  const [min2, setMin2] = useState(0);

  // 参照画像用
  const [refImages, setRefImages] = useState([]);
  const [refImageUploading, setRefImageUploading] = useState(false);
  const [refImageMsg, setRefImageMsg] = useState('');
  const refImageInputRef = useRef(null);

  useEffect(() => {
    fetchSettings();
    fetchCredentials();
    fetchRefImages();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data.settings);

      // cron → シンプル選択に変換
      const cron = data.settings?.posting?.cronSchedule || '0 9 * * *';
      const parsed = parseCronSimple(cron);
      setFrequency(parsed.frequency);
      setHour1(parsed.hour1);
      setMin1(parsed.min1);
      setHour2(parsed.hour2);
      setMin2(parsed.min2);
    } catch (err) {
      console.error('設定取得エラー:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCredentials = async () => {
    try {
      const res = await fetch('/api/credentials');
      const data = await res.json();
      setCredentials(data);
    } catch (err) {
      console.error('クレデンシャル取得エラー:', err);
    }
  };

  const fetchRefImages = async () => {
    try {
      const res = await fetch('/api/reference-images');
      const data = await res.json();
      setRefImages(data.images || []);
    } catch (err) {
      console.error('参照画像取得エラー:', err);
    }
  };

  const handleRefImageUpload = async (e, imageType) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefImageUploading(true);
    setRefImageMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', imageType);

      const res = await fetch('/api/reference-images', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        setRefImageMsg(data.message);
        fetchRefImages();
        setTimeout(() => setRefImageMsg(''), 3000);
      } else {
        setRefImageMsg(data.error || 'アップロード失敗');
      }
    } catch (err) {
      setRefImageMsg('エラー: ' + err.message);
    } finally {
      setRefImageUploading(false);
      if (refImageInputRef.current) refImageInputRef.current.value = '';
    }
  };

  const handleRefImageDelete = async (filename) => {
    try {
      const res = await fetch('/api/reference-images', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchRefImages();
      }
    } catch (err) {
      console.error('参照画像削除エラー:', err);
    }
  };

  const handleCredSave = async () => {
    setCredSaving(true);
    setCredMessage('');

    const payload = {};
    for (const [key, val] of Object.entries(credForm)) {
      if (val.trim()) payload[key] = val.trim();
    }

    if (Object.keys(payload).length === 0) {
      setCredMessage('変更する項目を入力してください');
      setCredSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setCredMessage('APIキーを更新しました');
        setCredForm({ geminiApiKey: '', geminiTextModel: '', geminiImageModel: '', wordpressSiteUrl: '', wordpressUsername: '', wordpressAppPassword: '' });
        fetchCredentials();
        setTimeout(() => setCredMessage(''), 3000);
      } else {
        const data = await res.json();
        setCredMessage(data.error || '保存に失敗しました');
      }
    } catch (err) {
      setCredMessage('エラー: ' + err.message);
    } finally {
      setCredSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestConnectionMsg('');
    try {
      const res = await fetch('/api/test-connection', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTestConnectionMsg('接続成功: ' + (data.message || 'WordPressに正常に接続できました'));
      } else {
        setTestConnectionMsg('接続失敗: ' + (data.error || '不明なエラー'));
      }
    } catch (err) {
      setTestConnectionMsg('接続テストエラー: ' + err.message);
    } finally {
      setTestingConnection(false);
      setTimeout(() => setTestConnectionMsg(''), 5000);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');

    const cron = buildCronSimple({ frequency, hour1, min1, hour2, min2 });
    const updates = {
      'article.minLength': settings.article.minLength,
      'article.maxLength': settings.article.maxLength,
      'article.defaultCategory': settings.article.defaultCategory,
      'article.targetAudience': settings.article.targetAudience || '',
      'article.defaultHashtags': settings.article.defaultHashtags || '',
      'knowledge.maxFileSizeKB': settings.knowledge.maxFileSizeKB,
      'knowledge.maxTotalChars': settings.knowledge.maxTotalChars,
      'posting.cronSchedule': cron,
      'posting.dryRun': settings.posting.dryRun,
    };

    if (settings.imageModel) {
      updates['imageModel'] = settings.imageModel;
    }

    if (settings.cta) {
      updates['cta'] = settings.cta;
    }

    if (settings.swell) {
      updates['swell'] = settings.swell;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      if (res.ok) {
        setMessage('設定を保存しました');
        setTimeout(() => setMessage(''), 3000);
      } else {
        const data = await res.json();
        setMessage(data.error || '保存に失敗しました');
      }
    } catch (err) {
      setMessage('エラー: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (path, value) => {
    setSettings((prev) => {
      const result = { ...prev };
      const keys = path.split('.');
      let current = result;
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return result;
    });
  };

  if (loading || !settings) {
    return <div className="text-center text-gray-500 py-12">読み込み中...</div>;
  }

  const cronDescription = describeCronSimple({ frequency, hour1, min1, hour2, min2 });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">設定</h1>

      <div className="space-y-8">
        {/* APIキー・認証情報 */}
        <Section title="APIキー・認証情報">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 mb-2">
            APIキー・パスワードはサーバー上の .env ファイルに保存されます。変更する項目のみ入力してください（空欄の項目は現在の値が維持されます）。
          </div>

          {credentials && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">現在の設定状況</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-gray-500">Gemini APIキー:</span>
                <span className="font-mono text-gray-800">{credentials.geminiApiKey || '未設定'}</span>
                <span className="text-gray-500">WordPress サイトURL:</span>
                <span className="font-mono text-gray-800">{credentials.wordpressSiteUrl || '未設定'}</span>
                <span className="text-gray-500">WordPress ユーザー名:</span>
                <span className="font-mono text-gray-800">{credentials.wordpressUsername || '未設定'}</span>
                <span className="text-gray-500">WordPress アプリケーションパスワード:</span>
                <span className="font-mono text-gray-800">{credentials.wordpressAppPassword || '未設定'}</span>
              </div>
            </div>
          )}

          <Field label="Gemini APIキー">
            <input
              type="password"
              value={credForm.geminiApiKey}
              onChange={(e) => setCredForm({ ...credForm, geminiApiKey: e.target.value })}
              className="input-field"
              placeholder="変更する場合のみ入力"
              autoComplete="off"
            />
          </Field>
          <Field label="WordPress サイトURL">
            <input
              type="url"
              value={credForm.wordpressSiteUrl}
              onChange={(e) => setCredForm({ ...credForm, wordpressSiteUrl: e.target.value })}
              className="input-field"
              placeholder="https://your-site.com"
              autoComplete="off"
            />
          </Field>
          <Field label="WordPress ユーザー名">
            <input
              type="text"
              value={credForm.wordpressUsername}
              onChange={(e) => setCredForm({ ...credForm, wordpressUsername: e.target.value })}
              className="input-field"
              placeholder="変更する場合のみ入力"
              autoComplete="off"
            />
          </Field>
          <Field label="WordPress アプリケーションパスワード">
            <input
              type="password"
              value={credForm.wordpressAppPassword}
              onChange={(e) => setCredForm({ ...credForm, wordpressAppPassword: e.target.value })}
              className="input-field"
              placeholder="変更する場合のみ入力"
              autoComplete="off"
            />
          </Field>

          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleCredSave}
              disabled={credSaving}
              className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {credSaving ? '保存中...' : 'APIキーを更新'}
            </button>
            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {testingConnection ? 'テスト中...' : '接続テスト'}
            </button>
            {credMessage && (
              <span className="text-sm text-amber-700">{credMessage}</span>
            )}
          </div>
          {testConnectionMsg && (
            <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${testConnectionMsg.includes('成功') ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
              {testConnectionMsg}
            </div>
          )}
        </Section>

        {/* 記事設定 */}
        <Section title="記事設定">
          <Field label="最小文字数">
            <input
              type="number"
              value={settings.article.minLength}
              onChange={(e) => updateField('article.minLength', parseInt(e.target.value) || 0)}
              className="input-field"
            />
          </Field>
          <Field label="最大文字数">
            <input
              type="number"
              value={settings.article.maxLength}
              onChange={(e) => updateField('article.maxLength', parseInt(e.target.value) || 0)}
              className="input-field"
            />
          </Field>
          <Field label="ターゲット読者">
            <input
              type="text"
              value={settings.article.targetAudience || ''}
              onChange={(e) => updateField('article.targetAudience', e.target.value)}
              className="input-field"
              placeholder="例: 副業を始めたい20〜30代のサラリーマン"
            />
            <p className="text-xs text-gray-500 mt-1">
              記事の対象読者を指定すると、読者に合わせた文体・内容で記事が生成されます
            </p>
          </Field>
          <Field label="デフォルトハッシュタグ">
            <input
              type="text"
              value={settings.article.defaultHashtags || ''}
              onChange={(e) => updateField('article.defaultHashtags', e.target.value)}
              className="input-field"
              placeholder="例: バイブコーディング,生成AI,AI活用"
            />
            <p className="text-xs text-gray-500 mt-1">
              カンマ区切りで入力。投稿時に自動でハッシュタグとして設定されます
            </p>
          </Field>
          <Field label="カテゴリ">
            <input
              type="text"
              value={settings.article.defaultCategory || ''}
              onChange={(e) => updateField('article.defaultCategory', e.target.value)}
              className="input-field"
              placeholder="未設定"
            />
          </Field>
        </Section>

        {/* CTA設定 */}
        <Section title="CTA設定（記事内リンク）">
          <Field label="CTA有効化">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={settings.cta?.enabled || false}
                onChange={(e) => setSettings(prev => ({...prev, cta: {...(prev.cta || {}), enabled: e.target.checked}}))} />
              <span className="text-sm text-gray-600">記事内にCTAリンクを自動挿入する</span>
            </label>
          </Field>
          <Field label="CTA URL">
            <input type="url" className="w-full p-2 border rounded" value={settings.cta?.url || ''}
              onChange={(e) => setSettings(prev => ({...prev, cta: {...(prev.cta || {}), url: e.target.value}}))}
              placeholder="https://example.com/signup" />
          </Field>
          <Field label="CTAテキスト">
            <input type="text" className="w-full p-2 border rounded" value={settings.cta?.text || ''}
              onChange={(e) => setSettings(prev => ({...prev, cta: {...(prev.cta || {}), text: e.target.value}}))}
              placeholder="詳しくはこちら" />
          </Field>
          <Field label="CTA説明文（末尾用）">
            <textarea className="w-full p-2 border rounded h-20" value={settings.cta?.description || ''}
              onChange={(e) => setSettings(prev => ({...prev, cta: {...(prev.cta || {}), description: e.target.value}}))}
              placeholder="末尾に表示する補足説明文..." />
          </Field>
        </Section>

        {/* SWELL装飾設定 */}
        <Section title="SWELL装飾設定">
          <Field label="SWELL装飾">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={settings.swell?.enabled !== false}
                onChange={(e) => setSettings(prev => ({...prev, swell: {...(prev.swell || {}), enabled: e.target.checked}}))} />
              <span className="text-sm text-gray-600">SWELL装飾を有効化</span>
            </label>
          </Field>
          <Field label="Gutenbergブロック変換">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={settings.swell?.gutenbergBlocks !== false}
                onChange={(e) => setSettings(prev => ({...prev, swell: {...(prev.swell || {}), gutenbergBlocks: e.target.checked}}))} />
              <span className="text-sm text-gray-600">標準HTMLをGutenbergブロックマークアップに変換</span>
            </label>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'captionBox', label: 'キャプションボックス' },
              { key: 'stepBlock', label: 'ステップブロック' },
              { key: 'faqBlock', label: 'FAQブロック' },
              { key: 'balloonBlock', label: 'ふきだしブロック' },
              { key: 'checkList', label: 'チェックリスト' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.swell?.[key] !== false}
                  onChange={(e) => setSettings(prev => ({...prev, swell: {...(prev.swell || {}), [key]: e.target.checked}}))} />
                <span className="text-sm text-gray-600">{label}</span>
              </label>
            ))}
          </div>
        </Section>

        {/* ナレッジ設定 */}
        <Section title="ナレッジ設定">
          <Field label="ファイルサイズ上限 (KB)">
            <input
              type="number"
              value={settings.knowledge.maxFileSizeKB}
              onChange={(e) => updateField('knowledge.maxFileSizeKB', parseInt(e.target.value) || 100)}
              className="input-field"
            />
          </Field>
          <Field label="全体文字数上限">
            <input
              type="number"
              value={settings.knowledge.maxTotalChars}
              onChange={(e) => updateField('knowledge.maxTotalChars', parseInt(e.target.value) || 50000)}
              className="input-field"
            />
          </Field>
        </Section>

        {/* 自動投稿スケジュール */}
        <Section title="自動投稿スケジュール">
          <Field label="投稿頻度">
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="input-field"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Field>

          <Field label="1回目の時刻">
            <div className="flex gap-2 items-center">
              <select
                value={hour1}
                onChange={(e) => setHour1(parseInt(e.target.value))}
                className="input-field"
                style={{ width: 'auto', minWidth: '5rem' }}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h}時</option>
                ))}
              </select>
              <select
                value={min1}
                onChange={(e) => setMin1(parseInt(e.target.value))}
                className="input-field"
                style={{ width: 'auto', minWidth: '5rem' }}
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')}分</option>
                ))}
              </select>
            </div>
          </Field>

          {frequency === 'daily2' && (
            <Field label="2回目の時刻">
              <div className="flex gap-2 items-center">
                <select
                  value={hour2}
                  onChange={(e) => setHour2(parseInt(e.target.value))}
                  className="input-field"
                  style={{ width: 'auto', minWidth: '5rem' }}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{h}時</option>
                  ))}
                </select>
                <select
                  value={min2}
                  onChange={(e) => setMin2(parseInt(e.target.value))}
                  className="input-field"
                  style={{ width: 'auto', minWidth: '5rem' }}
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}分</option>
                  ))}
                </select>
              </div>
            </Field>
          )}

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
            {cronDescription}
          </div>
        </Section>

        {/* 画像生成モデル */}
        <Section title="画像生成">
          <Field label="画像生成モデル">
            <select
              value={settings.imageModel || 'gemini-3.1-flash-image-preview'}
              onChange={(e) => updateField('imageModel', e.target.value)}
              className="input-field"
            >
              {IMAGE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>

          {/* 参照画像アップロード */}
          <div className="border-t border-gray-200 pt-4 mt-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">参照画像（スタイル参考）</h3>
            <p className="text-xs text-gray-600 mb-3">
              アイキャッチや図解のスタイル参考として画像をアップロードできます。
              アップロードした画像の雰囲気・色使い・テイストを参考にAIが画像を生成します。
            </p>

            {refImageMsg && (
              <div className={`rounded-lg px-4 py-2 text-sm mb-3 ${refImageMsg.includes('エラー') ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
                {refImageMsg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {/* アイキャッチ参照 */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-700 mb-2">アイキャッチ用参照</p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => handleRefImageUpload(e, 'eyecatch')}
                  disabled={refImageUploading}
                  className="text-xs w-full"
                />
                {/* アイキャッチ参照画像一覧 */}
                {refImages.filter(img => img.type === 'eyecatch').map((img) => (
                  <div key={img.filename} className="mt-2 flex items-center gap-2">
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={img.filename}
                      className="w-16 h-10 object-cover rounded border"
                    />
                    <span className="text-xs text-gray-500 flex-1 truncate">{img.filename}</span>
                    <button
                      onClick={() => handleRefImageDelete(img.filename)}
                      className="text-red-500 hover:text-red-700 text-xs cursor-pointer"
                    >
                      削除
                    </button>
                  </div>
                ))}
                {refImages.filter(img => img.type === 'eyecatch').length === 0 && (
                  <p className="text-xs text-gray-400 mt-2">未設定（デフォルトスタイルで生成）</p>
                )}
              </div>

              {/* 図解参照 */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-700 mb-2">図解用参照</p>
                <input
                  ref={refImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => handleRefImageUpload(e, 'diagram')}
                  disabled={refImageUploading}
                  className="text-xs w-full"
                />
                {/* 図解参照画像一覧 */}
                {refImages.filter(img => img.type === 'diagram').map((img) => (
                  <div key={img.filename} className="mt-2 flex items-center gap-2">
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={img.filename}
                      className="w-16 h-10 object-cover rounded border"
                    />
                    <span className="text-xs text-gray-500 flex-1 truncate">{img.filename}</span>
                    <button
                      onClick={() => handleRefImageDelete(img.filename)}
                      className="text-red-500 hover:text-red-700 text-xs cursor-pointer"
                    >
                      削除
                    </button>
                  </div>
                ))}
                {refImages.filter(img => img.type === 'diagram').length === 0 && (
                  <p className="text-xs text-gray-400 mt-2">未設定（デフォルトスタイルで生成）</p>
                )}
              </div>
            </div>

            <p className="text-xs text-gray-500">
              ※ 各タイプ最大3枚まで。PNG/JPG/WEBP/GIF対応（5MB以下）
            </p>
          </div>
        </Section>

        {/* その他 */}
        <Section title="その他">
          <Field label="ドライラン（投稿スキップ）">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.posting.dryRun}
                onChange={(e) => updateField('posting.dryRun', e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm text-gray-600">有効にすると実際の投稿をスキップします</span>
            </label>
          </Field>
        </Section>

        {/* 保存ボタン */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? '保存中...' : '設定を保存'}
          </button>
          {message && (
            <span className="text-sm">{message}</span>
          )}
        </div>
      </div>

      <style jsx>{`
        :global(.input-field) {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        :global(.input-field:focus) {
          outline: none;
          box-shadow: 0 0 0 2px #3b82f6;
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

// --- ヘルパー関数（クライアントサイド） ---

function buildCronSimple({ frequency, hour1, min1 = 0, hour2, min2 = 0 }) {
  const h1 = Math.min(23, Math.max(0, parseInt(hour1) || 0));
  const m1 = Math.min(50, Math.max(0, parseInt(min1) || 0));

  switch (frequency) {
    case 'daily2': {
      const h2 = Math.min(23, Math.max(0, parseInt(hour2) || 15));
      const m2v = Math.min(50, Math.max(0, parseInt(min2) || 0));
      // 2つの時刻を分離したcron式: "分1 時1,分2 時2" は非対応なので
      // 時が同じなら分をカンマ区切り、違えば2つのcron式を";"で連結
      if (h1 === h2) {
        const mins = [m1, m2v].sort((a, b) => a - b).join(',');
        return `${mins} ${h1} * * *`;
      }
      // 異なる時・分の場合は ";" 区切りで2つのスケジュール
      return `${m1} ${h1} * * *;${m2v} ${h2} * * *`;
    }
    case 'weekday':
      return `${m1} ${h1} * * 1-5`;
    default:
      return `${m1} ${h1} * * *`;
  }
}

function parseCronSimple(cron) {
  const defaults = { frequency: 'daily1', hour1: 9, min1: 0, hour2: 15, min2: 0 };
  if (!cron) return defaults;

  // ";" 区切り（2スケジュール）
  if (cron.includes(';')) {
    const [c1, c2] = cron.split(';').map(s => s.trim());
    const p1 = c1.split(' ');
    const p2 = c2.split(' ');
    return {
      frequency: 'daily2',
      hour1: parseInt(p1[1]) || 9,
      min1: parseInt(p1[0]) || 0,
      hour2: parseInt(p2[1]) || 15,
      min2: parseInt(p2[0]) || 0,
    };
  }

  const parts = cron.split(' ');
  if (parts.length !== 5) return defaults;
  const [minStr, hourStr, , , dow] = parts;

  const hours = hourStr.split(',').map(Number);
  const mins = minStr.split(',').map(Number);

  if (hours.length > 1) {
    return {
      frequency: 'daily2',
      hour1: hours[0] || 9,
      min1: mins[0] || 0,
      hour2: hours[1] || 15,
      min2: mins[1] || mins[0] || 0,
    };
  }

  return {
    frequency: dow === '1-5' ? 'weekday' : 'daily1',
    hour1: hours[0] || 9,
    min1: mins[0] || 0,
    hour2: 15,
    min2: 0,
  };
}

function describeCronSimple({ frequency, hour1, min1 = 0, hour2, min2 = 0 }) {
  const h1 = parseInt(hour1) || 0;
  const m1 = String(parseInt(min1) || 0).padStart(2, '0');
  const h2 = parseInt(hour2) || 15;
  const m2 = String(parseInt(min2) || 0).padStart(2, '0');

  switch (frequency) {
    case 'daily2':
      return `毎日 ${h1}:${m1} と ${h2}:${m2} に自動投稿`;
    case 'weekday':
      return `平日 ${h1}:${m1} に自動投稿`;
    default:
      return `毎日 ${h1}:${m1} に自動投稿`;
  }
}
