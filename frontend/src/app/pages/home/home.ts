import { Component, OnInit, ViewChild, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SearchBar } from '../../components/search-bar/search-bar';
import { StatsService, PlayerSearchResult, TeamInfo } from '../../core/services/stats.service';

@Component({
  selector: 'app-home',
  imports: [SearchBar, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  private router = inject(Router);
  private statsService = inject(StatsService);

  @ViewChild(SearchBar) searchBar!: SearchBar;

  teams: TeamInfo[] = [];

  ngOnInit() {
    this.statsService.getTeams().subscribe({
      next: (teams) => (this.teams = teams),
    });
  }

  onSelectPlayer(player: PlayerSearchResult) {
    this.router.navigate(['/player', player.id]);
  }

  triggerHint(name: string) {
    this.searchBar.setQuery(name);
  }
}
