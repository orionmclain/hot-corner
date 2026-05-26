import { Component, EventEmitter, HostListener, Input, OnDestroy, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StatsService, PlayerSearchResult } from '../../core/services/stats.service';

@Component({
  selector: 'app-search-bar',
  imports: [FormsModule],
  templateUrl: './search-bar.html',
  styleUrl: './search-bar.css',
  host: { '[class.lg]': 'size === "lg"' },
})
export class SearchBar implements OnDestroy {
  private statsService = inject(StatsService);

  @Input() placeholder = 'Search for a player...';
  @Input() size: 'sm' | 'lg' = 'sm';
  @Input() excludeId?: number;
  @Input() positionFilter?: (p: PlayerSearchResult) => boolean;

  @Output() playerSelected = new EventEmitter<PlayerSearchResult>();

  searchTerm = '';
  results: PlayerSearchResult[] = [];
  dropdownOpen = false;
  loading = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('app-search-bar')) {
      this.dropdownOpen = false;
    }
  }

  onInput() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = this.searchTerm.trim();
    if (q.length < 2) {
      this.results = [];
      this.dropdownOpen = false;
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.loading = true;
      this.statsService.searchPlayers(q).subscribe({
        next: (r) => {
          let filtered = r;
          if (this.excludeId != null) filtered = filtered.filter(p => p.id !== this.excludeId);
          if (this.positionFilter) filtered = filtered.filter(this.positionFilter);
          this.results = filtered;
          this.dropdownOpen = filtered.length > 0;
          this.loading = false;
        },
        error: () => {
          this.results = [];
          this.loading = false;
        },
      });
    }, 300);
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && this.results.length > 0) this.select(this.results[0]);
    if (event.key === 'Escape') this.dropdownOpen = false;
  }

  select(player: PlayerSearchResult) {
    this.playerSelected.emit(player);
    this.searchTerm = '';
    this.results = [];
    this.dropdownOpen = false;
  }

  setQuery(q: string) {
    this.searchTerm = q;
    this.onInput();
  }

  clear() {
    this.searchTerm = '';
    this.results = [];
    this.dropdownOpen = false;
  }

  ngOnDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }
}
