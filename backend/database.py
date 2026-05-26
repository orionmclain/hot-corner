"""
database.py — Connection pool and queries against local PostgreSQL.

Optional: if DATABASE_URL is unset or unreachable, all functions raise
DatabaseUnavailable so callers can fall back to the MLB API.
"""

import os
from contextlib import contextmanager

DATABASE_URL = os.environ.get("DATABASE_URL", "")

LOWER_IS_BETTER = {"era", "whip", "bb", "er"}

# SQL aggregate expressions keyed by stat name
_HITTING_SORT_SQL = {
    "ops": (
        "(SUM(hits)::float + SUM(base_on_balls) + SUM(hit_by_pitch)) "
        "/ NULLIF(SUM(at_bats) + SUM(base_on_balls) + SUM(hit_by_pitch) + SUM(sac_flies), 0) "
        "+ SUM(total_bases)::float / NULLIF(SUM(at_bats), 0)"
    ),
    "avg": "SUM(hits)::float / NULLIF(SUM(at_bats), 0)",
    "obp": (
        "(SUM(hits) + SUM(base_on_balls) + SUM(hit_by_pitch))::float "
        "/ NULLIF(SUM(at_bats) + SUM(base_on_balls) + SUM(hit_by_pitch) + SUM(sac_flies), 0)"
    ),
    "slg": "SUM(total_bases)::float / NULLIF(SUM(at_bats), 0)",
    "hr":  "SUM(home_runs)",
    "rbi": "SUM(rbi)",
    "sb":  "SUM(stolen_bases)",
}

_PITCHING_SORT_SQL = {
    "era":  "SUM(earned_runs)::float / NULLIF(SUM(outs)::float / 3.0, 0) * 9",
    "whip": "(SUM(base_on_balls) + SUM(hits))::float / NULLIF(SUM(outs)::float / 3.0, 0)",
    "k9":   "SUM(strike_outs)::float / NULLIF(SUM(outs)::float / 3.0, 0) * 9",
    "k":    "SUM(strike_outs)",
    "bb":   "SUM(base_on_balls)",
    "er":   "SUM(earned_runs)",
}


class DatabaseUnavailable(Exception):
    pass


_pool = None


def _get_pool():
    global _pool
    if _pool is not None:
        return _pool
    if not DATABASE_URL:
        raise DatabaseUnavailable("DATABASE_URL not set")
    try:
        from psycopg2.pool import ThreadedConnectionPool
        _pool = ThreadedConnectionPool(minconn=2, maxconn=20, dsn=DATABASE_URL)
        return _pool
    except Exception as e:
        raise DatabaseUnavailable(str(e)) from e


@contextmanager
def _get_conn():
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


# ── Game logs ──────────────────────────────────────────────────────────────────

def fetch_game_log(player_id: int, season: int, group: str) -> list[dict]:
    """Return parsed game dicts ordered by game_date. Returns [] if no rows."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            if group == "hitting":
                cur.execute(
                    """
                    SELECT game_date, opponent,
                           at_bats, hits, doubles, triples, home_runs,
                           base_on_balls, hit_by_pitch, sac_flies, total_bases,
                           rbi, stolen_bases, strike_outs, runs, plate_appearances
                    FROM hitting_game_logs
                    WHERE player_id = %s AND season = %s
                    ORDER BY game_date
                    """,
                    (player_id, season),
                )
                return [
                    {
                        "date": row[0].isoformat(), "opponent": row[1],
                        "atBats": row[2], "hits": row[3], "doubles": row[4],
                        "triples": row[5], "homeRuns": row[6], "baseOnBalls": row[7],
                        "hitByPitch": row[8], "sacFlies": row[9], "totalBases": row[10],
                        "rbi": row[11], "stolenBases": row[12], "strikeOuts": row[13],
                        "runs": row[14], "plateAppearances": row[15],
                    }
                    for row in cur.fetchall()
                ]
            else:
                cur.execute(
                    """
                    SELECT game_date, opponent,
                           outs, game_started, earned_runs, hits, strike_outs,
                           base_on_balls, hit_by_pitch, home_runs, runs
                    FROM pitching_game_logs
                    WHERE player_id = %s AND season = %s
                    ORDER BY game_date
                    """,
                    (player_id, season),
                )
                return [
                    {
                        "date": row[0].isoformat(), "opponent": row[1],
                        "outs": row[2], "ip_display": f"{row[2] // 3}.{row[2] % 3}",
                        "gameStarted": row[3], "earnedRuns": row[4], "hits": row[5],
                        "strikeOuts": row[6], "baseOnBalls": row[7],
                        "hitByPitch": row[8], "homeRuns": row[9], "runs": row[10],
                    }
                    for row in cur.fetchall()
                ]


# ── Players ────────────────────────────────────────────────────────────────────

def search_players(q: str, limit: int = 10) -> list[dict]:
    """Full-name trigram/ILIKE search against the local players table."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.id, p.full_name, p.position, r.team_id,
                       t.abbreviation
                FROM players p
                LEFT JOIN (
                    SELECT DISTINCT ON (player_id) player_id, team_id
                    FROM rosters
                    ORDER BY player_id, season DESC
                ) r ON r.player_id = p.id
                LEFT JOIN teams t ON t.id = r.team_id
                WHERE p.full_name ILIKE %s
                ORDER BY p.full_name
                LIMIT %s
                """,
                (f"%{q}%", limit),
            )
            return [
                {
                    "id": row[0],
                    "name": row[1] or "",
                    "position": row[2] or "",
                    "team_id": row[3],
                    "team_abbreviation": row[4] or "",
                    "headshot": (
                        "https://img.mlbstatic.com/mlb-photos/image/upload/"
                        f"d_people:generic:headshot:67:current.png/w_213,q_auto:best"
                        f"/v1/people/{row[0]}/headshot/67/current"
                    ),
                }
                for row in cur.fetchall()
            ]


def fetch_player(player_id: int) -> dict | None:
    """Return basic player record or None if not in DB."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, full_name, first_name, last_name, position, team_id FROM players WHERE id = %s",
                (player_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": row[0], "full_name": row[1],
                "first_name": row[2] or "", "last_name": row[3] or "",
                "position": row[4] or "", "team_id": row[5],
            }


# ── Teams ──────────────────────────────────────────────────────────────────────

def fetch_teams() -> list[dict]:
    """Return all teams ordered by name. Returns [] if table is empty."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, team_name, abbreviation, location, league, division FROM teams ORDER BY name"
            )
            return [
                {
                    "id": row[0], "name": row[1], "team_name": row[2],
                    "abbreviation": row[3], "location": row[4],
                    "league": row[5], "division": row[6],
                    "logo_url": f"https://www.mlbstatic.com/team-logos/{row[0]}.svg",
                }
                for row in cur.fetchall()
            ]


# ── Rosters ────────────────────────────────────────────────────────────────────

def fetch_roster(team_id: int, season: int) -> dict | None:
    """
    Return roster dict with classified positions (COALESCE players.position, rosters.position).
    Returns None if no rows found for this team/season.
    """
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.player_id, p.full_name, r.jersey_number,
                       COALESCE(p.position, r.position) AS position
                FROM rosters r
                LEFT JOIN players p ON p.id = r.player_id
                WHERE r.team_id = %s AND r.season = %s
                ORDER BY p.full_name
                """,
                (team_id, season),
            )
            rows = cur.fetchall()
            if not rows:
                return None
            return {
                "team_id": team_id,
                "players": [
                    {
                        "id": row[0],
                        "name": row[1] or "",
                        "jersey_number": row[2] or "",
                        "position": row[3] or "",
                        "headshot": (
                            "https://img.mlbstatic.com/mlb-photos/image/upload/"
                            f"d_people:generic:headshot:67:current.png/w_213,q_auto:best"
                            f"/v1/people/{row[0]}/headshot/67/current"
                        ),
                    }
                    for row in rows
                ],
            }


# ── Team leaderboard ───────────────────────────────────────────────────────────

def fetch_team_leaderboard(stat: str, season: int, length: int, pitcher_type: str | None) -> list[dict]:
    """
    Aggregate game-log stats by team for their last `length` game dates.
    team_date_rank uses DISTINCT (team_id, game_date) to avoid join inflation.
    Returns current_value, season_value (rate/total), and games_played per team.
    """
    is_pitching = stat in _PITCHING_SORT_SQL
    direction = "ASC" if stat in LOWER_IS_BETTER else "DESC"

    if is_pitching:
        expr = _PITCHING_SORT_SQL[stat]
        type_filter = ""
        if pitcher_type == "sp":
            type_filter = "AND g.game_started = TRUE"
        elif pitcher_type == "rp":
            type_filter = "AND g.game_started = FALSE"
        log_table = "pitching_game_logs"
    else:
        expr = _HITTING_SORT_SQL[stat]
        type_filter = ""
        log_table = "hitting_game_logs"

    sql = f"""
        WITH team_dates AS (
            SELECT DISTINCT r.team_id, g.game_date
            FROM {log_table} g
            JOIN rosters r ON r.player_id = g.player_id AND r.season = g.season
            WHERE g.season = %s
        ),
        team_date_rank AS (
            SELECT team_id, game_date,
                   DENSE_RANK() OVER (PARTITION BY team_id ORDER BY game_date DESC) AS day_rank
            FROM team_dates
        ),
        season_agg AS (
            SELECT r.team_id,
                   ({expr}) AS sv,
                   COUNT(DISTINCT g.game_date) AS gp
            FROM {log_table} g
            JOIN rosters r ON r.player_id = g.player_id AND r.season = g.season
            WHERE g.season = %s {type_filter}
            GROUP BY r.team_id
        ),
        current_agg AS (
            SELECT r.team_id, ({expr}) AS cv
            FROM {log_table} g
            JOIN rosters r ON r.player_id = g.player_id AND r.season = g.season
            JOIN team_date_rank d ON d.team_id = r.team_id AND d.game_date = g.game_date
            WHERE g.season = %s {type_filter} AND d.day_rank <= %s
            GROUP BY r.team_id
        )
        SELECT t.id, t.name, t.team_name, t.abbreviation,
               c.cv, s.sv, s.gp
        FROM teams t
        JOIN current_agg c ON c.team_id = t.id
        JOIN season_agg s ON s.team_id = t.id
        WHERE c.cv IS NOT NULL AND s.sv IS NOT NULL
        ORDER BY c.cv {direction} NULLS LAST
    """

    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (season, season, season, length))
            return [
                {
                    "team_id": row[0],
                    "name": row[1] or "",
                    "team_name": row[2] or "",
                    "abbreviation": row[3] or "",
                    "logo_url": f"https://www.mlbstatic.com/team-logos/{row[0]}.svg",
                    "current_value": row[4],
                    "season_value": row[5],
                    "games_played": row[6] or 1,
                }
                for row in cur.fetchall()
            ]


# ── Leaderboard candidates ─────────────────────────────────────────────────────

def fetch_leaderboard_candidates(
    stat: str, season: int, pitcher_type: str | None
) -> list[dict]:
    """
    Return all qualified candidates for the leaderboard sorted by season aggregate stat.
    Each dict has: player_id, name, position, team_abbreviation, team_name, headshot.
    """
    is_pitching = stat in _PITCHING_SORT_SQL

    if is_pitching:
        sort_expr = _PITCHING_SORT_SQL[stat]
        direction = "ASC" if stat in LOWER_IS_BETTER else "DESC"
        pos_filter = ""
        if pitcher_type == "sp":
            pos_filter = "AND p.position = 'SP'"
        elif pitcher_type == "rp":
            pos_filter = "AND p.position IN ('RP', 'CP', 'CL')"
        sql = f"""
            SELECT g.player_id, p.full_name, p.position, t.abbreviation, t.name
            FROM pitching_game_logs g
            JOIN players p ON p.id = g.player_id
            LEFT JOIN rosters r ON r.player_id = g.player_id AND r.season = g.season
            LEFT JOIN teams t ON t.id = r.team_id
            WHERE g.season = %s {pos_filter}
            GROUP BY g.player_id, p.full_name, p.position, t.abbreviation, t.name
            HAVING SUM(g.outs) >= 15
            ORDER BY ({sort_expr}) {direction} NULLS LAST
        """
    else:
        sort_expr = _HITTING_SORT_SQL[stat]
        direction = "ASC" if stat in LOWER_IS_BETTER else "DESC"
        sql = f"""
            SELECT g.player_id, p.full_name, p.position, t.abbreviation, t.name
            FROM hitting_game_logs g
            JOIN players p ON p.id = g.player_id
            LEFT JOIN rosters r ON r.player_id = g.player_id AND r.season = g.season
            LEFT JOIN teams t ON t.id = r.team_id
            WHERE g.season = %s
            GROUP BY g.player_id, p.full_name, p.position, t.abbreviation, t.name
            HAVING SUM(g.at_bats) >= 30
            ORDER BY ({sort_expr}) {direction} NULLS LAST
        """

    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (season,))
            return [
                {
                    "player_id": row[0],
                    "name": row[1] or "",
                    "position": row[2] or "",
                    "team_abbreviation": row[3] or "",
                    "team_name": row[4] or "",
                    "headshot": (
                        "https://img.mlbstatic.com/mlb-photos/image/upload/"
                        f"d_people:generic:headshot:67:current.png/w_213,q_auto:best"
                        f"/v1/people/{row[0]}/headshot/67/current"
                    ),
                }
                for row in cur.fetchall()
            ]
