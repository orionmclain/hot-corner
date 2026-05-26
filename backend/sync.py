#!/usr/bin/env python3
"""
sync.py — ETL: fetch MLB game logs from the Stats API and upsert into PostgreSQL.

Run nightly (or on demand) to keep the local DB current.

Usage:
    python sync.py                              # current season (all players)
    python sync.py --lookback 7                # re-sync players active in last 7 days
    python sync.py --seasons 2025 2024 2023    # backfill multiple seasons
    python sync.py --players 660271 545361     # one or more specific players
    python sync.py --workers 20                # increase parallelism
"""

import argparse
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)

MLB_API_BASE = "https://statsapi.mlb.com/api/v1"
CURRENT_YEAR = datetime.now().year
PITCHER_POSITIONS = {"P", "SP", "RP", "CP", "CL"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ── DB connection ──────────────────────────────────────────────────────────────

def get_conn():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        sys.exit("DATABASE_URL environment variable is not set.")
    return psycopg2.connect(url)


# ── MLB API helpers ────────────────────────────────────────────────────────────

def fetch_all_players(season: int) -> list[dict]:
    r = requests.get(
        f"{MLB_API_BASE}/sports/1/players",
        params={"season": season, "gameType": "R"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("people", [])


def fetch_splits(player_id: int, season: int, group: str) -> list[dict]:
    r = requests.get(
        f"{MLB_API_BASE}/people/{player_id}/stats",
        params={"stats": "gameLog", "group": group, "season": season, "gameType": "R"},
        timeout=15,
    )
    if r.status_code != 200:
        return []
    data = r.json()
    if not data.get("stats") or not data["stats"][0].get("splits"):
        return []
    return data["stats"][0]["splits"]


def fetch_mlb_teams(season: int) -> list[dict]:
    r = requests.get(
        f"{MLB_API_BASE}/teams",
        params={"sportId": 1, "season": season},
        timeout=15,
    )
    r.raise_for_status()
    return [
        t for t in r.json().get("teams", [])
        if t.get("sport", {}).get("id") == 1
        and t.get("active", False)
        and t.get("allStarStatus") == "N"
    ]


def fetch_mlb_roster(team_id: int, season: int) -> list[dict]:
    r = requests.get(
        f"{MLB_API_BASE}/teams/{team_id}/roster",
        params={"rosterType": "active", "season": season},
        timeout=10,
    )
    if r.status_code != 200:
        return []
    return r.json().get("roster", [])


# ── Upsert helpers ─────────────────────────────────────────────────────────────

def _parse_outs(ip_str) -> int:
    ip = float(str(ip_str))
    full = int(ip)
    partial = round((ip - full) * 10)
    return full * 3 + partial


def upsert_hitting(conn, player_id: int, season: int, splits: list[dict]) -> int:
    rows = []
    for s in splits:
        st = s.get("stat", {})
        rows.append((
            player_id, season, s["date"],
            s.get("opponent", {}).get("name", ""),
            st.get("atBats", 0), st.get("hits", 0),
            st.get("doubles", 0), st.get("triples", 0),
            st.get("homeRuns", 0), st.get("baseOnBalls", 0),
            st.get("hitByPitch", 0), st.get("sacFlies", 0),
            st.get("totalBases", 0), st.get("rbi", 0),
            st.get("stolenBases", 0), st.get("strikeOuts", 0),
            st.get("runs", 0), st.get("plateAppearances", 0),
        ))
    rows = list({r[2]: r for r in rows}.values())
    if not rows:
        return 0
    sql = """
        INSERT INTO hitting_game_logs (
            player_id, season, game_date, opponent,
            at_bats, hits, doubles, triples, home_runs, base_on_balls,
            hit_by_pitch, sac_flies, total_bases, rbi,
            stolen_bases, strike_outs, runs, plate_appearances
        ) VALUES %s
        ON CONFLICT (player_id, season, game_date) DO UPDATE SET
            opponent=EXCLUDED.opponent, at_bats=EXCLUDED.at_bats,
            hits=EXCLUDED.hits, doubles=EXCLUDED.doubles, triples=EXCLUDED.triples,
            home_runs=EXCLUDED.home_runs, base_on_balls=EXCLUDED.base_on_balls,
            hit_by_pitch=EXCLUDED.hit_by_pitch, sac_flies=EXCLUDED.sac_flies,
            total_bases=EXCLUDED.total_bases, rbi=EXCLUDED.rbi,
            stolen_bases=EXCLUDED.stolen_bases, strike_outs=EXCLUDED.strike_outs,
            runs=EXCLUDED.runs, plate_appearances=EXCLUDED.plate_appearances
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def upsert_pitching(conn, player_id: int, season: int, splits: list[dict]) -> int:
    rows = []
    for s in splits:
        st = s.get("stat", {})
        rows.append((
            player_id, season, s["date"],
            s.get("opponent", {}).get("name", ""),
            _parse_outs(st.get("inningsPitched", "0")),
            bool(st.get("gamesStarted", 0)),
            st.get("earnedRuns", 0), st.get("hits", 0),
            st.get("strikeOuts", 0), st.get("baseOnBalls", 0),
            st.get("hitByPitch", 0), st.get("homeRuns", 0),
            st.get("runs", 0),
        ))
    rows = list({r[2]: r for r in rows}.values())
    if not rows:
        return 0
    sql = """
        INSERT INTO pitching_game_logs (
            player_id, season, game_date, opponent,
            outs, game_started, earned_runs, hits, strike_outs,
            base_on_balls, hit_by_pitch, home_runs, runs
        ) VALUES %s
        ON CONFLICT (player_id, season, game_date) DO UPDATE SET
            opponent=EXCLUDED.opponent, outs=EXCLUDED.outs,
            game_started=EXCLUDED.game_started, earned_runs=EXCLUDED.earned_runs,
            hits=EXCLUDED.hits, strike_outs=EXCLUDED.strike_outs,
            base_on_balls=EXCLUDED.base_on_balls, hit_by_pitch=EXCLUDED.hit_by_pitch,
            home_runs=EXCLUDED.home_runs, runs=EXCLUDED.runs
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


def upsert_player(conn, player: dict, classified_pos: str):
    sql = """
        INSERT INTO players (id, full_name, first_name, last_name, position, team_id, active, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW())
        ON CONFLICT (id) DO UPDATE SET
            full_name=EXCLUDED.full_name, first_name=EXCLUDED.first_name,
            last_name=EXCLUDED.last_name, position=EXCLUDED.position,
            team_id=EXCLUDED.team_id, active=TRUE, updated_at=NOW()
    """
    with conn.cursor() as cur:
        cur.execute(sql, (
            player["id"],
            player.get("fullName", ""),
            player.get("firstName", ""),
            player.get("lastName", ""),
            classified_pos,
            player.get("currentTeam", {}).get("id"),
        ))
    conn.commit()


def upsert_teams(conn, teams: list[dict]):
    rows = [(
        t["id"], t["name"], t.get("teamName", ""), t.get("abbreviation", ""),
        t.get("locationName", ""), t.get("league", {}).get("name", ""),
        t.get("division", {}).get("name", ""),
    ) for t in teams]
    if not rows:
        return
    sql = """
        INSERT INTO teams (id, name, team_name, abbreviation, location, league, division)
        VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            name=EXCLUDED.name, team_name=EXCLUDED.team_name,
            abbreviation=EXCLUDED.abbreviation, location=EXCLUDED.location,
            league=EXCLUDED.league, division=EXCLUDED.division
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()


def upsert_roster(conn, team_id: int, season: int, roster: list[dict]):
    rows = [(
        team_id,
        p["person"]["id"],
        season,
        p.get("position", {}).get("abbreviation", ""),
        p.get("jerseyNumber", ""),
    ) for p in roster]
    if not rows:
        return
    sql = """
        INSERT INTO rosters (team_id, player_id, season, position, jersey_number)
        VALUES %s
        ON CONFLICT (team_id, player_id, season) DO UPDATE SET
            position=EXCLUDED.position, jersey_number=EXCLUDED.jersey_number
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()


# ── Lookback helpers ──────────────────────────────────────────────────────────

def fetch_recent_player_ids(conn, days: int, season: int) -> set[int]:
    cutoff = (datetime.now() - timedelta(days=days)).date()
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT player_id FROM hitting_game_logs
            WHERE season = %s AND game_date >= %s
            UNION
            SELECT DISTINCT player_id FROM pitching_game_logs
            WHERE season = %s AND game_date >= %s
        """, (season, cutoff, season, cutoff))
        return {row[0] for row in cur.fetchall()}


# ── Per-player game log sync ───────────────────────────────────────────────────

def sync_player(player: dict, season: int) -> tuple[int, str, str]:
    """Fetch and upsert one player's game log + player record.
    Returns (rows_written, status, classified_position).
    """
    pid  = player["id"]
    pos  = player.get("primaryPosition", {}).get("abbreviation", "")
    name = player.get("fullName", str(pid))
    group = "pitching" if pos in PITCHER_POSITIONS else "hitting"

    try:
        splits = fetch_splits(pid, season, group)
        if not splits:
            return 0, "no_data", pos

        # Classify pitchers using actual gamesStarted field
        classified_pos = pos
        if pos in PITCHER_POSITIONS:
            gs = sum(1 for s in splits if s.get("stat", {}).get("gamesStarted", 0))
            classified_pos = "SP" if len(splits) > 0 and gs / len(splits) >= 0.5 else "RP"

        conn = get_conn()
        try:
            if group == "pitching":
                n = upsert_pitching(conn, pid, season, splits)
            else:
                n = upsert_hitting(conn, pid, season, splits)
            upsert_player(conn, player, classified_pos)
            return n, "ok", classified_pos
        finally:
            conn.close()
    except Exception as exc:
        log.warning(f"  ✗ {name} ({pid}): {exc}")
        return 0, "error", pos


# ── Teams + roster sync ────────────────────────────────────────────────────────

def sync_teams_and_rosters(season: int):
    log.info("  Syncing teams...")
    teams = fetch_mlb_teams(season)
    conn = get_conn()
    try:
        upsert_teams(conn, teams)
    finally:
        conn.close()
    log.info(f"  {len(teams)} teams synced")

    log.info("  Syncing rosters...")
    ok = 0
    for team in teams:
        tid = team["id"]
        roster = fetch_mlb_roster(tid, season)
        if not roster:
            continue
        conn = get_conn()
        try:
            upsert_roster(conn, tid, season, roster)
            ok += 1
        finally:
            conn.close()
    log.info(f"  {ok}/{len(teams)} team rosters synced")


# ── Main sync loop ─────────────────────────────────────────────────────────────

def run_sync(seasons: list[int], player_ids: list[int] | None = None, workers: int = 12, lookback: int | None = None):
    for season in seasons:
        log.info(f"── Season {season} ──────────────────────────────────")

        # 1. Sync teams and rosters
        sync_teams_and_rosters(season)

        # 2. Sync player game logs + player records
        all_players = fetch_all_players(season)
        if player_ids:
            pid_set = set(player_ids)
            all_players = [p for p in all_players if p["id"] in pid_set]
        elif lookback:
            conn = get_conn()
            try:
                recent_ids = fetch_recent_player_ids(conn, lookback, season)
            finally:
                conn.close()
            all_players = [p for p in all_players if p["id"] in recent_ids]
            log.info(f"  Lookback {lookback}d: {len(all_players)} players active in last {lookback} days")

        total = len(all_players)
        log.info(f"  {total} players to sync (workers={workers})")

        ok = errors = skipped = total_rows = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(sync_player, p, season): p for p in all_players}
            for i, fut in enumerate(as_completed(futures), 1):
                n, status, _ = fut.result()
                if status == "ok":
                    ok += 1
                    total_rows += n
                elif status == "error":
                    errors += 1
                else:
                    skipped += 1
                if i % 50 == 0 or i == total:
                    log.info(f"  {i}/{total}  ok={ok}  errors={errors}  skipped={skipped}")

        log.info(
            f"  Done — {ok} players synced, {total_rows} rows upserted, "
            f"{errors} errors, {skipped} with no data"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync MLB game logs to PostgreSQL")
    parser.add_argument("--seasons", type=int, nargs="+", default=[CURRENT_YEAR])
    parser.add_argument("--players", type=int, nargs="+")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--lookback", type=int, default=None,
                        help="Only re-sync players with games in the last N days")
    args = parser.parse_args()
    run_sync(args.seasons, args.players, args.workers, args.lookback)
