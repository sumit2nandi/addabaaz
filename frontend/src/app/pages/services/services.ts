import { Component } from '@angular/core';

import { SERVICES } from '../../core/data/site.data';

@Component({
  selector: 'app-services',
  templateUrl: './services.html',
  styleUrl: './services.scss',
})
export class Services {
  readonly services = SERVICES;
}
