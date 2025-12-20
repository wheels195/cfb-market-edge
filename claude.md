# CFB Market Edge - Project Context

## Overview

Personal decision-support app for NCAAF betting that identifies market discrepancies using Elo-based projections. Built with Next.js 14 (App Router), Supabase, and deployed on Vercel.

## Current Production State

### PROD_V1 (Spreads) - LOCKED
- **Model**: Elo-only
- **Formula**: `modelSpreadHome = -((homeElo - awayElo) / 25 + 2.5)`
- **Edge**: `edge = marketSpreadHome - modelSpreadHome`
- **Selection**: Top 10 bets/week by |edge|
- **Filter**: Exclude spreads 3-7 (keep ≤3 or ≥7)
- **Staking**: Flat $100/bet
- **Status**: Forward testing via paper trading

See `PROD_V1_LOCKED.md` for full specification.

### V2 (Totals) - In Development
Separate model for over/under totals market.

## Key Files

### Models
- `src/lib/models/v1-elo-model.ts` - Production spread model (LOCKED)
- `src/lib/models/v2-ppa-model.ts` - Spread model with PPA (experimental)
- `src/lib/models/v2-totals-model.ts` - Totals model (to be created)

### API Routes
- `/api/paper-bets/recommendations` - Get top edge recommendations
- `/api/paper-bets/place` - Place paper bet
- `/api/paper-bets/active` - Get active bets
- `/api/paper-bets/history` - Get bet history

### Cron Jobs (vercel.json)
| Job | Schedule | Purpose |
|-----|----------|---------|
| run-pipeline | Thu-Sat 8AM | Full data refresh |
| poll-odds | Every 10min Thu-Sat | Capture live odds |
| materialize-edges | Every 15min Thu-Sat | Compute edges |
| set-closing-lines | Every 30min Thu-Sun | Capture closing lines |
| sync-results | Sun 6AM | Pull game scores from CFBD |
| grade-bets | Sun 7AM | Grade paper bets |
| sync-elo | Mon 6:30AM | Sync Elo ratings from CFBD |
| cleanup | Daily 3AM | Remove old data |

### Pages
- `/edges` - Current edge recommendations (dark UI)
- `/paper-trading` - Paper trading dashboard

## Database (Supabase)

### Key Tables
- `teams` - Team info with cfbd_team_id mapping
- `events` - Games with odds_api_event_id
- `odds_ticks` - Historical line snapshots
- `team_elo_snapshots` - Weekly Elo ratings per team
- `paper_bets` - Paper trading records
- `results` - Final game scores

## External APIs

### The Odds API
- Events and live odds (spreads, totals)
- Key: `ODDS_API_KEY`

### CollegeFootballData (CFBD)
- Elo ratings, results, rankings, PPA
- Key: `CFBD_API_KEY`
- Base: `https://apinext.collegefootballdata.com`

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ODDS_API_KEY
CFBD_API_KEY
CRON_SECRET
```

## Development Commands
```bash
npm run dev          # Local development
npm run build        # Production build
npm run lint         # ESLint
```

## Model Development Guidelines

### Adding New Models
1. Create `src/lib/models/v{N}-{name}-model.ts`
2. Define config interface extending previous version
3. Implement projection function
4. Add backtest script in `scripts/`
5. Document in separate LOCKED md file when proven

### Backtest Requirements
- Train: 2022-2023 only
- Test: 2024 only (out-of-sample)
- No peeking at 2024 during feature engineering
- Document all metrics: ROI, win rate, drawdown

## Current Tasks
1. Forward test PROD_V1 spreads (4-8 weeks)
2. Develop V2 totals model (separate from spreads)
3. Paper trade both in parallel
