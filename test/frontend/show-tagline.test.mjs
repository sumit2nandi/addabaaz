// Show poster cards are artwork-only: the tagline text that used to sit under each poster on the
// home Shows rail (and everywhere else show cards appear) is gone. The tagline still feeds SEO and
// the show page; it just no longer renders on cards.
// Run: node --test test/frontend/show-tagline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

test('show cards render no tagline text below the poster', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};
  const { app } = await import('../../app/js/app.js');
  app.user = { inList: () => false };
  const { showCard } = await import('../../app/js/ui/components.js');

  const root = document.createElement('div');
  root.innerHTML = showCard({ id: 'tagline-show', title: 'Show title', poster: 'media/show.webp', tagline: 'A Bengali show tagline' }).s;
  const card = root.querySelector('.card-poster');
  assert.ok(card.querySelector('.poster'), 'the poster stays');
  assert.equal(card.querySelector('.show-card-tagline'), null, 'no tagline text under the poster');
  assert.equal(card.textContent.includes('A Bengali show tagline'), false, 'the tagline string appears nowhere on the card');
  assert.ok(card.getAttribute('aria-label').includes('Show title'), 'the title remains available to screen readers');
});

test('the show-card tagline CSS rule is removed too', () => {
  const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');
  assert.equal(css.includes('.show-card-tagline'), false, 'dead tagline styles are gone');
});
