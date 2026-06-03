import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  StatsService, StandingsData, StandingsDivision,
  TeamLeaderboardData, TeamLeaderboardEntry,
} from '../../core/services/stats.service';

const PITCHING_STATS = new Set(['era', 'whip', 'k9', 'k', 'bb', 'er']);
const LOWER_IS_BETTER = new Set(['era', 'whip', 'bb', 'er']);

interface StretchStat { ops: string; era: string; opsHot: string; eraHot: string; }

@Component({
  selector: 'app-standings',
  imports: [FormsModule],
  templateUrl: './standings.html',
  styleUrl: './standings.css',
})
export class Standings implements OnInit {
  private router = inject(Router);
  private statsService = inject(StatsService);

  // ── Shared ──
  tabView: 'standings' | 'leaderboard' = 'standings';
  season = new Date().getFullYear();
  readonly seasons = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i);
  readonly Math = Math;
  readonly LOWER_IS_BETTER = LOWER_IS_BETTER;

  // ── Standings view ──
  standingsData: StandingsData | null = null;
  standingsLoading = true;
  standingsError: string | null = null;

  // Stretch stats for OPS/ERA columns
  stretchLength = 15;
  stretchStatsMap: Record<number, StretchStat> = {};
  stretchStatsLoading = false;

  // ── Leaderboard view ──
  teamData: TeamLeaderboardData | null = null;
  lbLoading = false;
  lbError: string | null = null;
  selectedStat = 'ops';
  lbStretchLength = 15;
  pitcherType: 'sp' | 'rp' = 'sp';
  lbSortBy: 'current' | 'season' | 'form' = 'current';
  lbSortDir: 'natural' | 'reversed' = 'natural';
  lbFiltersOpen = false;

  get selectedStatLabel(): string {
    for (const g of this.statGroups) {
      const opt = g.options.find(o => o.value === this.selectedStat);
      if (opt) return opt.label;
    }
    return this.selectedStat.toUpperCase();
  }

  readonly statGroups = [
    {
      label: 'Hitting',
      options: [
        { value: 'ops',  label: 'OPS' }, { value: 'avg', label: 'AVG' },
        { value: 'hr',   label: 'HR'  }, { value: 'rbi', label: 'RBI' },
        { value: 'obp',  label: 'OBP' }, { value: 'slg', label: 'SLG' },
        { value: 'sb',   label: 'SB'  },
      ],
    },
    {
      label: 'Pitching',
      options: [
        { value: 'era',  label: 'ERA'  }, { value: 'whip', label: 'WHIP' },
        { value: 'k9',   label: 'K/9'  }, { value: 'k',    label: 'K'    },
      ],
    },
  ];

  get isPitchingStat() { return PITCHING_STATS.has(this.selectedStat); }
  get isCountStat()    { return ['hr', 'rbi', 'sb', 'k', 'bb', 'er'].includes(this.selectedStat); }

  get alDivisions(): StandingsDivision[] {
    return this.standingsData?.divisions.filter(d => d.name.startsWith('American')) ?? [];
  }
  get nlDivisions(): StandingsDivision[] {
    return this.standingsData?.divisions.filter(d => d.name.startsWith('National')) ?? [];
  }

  ngOnInit() { this.loadStandings(); }

  setTab(tab: 'standings' | 'leaderboard') {
    this.tabView = tab;
    if (tab === 'leaderboard' && !this.teamData && !this.lbLoading) this.loadTeamLeaderboard();
  }

  onSeasonChange() {
    this.standingsData = null;
    this.teamData = null;
    this.stretchStatsMap = {};
    this.loadStandings();
    if (this.tabView === 'leaderboard') this.loadTeamLeaderboard();
  }

  private loadStandings() {
    this.standingsLoading = true;
    this.standingsError = null;
    this.statsService.getStandings(this.season).subscribe({
      next: (data) => {
        this.standingsData = data;
        this.standingsLoading = false;
        this.loadStretchStats();
      },
      error: () => { this.standingsError = 'Failed to load standings.'; this.standingsLoading = false; },
    });
  }

  loadStretchStats() {
    this.stretchStatsLoading = true;
    this.stretchStatsMap = {};
    forkJoin({
      ops: this.statsService.getTeamLeaderboard('ops', this.stretchLength, this.season),
      era: this.statsService.getTeamLeaderboard('era', this.stretchLength, this.season),
    }).subscribe({
      next: ({ ops, era }) => {
        const opsMap: Record<number, TeamLeaderboardEntry> = {};
        const eraMap: Record<number, TeamLeaderboardEntry> = {};
        ops.entries.forEach(e => opsMap[e.team_id] = e);
        era.entries.forEach(e => eraMap[e.team_id] = e);
        const result: Record<number, StretchStat> = {};
        for (const div of (this.standingsData?.divisions ?? [])) {
          for (const team of div.teams) {
            result[team.id] = {
              ops:    opsMap[team.id]?.current_value_display ?? '—',
              era:    eraMap[team.id]?.current_value_display ?? '—',
              opsHot: opsMap[team.id]?.hot_cold ?? 'neutral',
              eraHot: eraMap[team.id]?.hot_cold ?? 'neutral',
            };
          }
        }
        this.stretchStatsMap = result;
        this.stretchStatsLoading = false;
      },
      error: () => { this.stretchStatsLoading = false; },
    });
  }

  // ── Leaderboard ──

  loadTeamLeaderboard() {
    this.lbLoading = true;
    this.lbError = null;
    this.teamData = null;
    const pt = this.isPitchingStat ? this.pitcherType : undefined;
    this.statsService.getTeamLeaderboard(this.selectedStat, this.lbStretchLength, this.season, pt).subscribe({
      next: (data) => { this.teamData = data; this.lbLoading = false; },
      error: (err) => { this.lbError = err.error?.detail ?? 'Failed to load team leaderboard.'; this.lbLoading = false; },
    });
  }

  selectStat(stat: string) {
    this.selectedStat = stat;
    this.lbSortDir = 'natural';
    this.loadTeamLeaderboard();
  }

  selectPitcherType(type: 'sp' | 'rp') {
    this.pitcherType = type;
    this.loadTeamLeaderboard();
  }

  seasonVal(t: TeamLeaderboardEntry): number {
    return this.isCountStat ? (t.season_avg_value ?? 0) : (t.season_value ?? 0);
  }

  formPct(t: TeamLeaderboardEntry): number {
    const base = this.seasonVal(t);
    if (!base) return 0;
    const raw = (t.current_value - base) / Math.abs(base) * 100;
    return LOWER_IS_BETTER.has(this.selectedStat) ? -raw : raw;
  }

  get sortedTeams(): TeamLeaderboardEntry[] {
    if (!this.teamData) return [];
    return [...this.teamData.entries].sort((a, b) => {
      let av: number, bv: number;
      let lowerBetter = LOWER_IS_BETTER.has(this.selectedStat);
      if (this.lbSortBy === 'current') {
        av = a.current_value; bv = b.current_value;
      } else if (this.lbSortBy === 'season') {
        av = this.seasonVal(a); bv = this.seasonVal(b);
      } else {
        av = this.formPct(a); bv = this.formPct(b); lowerBetter = false;
      }
      const natural = lowerBetter ? av - bv : bv - av;
      return this.lbSortDir === 'reversed' ? -natural : natural;
    });
  }

  sortTeam(col: 'current' | 'season' | 'form') {
    if (this.lbSortBy === col) {
      this.lbSortDir = this.lbSortDir === 'natural' ? 'reversed' : 'natural';
    } else {
      this.lbSortBy = col; this.lbSortDir = 'natural';
    }
  }

  sortArrow(col: 'current' | 'season' | 'form'): string {
    if (this.lbSortBy !== col) return '↕';
    const naturalDown = col === 'form' ? true : !LOWER_IS_BETTER.has(this.selectedStat);
    return (this.lbSortDir === 'natural') === naturalDown ? '↓' : '↑';
  }

  teamSeasonDisplay(t: TeamLeaderboardEntry): string {
    return this.isCountStat ? (t.season_avg_display ?? '—') : (t.season_value_display ?? '—');
  }

  formDeltaDisplay(t: TeamLeaderboardEntry): string {
    const pct = this.formPct(t);
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  // ── Helpers ──

  goToTeam(id: number) { this.router.navigate(['/team', id]); }

  shortDivName(name: string): string {
    return name.replace('American League ', '').replace('National League ', '');
  }

  statClass(hot: string): string {
    return hot === 'on_fire' ? 'on-fire' : hot;
  }

  streakClass(streak: string): string {
    if (!streak) return '';
    return streak.startsWith('W') ? 'win' : 'loss';
  }
}
