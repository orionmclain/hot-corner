# Hot Corner

See who's hot, who's cold, and how consistent any MLB player has really been. Explore the season through any rolling N-game window — find hot streaks, cold spells, and leaderboards updated daily.

![Angular](https://img.shields.io/badge/Angular-20-dd0031?style=flat-square) ![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square) ![Python](https://img.shields.io/badge/Python-3.12+-3776ab?style=flat-square) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-optional-336791?style=flat-square)

## Features

- **Rolling stretch analysis** — slide from 5 to 50 games to find any player's best and worst runs
- **Leaderboard** — ranked list of top performers over any stretch length, with hot/cold status, best/worst windows, and consistency rating
- **Team pages** — full roster breakdown by position group (hitters / SP / RP), each with their own stat and stretch controls
- **Hitting & pitching stats** — OPS, AVG, OBP, SLG, HR, RBI, SB / ERA, WHIP, K/9, K, BB, ER
- **Player comparison** — compare any two players side-by-side
- **Hot/cold system** — 5-level status (On Fire / Hot / Neutral / Cold / Slumping) based on current stretch vs season average
- **Consistency rating** — coefficient of variation shows how streaky a player really is
- **Dynamic default length** — stretch length auto-adjusts early in the season so charts are always meaningful
- **Shareable URLs** — `/player/:id`, `/team/:id`, `/compare/:id1/:id2` routes are all deep-linkable

## Project Structure

```
Hot Corner/
├── frontend/               # Angular 20 frontend
├── backend/
│   ├── main.py             # FastAPI app
│   ├── database.py         # PostgreSQL connection pool (optional)
│   ├── sync.py             # ETL: nightly MLB API → local DB sync
│   └── requirements.txt
└── db/
    └── schema.sql          # PostgreSQL schema
```

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.12+
- Angular CLI: `npm install -g @angular/cli`
- PostgreSQL (optional — see [Database](#database) below)

### Backend

```bash
cd backend
poetry install

# Optional: set your database URL (see Database section)
export DATABASE_URL=postgresql://user:password@localhost:5432/baseball

poetry run uvicorn main:app --reload
```

Runs on `http://localhost:8000`. Works without a database — falls back to the public MLB Stats API automatically.

### Frontend

```bash
cd frontend
npm install
ng serve
```

Open `http://localhost:4200`.

## Database

The backend has a three-tier cache: **in-memory TTL → PostgreSQL → MLB Stats API**. Without a database it works fine, but response times depend on real-time MLB API calls. With a local database, game-log queries drop from ~500 ms to under 10 ms.

### Setup

```bash
# 1. Apply the schema
psql $DATABASE_URL -f db/schema.sql

# 2. Backfill historical data (adjust seasons as needed)
DATABASE_URL=postgresql://... python backend/sync.py --seasons 2026 2025 2024 2023

# 3. Add a nightly cron to keep current season current
DATABASE_URL=... python backend/sync.py
```

### Hosting options

| Option | Free tier | Paid | Notes |
|---|---|---|---|
| Local PostgreSQL | Free | — | Dev only; not reachable from deployed backend |
| [Supabase](https://supabase.com) | 500 MB, pauses after 7d inactivity | $25/mo (no pause) | Easiest to get started |
| [Neon](https://neon.tech) | 512 MB, no pausing | $19/mo | Good free tier for low-traffic apps |
| [Railway](https://railway.app) | $5 credit/mo | Usage-based | Can host backend + DB together |

Your data (5 seasons of game logs) is roughly 300–500 MB, so the free tiers are sufficient for development and early production use.

## How It Works

Game logs are fetched from the public [MLB Stats API](https://statsapi.mlb.com) and stored as flat per-game rows. Rolling windows are computed server-side using prefix sums — every possible N-game stretch is evaluated in O(n) time regardless of stretch length.

| Data | In-memory TTL |
|---|---|
| Game logs | 1 hour |
| Leaderboard results | 1 hour |
| Player info | 24 hours |
| Roster / team data | 1 hour |
| Search results | 5 minutes |

## Production Build

```bash
# Frontend — deploy to Cloudflare Pages
cd frontend
ng build --configuration production
# Output in dist/

# Backend — deploy to Railway
# Set DATABASE_URL in your hosting environment
# Update src/environments/environment.ts with your backend URL
```
