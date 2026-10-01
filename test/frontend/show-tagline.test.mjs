import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

test('show poster cards place the tagline immediately below the poster', async () => {
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
  const poster = card.querySelector('.poster');
  const tagline = card.querySelector('.show-card-tagline');
  assert.ok(poster);
  assert.ok(tagline?.classList.contains('bn'));
  assert.equal([...card.children].indexOf(tagline), [...card.children].indexOf(poster) + 1);
});
