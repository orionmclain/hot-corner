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
import { forkJoin, of, Subscription, firstValueFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  StatsService,
  PlayerInfo,
  PlayerSearchResult,
  StretchData,
  StretchWindow,
  StretchGame,
  hitterDefaultLength,
  spDefaultLength,
  rpDefaultLength,
} from '../../core/services/stats.service';
import { SearchBar } from '../../components/search-bar/search-bar';
import Chart from 'chart.js/auto';

const PLAYER_COLORS = ['#10b981', '#3b82f6'];
const PITCHER_POSITIONS = new Set(['SP', 'RP', 'P', 'CP']);
const PITCHING_STATS = new Set(['era', 'whip', 'k9', 'k', 'bb', 'er']);

@Component({
  selector: 'app-player',
  imports: [FormsModule, SearchBar],
  templateUrl: './player.html',
  styleUrl: './player.css',
})
export class Player implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private statsService = inject(StatsService);

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  // Primary player
  playerId = -1;
  playerInfo: PlayerInfo | null = null;
  stretchData: StretchData | null = null;
  loading = false;
  error: string | null = null;

  // Comparison player
  compareId: number | null = null;
  compareInfo: PlayerInfo | null = null;
  compareStretchData: StretchData | null = null;
  compareError: string | null = null;

  // Compare search UI
  showCompareSearch = false;

  // Two-way player
  twoWayMode: 'hitting' | 'pitching' = 'hitting';

  // Game log panel
  selectedWindow: StretchWindow | null = null;
  selectedWindowGames: StretchGame[] = [];
  selectedWindowPlayerIndex = 0;
  gameLogLoading = false;

  private routeSub?: Subscription;

  season = new Date().getFullYear();
  selectedStat = 'ops';
  stretchLength = 5;
  private gamesPlayedThisSeason = 0;

  readonly hittingStatOptions = [
    { value: 'ops',  label: 'OPS' },
    { value: 'avg',  label: 'AVG' },
    { value: 'obp',  label: 'OBP' },
    { value: 'slg',  label: 'SLG' },
    { value: 'hr',   label: 'HR'  },
    { value: 'rbi',  label: 'RBI' },
    { value: 'sb',   label: 'SB'  },
  ];

  readonly pitchingStatOptions = [
    { value: 'era',  label: 'ERA'  },
    { value: 'whip', label: 'WHIP' },
    { value: 'k9',   label: 'K/9'  },
    { value: 'k',    label: 'K'    },
    { value: 'bb',   label: 'BB'   },
    { value: 'er',   label: 'ER'   },
  ];

  get statOptions() {
    return this.isPitcher ? this.pitchingStatOptions : this.hittingStatOptions;
  }

  get isTwoWay(): boolean {
    return this.playerInfo?.position === 'TWP';
  }

  get isPitcher(): boolean {
    if (this.isTwoWay) return this.twoWayMode === 'pitching';
    return PITCHER_POSITIONS.has(this.playerInfo?.position ?? '');
  }

  get comparePositionFilter(): (p: PlayerSearchResult) => boolean {
    const group = this.primaryGroup;
    return (p) => {
      const pg = this.getPositionGroup(p.position);
      if (group === 'hitter') return pg === 'hitter' || p.position === 'TWP';
      return pg === group;
    };
  }

  private getPositionGroup(pos: string): 'hitter' | 'sp' | 'rp' {
    if (pos === 'SP') return 'sp';
    if (['RP', 'CP', 'CL'].includes(pos)) return 'rp';
    return 'hitter';
  }

  get primaryGroup(): 'hitter' | 'sp' | 'rp' {
    if (this.isTwoWay) return this.twoWayMode === 'pitching' ? 'sp' : 'hitter';
    return this.getPositionGroup(this.playerInfo?.position ?? '');
  }

  setTwoWayMode(mode: 'hitting' | 'pitching') {
    this.twoWayMode = mode;
    this.selectedStat = mode === 'pitching' ? 'era' : 'ops';
    this.loadStretches();
  }

  readonly seasons = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i);
  readonly Math = Math;

  // ── Lifecycle ────────────────────────────────────────────
  async ngOnInit() {
    if (this.season === new Date().getFullYear()) {
      try {
        const { games_played } = await firstValueFrom(this.statsService.getDefaultLength(this.season));
        this.gamesPlayedThisSeason = games_played;
      } catch {}
    }

    this.routeSub = this.route.paramMap.subscribe((params) => {
      const newId = Number(params.get('id') ?? params.get('id1'));
      const newCompareId = params.get('id2') ? Number(params.get('id2')) : null;
      const playerChanged = newId !== this.playerId;

      this.playerId = newId;

      if (playerChanged) {
        this.playerInfo = null;
        this.stretchData = null;
        this.error = null;
        this.showCompareSearch = false;
        this.twoWayMode = 'hitting';
        this.closeGameLog();
      }

      this.compareId = newCompareId;
      this.compareInfo = null;
      this.compareStretchData = null;
      this.compareError = null;

      if (newCompareId) {
        this.statsService.getPlayer(newCompareId).subscribe({
          next: (info) => (this.compareInfo = info),
        });
      }

      if (playerChanged || !this.playerInfo) {
        this.statsService.getPlayer(this.playerId).subscribe({
          next: (p) => {
            this.playerInfo = p;
            const isPitcher = PITCHER_POSITIONS.has(p.position);
            if (isPitcher && !PITCHING_STATS.has(this.selectedStat)) {
              this.selectedStat = 'era';
            } else if (!isPitcher && PITCHING_STATS.has(this.selectedStat)) {
              this.selectedStat = 'ops';
            }
            if (this.gamesPlayedThisSeason > 0) {
              const group = this.getPositionGroup(p.position);
              if (group === 'sp') this.stretchLength = spDefaultLength(this.gamesPlayedThisSeason);
              else if (group === 'rp') this.stretchLength = rpDefaultLength(this.gamesPlayedThisSeason);
              else this.stretchLength = hitterDefaultLength(this.gamesPlayedThisSeason);
            }
            this.loadStretches();
          },
        });
      } else {
        this.loadStretches();
      }
    });
  }

  ngOnDestroy() {
    this.chart?.destroy();
    this.routeSub?.unsubscribe();
  }

  // ── Data loading ──────────────────────────────────────────
  loadStretches() {
    this.loading = true;
    this.error = null;
    this.closeGameLog();

    const primary$ = this.statsService
      .getStretches(this.playerId, this.season, this.stretchLength, this.selectedStat)
      .pipe(catchError((err) => {
        this.error = err.error?.detail ?? 'Failed to load data. Is the backend running?';
        return of(null as StretchData | null);
      }));

    if (this.compareId) {
      const compare$ = this.statsService
        .getStretches(this.compareId, this.season, this.stretchLength, this.selectedStat)
        .pipe(catchError((err) => {
          this.compareError = err.error?.detail ?? 'No data for this season.';
          return of(null as StretchData | null);
        }));

      forkJoin([primary$, compare$]).subscribe(([p, c]) => {
        this.stretchData = p;
        this.compareStretchData = c;
        this.loading = false;
        if (p) setTimeout(() => this.renderChart(p, c), 0);
        else if (this.chart) { this.chart.destroy(); this.chart = null; }
      });
    } else {
      primary$.subscribe((p) => {
        this.stretchData = p;
        this.loading = false;
        if (p) setTimeout(() => this.renderChart(p, null), 0);
        else if (this.chart) { this.chart.destroy(); this.chart = null; }
      });
    }
  }

  // ── Comparison ────────────────────────────────────────────
  selectComparePlayer(player: PlayerSearchResult) {
    this.showCompareSearch = false;
    this.router.navigate(['/compare', this.playerId, player.id]);
  }

  removeComparePlayer() {
    this.router.navigate(['/player', this.playerId]);
  }

  // ── Game log panel ────────────────────────────────────────
  selectWindow(w: StretchWindow, data: StretchData, pi: number) {
    this.selectedWindow = w;
    this.selectedWindowPlayerIndex = pi;
    this.selectedWindowGames = [];
    this.gameLogLoading = true;

    const playerId = pi === 0 ? this.playerId : this.compareId!;
    this.statsService.getGameLog(playerId, data.season, data.stat).subscribe({
      next: (games) => {
        this.selectedWindowGames = games.slice(w.window_index, w.window_index + data.stretch_length);
        this.gameLogLoading = false;
      },
      error: () => { this.gameLogLoading = false; },
    });
  }

  closeGameLog() {
    this.selectedWindow = null;
    this.selectedWindowGames = [];
    this.gameLogLoading = false;
  }

  get selectedWindowPlayerName(): string {
    return this.selectedWindowPlayerIndex === 0
      ? (this.playerInfo?.name ?? '')
      : (this.compareInfo?.name ?? '');
  }

  get selectedWindowColor(): string {
    return PLAYER_COLORS[this.selectedWindowPlayerIndex];
  }

  // ── Computed display ─────────────────────────────────────
  isPitchingStat(stat: string): boolean {
    return PITCHING_STATS.has(stat);
  }

  seasonStatLabel(data: StretchData): string {
    const isCount = ['hr', 'rbi', 'sb', 'k', 'bb', 'er'].includes(data.stat);
    return isCount ? `${data.stat_label} per ${data.stretch_length}G avg` : data.stat_label;
  }

  streakLabel(data: StretchData): string {
    const s = data.streakiness;
    if (PITCHING_STATS.has(data.stat)) {
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
    if (PITCHING_STATS.has(data.stat)) {
      if (s < 38) return 'consistent';
      if (s < 58) return 'moderate';
      return 'streaky';
    }
    if (s < 25) return 'consistent';
    if (s < 45) return 'moderate';
    return 'streaky';
  }

  // ── Chart ─────────────────────────────────────────────────
  private fmtDate(iso: string): string {
    if (!iso) return '';
    const [, mm, dd] = iso.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[+mm - 1]} ${+dd}`;
  }

  private makeWindowMap(data: StretchData): Map<string, StretchWindow> {
    const map = new Map<string, StretchWindow>();
    const priority = (w: StretchWindow) =>
      w.window_index === data.best_index || w.window_index === data.worst_index ? 1 : 0;
    for (const w of data.windows) {
      const existing = map.get(w.end_date);
      if (!existing || priority(w) > priority(existing)) map.set(w.end_date, w);
    }
    return map;
  }

  private buildAlignedData(p1: StretchData, p2: StretchData | null) {
    if (!p2) {
      return {
        labels: p1.windows.map((w) => this.fmtDate(w.end_date)),
        datasets: [{ windows: p1.windows as (StretchWindow | null)[], data: p1 }],
      };
    }
    const allDates = Array.from(
      new Set([...p1.windows.map((w) => w.end_date), ...p2.windows.map((w) => w.end_date)])
    ).sort();
    const p1Map = this.makeWindowMap(p1);
    const p2Map = this.makeWindowMap(p2);
    return {
      labels: allDates.map((d) => this.fmtDate(d)),
      datasets: [
        { windows: allDates.map((d) => p1Map.get(d) ?? null), data: p1 },
        { windows: allDates.map((d) => p2Map.get(d) ?? null), data: p2 },
      ],
    };
  }

  private renderChart(p1: StretchData, p2: StretchData | null) {
    if (!this.chartCanvas?.nativeElement) return;
    if (this.chart) { this.chart.destroy(); this.chart = null; }

    const isCountStat = ['hr', 'rbi', 'sb', 'k', 'bb', 'er'].includes(p1.stat);
    const isPitch = PITCHING_STATS.has(p1.stat);
    const isEraStyle = ['era', 'k9'].includes(p1.stat);
    const aligned = this.buildAlignedData(p1, p2);
    const getName = (pi: number) =>
      pi === 0 ? (this.playerInfo?.name ?? 'Player 1') : (this.compareInfo?.name ?? 'Player 2');

    const allData = [p1, ...(p2 ? [p2] : [])];
    const allAligned = aligned.datasets;

    const datasets: any[] = [];

    allAligned.forEach((ds, pi) => {
      const color = PLAYER_COLORS[pi];
      const { windows: alignedWindows, data } = ds;

      const pointBg = alignedWindows.map((w) => {
        if (!w) return 'transparent';
        if (w.window_index === data.best_index) return '#f59e0b';
        if (w.window_index === data.worst_index) return '#ef4444';
        return color;
      });
      const pointR = alignedWindows.map((w) => {
        if (!w) return 0;
        return w.window_index === data.best_index || w.window_index === data.worst_index ? 7 : 0;
      });
      const pointHR = alignedWindows.map((w) => {
        if (!w) return 0;
        return w.window_index === data.best_index || w.window_index === data.worst_index ? 9 : 5;
      });

      datasets.push({
        label: getName(pi),
        data: alignedWindows.map((w) => (w ? w.value : null)),
        borderColor: color,
        backgroundColor: (() => {
          const hex = color.replace('#', '');
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          return `rgba(${r},${g},${b},0.08)`;
        })(),
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        spanGaps: isPitch,
        pointBackgroundColor: pointBg,
        pointBorderColor: pointBg,
        pointBorderWidth: 2,
        pointRadius: pointR,
        pointHoverRadius: pointHR,
      });

      const hex = color.replace('#', '');
      const cr = parseInt(hex.slice(0, 2), 16);
      const cg = parseInt(hex.slice(2, 4), 16);
      const cb = parseInt(hex.slice(4, 6), 16);
      datasets.push({
        label: `${getName(pi)} avg`,
        data: alignedWindows.map(() => data.season_value),
        borderColor: `rgba(${cr},${cg},${cb},0.3)`,
        borderDash: [5, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0,
        spanGaps: true,
      });
    });

    const ctx = this.chartCanvas.nativeElement.getContext('2d')!;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: { labels: aligned.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onClick: (_, elements) => {
          if (!elements.length) {
            this.closeGameLog();
            return;
          }
          const el = elements[0];
          const pi = Math.floor(el.datasetIndex / 2);
          const w = allAligned[pi]?.windows[el.index];
          if (w) this.selectWindow(w, allData[pi], pi);
        },
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
                for (const item of items) {
                  const pi = Math.floor(item.datasetIndex / 2);
                  const w = allAligned[pi]?.windows[item.dataIndex];
                  if (w) return `${this.fmtDate(w.start_date)} – ${this.fmtDate(w.end_date)}`;
                }
                return '';
              },
              label: (item) => {
                if (item.raw === null || item.datasetIndex % 2 !== 0) return '';
                const pi = item.datasetIndex / 2;
                const w = allAligned[pi]?.windows[item.dataIndex];
                if (!w) return '';
                const val = isCountStat
                  ? String(Math.round(item.raw as number))
                  : (item.raw as number).toFixed(isEraStyle ? 2 : 3);
                const data = allData[pi];
                const badge =
                  w.window_index === data.best_index ? ' 🏆'
                  : w.window_index === data.worst_index ? ' 📉'
                  : '';
                return ` ${getName(pi)}: ${val}${badge}`;
              },
              afterLabel: (item) => {
                if (item.raw === null || item.datasetIndex % 2 !== 0) return [];
                const pi = item.datasetIndex / 2;
                const w = allAligned[pi]?.windows[item.dataIndex];
                if (!w) return [];
                if (isPitch) {
                  return [
                    ` Games ${w.start_game}–${w.end_game}`,
                    ` ${w.k}K  ${w.bb}BB  ${w.er}ER  ${w.ip_display ?? ''}IP`,
                    ` Click to see game log`,
                  ];
                }
                return [
                  ` Games ${w.start_game}–${w.end_game}`,
                  ` ${w.hits}H  ${w.bb}BB  ${w.hr}HR  ${w.rbi}RBI  ${w.sb}SB`,
                  ` Click to see game log`,
                ];
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
