import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ContentService } from '../../core/services/content.service';
import { HeroBanner } from '../../shared/hero-banner/hero-banner';
import { MediaRail } from '../../shared/media-rail/media-rail';
import { PromoCard } from '../../shared/promo-card/promo-card';
import { PosterCard } from '../../shared/poster-card/poster-card';
import { ShowCard } from '../../shared/show-card/show-card';

@Component({
  selector: 'app-home',
  imports: [RouterLink, HeroBanner, MediaRail, ShowCard, PromoCard, PosterCard],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly content = inject(ContentService);

  readonly shows = this.content.rankedShows;
  readonly promoRows = this.content.promoRows;
  readonly upcoming = this.content.upcomingHome;
  readonly behindTheScenes = this.content.behindTheScenesHome;
  readonly featuredUpcoming = this.content.featuredUpcoming;
  readonly upcomingFolder = this.content.upcomingFolder;
  readonly btsFolder = this.content.btsFolder;
}
