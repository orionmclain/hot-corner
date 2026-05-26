import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Player } from './pages/player/player';
import { Team } from './pages/team/team';
import { Leaderboard } from './pages/leaderboard/leaderboard';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'player/:id', component: Player },
  { path: 'compare/:id1/:id2', component: Player },
  { path: 'team/:id', component: Team },
  { path: 'leaderboard', component: Leaderboard },
  { path: '**', redirectTo: '' },
];
