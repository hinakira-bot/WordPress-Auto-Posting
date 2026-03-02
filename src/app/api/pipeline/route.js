import { NextResponse } from 'next/server';
import { startPipeline, getStatus, resetPipeline, getCheckpointInfo } from '@/lib/pipeline-runner.js';

/** POST /api/pipeline — パイプライン実行開始 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { action, dryRun = false, keywordId } = body;

    // アクション分岐
    if (action === 'resume') {
      // チェックポイントからレジューム
      await startPipeline({ dryRun, resume: true });
      return NextResponse.json({ success: true, message: 'レジューム開始' });
    }

    // 通常の実行開始
    await startPipeline({ dryRun, keywordId });
    return NextResponse.json({ success: true, message: 'パイプライン開始' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
}

/** GET /api/pipeline — 現在の実行状態取得 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    // チェックポイント情報の取得
    if (query === 'checkpoint') {
      const info = getCheckpointInfo();
      return NextResponse.json({
        hasCheckpoint: !!info,
        checkpoint: info,
      });
    }

    const status = getStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** DELETE /api/pipeline — パイプラインを強制リセット */
export async function DELETE() {
  try {
    const result = resetPipeline();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
