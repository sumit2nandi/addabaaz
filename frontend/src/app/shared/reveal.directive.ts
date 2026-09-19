import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Adds `in-view` once the element scrolls into view.
 * Replaces the old `setupRowAnimations()` IntersectionObserver pass — the
 * `.animate-row` fade-up transition lives in the global stylesheet.
 */
@Directive({
  selector: '[appReveal]',
})
export class RevealDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;

      if (!('IntersectionObserver' in window)) {
        element.classList.add('in-view');
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              element.classList.add('in-view');
              observer.disconnect();
            }
          }
        },
        { threshold: 0.06, rootMargin: '0px 0px -60px 0px' },
      );

      observer.observe(element);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
