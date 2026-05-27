import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PlayerSearchResult {
  id: number;
  name: string;
  position: string;
  team_id: number;
  team_abbreviation?: string;
  headshot: string;
}

export interface PlayerInfo {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  position: string;
  position_name: string;
  team_id: number;
  team_name: string;
  jersey_number: string;
  bats: string;
  throws: string;
  debut_date: string;
  headshot: string;
}

export interface StretchGame {
  date: string;
  opponent: string;
  // hitting
  atBats?: number;
  hits?: number;
  homeRuns?: number;
  rbi?: number;
  baseOnBalls?: number;
  stolenBases?: number;
  strikeOuts?: number;
  // pitching
  outs?: number;
  ip_display?: string;
  earnedRuns?: number;
}

export interface StretchWindow {
  window_index: number;
  start_game: number;
  end_game: number;
  start_date: string;
  end_date: string;
  value: number;
  value_display: string;
  hits: number;
  bb: number;
  k: number;
  hr: number;
  rbi?: number;
  sb?: number;
  ab?: number;
  er?: number;
  ip?: number;
  ip_display?: string;
}

export interface StretchData {
  player_id: number;
  season: number;
  total_games: number;
  stretch_length: number;
  stat: string;
  stat_label: string;
  season_value: number;
  season_value_display: string;
  streakiness: number;
  best_index: number;
  worst_index: number;
  best: StretchWindow;
  worst: StretchWindow;
  windows: StretchWindow[];
  hot_cold: 'on_fire' | 'hot' | 'neutral' | 'cold' | 'slumping';
  current_window: StretchWindow;
}

export interface TeamInfo {
  id: number;
  name: string;
  team_name: string;
  abbreviation: string;
  location: string;
  league: string;
  division: string;
  logo_url: string;
}

export interface RosterPlayer {
  id: number;
  name: string;
  jersey_number: string;
  position: string;
  headshot: string;
  stat?: string;
  stat_label?: string;
  current_value?: number;
  current_value_display?: string;
  hot_cold?: 'on_fire' | 'hot' | 'neutral' | 'cold' | 'slumping';
}

export interface LeaderboardPlayer {
  rank: number;
  player_id: number;
  name: string;
  team: string;
  team_abbreviation: string;
  position: string;
  headshot: string;
  current_value: number;
  current_value_display: string;
  season_value: number;
  season_value_display: string;
  season_total: number | null;
  season_total_display: string | null;
  best_value: number;
  best_value_display: string;
  best_start_date: string;
  best_end_date: string;
  worst_value: number;
  worst_value_display: string;
  worst_start_date: string;
  worst_end_date: string;
  streakiness: number;
  hot_cold: 'on_fire' | 'hot' | 'neutral' | 'cold' | 'slumping';
}

export interface TeamLeaderboardEntry {
  team_id: number;
  name: string;
  team_name: string;
  abbreviation: string;
  logo_url: string;
  rank: number;
  current_value: number;
  current_value_display: string;
  // rate stats
  season_value?: number;
  season_value_display?: string;
  // count stats
  season_avg_value?: number;
  season_avg_display?: string;
  season_total?: number;
  season_total_display?: string;
  hot_cold: 'on_fire' | 'hot' | 'neutral' | 'cold' | 'slumping';
}

export interface TeamLeaderboardData {
  stat: string;
  stat_label: string;
  stretch_length: number;
  season: number;
  pitcher_type: string | null;
  entries: TeamLeaderboardEntry[];
}

export interface LeaderboardData {
  stat: string;
  stat_label: string;
  stretch_length: number;
  season: number;
  pitcher_type: string | null;
  players: LeaderboardPlayer[];
}

export function hitterDefaultLength(gamesPlayed: number): number {
  if (gamesPlayed < 30) return 5;
  if (gamesPlayed < 60) return 10;
  return 15;
}

export function spDefaultLength(gamesPlayed: number): number {
  return gamesPlayed < 50 ? 3 : 5;
}

export function rpDefaultLength(gamesPlayed: number): number {
  if (gamesPlayed < 30) return 3;
  if (gamesPlayed < 60) return 5;
  return 10;
}

export interface TeamPageState {
  hitterStat: string; hitterLength: number;
  spStat: string;     spLength: number;
  rpStat: string;     rpLength: number;
}

export interface LeaderboardPageState {
  season: number;
  stretchLength: number;
  selectedStat: string;
  pitcherType: 'sp' | 'rp';
  view: 'players' | 'teams';
  sortBy: 'current' | 'season' | 'best' | 'worst' | 'form';
  sortDir: 'natural' | 'reversed';
  teamSortBy: 'current' | 'season' | 'form';
  teamSortDir: 'natural' | 'reversed';
  searchQuery: string;
  selectedTeam: string;
  selectedPosition: string;
  data: LeaderboardData | null;
  teamData: TeamLeaderboardData | null;
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  teamPageState: TeamPageState = {
    hitterStat: 'ops', hitterLength: 10,
    spStat: 'era',     spLength: 5,
    rpStat: 'whip',    rpLength: 10,
  };

  leaderboardPageState: LeaderboardPageState = {
    season: new Date().getFullYear(),
    stretchLength: 15,
    selectedStat: 'ops',
    pitcherType: 'sp',
    sortBy: 'current',
    sortDir: 'natural',
    view: 'players',
    teamSortBy: 'current',
    teamSortDir: 'natural',
    searchQuery: '',
    selectedTeam: '',
    selectedPosition: '',
    data: null,
    teamData: null,
  };

  searchPlayers(q: string): Observable<PlayerSearchResult[]> {
    return this.http.get<PlayerSearchResult[]>(`${this.apiUrl}/players/search`, { params: { q } });
  }

  getPlayer(id: number): Observable<PlayerInfo> {
    return this.http.get<PlayerInfo>(`${this.apiUrl}/players/${id}`);
  }

  getStretches(playerId: number, season: number, length: number, stat: string): Observable<StretchData> {
    return this.http.get<StretchData>(`${this.apiUrl}/players/${playerId}/stretches`, {
      params: { season, length, stat },
    });
  }

  getTeams(): Observable<TeamInfo[]> {
    return this.http.get<TeamInfo[]>(`${this.apiUrl}/teams`);
  }

  getTeamRoster(teamId: number, season?: number): Observable<{ team_id: number; players: RosterPlayer[] }> {
    const params: any = {};
    if (season) params['season'] = season;
    return this.http.get<{ team_id: number; players: RosterPlayer[] }>(`${this.apiUrl}/teams/${teamId}/roster`, { params });
  }

  getTeamHotCold(
    teamId: number,
    opts: { season?: number; hitterStat?: string; hitterLength?: number; spStat?: string; spLength?: number; rpStat?: string; rpLength?: number } = {}
  ): Observable<RosterPlayer[]> {
    const params: any = {
      hitter_stat:   opts.hitterStat   ?? 'ops',
      hitter_length: opts.hitterLength ?? 10,
      sp_stat:       opts.spStat       ?? 'era',
      sp_length:     opts.spLength     ?? 5,
      rp_stat:       opts.rpStat       ?? 'whip',
      rp_length:     opts.rpLength     ?? 10,
    };
    if (opts.season) params['season'] = opts.season;
    return this.http.get<RosterPlayer[]>(`${this.apiUrl}/teams/${teamId}/hot-cold`, { params });
  }

  getDefaultLength(season?: number): Observable<{ default_length: number; games_played: number }> {
    const params: any = {};
    if (season) params['season'] = season;
    return this.http.get<{ default_length: number; games_played: number }>(`${this.apiUrl}/season/default-length`, { params });
  }

  getGameLog(playerId: number, season: number, stat: string): Observable<StretchGame[]> {
    return this.http.get<StretchGame[]>(`${this.apiUrl}/players/${playerId}/game-log`, {
      params: { season, stat },
    });
  }

  getLeaderboard(stat: string, length: number, season: number, pitcherType?: string): Observable<LeaderboardData> {
    const params: any = { stat, length, season };
    if (pitcherType) params['pitcher_type'] = pitcherType;
    return this.http.get<LeaderboardData>(`${this.apiUrl}/leaderboard`, { params });
  }

  getTeamStretches(teamId: number, season: number, length: number, stat: string): Observable<StretchData> {
    return this.http.get<StretchData>(`${this.apiUrl}/teams/${teamId}/stretches`, {
      params: { season, length, stat },
    });
  }

  getTeamLeaderboard(stat: string, length: number, season: number, pitcherType?: string): Observable<TeamLeaderboardData> {
    const params: any = { stat, length, season };
    if (pitcherType) params['pitcher_type'] = pitcherType;
    return this.http.get<TeamLeaderboardData>(`${this.apiUrl}/teams/leaderboard`, { params });
  }

  getTeamRecord(teamId: number, season: number = new Date().getFullYear()): Observable<{ wins: number; losses: number; pct: string; gb: string; streak: string }> {
    return this.http.get<{ wins: number; losses: number; pct: string; gb: string; streak: string }>(
      `${this.apiUrl}/teams/${teamId}/record`, { params: { season } }
    );
  }
}
