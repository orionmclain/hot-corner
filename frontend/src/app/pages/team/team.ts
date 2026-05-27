import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import {
  StatsService,
  RosterPlayer,
  TeamInfo,
  TeamPageState,
  StretchData,
  StretchWindow,
} from '../../core/services/stats.service';
import Chart from 'chart.js/auto';

const POSITION_ORDER: Record<string, number> = {
  SP: 0, RP: 1, CP: 1, CL: 1, P: 1,
  C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6,
  LF: 7, CF: 8, RF: 9, OF: 9, DH: 10,
};

const PITCHING_STATS = new Set(['era', 'whip', 'k9', 'k', 'bb', 'er']);
const COUNT_STATS = new Set(['hr', 'rbi', 'sb', 'k', 'bb', 'er']);

@Component({
  selector: 'app-team',
  imports: [FormsModule],
  templateUrl: './team.html',
  styleUrl: './team.css',
})
export class Team implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private statsService = inject(StatsService);

  teamId = 0;
  team: TeamInfo | null = null;
  record: { wins: number; losses: number; pct: string; gb: string; streak: string } | null = null;
  players: RosterPlayer[] = [];
  loading = true;
  hotColdLoading = true;
  error: string | null = null;

  // Per-section roster controls
  hitterStat = 'ops';  hitterLength = 10;
  spStat     = 'era';  spLength     = 5;
  rpStat     = 'whip'; rpLength     = 10;

  // Team performance chart
  @ViewChild('teamChartCanvas') teamChartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;
  chartData: StretchData | null = null;
  chartLoading = false;
  chartError: string | null = null;
  chartStat = 'ops';
  chartLength = 10;
  chartSeason = new Date().getFullYear();
  chartMode: 'offense' | 'pitching' = 'offense';

  readonly seasons = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i);
  readonly Math = Math;

  readonly offenseStats = [
    { value: 'ops',  label: 'OPS' },
    { value: 'avg',  label: 'AVG' },
    { value: 'obp',  label: 'OBP' },
    { value: 'slg',  label: 'SLG' },
    { value: 'hr',   label: 'HR'  },
    { value: 'rbi',  label: 'RBI' },
    { value: 'wins', label: 'W'   },
  ];

  readonly pitchingChartStats = [
    { value: 'era',  label: 'ERA'  },
    { value: 'whip', label: 'WHIP' },
    { value: 'k9',   label: 'K/9'  },
    { value: 'k',    label: 'K'    },
  ];

  get chartStatOptions() {
    return this.chartMode === 'offense' ? this.offenseStats : this.pitchingChartStats;
  }

  private get state(): TeamPageState { return this.statsService.teamPageState; }
  private saveState() {
    Object.assign(this.state, {
      hitterStat: this.hitterStat, hitterLength: this.hitterLength,
      spStat: this.spStat,         spLength: this.spLength,
      rpStat: this.rpStat,         rpLength: this.rpLength,
    });
  }

  readonly hittingStats = [
    { value: 'ops', label: 'OPS' }, { value: 'avg', label: 'AVG' },
    { value: 'hr',  label: 'HR'  }, { value: 'rbi', label: 'RBI' },
    { value: 'obp', label: 'OBP' }, { value: 'slg', label: 'SLG' },
    { value: 'sb',  label: 'SB'  },
  ];
  readonly pitchingStats = [
    { value: 'era',  label: 'ERA'  }, { value: 'whip', label: 'WHIP' },
    { value: 'k9',   label: 'K/9'  }, { value: 'k',    label: 'K'    },
  ];

  ngOnInit() {
    ({ hitterStat: this.hitterStat, hitterLength: this.hitterLength,
       spStat: this.spStat, spLength: this.spLength,
       rpStat: this.rpStat, rpLength: this.rpLength } = this.state);

    this.route.paramMap.subscribe((params) => {
      this.teamId = Number(params.get('id'));
      this.loadRoster();
      this.loadTeamStretches();
    });
  }

  ngOnDestroy() {
    this.chart?.destroy();
  }

  private loadRoster() {
    this.loading = true;
    this.hotColdLoading = true;
    this.error = null;

    this.statsService.getTeams().subscribe({
      next: (teams) => { this.team = teams.find((t) => t.id === this.teamId) ?? null; },
    });

    this.statsService.getTeamRecord(this.teamId).subscribe({
      next: (r) => { this.record = r; },
      error: () => {},
    });

    this.statsService.getTeamRoster(this.teamId).subscribe({
      next: (data) => {
        this.players = data.players.slice().sort(
          (a, b) => (POSITION_ORDER[a.position] ?? 99) - (POSITION_ORDER[b.position] ?? 99)
        );
        this.loading = false;
        this.loadHotCold();
      },
      error: () => {
        this.error = 'Failed to load roster.';
        this.loading = false;
        this.hotColdLoading = false;
      },
    });
  }

  loadHotCold() {
    this.saveState();
    this.hotColdLoading = true;
    this.statsService.getTeamHotCold(this.teamId, {
      hitterStat: this.hitterStat, hitterLength: this.hitterLength,
      spStat: this.spStat,         spLength: this.spLength,
      rpStat: this.rpStat,         rpLength: this.rpLength,
    }).subscribe({
      next: (hotColdPlayers) => {
        const map = new Map(hotColdPlayers.map((p) => [p.id, p]));
        this.players = this.players.map((p) => ({ ...p, ...map.get(p.id) }));
        this.hotColdLoading = false;
      },
      error: () => { this.hotColdLoading = false; },
    });
  }

  setChartMode(mode: 'offense' | 'pitching') {
    this.chartMode = mode;
    this.chartStat = mode === 'pitching' ? 'era' : 'ops';
    this.loadTeamStretches();
  }

  loadTeamStretches() {
    this.chartLoading = true;
    this.chartError = null;
    if (this.chart) { this.chart.destroy(); this.chart = null; }

    this.statsService.getTeamStretches(this.teamId, this.chartSeason, this.chartLength, this.chartStat)
      .pipe(catchError((err) => {
        this.chartError = err.error?.detail ?? 'Failed to load team performance data.';
        return of(null as StretchData | null);
      }))
      .subscribe((data) => {
        this.chartData = data;
        this.chartLoading = false;
        if (data) setTimeout(() => this.renderTeamChart(data), 0);
      });
  }

  streakLabel(data: StretchData): string {
    const s = data.streakiness;
    const isPitch = PITCHING_STATS.has(data.stat);
    if (isPitch) {
      if (s < 20) return 'Very Consistent';
      if (s < 38) return 'Consistent';
      if (s < 58) return 'Moderate';
      if (s < 85) return 'Streaky';
      return 'Very Streaky';
    }
    if (s < 15) return 'Very Consistent';
    if (s < 25) return 'Consistent';
    if (s < 40) return 'Moderate';
    if (s < 60) return 'Streaky';
    return 'Very Streaky';
  }

  streakClass(data: StretchData): string {
    const s = data.streakiness;
    const isPitch = PITCHING_STATS.has(data.stat);
    if (isPitch) {
      if (s < 38) return 'consistent';
      if (s < 58) return 'moderate';
      return 'streaky';
    }
    if (s < 25) return 'consistent';
    if (s < 45) return 'moderate';
    return 'streaky';
  }

  seasonStatLabel(data: StretchData): string {
    return COUNT_STATS.has(data.stat)
      ? `${data.stat_label} per ${data.stretch_length}G avg`
      : data.stat_label;
  }

  goToPlayer(id: number) {
    this.router.navigate(['/player', id]);
  }

  get starters(): RosterPlayer[] {
    return this.players.filter((p) => p.position === 'SP');
  }

  get relievers(): RosterPlayer[] {
    return this.players.filter((p) => ['RP', 'CP', 'CL', 'P'].includes(p.position));
  }

  get positionPlayers(): RosterPlayer[] {
    return this.players.filter((p) => !['SP', 'RP', 'CP', 'CL', 'P'].includes(p.position));
  }

  private fmtDate(iso: string): string {
    if (!iso) return '';
    const [, mm, dd] = iso.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[+mm - 1]} ${+dd}`;
  }

  private renderTeamChart(data: StretchData) {
    if (!this.teamChartCanvas?.nativeElement) return;
    if (this.chart) { this.chart.destroy(); this.chart = null; }

    const color = '#10b981';
    const isPitch = PITCHING_STATS.has(data.stat);
    const isCountStat = COUNT_STATS.has(data.stat);
    const isEraStyle = ['era', 'k9'].includes(data.stat);

    const pointBg = data.windows.map((w) => {
      if (w.window_index === data.best_index) return '#f59e0b';
      if (w.window_index === data.worst_index) return '#ef4444';
      return color;
    });
    const pointR  = data.windows.map((w) =>
      w.window_index === data.best_index || w.window_index === data.worst_index ? 7 : 0
    );
    const pointHR = data.windows.map((w) =>
      w.window_index === data.best_index || w.window_index === data.worst_index ? 9 : 5
    );

    const ctx = this.teamChartCanvas.nativeElement.getContext('2d')!;
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.windows.map((w) => this.fmtDate(w.end_date)),
        datasets: [
          {
            label: data.stat_label,
            data: data.windows.map((w) => w.value),
            borderColor: color,
            backgroundColor: 'rgba(16,185,129,0.08)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            spanGaps: isPitch,
            pointBackgroundColor: pointBg,
            pointBorderColor: pointBg,
            pointBorderWidth: 2,
            pointRadius: pointR,
            pointHoverRadius: pointHR,
          } as any,
          {
            label: 'Season avg',
            data: data.windows.map(() => data.season_value),
            borderColor: 'rgba(16,185,129,0.3)',
            borderDash: [5, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            tension: 0,
            spanGaps: true,
          } as any,
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1f2937',
            borderColor: '#374151',
            borderWidth: 1,
            titleColor: '#f9fafb',
            bodyColor: '#9ca3af',
            padding: 14,
            filter: (item) => item.raw !== null,
            callbacks: {
              title: (items) => {
                const w = data.windows[items[0].dataIndex];
                return w ? `${this.fmtDate(w.start_date)} – ${this.fmtDate(w.end_date)}` : '';
              },
              label: (item) => {
                if (item.datasetIndex !== 0) return '';
                const w = data.windows[item.dataIndex];
                if (!w) return '';
                const val = isCountStat
                  ? String(Math.round(item.raw as number))
                  : (item.raw as number).toFixed(isEraStyle ? 2 : 3);
                const badge =
                  w.window_index === data.best_index ? ' 🏆'
                  : w.window_index === data.worst_index ? ' 📉'
                  : '';
                return ` ${data.stat_label}: ${val}${badge}`;
              },
              afterLabel: (item) => {
                if (item.datasetIndex !== 0) return [];
                const w = data.windows[item.dataIndex];
                return w ? [` Games ${w.start_game}–${w.end_game}`] : [];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            border: { color: 'rgba(255,255,255,0.06)' },
            ticks: {
              color: '#6b7280',
              maxTicksLimit: 18,
              font: { size: 11, family: 'Inter, system-ui, sans-serif' },
            },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            border: { color: 'rgba(255,255,255,0.06)' },
            ticks: {
              color: '#6b7280',
              font: { size: 11, family: 'Inter, system-ui, sans-serif' },
              callback: (val) => {
                if (isCountStat) return String(val);
                if (isEraStyle) return Number(val).toFixed(2);
                return Number(val).toFixed(3);
              },
            },
          },
        },
      },
    });
  }
}
