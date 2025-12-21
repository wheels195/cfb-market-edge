# CFB Market-Edge

Personal decision-support app for NCAAF betting that identifies market discrepancies, tracks line movement, and generates model projections.

## Project Overview

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (Postgres)
- **Deployment**: Vercel
- **Odds Source**: The Odds API (DraftKings, Bovada)
- **Stats Source**: CollegeFootballData API

---

## The Model

### Production Model: Market-Anchored v1

The live betting model uses a **market-anchored approach**:

1. **Base**: Start with the current market spread (from DraftKings or Bovada)
2. **Adjustment**: Apply Elo-based adjustment (capped at ±5 points)
3. **Edge**: Difference between model spread and market spread

**Formula:**
```
elo_adjustment = (home_elo - away_elo) / 25 + home_field_advantage
model_spread = market_spread + clamp(elo_adjustment, -5, +5)
edge = market_spread - model_spread
```

**Why Market-Anchored:**
- Markets are efficient; we're looking for small edges, not replacing the market
- Prevents wild projections that pure Elo might produce
- ChatGPT research confirmed: use market-anchored for betting, raw Elo for diagnostics

### Elo Rating System

- **Initial Rating**: 1500 for all teams
- **K-Factor**: Adjusted for game importance
- **Home Field Advantage**: 2.5 points
- **Divisor**: 25 (converts Elo diff to spread points)
- **Weekly Snapshots**: Stored in `team_elo_snapshots` table for point-in-time lookups

---

## Current Performance (Bowl Season 2024-25)

| Metric | Value |
|--------|-------|
| Record | 4-2 |
| Win Rate | 66.7% |
| Units | +1.64 |
| ROI | +27.3% |

### Tracked Results

| Game | Pick | Spread | Result | Outcome |
|------|------|--------|--------|---------|
| WMU vs Kennesaw | WMU -3 | -3.5 | 41-6 | WIN |
| NC State vs Memphis | NC State -3.5 | -3.5 | 31-7 | WIN |
| Oklahoma vs Alabama | Oklahoma -2 | -2 | 24-34 | LOSS |
| Texas A&M vs Miami | Texas A&M -3 | -3.5 | 3-10 | LOSS |
| Ole Miss vs Tulane | Ole Miss -17.5 | -17.5 | 41-10 | WIN |
| Oregon vs JMU | JMU +20.5 | -20.5 | 51-34 | WIN |

---

## Architecture

### Database Schema

```
sportsbooks          - DraftKings, Bovada, FanDuel
teams                - NCAAF teams with CFBD mapping
events               - Games with odds_api_event_id
odds_ticks           - Line snapshots (deduplicated)
closing_lines        - Materialized closing numbers
results              - Final scores from CFBD
team_elo_snapshots   - Weekly Elo ratings per team
model_versions       - Model metadata
projections          - Model outputs per event
edges                - Computed edges per event/book
game_predictions     - Locked predictions at kickoff
```

### Cron Jobs (Vercel)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `poll-odds` | Every 10 min | Fetch live spreads from The Odds API |
| `materialize-edges` | Every 15 min | Calculate model vs market edges |
| `set-closing-lines` | Every 30 min | Lock closing line + prediction at kickoff |
| `sync-results` | 6 AM daily | Pull final scores from CFBD |
| `grade-bets` | 7 AM daily | Calculate WIN/LOSS for completed games |
| `sync-elo` | 6:30 AM daily | Update Elo ratings after games |
| `run-pipeline` | 8 AM daily | Full data sync |

### API Endpoints

- `GET /api/games` - Games with edges, results, and recommendations
- `GET /api/cron/*` - Cron job endpoints
- `GET /api/paper-bets` - Paper trading system

---

## Key Files

### Core Model
- `src/lib/models/dual-projections.ts` - Market-anchored model implementation
- `src/lib/models/elo.ts` - Elo rating calculations
- `src/lib/jobs/materialize-edges.ts` - Edge computation

### Data Sync
- `src/lib/jobs/poll-odds.ts` - Odds API polling with deduplication
- `src/lib/jobs/sync-results.ts` - CFBD results sync
- `src/lib/jobs/set-closing-lines.ts` - Closing line + prediction locking

### Frontend
- `src/app/page.tsx` - Homepage with stats, results, upcoming games
- `src/app/games/page.tsx` - Full games list with filters
- `src/lib/team-logos.ts` - ESPN CDN team logo mapping

---

## Environment Variables

```
# Supabase
SUPABASE_URL=https://cdhujemmhfbsmzchsuci.supabase.co
SUPABASE_ANON_KEY=<jwt_token>
SUPABASE_SERVICE_ROLE_KEY=<service_key>

# The Odds API
ODDS_API_KEY=<key>

# CollegeFootballData
CFBD_API_KEY=<key>
```

---

## Completed Work

### Phase 1: Foundation
- [x] Next.js 14 project setup
- [x] Supabase database schema
- [x] Team logo integration (ESPN CDN)
- [x] Events sync from The Odds API

### Phase 2: Odds Ingestion
- [x] Odds polling with adaptive timing
- [x] Deduplication (hash-based)
- [x] DraftKings + Bovada support
- [x] Closing line materialization

### Phase 3: Model Implementation
- [x] Elo rating system
- [x] Weekly Elo snapshots for point-in-time lookups
- [x] Market-anchored projection model
- [x] Edge calculation and ranking

### Phase 4: Results Tracking
- [x] CFBD results sync
- [x] Automatic bet grading (WIN/LOSS/PUSH)
- [x] Game predictions table (locks at kickoff)
- [x] Performance stats calculation

### Phase 5: UI/UX
- [x] Premium sportsbook-style homepage
- [x] Team logos with rankings
- [x] Mobile-optimized responsive design
- [x] Dark theme with emerald accents
- [x] Sportsbook display (DK vs Bovada)
- [x] Results with model picks and outcomes

---

## Commands

```bash
# Development
npm run dev

# Build
npm run build

# Run specific sync
SUPABASE_URL="..." SUPABASE_ANON_KEY="..." npx tsx scripts/<script>.ts
```

---

## Notes

- **Odds Source Priority**: DraftKings preferred, Bovada as backup
- **Edge Threshold**: 2+ points highlighted as strong plays
- **Model updates**: Elo ratings update daily after games complete
- **Data retention**: Odds ticks kept for line movement analysis
