import { NextResponse } from 'next/server';
import { testWordPressConnection } from '../../../wordpress-poster.js';

export async function POST() {
  try {
    const result = await testWordPressConnection();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
