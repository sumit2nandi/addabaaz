// The watch page must not add a second topbar offset. `#view` already pads every non-hero route
// below the fixed topbar (`padding-top: calc(var(--topbar-h) + var(--sat))`); the watch page used to
// add the SAME padding again on `.watch`, doubling the offset - a blank black band between the
// topbar and the player (reported from the app with a screenshot). Exactly one source of that
// offset may exist.
// Run: node --test test/frontend/watch-top-offset.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../app/css/styles.css', import.meta.url), 'utf8');

test('the topbar offset is applied exactly once, so no blank band sits above the player', () => {
  const offsets = css.match(/padding-top: calc\(var\(--topbar-h\)/g) || [];
  assert.equal(offsets.length, 1, 'only #view may pad below the fixed topbar');
  assert.match(css, /body:not\(\[data-route="home"\]\):not\(\[data-route="show"\]\):not\(\[data-route="soon"\]\) #view \{ padding-top: calc\(var\(--topbar-h\) \+ var\(--sat\)\); \}/,
    'the single offset comes from #view for every normal route (watch included)');
  assert.doesNotMatch(css, /\.watch \{[^}]*padding-top/,
    'the watch page must not repeat the offset (that was the blank space above the video)');
});

test('the watch route really is a normal (padded) route, not one of the hero routes', () => {
  const rule = css.match(/body:not\(\[data-route="home"\]\):not\(\[data-route="show"\]\):not\(\[data-route="soon"\]\) #view/);
  assert.ok(rule, 'the padding rule exists');
  assert.doesNotMatch(rule[0], /watch/, 'watch is not excluded, so the single #view offset applies to it');
  // And the route name the shell writes for /watch/<id> matches what the selector expects.
  const shell = fs.readFileSync(new URL('../../app/js/ui/shell.js', import.meta.url), 'utf8');
  assert.match(shell, /dataset\.route = path\.split\('\/'\)\[1\] \|\| 'home'/, '/watch/x becomes data-route="watch"');
});
