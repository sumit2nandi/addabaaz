/* URL style. On the website served by the ADDABAAZ server, pages have real, crawlable URLs (/show/shahid) — the server says so
 * with <meta name="ab:routing" content="history">. Static hosting and the native apps have no such server, so they keep
 * hash URLs (#/show/shahid). Old hash links keep working on the website (see main.js). */
const native = typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform?.());
export const HISTORY = typeof document !== 'undefined' && !native && document.querySelector('meta[name="ab:routing"]')?.content === 'history';
/** '/show/x' → the href to put in a link for the current URL style. */
export const toHref = (path) => (HISTORY ? path : '#' + path);
