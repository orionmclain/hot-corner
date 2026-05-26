import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { StatsService, RosterPlayer, TeamInfo, TeamPageState } from '../../core/services/stats.service';

const POSITION_ORDER: Record<string, number> = {
  SP: 0, RP: 1, CP: 1, CL: 1, P: 1,
  C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6,
  LF: 7, CF: 8, RF: 9, OF: 9, DH: 10,
};

@Component({
  selector: 'app-team',
  imports: [FormsModule],
  templateUrl: './team.html',
  styleUrl: './team.css',
})
export class Team implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private statsService = inject(StatsService);

  teamId = 0;
  team: TeamInfo | null = null;
  players: RosterPlayer[] = [];
  loading = true;
  hotColdLoading = true;
  error: string | null = null;

  // Per-section controls (restored from service state on init)
  hitterStat = 'ops';  hitterLength = 10;
  spStat     = 'era';  spLength     = 5;
  rpStat     = 'whip'; rpLength     = 10;

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
    // Restore controls from service state
    ({ hitterStat: this.hitterStat, hitterLength: this.hitterLength,
       spStat: this.spStat, spLength: this.spLength,
       rpStat: this.rpStat, rpLength: this.rpLength } = this.state);

    this.route.paramMap.subscribe((params) => {
      this.teamId = Number(params.get('id'));
      this.loadRoster();
    });
  }

  private loadRoster() {
    this.loading = true;
    this.hotColdLoading = true;
    this.error = null;

    this.statsService.getTeams().subscribe({
      next: (teams) => { this.team = teams.find((t) => t.id === this.teamId) ?? null; },
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
}
