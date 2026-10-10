import { html } from '../util.js';
import { icon } from '../icons.js';
import { back } from '../router.js';

// Delegate on the view root so redraws retain one handler, removed on navigation.
export function pageBack(ctx, fallback = '/') {
  const onBack = (event) => {
    if (event.target.closest('[data-page-back]')) back(fallback);
  };
  ctx.root.addEventListener('click', onBack);
  ctx.onCleanup(() => ctx.root.removeEventListener('click', onBack));
  return html`<button type="button" class="page-back" data-page-back aria-label="Back to previous page">${icon('left', { size: 28 })}</button>`;
}
