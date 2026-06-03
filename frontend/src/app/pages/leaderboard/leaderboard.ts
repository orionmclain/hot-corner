import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StatsService, LeaderboardData, LeaderboardPlayer } from '../../core/services/stats.service';

const PITCHING_STATS = new Set(['era', 'whip', 'k9', 'k', 'bb', 'er']);
const LOWER_IS_BETTER = new Set(['era', 'whip', 'bb', 'er']);

const DEFAULT_LENGTH: Record<string, number> = {
  sp: 5,
  rp: 5,
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
  loading = false;
  error: string | null = null;

  season = new Date().getFullYear();
  stretchLength = 5;
  selectedStat = 'ops';
  pitcherType: 'sp' | 'rp' = 'sp';

  sortBy: 'current' | 'season' | 'best' | 'worst' | 'form' = 'current';
  sortDir: 'natural' | 'reversed' = 'natural';

  searchQuery = '';
  selectedTeam = '';
  selectedPosition = '';

  readonly hitterPositions = ['C','1B','2B','3B','SS','LF','CF','RF','OF','DH'];

  private get savedState() { return this.statsService.leaderboardPageState; }
  private saveState() {
    Object.assign(this.savedState, {
      season: this.season, stretchLength: this.stretchLength,
      selectedStat: this.selectedStat, pitcherType: this.pitcherType,
      sortBy: this.sortBy, sortDir: this.sortDir,
      searchQuery: this.searchQuery, selectedTeam: this.selectedTeam,
      selectedPosition: this.selectedPosition,
      data: this.data,
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

  filtersOpen = false;

  get isPitchingStat() { return PITCHING_STATS.has(this.selectedStat); }
  get isCountStat()    { return ['hr', 'rbi', 'sb', 'k', 'bb', 'er'].includes(this.selectedStat); }
  get isCurrentSeason(){ return this.season === this.currentYear; }

  get selectedStatLabel(): string {
    for (const g of this.statGroups) {
      const opt = g.options.find(o => o.value === this.selectedStat);
      if (opt) return opt.label;
    }
    return this.selectedStat.toUpperCase();
  }

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

  ngOnInit() {
    const s = this.savedState;
    if (s.data) {
      ({ season: this.season, stretchLength: this.stretchLength,
         selectedStat: this.selectedStat, pitcherType: this.pitcherType,
         sortBy: this.sortBy, sortDir: this.sortDir,
         searchQuery: this.searchQuery, selectedTeam: this.selectedTeam,
         selectedPosition: this.selectedPosition,
         data: this.data } = s);
      return;
    }

    this.selectedStat = s.selectedStat;
    this.pitcherType = s.pitcherType;

    this.stretchLength = PITCHING_STATS.has(this.selectedStat)
      ? DEFAULT_LENGTH[this.pitcherType]
      : DEFAULT_LENGTH['hitter'];
    this.load();
  }

  selectStat(stat: string) {
    this.selectedStat = stat;
    this.sortDir = 'natural';
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
    this.data = null;
    this.loading = true;
    this.error = null;
    const pt = this.isPitchingStat ? this.pitcherType : undefined;
    this.statsService.getLeaderboard(this.selectedStat, this.stretchLength, this.season, pt).subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (err) => { this.error = err.error?.detail ?? 'Failed to load leaderboard.'; this.loading = false; },
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
