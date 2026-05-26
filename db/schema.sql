-- Hot Corner — PostgreSQL schema
-- Apply with: psql $DATABASE_URL -f db/schema.sql

CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY,   -- MLB person ID
    full_name   TEXT    NOT NULL,
    first_name  TEXT,
    last_name   TEXT,
    position    TEXT,                  -- primary position abbreviation
    team_id     INTEGER,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
    id           INTEGER PRIMARY KEY,  -- MLB team ID
    name         TEXT NOT NULL,
    team_name    TEXT,
    abbreviation TEXT,
    location     TEXT,
    league       TEXT,
    division     TEXT
);

CREATE TABLE IF NOT EXISTS hitting_game_logs (
    player_id         INTEGER  NOT NULL,
    season            SMALLINT NOT NULL,
    game_date         DATE     NOT NULL,
    opponent          TEXT,
    at_bats           SMALLINT NOT NULL DEFAULT 0,
    hits              SMALLINT NOT NULL DEFAULT 0,
    doubles           SMALLINT NOT NULL DEFAULT 0,
    triples           SMALLINT NOT NULL DEFAULT 0,
    home_runs         SMALLINT NOT NULL DEFAULT 0,
    base_on_balls     SMALLINT NOT NULL DEFAULT 0,
    hit_by_pitch      SMALLINT NOT NULL DEFAULT 0,
    sac_flies         SMALLINT NOT NULL DEFAULT 0,
    total_bases       SMALLINT NOT NULL DEFAULT 0,
    rbi               SMALLINT NOT NULL DEFAULT 0,
    stolen_bases      SMALLINT NOT NULL DEFAULT 0,
    strike_outs       SMALLINT NOT NULL DEFAULT 0,
    runs              SMALLINT NOT NULL DEFAULT 0,
    plate_appearances SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, season, game_date)
);

CREATE TABLE IF NOT EXISTS pitching_game_logs (
    player_id     INTEGER  NOT NULL,
    season        SMALLINT NOT NULL,
    game_date     DATE     NOT NULL,
    opponent      TEXT,
    outs          SMALLINT NOT NULL DEFAULT 0,  -- innings_pitched * 3
    game_started  BOOLEAN  NOT NULL DEFAULT FALSE,
    earned_runs   SMALLINT NOT NULL DEFAULT 0,
    hits          SMALLINT NOT NULL DEFAULT 0,
    strike_outs   SMALLINT NOT NULL DEFAULT 0,
    base_on_balls SMALLINT NOT NULL DEFAULT 0,
    hit_by_pitch  SMALLINT NOT NULL DEFAULT 0,
    home_runs     SMALLINT NOT NULL DEFAULT 0,
    runs          SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, season, game_date)
);

CREATE TABLE IF NOT EXISTS rosters (
    team_id       INTEGER  NOT NULL,
    player_id     INTEGER  NOT NULL,
    season        SMALLINT NOT NULL,
    position      TEXT,
    jersey_number TEXT,
    PRIMARY KEY (team_id, player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_rosters_team_season ON rosters (team_id, season);

-- Covering indexes for the primary query pattern: player_id + season → ordered by date
CREATE INDEX IF NOT EXISTS idx_hitting_player_season
    ON hitting_game_logs (player_id, season, game_date);

CREATE INDEX IF NOT EXISTS idx_pitching_player_season
    ON pitching_game_logs (player_id, season, game_date);
