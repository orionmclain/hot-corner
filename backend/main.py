from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from cachetools import TTLCache
from threading import Lock
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import math
from datetime import datetime, date
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env", override=True)


def _season_default_length(season: int) -> int:
    """Estimate sensible default stretch length based on games played so far.

    Targets at least ~10 rolling windows at the default length, so charts are
    meaningful early in the season.  Formula: games_played - 10, clamped to [5, 15].
      19 games → 9   (11 windows)
      25 games → 15  (11 windows, capped)
      162 games → 15
    """
    today = date.today()
    if today.year > season:
        return 15
    opening_day = date(season, 3, 27)
    days_elapsed = max(0, (today - opening_day).days)
    games_played = min(162, round(days_elapsed * 0.87))
    return max(5, min(15, games_played - 10))


@asynccontextmanager
async def lifespan(app: FastAPI):
    def precompute():
        default_len = _season_default_length(CURRENT_YEAR)
        for kwargs in [
            {"stat": "ops",  "length": default_len, "season": CURRENT_YEAR, "pitcher_type": None},
            {"stat": "era",  "length": 5,  "season": CURRENT_YEAR, "pitcher_type": "sp"},
            {"stat": "whip", "length": 10, "season": CURRENT_YEAR, "pitcher_type": "rp"},
        ]:
            try:
                get_leaderboard(**kwargs)
            except Exception:
                pass
    threading.Thread(target=precompute, daemon=True).start()
    yield


app = FastAPI(title="Baseball Stretch Analysis API", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MLB_API_BASE = "https://statsapi.mlb.com/api/v1"
CURRENT_YEAR = datetime.now().year

HITTING_STAT_LABELS = {
    "ops": "OPS", "avg": "AVG", "obp": "OBP", "slg": "SLG",
    "hr": "HR", "rbi": "RBI", "sb": "SB",
}
PITCHING_STAT_LABELS = {
    "era": "ERA", "whip": "WHIP", "k9": "K/9",
    "k": "K", "bb": "BB", "er": "ER",
}
ALL_STAT_LABELS = {**HITTING_STAT_LABELS, **PITCHING_STAT_LABELS}
LOWER_IS_BETTER = {"era", "whip", "bb", "er"}
HITTING_COUNT_STATS = {"hr", "rbi", "sb"}
PITCHING_COUNT_STATS = {"k", "bb", "er"}
ALL_COUNT_STATS = HITTING_COUNT_STATS | PITCHING_COUNT_STATS

# MLB API sort stat names for leaderboard fetching
LEADERBOARD_CONFIG = {
    "ops":  {"group": "hitting",  "sortStat": "onBasePlusSlugging"},
    "avg":  {"group": "hitting",  "sortStat": "avg"},
    "obp":  {"group": "hitting",  "sortStat": "onBasePercentage"},
    "slg":  {"group": "hitting",  "sortStat": "sluggingPercentage"},
    "hr":   {"group": "hitting",  "sortStat": "homeRuns"},
    "rbi":  {"group": "hitting",  "sortStat": "rbi"},
    "sb":   {"group": "hitting",  "sortStat": "stolenBases"},
    "era":  {"group": "pitching", "sortStat": "era"},
    "whip": {"group": "pitching", "sortStat": "whip"},
    "k9":   {"group": "pitching", "sortStat": "strikeoutsPer9Inn"},
    "k":    {"group": "pitching", "sortStat": "strikeOuts"},
    "bb":   {"group": "pitching", "sortStat": "baseOnBalls"},
    "er":   {"group": "pitching", "sortStat": "earnedRuns"},
}

# ── Caches ────────────────────────────────────────────────────────────────────
_search_cache: TTLCache = TTLCache(maxsize=200, ttl=300)
_player_cache: TTLCache = TTLCache(maxsize=500, ttl=86400)
_gamelog_cache: TTLCache = TTLCache(maxsize=1000, ttl=3600)
_teams_cache: TTLCache = TTLCache(maxsize=5, ttl=86400)
_roster_cache: TTLCache = TTLCache(maxsize=60, ttl=3600)
_leaderboard_cache: TTLCache = TTLCache(maxsize=50, ttl=3600)
_lock = Lock()


def _cached_search(q: str) -> list:
    key = q.lower().strip()
    with _lock:
        if key in _search_cache:
            return _search_cache[key]
    r = requests.get(
        f"{MLB_API_BASE}/people/search",
        params={"names": q, "sportId": 1, "hydrate": "currentTeam"},
        timeout=10,
    )
    if r.status_code != 200:
        return []
    people = r.json().get("people", [])
    result = [
        {
            "id": p["id"],
            "name": p["fullName"],
            "position": p.get("primaryPosition", {}).get("abbreviation", ""),
            "team_id": p.get("currentTeam", {}).get("id"),
            "team_abbreviation": p.get("currentTeam", {}).get("abbreviation", ""),
            "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{p['id']}/headshot/67/current",
        }
        for p in people[:10]
    ]
    with _lock:
        _search_cache[key] = result
    return result


def _cached_player(player_id: int) -> dict:
    with _lock:
        if player_id in _player_cache:
            return _player_cache[player_id]
    r = requests.get(
        f"{MLB_API_BASE}/people/{player_id}",
        params={"hydrate": "currentTeam"},
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="Player not found")
    data = r.json()
    if not data.get("people"):
        raise HTTPException(status_code=404, detail="Player not found")
    p = data["people"][0]
    team = p.get("currentTeam", {})
    result = {
        "id": p["id"],
        "name": p["fullName"],
        "firstName": p.get("firstName", ""),
        "lastName": p.get("lastName", ""),
        "position": p.get("primaryPosition", {}).get("abbreviation", ""),
        "position_name": p.get("primaryPosition", {}).get("name", ""),
        "team_id": team.get("id"),
        "team_name": team.get("name", ""),
        "jersey_number": p.get("primaryNumber", ""),
        "bats": p.get("batSide", {}).get("description", ""),
        "throws": p.get("pitchHand", {}).get("description", ""),
        "debut_date": p.get("mlbDebutDate", ""),
        "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{player_id}/headshot/67/current",
    }
    # Override raw position with DB-classified position (SP/RP instead of P)
    try:
        import database
        db_p = database.fetch_player(player_id)
        if db_p and db_p.get("position"):
            result["position"] = db_p["position"]
    except Exception:
        pass
    with _lock:
        _player_cache[player_id] = result
    return result


def _cached_gamelog(player_id: int, season: int, group: str) -> list[dict]:
    """
    Three-tier cache: in-memory TTL → local PostgreSQL → MLB Stats API.
    Returns a list of parsed game dicts ordered by game date.
    """
    key = (player_id, season, group)

    # L1: in-memory TTL cache
    with _lock:
        if key in _gamelog_cache:
            return _gamelog_cache[key]

    # L2: local database (fast path once DB is populated)
    try:
        import database
        games = database.fetch_game_log(player_id, season, group)
        if games:
            with _lock:
                _gamelog_cache[key] = games
            return games
    except Exception:
        pass  # DB unavailable or player not yet synced — fall through

    # L3: MLB Stats API (fallback / source of truth)
    r = requests.get(
        f"{MLB_API_BASE}/people/{player_id}/stats",
        params={"stats": "gameLog", "group": group, "season": season, "gameType": "R"},
        timeout=15,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch game log from MLB API")
    data = r.json()
    if not data.get("stats") or not data["stats"][0].get("splits"):
        raise HTTPException(
            status_code=404,
            detail=f"No {group} game log found for season {season}",
        )
    parse_fn = parse_pitching_game if group == "pitching" else parse_hitting_game
    games = [parse_fn(s) for s in data["stats"][0]["splits"]]
    with _lock:
        _gamelog_cache[key] = games
    return games


# ── Game parsing ──────────────────────────────────────────────────────────────

def parse_ip(ip_str) -> float:
    ip = float(str(ip_str))
    full = int(ip)
    outs = round((ip - full) * 10)
    return full + outs / 3.0


def fmt_ip(total_outs: int) -> str:
    return f"{total_outs // 3}.{total_outs % 3}"


def parse_hitting_game(s: dict) -> dict:
    st = s["stat"]
    return {
        "date": s.get("date", ""),
        "opponent": s.get("opponent", {}).get("name", ""),
        "atBats": st.get("atBats", 0),
        "hits": st.get("hits", 0),
        "doubles": st.get("doubles", 0),
        "triples": st.get("triples", 0),
        "homeRuns": st.get("homeRuns", 0),
        "baseOnBalls": st.get("baseOnBalls", 0),
        "hitByPitch": st.get("hitByPitch", 0),
        "sacFlies": st.get("sacFlies", 0),
        "totalBases": st.get("totalBases", 0),
        "rbi": st.get("rbi", 0),
        "stolenBases": st.get("stolenBases", 0),
        "strikeOuts": st.get("strikeOuts", 0),
        "runs": st.get("runs", 0),
        "plateAppearances": st.get("plateAppearances", 0),
    }


def parse_pitching_game(s: dict) -> dict:
    st = s["stat"]
    outs = round(parse_ip(st.get("inningsPitched", "0")) * 3)
    return {
        "date": s.get("date", ""),
        "opponent": s.get("opponent", {}).get("name", ""),
        "outs": outs,
        "ip_display": fmt_ip(outs),
        "gameStarted": bool(st.get("gamesStarted", 0)),
        "earnedRuns": st.get("earnedRuns", 0),
        "hits": st.get("hits", 0),
        "strikeOuts": st.get("strikeOuts", 0),
        "baseOnBalls": st.get("baseOnBalls", 0),
        "hitByPitch": st.get("hitByPitch", 0),
        "homeRuns": st.get("homeRuns", 0),
        "runs": st.get("runs", 0),
    }


# ── Stat computation ──────────────────────────────────────────────────────────

def compute_stat(games: list[dict], stat: str) -> float:
    """Full-season (or arbitrary slice) stat computation. Single-pass over games."""
    ab = h = bb = hbp = sf = tb = hr = rbi = sb = 0
    for g in games:
        ab  += g["atBats"];      h   += g["hits"]
        bb  += g["baseOnBalls"]; hbp += g["hitByPitch"]
        sf  += g["sacFlies"];    tb  += g["totalBases"]
        hr  += g["homeRuns"];    rbi += g["rbi"]
        sb  += g["stolenBases"]
    d = ab + bb + hbp + sf
    if stat == "avg":  return round(h / ab, 3) if ab > 0 else 0.0
    if stat == "obp":  return round((h + bb + hbp) / d, 3) if d > 0 else 0.0
    if stat == "slg":  return round(tb / ab, 3) if ab > 0 else 0.0
    if stat == "ops":  return round((h + bb + hbp) / d + tb / ab, 3) if ab > 0 and d > 0 else 0.0
    if stat == "hr":   return float(hr)
    if stat == "rbi":  return float(rbi)
    if stat == "sb":   return float(sb)
    return 0.0


def compute_pitching_stat(games: list[dict], stat: str) -> float:
    """Full-season (or arbitrary slice) pitching stat computation. Single-pass over games."""
    outs = er = h = bb = k = 0
    for g in games:
        outs += g["outs"]; er += g["earnedRuns"]
        h    += g["hits"]; bb += g["baseOnBalls"]
        k    += g["strikeOuts"]
    ip = outs / 3.0
    if stat == "era":  return round(er / ip * 9, 2) if ip > 0 else 0.0
    if stat == "whip": return round((bb + h) / ip, 3) if ip > 0 else 0.0
    if stat == "k9":   return round(k / ip * 9, 2) if ip > 0 else 0.0
    if stat == "k":    return float(k)
    if stat == "bb":   return float(bb)
    if stat == "er":   return float(er)
    return 0.0


# ── Prefix-sum rolling window engine ─────────────────────────────────────────

def build_prefix_sums(games: list[dict], is_pitching: bool) -> dict:
    """Precompute prefix sums so any window stat can be resolved in O(1)."""
    n = len(games)
    if is_pitching:
        keys = {"outs": "outs", "er": "earnedRuns", "h": "hits",
                "bb": "baseOnBalls", "k": "strikeOuts", "hr": "homeRuns"}
        p = {k: [0] * (n + 1) for k in keys}
        for i, g in enumerate(games, 1):
            for k, field in keys.items():
                p[k][i] = p[k][i-1] + g[field]
    else:
        keys = {"ab": "atBats", "h": "hits", "bb": "baseOnBalls",
                "hbp": "hitByPitch", "sf": "sacFlies", "tb": "totalBases",
                "hr": "homeRuns", "rbi": "rbi", "sb": "stolenBases", "k": "strikeOuts"}
        p = {k: [0] * (n + 1) for k in keys}
        for i, g in enumerate(games, 1):
            for k, field in keys.items():
                p[k][i] = p[k][i-1] + g[field]
    return p


def window_value(p: dict, i: int, j: int, stat: str, is_pitching: bool) -> float:
    """Compute one window's stat value from prefix sums in O(1)."""
    if is_pitching:
        outs = p["outs"][j] - p["outs"][i]; ip = outs / 3.0
        if stat == "era":
            er = p["er"][j] - p["er"][i]
            return round(er / ip * 9, 2) if ip > 0 else 0.0
        if stat == "whip":
            return round((p["bb"][j]-p["bb"][i] + p["h"][j]-p["h"][i]) / ip, 3) if ip > 0 else 0.0
        if stat == "k9":
            return round((p["k"][j]-p["k"][i]) / ip * 9, 2) if ip > 0 else 0.0
        if stat == "k":  return float(p["k"][j]  - p["k"][i])
        if stat == "bb": return float(p["bb"][j] - p["bb"][i])
        if stat == "er": return float(p["er"][j] - p["er"][i])
    else:
        ab = p["ab"][j]-p["ab"][i]; h = p["h"][j]-p["h"][i]
        bb = p["bb"][j]-p["bb"][i]; hbp = p["hbp"][j]-p["hbp"][i]
        sf = p["sf"][j]-p["sf"][i]; tb = p["tb"][j]-p["tb"][i]
        if stat == "avg":  return round(h / ab, 3) if ab > 0 else 0.0
        if stat == "obp":
            d = ab + bb + hbp + sf
            return round((h + bb + hbp) / d, 3) if d > 0 else 0.0
        if stat == "slg":  return round(tb / ab, 3) if ab > 0 else 0.0
        if stat == "ops":
            d = ab + bb + hbp + sf
            return round((h + bb + hbp) / d + tb / ab, 3) if ab > 0 and d > 0 else 0.0
        if stat == "hr":  return float(p["hr"][j]  - p["hr"][i])
        if stat == "rbi": return float(p["rbi"][j] - p["rbi"][i])
        if stat == "sb":  return float(p["sb"][j]  - p["sb"][i])
    return 0.0


def format_stat(value: float, stat: str) -> str:
    if stat in ALL_COUNT_STATS:
        return str(int(value))
    if stat in ("era", "k9"):
        return f"{value:.2f}"
    return f"{value:.3f}"


def compute_hot_cold(current_value: float, season_value: float, stat: str) -> str:
    """Compare current stretch to season average. Returns 5-level status."""
    if season_value == 0 or current_value == 0:
        return "neutral"
    # For lower-is-better stats (ERA/WHIP), flip so ratio > 1 = performing better
    if stat in LOWER_IS_BETTER:
        ratio = season_value / current_value
    else:
        ratio = current_value / season_value
    if ratio >= 1.25: return "on_fire"
    if ratio >= 1.10: return "hot"
    if ratio <= 0.75: return "slumping"
    if ratio <= 0.90: return "cold"
    return "neutral"


def compute_season_value(games: list, stat: str, length: int, compute_fn) -> tuple[float, str]:
    """Returns (season_value, season_value_display) scaled to per-stretch units."""
    total = len(games)
    raw = compute_fn(games, stat)
    if stat in ALL_COUNT_STATS and total > 0:
        val = round(raw * length / total, 2)
        return val, f"{val:.1f}"
    return raw, format_stat(raw, stat)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/players/search")
def search_players(q: str = Query(..., min_length=2)):
    try:
        import database
        results = database.search_players(q)
        if results:
            return results
    except Exception:
        pass
    return _cached_search(q)


@app.get("/players/{player_id}")
def get_player(player_id: int):
    return _cached_player(player_id)


@app.get("/players/{player_id}/stretches")
def get_stretches(
    player_id: int,
    season: int = Query(CURRENT_YEAR),
    length: int = Query(15, ge=3, le=60),
    stat: str = Query("ops"),
):
    if stat not in ALL_STAT_LABELS:
        raise HTTPException(status_code=400, detail=f"Invalid stat. Choose from: {', '.join(ALL_STAT_LABELS)}")

    is_pitching = stat in PITCHING_STAT_LABELS
    group = "pitching" if is_pitching else "hitting"
    games = _cached_gamelog(player_id, season, group)

    total_games = len(games)
    if total_games < length:
        raise HTTPException(
            status_code=400,
            detail=f"Only {total_games} games played in {season} — stretch length {length} is too long.",
        )

    compute = compute_pitching_stat if is_pitching else compute_stat
    ps = build_prefix_sums(games, is_pitching)

    windows = []
    for i in range(total_games - length + 1):
        j = i + length
        value = window_value(ps, i, j, stat, is_pitching)

        if is_pitching:
            outs = ps["outs"][j] - ps["outs"][i]
            window = {
                "window_index": i,
                "start_game": i + 1, "end_game": j,
                "start_date": games[i]["date"], "end_date": games[j - 1]["date"],
                "value": value, "value_display": format_stat(value, stat),
                "k":    ps["k"][j]  - ps["k"][i],
                "bb":   ps["bb"][j] - ps["bb"][i],
                "er":   ps["er"][j] - ps["er"][i],
                "hr":   ps["hr"][j] - ps["hr"][i],
                "hits": ps["h"][j]  - ps["h"][i],
                "ip":   round(outs / 3, 2),
                "ip_display": fmt_ip(outs),
            }
        else:
            window = {
                "window_index": i,
                "start_game": i + 1, "end_game": j,
                "start_date": games[i]["date"], "end_date": games[j - 1]["date"],
                "value": value, "value_display": format_stat(value, stat),
                "hr":   ps["hr"][j]  - ps["hr"][i],
                "rbi":  ps["rbi"][j] - ps["rbi"][i],
                "sb":   ps["sb"][j]  - ps["sb"][i],
                "hits": ps["h"][j]   - ps["h"][i],
                "ab":   ps["ab"][j]  - ps["ab"][i],
                "bb":   ps["bb"][j]  - ps["bb"][i],
                "k":    ps["k"][j]   - ps["k"][i],
            }
        windows.append(window)

    if stat in LOWER_IS_BETTER:
        best_idx = min(range(len(windows)), key=lambda i: windows[i]["value"])
        worst_idx = max(range(len(windows)), key=lambda i: windows[i]["value"])
    else:
        best_idx = max(range(len(windows)), key=lambda i: windows[i]["value"])
        worst_idx = min(range(len(windows)), key=lambda i: windows[i]["value"])

    season_value, season_value_display = compute_season_value(games, stat, length, compute)

    values = [w["value"] for w in windows]
    mean_val = sum(values) / len(values) if values else 0
    variance = sum((v - mean_val) ** 2 for v in values) / len(values) if values else 0
    std_dev = math.sqrt(variance)
    streakiness = round((std_dev / mean_val) * 100, 1) if mean_val > 0 else 0.0

    hot_cold = compute_hot_cold(windows[-1]["value"], season_value, stat)

    return {
        "player_id": player_id,
        "season": season,
        "total_games": total_games,
        "stretch_length": length,
        "stat": stat,
        "stat_label": ALL_STAT_LABELS.get(stat, stat.upper()),
        "season_value": season_value,
        "season_value_display": season_value_display,
        "streakiness": streakiness,
        "best_index": best_idx,
        "worst_index": worst_idx,
        "best": windows[best_idx],
        "worst": windows[worst_idx],
        "windows": windows,
        "hot_cold": hot_cold,
        "current_window": windows[-1],
    }


@app.get("/players/{player_id}/game-log")
def get_game_log(
    player_id: int,
    season: int = Query(CURRENT_YEAR),
    stat: str = Query("ops"),
):
    is_pitching = stat in PITCHING_STAT_LABELS
    group = "pitching" if is_pitching else "hitting"
    games = _cached_gamelog(player_id, season, group)

    if is_pitching:
        return [
            {
                "date": g["date"],
                "opponent": g["opponent"],
                "ip_display": g["ip_display"],
                "hits": g["hits"],
                "earnedRuns": g["earnedRuns"],
                "baseOnBalls": g["baseOnBalls"],
                "strikeOuts": g["strikeOuts"],
                "homeRuns": g["homeRuns"],
            }
            for g in games
        ]
    else:
        return [
            {
                "date": g["date"],
                "opponent": g["opponent"],
                "atBats": g["atBats"],
                "hits": g["hits"],
                "homeRuns": g["homeRuns"],
                "rbi": g["rbi"],
                "baseOnBalls": g["baseOnBalls"],
                "stolenBases": g["stolenBases"],
                "strikeOuts": g["strikeOuts"],
            }
            for g in games
        ]


# ── Teams ─────────────────────────────────────────────────────────────────────

@app.get("/teams")
def get_teams():
    with _lock:
        if "teams" in _teams_cache:
            return _teams_cache["teams"]
    # Try DB first
    try:
        import database
        result = database.fetch_teams()
        if result:
            with _lock:
                _teams_cache["teams"] = result
            return result
    except Exception:
        pass
    # Fall back to MLB API
    r = requests.get(
        f"{MLB_API_BASE}/teams",
        params={"sportId": 1, "season": CURRENT_YEAR},
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch teams")
    teams = r.json().get("teams", [])
    result = sorted(
        [
            {
                "id": t["id"],
                "name": t["name"],
                "team_name": t.get("teamName", ""),
                "abbreviation": t.get("abbreviation", ""),
                "location": t.get("locationName", ""),
                "league": t.get("league", {}).get("name", ""),
                "division": t.get("division", {}).get("name", ""),
                "logo_url": f"https://www.mlbstatic.com/team-logos/{t['id']}.svg",
            }
            for t in teams
            if t.get("sport", {}).get("id") == 1
               and t.get("active", False)
               and t.get("allStarStatus") == "N"
        ],
        key=lambda t: t["name"],
    )
    with _lock:
        _teams_cache["teams"] = result
    return result


@app.get("/teams/{team_id}/roster")
def get_roster(team_id: int, season: int = Query(CURRENT_YEAR)):
    key = (team_id, season)
    with _lock:
        if key in _roster_cache:
            return _roster_cache[key]
    # Try DB first (returns classified SP/RP positions)
    try:
        import database
        result = database.fetch_roster(team_id, season)
        if result:
            with _lock:
                _roster_cache[key] = result
            return result
    except Exception:
        pass
    # Fall back to MLB API
    r = requests.get(
        f"{MLB_API_BASE}/teams/{team_id}/roster",
        params={"rosterType": "active", "season": season},
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="Team not found")

    roster = r.json().get("roster", [])
    players = [
        {
            "id": p["person"]["id"],
            "name": p["person"]["fullName"],
            "jersey_number": p.get("jerseyNumber", ""),
            "position": p.get("position", {}).get("abbreviation", ""),
            "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{p['person']['id']}/headshot/67/current",
        }
        for p in roster
    ]

    result = {"team_id": team_id, "players": players}
    with _lock:
        _roster_cache[key] = result
    return result


@app.get("/teams/{team_id}/hot-cold")
def get_team_hot_cold(
    team_id: int,
    season: int = Query(CURRENT_YEAR),
    hitter_stat: str = Query("ops"),
    hitter_length: int = Query(10, ge=3, le=60),
    sp_stat: str = Query("era"),
    sp_length: int = Query(5, ge=3, le=60),
    rp_stat: str = Query("whip"),
    rp_length: int = Query(10, ge=3, le=60),
):
    roster_data = get_roster(team_id, season)
    players = roster_data["players"]

    def resolve_position(pid: int, pos: str) -> str:
        """Classify generic 'P' as SP or RP using GS/G ratio from game log."""
        if pos != "P":
            return pos
        try:
            games = _cached_gamelog(pid, season, "pitching")
            if not games:
                return "RP"
            gs = sum(1 for g in games if g["gameStarted"])
            return "SP" if gs / len(games) >= 0.5 else "RP"
        except Exception:
            return "RP"

    def player_status(player: dict):
        pid = player["id"]
        pos = resolve_position(pid, player["position"])

        if pos == "SP":
            stat, group, length = sp_stat, "pitching", sp_length
        elif pos in ("RP", "CP", "CL"):
            stat, group, length = rp_stat, "pitching", rp_length
        else:
            stat, group, length = hitter_stat, "hitting", hitter_length

        is_pitching = group == "pitching"
        compute = compute_pitching_stat if is_pitching else compute_stat
        try:
            games = _cached_gamelog(pid, season, group)
            if len(games) < length:
                # Still return corrected position so the team-page section split works
                return {**player, "position": pos}
            ps = build_prefix_sums(games, is_pitching)
            n = len(games)
            values = [window_value(ps, i, i + length, stat, is_pitching) for i in range(n - length + 1)]
            season_value, _ = compute_season_value(games, stat, length, compute)
            current_value = values[-1]
            return {
                **player,
                "position": pos,
                "stat": stat,
                "stat_label": ALL_STAT_LABELS.get(stat, stat.upper()),
                "current_value": current_value,
                "current_value_display": format_stat(current_value, stat),
                "hot_cold": compute_hot_cold(current_value, season_value, stat),
            }
        except Exception:
            return {**player, "position": pos}

    results = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(player_status, p): p for p in players}
        for future in as_completed(futures):
            r = future.result()
            if r:
                results.append(r)

    return sorted(results, key=lambda p: p["name"])


# ── Leaderboard ───────────────────────────────────────────────────────────────

SP_POSITIONS = {"SP"}
RP_POSITIONS = {"RP", "CP", "CL", "P"}


@app.get("/leaderboard")
def get_leaderboard(
    stat: str = Query("ops"),
    length: int = Query(15, ge=3, le=60),
    season: int = Query(CURRENT_YEAR),
    pitcher_type: str = Query(None),  # 'sp' or 'rp'
):
    if stat not in ALL_STAT_LABELS:
        raise HTTPException(status_code=400, detail="Invalid stat")

    cache_key = (stat, length, season, pitcher_type)
    with _lock:
        if cache_key in _leaderboard_cache:
            return _leaderboard_cache[cache_key]

    config = LEADERBOARD_CONFIG.get(stat, {"group": "hitting", "sortStat": "onBasePlusSlugging"})
    group = config["group"]
    is_pitching = group == "pitching"
    compute = compute_pitching_stat if is_pitching else compute_stat

    # Build candidate list — DB first, MLB API fallback
    candidates: list[dict] = []
    try:
        import database
        candidates = database.fetch_leaderboard_candidates(stat, season, pitcher_type)
    except Exception:
        pass

    if not candidates:
        # MLB API fallback: fetch season stats, convert to candidate dicts
        r = requests.get(
            f"{MLB_API_BASE}/stats",
            params={
                "stats": "season", "group": group, "season": season,
                "gameType": "R", "limit": 150, "sortStat": config["sortStat"],
                "sportId": 1, "hydrate": "person,team",
            },
            timeout=20,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch leaderboard")
        data = r.json()
        if not data.get("stats") or not data["stats"][0].get("splits"):
            return {"stat": stat, "stat_label": ALL_STAT_LABELS[stat], "stretch_length": length, "season": season, "players": []}
        for s in data["stats"][0]["splits"]:
            person = s.get("player", {}); team = s.get("team", {})
            pid = person.get("id")
            if not pid:
                continue
            st = s.get("stat", {})
            gs = st.get("gamesStarted", 0); g = max(st.get("gamesPlayed", 1), 1)
            raw_pos = s.get("position", {}).get("abbreviation", "")
            if is_pitching:
                raw_pos = "SP" if gs / g >= 0.5 else "RP"
            if pitcher_type == "sp" and raw_pos not in SP_POSITIONS: continue
            if pitcher_type == "rp" and raw_pos not in RP_POSITIONS: continue
            candidates.append({
                "player_id": pid, "name": person.get("fullName", ""),
                "position": raw_pos, "team_name": team.get("name", ""),
                "team_abbreviation": team.get("abbreviation", ""),
                "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{pid}/headshot/67/current",
            })

    def compute_player_entry(c: dict):
        pid = c["player_id"]
        try:
            games = _cached_gamelog(pid, season, group)
            if len(games) < length:
                return None
            ps = build_prefix_sums(games, is_pitching)
            n = len(games)
            values = [window_value(ps, i, i + length, stat, is_pitching) for i in range(n - length + 1)]
            if stat in LOWER_IS_BETTER:
                best_idx = min(range(len(values)), key=lambda i: values[i])
                worst_idx = max(range(len(values)), key=lambda i: values[i])
            else:
                best_idx = max(range(len(values)), key=lambda i: values[i])
                worst_idx = min(range(len(values)), key=lambda i: values[i])
            best_val = values[best_idx]
            worst_val = values[worst_idx]
            mean_val = sum(values) / len(values)
            variance = sum((v - mean_val) ** 2 for v in values) / len(values) if len(values) > 1 else 0
            streakiness = round((math.sqrt(variance) / mean_val) * 100, 1) if mean_val > 0 else 0.0
            season_value, season_value_display = compute_season_value(games, stat, length, compute)
            season_total = int(compute(games, stat)) if stat in ALL_COUNT_STATS else None
            current_value = values[-1]
            return {
                "player_id": pid,
                "name": c["name"],
                "team": c.get("team_name", ""),
                "team_abbreviation": c.get("team_abbreviation", ""),
                "position": c.get("position", ""),
                "headshot": c["headshot"],
                "current_value": current_value,
                "current_value_display": format_stat(current_value, stat),
                "season_value": season_value,
                "season_value_display": season_value_display,
                "season_total": season_total,
                "season_total_display": str(season_total) if season_total is not None else None,
                "best_value": best_val,
                "best_value_display": format_stat(best_val, stat),
                "best_start_date": games[best_idx]["date"],
                "best_end_date": games[best_idx + length - 1]["date"],
                "worst_value": worst_val,
                "worst_value_display": format_stat(worst_val, stat),
                "worst_start_date": games[worst_idx]["date"],
                "worst_end_date": games[worst_idx + length - 1]["date"],
                "streakiness": streakiness,
                "hot_cold": compute_hot_cold(current_value, season_value, stat),
            }
        except Exception:
            return None

    results = []
    with ThreadPoolExecutor(max_workers=15) as executor:
        futures = [executor.submit(compute_player_entry, c) for c in candidates]
        for future in as_completed(futures):
            entry = future.result()
            if entry:
                results.append(entry)

    results.sort(key=lambda p: p["current_value"], reverse=(stat not in LOWER_IS_BETTER))
    for i, p in enumerate(results):
        p["rank"] = i + 1

    response = {
        "stat": stat,
        "stat_label": ALL_STAT_LABELS[stat],
        "stretch_length": length,
        "season": season,
        "pitcher_type": pitcher_type,
        "players": results,
    }
    with _lock:
        _leaderboard_cache[cache_key] = response
    return response


_team_lb_cache: TTLCache = TTLCache(maxsize=50, ttl=3600)


@app.get("/teams/leaderboard")
def get_team_leaderboard(
    stat: str = Query("ops"),
    length: int = Query(15, ge=1, le=60),
    season: int = Query(CURRENT_YEAR),
    pitcher_type: str = Query(None),
):
    if stat not in ALL_STAT_LABELS:
        raise HTTPException(status_code=400, detail="Invalid stat")

    cache_key = (stat, length, season, pitcher_type)
    with _lock:
        if cache_key in _team_lb_cache:
            return _team_lb_cache[cache_key]

    try:
        import database
        entries = database.fetch_team_leaderboard(stat, season, length, pitcher_type)
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=502, detail="Failed to load team leaderboard")

    is_count = stat in ALL_COUNT_STATS
    results = []
    for i, e in enumerate(entries):
        cv, sv, gp = e["current_value"], e["season_value"], e["games_played"]
        if is_count:
            # season_value is the raw season total; derive per-stretch average for comparison
            season_avg = sv * length / gp if gp > 0 else 0
            season_total = int(round(sv))
            entry = {
                **e,
                "rank": i + 1,
                "current_value_display": format_stat(cv, stat),
                "season_avg_value": season_avg,
                "season_avg_display": f"{season_avg:.1f}",
                "season_total": season_total,
                "season_total_display": str(season_total),
                "hot_cold": compute_hot_cold(cv, season_avg, stat),
            }
        else:
            entry = {
                **e,
                "rank": i + 1,
                "current_value_display": format_stat(cv, stat),
                "season_value_display": format_stat(sv, stat),
                "hot_cold": compute_hot_cold(cv, sv, stat),
            }
        results.append(entry)

    response = {
        "stat": stat,
        "stat_label": ALL_STAT_LABELS[stat],
        "stretch_length": length,
        "season": season,
        "pitcher_type": pitcher_type,
        "entries": results,
    }
    with _lock:
        _team_lb_cache[cache_key] = response
    return response


@app.get("/season/default-length")
def get_default_length(season: int = Query(CURRENT_YEAR)):
    """Recommended default stretch length based on games played so far in the season."""
    default_length = _season_default_length(season)
    today = date.today()
    if today.year > season:
        return {"default_length": 15, "games_played": 162}
    opening_day = date(season, 3, 27)
    days_elapsed = max(0, (today - opening_day).days)
    games_played = min(162, round(days_elapsed * 0.87))
    return {"default_length": default_length, "games_played": games_played}

