# CFB Market-Edge: Production Model Plan v2 (Simplified)

## Core Principle

**At any point in time, the model may only use information that would have been available at that moment.**

## Simplified Approach

Instead of building custom player-level Elo ratings from raw stats, we use **CFBD's pre-calculated metrics**:

1. **Returning Production** — CFBD calculates % of PPA returning (already opponent-adjusted)
2. **Team PPA** — Per-game and cumulative, already opponent-adjusted
3. **Player Usage** — Identifies key players by snap/touch share
4. **Weather** — Direct from CFBD
5. **Recruiting** — 4-year composite from class rankings

This is simpler, more robust, and uses proven metrics.

---

## Data Successfully Synced

| Table | Records | Purpose |
|-------|---------|---------|
| returning_production | 522 | Preseason: % of production returning |
| recruiting_classes | 1,403 | Preseason: talent level |
| player_usage | 11,278 | Key player identification |
| player_seasons | 48,621 | Player stats for tracking |
| game_advanced_stats | 6,740 | Per-game PPA, success rate |
| game_weather | 10,484 | Weather adjustments |
| transfer_portal | 9,923 | Roster changes |

---

## Rating System Architecture

### Preseason Rating (Week 0)

```
preseason_rating =
    α × prior_season_final_rating × regression_to_mean
  + β × returning_production_ppa
  + γ × recruiting_composite_4yr
  + δ × coaching_stability_bonus
```

**Components:**

| Factor | Weight (α,β,γ,δ) | Source |
|--------|------------------|--------|
| Prior season rating | ~0.50 | Our calculated rating |
| Returning production | ~0.25 | CFBD `returning_production.percent_ppa` |
| Recruiting composite | ~0.20 | 4-year weighted avg of recruiting rank |
| Coaching stability | ~0.05 | Years at school, career win % |

**Regression to mean:** New season rating = 0.6 × last_season + 0.4 × league_average

### Weekly Rating Updates

After each game, update team rating using **game-level PPA**:

```python
def update_rating_after_game(team, game):
    # Get game PPA from game_advanced_stats
    game_ppa = get_game_ppa(team, game.id)

    # Current rating components
    current_off = team.off_rating
    current_def = team.def_rating

    # Game performance (already opponent-adjusted by CFBD)
    game_off_ppa = game_ppa.off_ppa  # Higher is better
    game_def_ppa = game_ppa.def_ppa  # Lower is better (less points allowed)

    # K factor decreases through season
    games_played = team.games_played
    k = K_BASE * (1 - games_played / 15)

    # Update ratings
    new_off = current_off + k * (game_off_ppa - current_off)
    new_def = current_def + k * (game_def_ppa - current_def)

    return {
        'off_rating': new_off,
        'def_rating': new_def,
        'overall': new_off - new_def  # Net PPA (off is positive, def is positive when bad)
    }
```

---

## Game Projection Features

### Spread Projection

```
projected_spread =
    (away_rating - home_rating) / RATING_TO_SPREAD_SCALE
  + home_field_advantage
  + weather_adjustment
  + rest_adjustment
  + key_player_adjustment
  + recent_form_adjustment
  + situational_adjustment
```

### Feature Details

#### 1. Home Field Advantage
```python
if neutral_site:
    hfa = 0
else:
    hfa = 2.5  # Default, can be tuned
```

#### 2. Weather Adjustment (Spreads)
```python
# Weather mainly affects totals, but extreme weather helps home team slightly
if wind_speed > 20 or temperature < 30:
    weather_adj = 0.5  # Home team advantage in bad weather
else:
    weather_adj = 0
```

#### 3. Rest Adjustment
```python
home_rest = days_since_last_game(home_team)
away_rest = days_since_last_game(away_team)

if home_rest >= 10 and away_rest <= 6:
    rest_adj = 1.5  # Home off bye, away on short rest
elif away_rest >= 10 and home_rest <= 6:
    rest_adj = -1.5
else:
    rest_adj = (home_rest - away_rest) * 0.2  # Small advantage per extra day
```

#### 4. Key Player Adjustment
```python
# Check if high-usage players are missing (didn't play last game)
home_missing = get_missing_key_players(home_team)
away_missing = get_missing_key_players(away_team)

# Position-specific impacts
POSITION_IMPACT = {
    'QB': 5.0,   # Starting QB worth 5 points
    'RB': 1.5,   # Top RB worth 1.5 points
    'WR': 1.0,   # Top WR worth 1 point
    'OL': 0.5,   # Per lineman
    'DL': 0.5,
    'LB': 0.3,
    'DB': 0.3,
}

home_impact = sum(POSITION_IMPACT.get(p.position, 0) for p in home_missing)
away_impact = sum(POSITION_IMPACT.get(p.position, 0) for p in away_missing)

key_player_adj = away_impact - home_impact  # Positive = favors home
```

#### 5. Recent Form
```python
# Compare last 3 games PPA to season average
home_recent_ppa = avg_ppa_last_3_games(home_team)
home_season_ppa = season_avg_ppa(home_team)
away_recent_ppa = avg_ppa_last_3_games(away_team)
away_season_ppa = season_avg_ppa(away_team)

home_form = (home_recent_ppa - home_season_ppa) * FORM_WEIGHT
away_form = (away_recent_ppa - away_season_ppa) * FORM_WEIGHT

form_adj = home_form - away_form
```

#### 6. Situational
```python
situation_adj = 0

# Rivalry games tend to be closer
if is_rivalry_game(home, away):
    if abs(base_spread) > 7:
        situation_adj = -1.5 if base_spread > 0 else 1.5

# Bowl eligibility desperation
if home_wins == 5:
    situation_adj += 1.0  # Home team fighting for bowl
if away_wins == 5:
    situation_adj -= 1.0
```

### Total Projection

```
projected_total =
    league_avg_total
  + pace_adjustment
  + offensive_quality_adjustment
  + defensive_quality_adjustment
  + weather_adjustment
```

```python
# Pace: more plays = more points
home_pace = plays_per_game(home_team)
away_pace = plays_per_game(away_team)
avg_pace = (home_pace + away_pace) / 2
pace_adj = (avg_pace - LEAGUE_AVG_PACE) * POINTS_PER_PLAY

# Offensive/defensive quality
combined_off = home_off_rating + away_off_rating
combined_def = home_def_rating + away_def_rating
quality_adj = (combined_off - 2 * LEAGUE_AVG_OFF) * OFF_WEIGHT

# Weather (big impact on totals)
weather_total_adj = 0
if wind_speed > 15:
    weather_total_adj -= (wind_speed - 15) * 0.2
if temperature < 40:
    weather_total_adj -= (40 - temperature) * 0.05
if precipitation > 0:
    weather_total_adj -= 2
if is_indoor:
    weather_total_adj = 0  # No weather impact indoors
```

---

## Walk-Forward Engine

```python
def run_walk_forward(seasons: list[int], params: ModelParams):
    results = []

    for season in seasons:
        # Initialize preseason ratings
        ratings = initialize_preseason_ratings(season)
        snapshot_ratings(season, week=0, ratings)

        for week in range(1, 16):
            # 1. Get upcoming games
            games = get_games_for_week(season, week)

            # 2. Generate projections BEFORE games happen
            for game in games:
                # Get frozen ratings from previous week
                home_rating = get_rating(game.home_team, season, week - 1)
                away_rating = get_rating(game.away_team, season, week - 1)

                # Get all features
                features = extract_features(game, home_rating, away_rating)

                # Project spread and total
                projection = calculate_projection(features, params)

                # Get market line
                closing_line = get_closing_line(game.id)

                # Calculate CLV
                clv_spread = projection.spread - closing_line.spread
                clv_total = projection.total - closing_line.total

                results.append({
                    'game': game,
                    'projection': projection,
                    'closing': closing_line,
                    'clv_spread': clv_spread,
                    'clv_total': clv_total,
                })

            # 3. AFTER games complete: update ratings
            completed_games = get_completed_games(season, week)
            for game in completed_games:
                game_ppa = get_game_advanced_stats(game.id)
                update_ratings(game.home_team, game_ppa.home)
                update_ratings(game.away_team, game_ppa.away)

            # 4. Snapshot ratings
            snapshot_ratings(season, week, ratings)

    return calculate_clv_metrics(results)
```

---

## Parameters to Tune

| Parameter | Description | Range |
|-----------|-------------|-------|
| `PRIOR_WEIGHT` | Weight on prior season rating | 0.4 - 0.7 |
| `RETURNING_PROD_WEIGHT` | Weight on returning production | 0.15 - 0.35 |
| `RECRUITING_WEIGHT` | Weight on 4-year recruiting | 0.1 - 0.25 |
| `K_BASE` | Rating update speed | 0.1 - 0.3 |
| `HFA_DEFAULT` | Home field advantage points | 2.0 - 3.5 |
| `REST_FACTOR` | Points per rest day difference | 0.1 - 0.3 |
| `QB_OUT_IMPACT` | Points when starting QB missing | 4.0 - 7.0 |
| `FORM_WEIGHT` | Weight on recent 3-game form | 0.3 - 0.7 |
| `WIND_TOTAL_COEF` | Total reduction per mph wind | -0.15 to -0.25 |
| `RATING_TO_SPREAD_SCALE` | Convert rating diff to spread | 8 - 15 |

**Tuning method:**
- Tune on 2022 season
- Validate on 2023-2024
- Optimize for CLV, not win rate

---

## CLV Calculation

```
CLV (Closing Line Value) = Our Projection - Closing Line

Example:
  Our spread projection: Home -4.0
  Closing line: Home -7.0
  CLV = -4.0 - (-7.0) = +3.0 points

  Interpretation: We projected the game 3 points closer than the close.
  If we bet Home -4.0 early, we got 3 points of value.
```

**Metrics:**

| Metric | Target |
|--------|--------|
| Mean CLV | > 0 (positive is good) |
| CLV+ Rate | > 52% (beat close more than half the time) |
| CLV Sharpe | > 0.2 (consistency) |

---

## Implementation Order

### Phase 1: Team Rating System ✓ (Data synced)
- [x] Sync returning production
- [x] Sync recruiting classes
- [x] Sync game advanced stats (PPA)
- [x] Sync weather
- [ ] Build preseason rating initialization
- [ ] Build weekly rating updates

### Phase 2: Projection Engine
- [ ] Extract game features (rest, weather, etc.)
- [ ] Build spread projection
- [ ] Build total projection
- [ ] Track key player availability

### Phase 3: Walk-Forward Backtest
- [ ] Run walk-forward on 2022-2024
- [ ] Calculate CLV metrics
- [ ] Validate no data leakage

### Phase 4: Parameter Tuning
- [ ] Grid search on 2022
- [ ] Validate on 2023-2024
- [ ] Document final parameters

### Phase 5: Production
- [ ] Daily rating updates
- [ ] Live projections for upcoming games
- [ ] Hypothetical bet tracking
- [ ] CLV monitoring

---

## Key Insight: Why This Works

1. **CFBD's PPA is opponent-adjusted** — We're not using raw stats
2. **Returning production is pre-calculated** — CFBD does the player tracking
3. **Weekly updates use game PPA** — Captures in-season performance changes
4. **Simple feature set** — Weather, rest, key players are measurable
5. **CLV is the metric** — Not win rate, not ROI (too noisy)

The market is efficient. We're not trying to beat it by 5%. We're trying to find +0.5 to +1.0 points of CLV consistently. That's enough for long-term edge.
