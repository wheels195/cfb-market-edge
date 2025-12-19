import { NextResponse } from 'next/server';
import { seedEloRatings } from '@/lib/jobs/seed-elo';

export const maxDuration = 300; // 5 minutes for historical processing

export async function GET() {
  try {
    // Process last 3 seasons to build ratings
    const result = await seedEloRatings([2022, 2023, 2024]);

    return NextResponse.json({
      success: result.errors.length === 0,
      ...result,
    });
  } catch (error) {
    console.error('Seed Elo error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
