import { html } from '../util.js';
import { legalDoc, LEGAL_PAGES, LEGAL_UPDATED } from '../legal-text.js';
import { fmtDate } from '../util.js';
import { studioData } from './studio.js';
import { sectionHeader } from '../ui/components.js';

/** /privacy · /terms · /refunds */
export default async function legal(ctx) {
  const studio = await studioData().catch(() => ({}));
  const d = legalDoc(LEGAL_PAGES[ctx.path], { studio: studio?.studio });
  ctx.setTitle(d.title);
  ctx.root.innerHTML = html`<article class="page page-narrow legal">
    ${sectionHeader({ tag: 'Legal', title: d.title, subtitle: `Last updated ${fmtDate(LEGAL_UPDATED)}` })}
    <p class="lead">${d.intro}</p>
    ${d.sections.map(([h, ps]) => html`<section><h2>${h}</h2>${ps.map((t) => html`<p>${t}</p>`)}</section>`)}
    <p class="muted legal-links"><a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a> · <a href="#/refunds">Refunds</a> · <a href="#/contact">Contact</a></p>
  </article>`.s;
}
