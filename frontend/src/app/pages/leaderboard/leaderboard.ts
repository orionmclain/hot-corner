import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StatsService, LeaderboardData, LeaderboardPlayer } from '../../core/services/stats.service';

const PITCHING_STATS = new Set(['era', 'whip', 'k9', 'k', 'bb', 'er']);
const LOWER_IS_BETTER = new Set(['era', 'whip', 'bb', 'er']);

const DEFAULT_LENGTH: Record<string, number> = { sp: 5, rp: 5, hitter: 5 };

const TEAM_LEAGUE: Record<string, 'AL' | 'NL'> = {
  NYY: 'AL', BOS: 'AL', TB:  'AL', TOR: 'AL', BAL: 'AL',
  CLE: 'AL', CWS: 'AL', DET: 'AL', KC:  'AL', MIN: 'AL',
  HOU: 'AL', LAA: 'AL', OAK: 'AL', SEA: 'AL', TEX: 'AL',
  ATL: 'NL', NYM: 'NL', PHI: 'NL', MIA: 'NL', WSH: 'NL',
  CHC: 'NL', CIN: 'NL', MIL: 'NL', PIT: 'NL', STL: 'NL',
  ARI: 'NL', COL: 'NL', LAD: 'NL', SD:  'NL', SF:  'NL',
};

const TEAM_DIVISION: Record<string, string> = {
  NYY: 'AL East',    BOS: 'AL East',    TB:  'AL East',    TOR: 'AL East',    BAL: 'AL East',
  CLE: 'AL Central', CWS: 'AL Central', DET: 'AL Central', KC:  'AL Central', MIN: 'AL Central',
  HOU: 'AL West',    LAA: 'AL West',    OAK: 'AL West',    SEA: 'AL West',    TEX: 'AL West',
  ATL: 'NL East',    NYM: 'NL East',    PHI: 'NL East',    MIA: 'NL East',    WSH: 'NL East',
  CHC: 'NL Central', CIN: 'NL Central', MIL: 'NL Central', PIT: 'NL Central', STL: 'NL Central',
  ARI: 'NL West',    COL: 'NL West',    LAD: 'NL West',    SD:  'NL West',    SF:  'NL West',
};

const AL_DIVISIONS = ['AL East', 'AL Central', 'AL West'];
const NL_DIVISIONS = ['NL East', 'NL Central', 'NL West'];

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
  loading = false;
  error: string | null = null;

  season = new Date().getFullYear();
  stretchLength = 5;
  selectedStat = 'ops';
  pitcherType: 'sp' | 'rp' = 'sp';

  sortBy: 'current' | 'season' | 'best' | 'worst' | 'form' | 'streak' = 'current';
  sortDir: 'natural' | 'reversed' = 'natural';

  searchQuery = '';
  selectedTeam = '';
  selectedPosition = '';
  selectedLeague = '';
  selectedDivision = '';

  filtersOpen = false;

  readonly hitterPositions = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
  readonly pitcherPositions = ['SP', 'RP'];
  readonly allPositions = ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];

  private get savedState() { return this.statsService.leaderboardPageState; }
  private saveState() {
    Object.assign(this.savedState, {
      season: this.season, stretchLength: this.stretchLength,
      selectedStat: this.selectedStat, pitcherType: this.pitcherType,
      sortBy: this.sortBy, sortDir: this.sortDir,
      searchQuery: this.searchQuery, selectedTeam: this.selectedTeam,
      selectedPosition: this.selectedPosition,
      selectedLeague: this.selectedLeague,
      selectedDivision: this.selectedDivision,
      data: this.data,
    });
  }

  readonly seasons = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  readonly currentYear = new Date().getFullYear();
  readonly Math = Math;
  readonly LOWER_IS_BETTER = LOWER_IS_BETTER;

  readonly hitterStatOptions = [
    { value: 'ops', label: 'OPS' }, { value: 'avg', label: 'AVG' },
    { value: 'obp', label: 'OBP' }, { value: 'slg', label: 'SLG' },
    { value: 'hr',  label: 'HR'  }, { value: 'rbi', label: 'RBI' },
    { value: 'sb',  label: 'SB'  },
  ];

  readonly pitcherStatOptions = [
    { value: 'era',  label: 'ERA'  }, { value: 'whip', label: 'WHIP' },
    { value: 'k9',   label: 'K/9'  }, { value: 'k',    label: 'K'    },
    { value: 'bb',   label: 'BB'   }, { value: 'er',   label: 'ER'   },
  ];

  get isPitchingStat() { return PITCHING_STATS.has(this.selectedStat); }
  get isCountStat()    { return ['hr', 'rbi', 'sb', 'k', 'bb', 'er'].includes(this.selectedStat); }
  get isCurrentSeason(){ return this.season === this.currentYear; }

  get selectedStatLabel(): string {
    return [...this.hitterStatOptions, ...this.pitcherStatOptions]
      .find(o => o.value === this.selectedStat)?.label ?? this.selectedStat.toUpperCase();
  }

  get availableDivisions(): string[] {
    if (this.selectedLeague === 'AL') return AL_DIVISIONS;
    if (this.selectedLeague === 'NL') return NL_DIVISIONS;
    return [...AL_DIVISIONS, ...NL_DIVISIONS];
  }

  get availableTeams(): string[] {
    if (!this.data) return [];
    return [...new Set(
      this.data.players
        .filter(p =>
          (!this.selectedLeague   || TEAM_LEAGUE[p.team_abbreviation]   === this.selectedLeague) &&
          (!this.selectedDivision || TEAM_DIVISION[p.team_abbreviation] === this.selectedDivision)
        )
        .map(p => p.team_abbreviation)
    )].sort();
  }

  onLeagueChange() {
    if (this.selectedLeague && !this.availableDivisions.includes(this.selectedDivision)) {
      this.selectedDivision = '';
    }
    if (this.selectedTeam && TEAM_LEAGUE[this.selectedTeam] !== this.selectedLeague) {
      this.selectedTeam = '';
    }
  }

  onDivisionChange() {
    if (this.selectedTeam && this.selectedDivision &&
        TEAM_DIVISION[this.selectedTeam] !== this.selectedDivision) {
      this.selectedTeam = '';
    }
  }

  get filteredPlayers(): LeaderboardPlayer[] {
    if (!this.data) return [];
    const q   = this.searchQuery.toLowerCase();
    const pos = this.selectedPosition;
    const seen = new Set<number>();
    return this.data.players.filter(p => {
      if (seen.has(p.player_id)) return false;
      seen.add(p.player_id);
      return (
        (!q  || p.name.toLowerCase().includes(q)) &&
        (!this.selectedTeam     || p.team_abbreviation === this.selectedTeam) &&
        (!this.selectedLeague   || TEAM_LEAGUE[p.team_abbreviation]   === this.selectedLeague) &&
        (!this.selectedDivision || TEAM_DIVISION[p.team_abbreviation] === this.selectedDivision) &&
        (!pos || pos === 'SP' || pos === 'RP' ||
          (pos === 'OF' ? ['LF', 'CF', 'RF', 'OF'].includes(p.position) : p.position === pos))
      );
    });
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

  get sortedPlayers(): LeaderboardPlayer[] {
    return [...this.filteredPlayers].sort((a, b) => {
      let av: number, bv: number;
      let lowerBetter = LOWER_IS_BETTER.has(this.selectedStat);
      switch (this.sortBy) {
        case 'current': av = a.current_value; bv = b.current_value; break;
        case 'season':
          if (this.isCountStat && a.season_total != null && b.season_total != null) {
            av = a.season_total; bv = b.season_total;
          } else { av = a.season_value; bv = b.season_value; }
          break;
        case 'best':   av = a.best_value;   bv = b.best_value;   break;
        case 'worst':  av = a.worst_value;  bv = b.worst_value;  break;
        case 'streak':
          av = a.streakiness; bv = b.streakiness; lowerBetter = false; break;
        default: // form
          av = this.overperformance(a.current_value, a.season_value);
          bv = this.overperformance(b.current_value, b.season_value);
          lowerBetter = false;
      }
      const natural = lowerBetter ? av - bv : bv - av;
      return this.sortDir === 'reversed' ? -natural : natural;
    });
  }

  sortArrow(col: 'current' | 'season' | 'best' | 'worst' | 'form' | 'streak'): string {
    if (this.sortBy !== col) return '↕';
    const naturalDown = (col === 'form' || col === 'streak') ? true : !LOWER_IS_BETTER.has(this.selectedStat);
    return (this.sortDir === 'natural' ? naturalDown : !naturalDown) ? '↓' : '↑';
  }

  sort(col: 'current' | 'season' | 'best' | 'worst' | 'form' | 'streak') {
    if (this.sortBy === col) {
      this.sortDir = this.sortDir === 'natural' ? 'reversed' : 'natural';
    } else {
      this.sortBy = col;
      this.sortDir = 'natural';
    }
  }

  selectStat(stat: string) {
    this.selectedStat = stat;
    this.sortDir = 'natural';
    if (PITCHING_STATS.has(stat)) {
      // Clear hitter positions — but keep '' (All) or SP/RP as-is
      if (this.selectedPosition !== '' && this.selectedPosition !== 'SP' && this.selectedPosition !== 'RP') {
        this.selectedPosition = '';
      }
      this.stretchLength = DEFAULT_LENGTH['sp'];
    } else {
      // Clear pitcher positions when switching to hitting
      if (this.selectedPosition === 'SP' || this.selectedPosition === 'RP') {
        this.selectedPosition = '';
      }
      this.stretchLength = DEFAULT_LENGTH['hitter'];
    }
    this.load();
  }

  selectPosition(pos: string) {
    this.selectedPosition = pos;
    if (pos === 'SP') {
      this.pitcherType = 'sp';
      if (!this.isPitchingStat) { this.selectedStat = 'era'; this.stretchLength = DEFAULT_LENGTH['sp']; }
      this.load();
    } else if (pos === 'RP') {
      this.pitcherType = 'rp';
      if (!this.isPitchingStat) { this.selectedStat = 'whip'; this.stretchLength = DEFAULT_LENGTH['rp']; }
      this.load();
    } else if (pos === '' && this.isPitchingStat) {
      // Switched to "All" while on a pitching stat — reload to include all pitchers
      this.load();
    }
    // Hitter positions on a hitting stat: client-side filter only, no reload
  }

  ngOnInit() {
    const s = this.savedState;
    // Always restore all filter state, regardless of whether data is cached
    this.season           = s.season;
    this.stretchLength    = s.stretchLength;
    this.selectedStat     = s.selectedStat;
    this.pitcherType      = s.pitcherType;
    this.sortBy           = s.sortBy;
    this.sortDir          = s.sortDir;
    this.searchQuery      = s.searchQuery;
    this.selectedTeam     = s.selectedTeam;
    this.selectedPosition = s.selectedPosition ?? '';
    this.selectedLeague   = s.selectedLeague   ?? '';
    this.selectedDivision = s.selectedDivision ?? '';

    if (s.data) {
      this.data = s.data;
      return;
    }
    this.load();
  }

  load() {
    this.savedState.data = null;
    this.data = null;
    this.loading = true;
    this.error = null;
    // Derive pitcher_type from the position filter:
    //   SP → 'sp', RP → 'rp', '' (All) → undefined (all pitchers)
    const pt = this.isPitchingStat
      ? (this.selectedPosition === 'SP' ? 'sp' : this.selectedPosition === 'RP' ? 'rp' : undefined)
      : undefined;
    this.statsService.getLeaderboard(this.selectedStat, this.stretchLength, this.season, pt).subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (err) => { this.error = err.error?.detail ?? 'Failed to load leaderboard.'; this.loading = false; },
    });
  }

  private static readonly MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  dateRange(start: string, end: string): string {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end   + 'T12:00:00');
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
