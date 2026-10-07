import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { accountGroup, wireAccountAccordion } from '../../app/js/ui/account-accordion.js';
import { html } from '../../app/js/util.js';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('four inline settings expand accessibly and wire only once across repeated toggles', () => {
  for (const id of ['playback', 'security', 'kids', 'notify']) {
    const { document } = parseHTML(accountGroup({ id, title: id, sub: 'Details', ic: 'user' }).s);
    let rendered = 0, wired = 0;
    wireAccountAccordion(document, () => { rendered++; return html`<input value="saved">`; }, () => wired++, {});
    const button = document.querySelector('button'), panel = document.querySelector('[role=region]');
    assert.equal(button.getAttribute('aria-controls'), panel.id);
    assert.ok(panel.hasAttribute('inert'));
    button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.hasAttribute('inert'), false);
    document.querySelector('input').value = 'changed';
    button.click();
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.ok(panel.hasAttribute('inert'));
    button.click();
    assert.equal(rendered, 1); assert.equal(wired, 1);
    assert.equal(document.querySelector('input').value, 'changed');
  }
});

test('referral/support remain links; order, back links and privacy integration match the new layout', () => {
  for (const id of ['refer', 'help']) {
    const { document } = parseHTML(accountGroup({ id, title: id, ic: 'user', href: '#/destination' }).s);
    assert.equal(document.querySelector('a').getAttribute('href'), '#/destination');
    assert.equal(document.querySelector('button'), null);
  }
  const extra = read('app/js/views/account-extra.js');
  assert.ok(extra.indexOf("['notify',") < extra.indexOf("['refer',"));
  assert.match(extra, /\['kids', 'Parental Control'/);
  assert.match(read('app/js/views/support.js'), /class="back-link" href="#\/account"/);
  assert.doesNotMatch(read('index.html'), /data-consent-open/);
  assert.match(read('app/js/views/legal.js'), /ctx.path === '\/privacy' \? privacyChoices\(\)/);
  assert.match(read('app/js/views/legal.js'), /wirePrivacyChoices\(ctx.root\)/);
  assert.match(read('app/css/styles.css'), /prefers-reduced-motion: reduce\) \{\s*\.accordion-panel/);
});
