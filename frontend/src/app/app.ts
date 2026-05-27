import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header],
  template: `
    <app-header />
    <main>
      <router-outlet />
    </main>
    <footer>
      Hot Corner is an unofficial fan site not affiliated with or endorsed by Major League Baseball.
      Stats sourced from the MLB Stats API.
    </footer>
  `,
  styles: [`
    main {
      min-height: calc(100vh - 56px);
    }
    footer {
      text-align: center;
      padding: 20px 24px;
      font-size: 11px;
      color: #4b5563;
      border-top: 1px solid #1f2937;
    }
  `],
})
export class App {}
