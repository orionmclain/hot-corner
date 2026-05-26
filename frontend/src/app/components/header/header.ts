import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SearchBar } from '../search-bar/search-bar';
import { PlayerSearchResult, StatsService } from '../../core/services/stats.service';

@Component({
  selector: 'app-header',
  imports: [RouterLink, SearchBar],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header implements OnInit {
  private router = inject(Router);
  private statsService = inject(StatsService);

  showSearch = false;

  ngOnInit() {
    const check = (url: string) =>
      url.startsWith('/player/') || url.startsWith('/compare/') ||
      url.startsWith('/team/') || url === '/leaderboard';

    this.showSearch = check(this.router.url);

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.showSearch = check(e.urlAfterRedirects);
      });
  }

  onSelectPlayer(player: PlayerSearchResult) {
    this.router.navigate(['/player', player.id]);
  }

  goToTeams() {
    this.statsService.leaderboardPageState.view = 'teams';
    this.statsService.leaderboardPageState.teamData = null;
    this.router.navigate(['/leaderboard']);
  }
}
