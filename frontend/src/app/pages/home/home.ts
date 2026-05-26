import { Component, OnInit, ViewChild, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { SearchBar } from '../../components/search-bar/search-bar';
import {
  StatsService, PlayerSearchResult,
  LeaderboardPlayer, TeamLeaderboardEntry,
} from '../../core/services/stats.service';

@Component({
  selector: 'app-home',
  imports: [SearchBar, RouterLink, FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  private router = inject(Router);
  private statsService = inject(StatsService);

  @ViewChild(SearchBar) searchBar!: SearchBar;

  readonly season = new Date().getFullYear();
  stretchLength = 5;
  loading = false;

  topHitters:  LeaderboardPlayer[]    = [];
  topPitchers: LeaderboardPlayer[]    = [];
  topTeamsOps: TeamLeaderboardEntry[] = [];
  topTeamsEra: TeamLeaderboardEntry[] = [];

  ngOnInit() { this.loadPreviews(); }

  loadPreviews() {
    this.loading = true;
    forkJoin({
      hitters:  this.statsService.getLeaderboard('ops', this.stretchLength, this.season),
      pitchers: this.statsService.getLeaderboard('era', this.stretchLength, this.season, 'sp'),
      teamsOps: this.statsService.getTeamLeaderboard('ops', this.stretchLength, this.season),
      teamsEra: this.statsService.getTeamLeaderboard('era', this.stretchLength, this.season),
    }).subscribe({
      next: ({ hitters, pitchers, teamsOps, teamsEra }) => {
        this.topHitters  = hitters.players.slice(0, 5);
        this.topPitchers = pitchers.players.slice(0, 5);
        this.topTeamsOps = teamsOps.entries.slice(0, 5);
        this.topTeamsEra = teamsEra.entries.slice(0, 5);
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  onSelectPlayer(player: PlayerSearchResult) {
    this.router.navigate(['/player', player.id]);
  }

  triggerHint(name: string) { this.searchBar.setQuery(name); }

  goToLeaderboard(stat: string, view: 'players' | 'teams', pitcherType?: 'sp' | 'rp') {
    const s = this.statsService.leaderboardPageState;
    s.view         = view;
    s.selectedStat = stat;
    s.stretchLength = this.stretchLength;
    s.data          = null;
    s.teamData      = null;
    if (pitcherType) s.pitcherType = pitcherType;
    this.router.navigate(['/leaderboard']);
  }

  hcClass(hc: string): string {
    return 'hc-dot ' + hc.replace('_', '-');
  }
}
