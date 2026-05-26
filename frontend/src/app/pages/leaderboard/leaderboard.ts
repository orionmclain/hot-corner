import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StatsService, LeaderboardData, LeaderboardPlayer, TeamLeaderboardData, TeamLeaderboardEntry, hitterDefaultLength, spDefaultLength, rpDefaultLength } from '../../core/services/stats.service';

const PITCHING_STATS = new Set(['era', 'whip', 'k9', 'k', 'bb', 'er']);
const LOWER_IS_BETTER = new Set(['era', 'whip', 'bb', 'er']);

const DEFAULT_LENGTH: Record<string, number> = {
  sp: 3,
  rp: 3,
  hitter: 5,
};

@Component({
  selector: 'app-leaderboard',
  imports: [FormsModule],
  templateUrl: './leaderboard.html',
  styleUrl: './leaderboard.css',
})
export class Leaderboard implements OnInit {
  private statsService = inject(StatsService);
  private router = inject(Router);

  data: LeaderboardData | null = null;
  teamData: TeamLeaderboardData | null = null;
  loading = false;
  error: string | null = null;

  view: 'players' | 'teams' = 'players';
  season = new Date().getFullYear();
  stretchLength = 5;
  selectedStat = 'ops';
  pitcherType: 'sp' | 'rp' = 'sp';

  // Player sort
  sortBy: 'current' | 'season' | 'best' | 'worst' | 'form' = 'current';
  sortDir: 'natural' | 'reversed' = 'natural';

  // Team sort
  teamSortBy: 'current' | 'season' | 'form' = 'current';
  teamSortDir: 'natural' | 'reversed' = 'natural';

  // Filters (player view only)
  searchQuery = '';
  selectedTeam = '';
  selectedPosition = '';

  readonly hitterPositions = ['C','1B','2B','3B','SS','LF','CF','RF','OF','DH'];

  private get savedState() { return this.statsService.leaderboardPageState; }
  private saveState() {
    Object.assign(this.savedState, {
      view: this.view,
      season: this.season, stretchLength: this.stretchLength,
      selectedStat: this.selectedStat, pitcherType: this.pitcherType,
      sortBy: this.sortBy, sortDir: this.sortDir,
      teamSortBy: this.teamSortBy, teamSortDir: this.teamSortDir,
      searchQuery: this.searchQuery, selectedTeam: this.selectedTeam,
      selectedPosition: this.selectedPosition,
      data: this.data,
      teamData: this.teamData,
    });
  }

  readonly seasons = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  readonly currentYear = new Date().getFullYear();
  readonly Math = Math;
  readonly LOWER_IS_BETTER = LOWER_IS_BETTER;

  readonly statGroups = [
    {
      label: 'Hitting',
      options: [
        { value: 'ops', label: 'OPS' },
        { value: 'avg', label: 'AVG' },
        { value: 'obp', label: 'OBP' },
        { value: 'slg', label: 'SLG' },
        { value: 'hr',  label: 'HR'  },
        { value: 'rbi', label: 'RBI' },
        { value: 'sb',  label: 'SB'  },
      ],
    },
    {
      label: 'Pitching',
      options: [
        { value: 'era',  label: 'ERA'  },
        { value: 'whip', label: 'WHIP' },
        { value: 'k9',   label: 'K/9'  },
        { value: 'k',    label: 'K'    },
      ],
    },
  ];

  get isPitchingStat() { return PITCHING_STATS.has(this.selectedStat); }
  get isCountStat()    { return ['hr', 'rbi', 'sb', 'k', 'bb', 'er'].includes(this.selectedStat); }
  get isCurrentSeason(){ return this.season === this.currentYear; }

  // ── Player view ──────────────────────────────────────────────────────────────

  get availableTeams(): string[] {
    if (!this.data) return [];
    return [...new Set(this.data.players.map(p => p.team_abbreviation))].sort();
  }

  get filteredPlayers(): LeaderboardPlayer[] {
    if (!this.data) return [];
    const q = this.searchQuery.toLowerCase();
    return this.data.players.filter(p =>
      (!q || p.name.toLowerCase().includes(q)) &&
      (!this.selectedTeam || p.team_abbreviation === this.selectedTeam) &&
      (!this.selectedPosition || (
        this.selectedPosition === 'OF'
          ? ['LF', 'CF', 'RF', 'OF'].includes(p.position)
          : p.position === this.selectedPosition
      ))
    );
  }

  private overperformance(current: number, season: number): number {
    if (!season) return 0;
    const raw = (current - season) / Math.abs(season) * 100;
    return LOWER_IS_BETTER.has(this.selectedStat) ? -raw : raw;
  }

  formDeltaPct(p: LeaderboardPlayer): number {
    return this.overperformance(p.current_value, p.season_value);
  }

  formDeltaDisplay(p: LeaderboardPlayer): string {
    const pct = this.formDeltaPct(p);
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  teamSeasonDisplay(t: TeamLeaderboardEntry): string {
    return this.isCountStat
      ? (t.season_avg_display ?? '—')
      : (t.season_value_display ?? '—');
  }

  teamFormDeltaPct(t: TeamLeaderboardEntry): number {
    const base = this.isCountStat ? (t.season_avg_value ?? 0) : (t.season_value ?? 0);
    return this.overperformance(t.current_value, base ?? 0);
  }

  teamFormDeltaDisplay(t: TeamLeaderboardEntry): string {
    const pct = this.teamFormDeltaPct(t);
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  get sortedPlayers(): LeaderboardPlayer[] {
    return [...this.filteredPlayers].sort((a, b) => {
      let av: number, bv: number;
      let lowerBetter = LOWER_IS_BETTER.has(this.selectedStat);
      if (this.sortBy === 'current') {
        av = a.current_value; bv = b.current_value;
      } else if (this.sortBy === 'season') {
        if (this.isCountStat && a.season_total != null && b.season_total != null) {
          av = a.season_total; bv = b.season_total;
        } else {
          av = a.season_value; bv = b.season_value;
        }
      } else if (this.sortBy === 'best') {
        av = a.best_value; bv = b.best_value;
      } else if (this.sortBy === 'worst') {
        av = a.worst_value; bv = b.worst_value;
      } else {
        av = this.overperformance(a.current_value, a.season_value);
        bv = this.overperformance(b.current_value, b.season_value);
        lowerBetter = false;
      }
      const natural = lowerBetter ? av - bv : bv - av;
      return this.sortDir === 'reversed' ? -natural : natural;
    });
  }

  sortArrow(col: 'current' | 'season' | 'best' | 'worst' | 'form'): string {
    if (this.sortBy !== col) return '↕';
    const naturalDown = col === 'form' ? true : !LOWER_IS_BETTER.has(this.selectedStat);
    const showDown = this.sortDir === 'natural' ? naturalDown : !naturalDown;
    return showDown ? '↓' : '↑';
  }

  sort(col: 'current' | 'season' | 'best' | 'worst' | 'form') {
    if (this.sortBy === col) {
      this.sortDir = this.sortDir === 'natural' ? 'reversed' : 'natural';
    } else {
      this.sortBy = col;
      this.sortDir = 'natural';
    }
  }

  // ── Team view ────────────────────────────────────────────────────────────────

  get sortedTeams(): TeamLeaderboardEntry[] {
    if (!this.teamData) return [];
    return [...this.teamData.entries].sort((a, b) => {
      let av: number, bv: number;
      let lowerBetter = LOWER_IS_BETTER.has(this.selectedStat);
      const teamSeasonVal = (t: TeamLeaderboardEntry) =>
        this.isCountStat ? (t.season_avg_value ?? 0) : (t.season_value ?? 0);
      if (this.teamSortBy === 'current') {
        av = a.current_value; bv = b.current_value;
      } else if (this.teamSortBy === 'season') {
        av = teamSeasonVal(a); bv = teamSeasonVal(b);
      } else {
        av = this.overperformance(a.current_value, teamSeasonVal(a));
        bv = this.overperformance(b.current_value, teamSeasonVal(b));
        lowerBetter = false;
      }
      const natural = lowerBetter ? av - bv : bv - av;
      return this.teamSortDir === 'reversed' ? -natural : natural;
    });
  }

  teamSortArrow(col: 'current' | 'season' | 'form'): string {
    if (this.teamSortBy !== col) return '↕';
    const naturalDown = col === 'form' ? true : !LOWER_IS_BETTER.has(this.selectedStat);
    const showDown = this.teamSortDir === 'natural' ? naturalDown : !naturalDown;
    return showDown ? '↓' : '↑';
  }

  sortTeam(col: 'current' | 'season' | 'form') {
    if (this.teamSortBy === col) {
      this.teamSortDir = this.teamSortDir === 'natural' ? 'reversed' : 'natural';
    } else {
      this.teamSortBy = col;
      this.teamSortDir = 'natural';
    }
  }

  setView(v: 'players' | 'teams') {
    if (this.view === v) return;
    this.view = v;
    if (v === 'teams' && !this.teamData) this.loadTeams();
    if (v === 'players' && !this.data) this.loadPlayers();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  ngOnInit() {
    const s = this.savedState;
    if (s.data || s.teamData) {
      ({ view: this.view, season: this.season, stretchLength: this.stretchLength,
         selectedStat: this.selectedStat, pitcherType: this.pitcherType,
         sortBy: this.sortBy, sortDir: this.sortDir,
         teamSortBy: this.teamSortBy, teamSortDir: this.teamSortDir,
         searchQuery: this.searchQuery, selectedTeam: this.selectedTeam,
         selectedPosition: this.selectedPosition,
         data: this.data, teamData: this.teamData } = s);
      return;
    }

    if (this.season === new Date().getFullYear()) {
      this.statsService.getDefaultLength(this.season).subscribe({
        next: ({ games_played }) => {
          DEFAULT_LENGTH['hitter'] = hitterDefaultLength(games_played);
          DEFAULT_LENGTH['sp']     = spDefaultLength(games_played);
          DEFAULT_LENGTH['rp']     = rpDefaultLength(games_played);
          this.stretchLength = PITCHING_STATS.has(this.selectedStat)
            ? DEFAULT_LENGTH[this.pitcherType]
            : DEFAULT_LENGTH['hitter'];
          this.load();
        },
        error: () => { this.load(); },
      });
    } else {
      this.load();
    }
  }

  selectStat(stat: string) {
    this.selectedStat = stat;
    this.sortDir = 'natural';
    this.teamSortDir = 'natural';
    this.selectedPosition = '';
    if (PITCHING_STATS.has(stat)) {
      this.stretchLength = DEFAULT_LENGTH[this.pitcherType];
    } else {
      this.stretchLength = DEFAULT_LENGTH['hitter'];
    }
    this.load();
  }

  selectPitcherType(type: 'sp' | 'rp') {
    this.pitcherType = type;
    this.stretchLength = DEFAULT_LENGTH[type];
    this.load();
  }

  load() {
    this.savedState.data = null;
    this.savedState.teamData = null;
    this.data = null;
    this.teamData = null;
    if (this.view === 'teams') {
      this.loadTeams();
    } else {
      this.loadPlayers();
    }
  }

  private loadPlayers() {
    this.loading = true;
    this.error = null;
    const pt = this.isPitchingStat ? this.pitcherType : undefined;
    this.statsService.getLeaderboard(this.selectedStat, this.stretchLength, this.season, pt).subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (err) => { this.error = err.error?.detail ?? 'Failed to load leaderboard.'; this.loading = false; },
    });
  }

  private loadTeams() {
    this.loading = true;
    this.error = null;
    const pt = this.isPitchingStat ? this.pitcherType : undefined;
    this.statsService.getTeamLeaderboard(this.selectedStat, this.stretchLength, this.season, pt).subscribe({
      next: (d) => { this.teamData = d; this.loading = false; },
      error: (err) => { this.error = err.error?.detail ?? 'Failed to load team leaderboard.'; this.loading = false; },
    });
  }

  private static readonly MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  dateRange(start: string, end: string): string {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const sm = Leaderboard.MONTHS[s.getMonth()];
    const em = Leaderboard.MONTHS[e.getMonth()];
    return sm === em
      ? `${sm} ${s.getDate()}–${e.getDate()}`
      : `${sm} ${s.getDate()} – ${em} ${e.getDate()}`;
  }

  goToPlayer(p: LeaderboardPlayer) {
    this.saveState();
    this.router.navigate(['/player', p.player_id]);
  }
}
