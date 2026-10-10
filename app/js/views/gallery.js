// The Behind-the-scenes gallery is hidden (nav, footer, home rail, Account shortcuts, sitemap and the CMS
// entry are all gone). This module stays so that old links, bookmarks and links Google already knows about
// land somewhere sensible instead of on "Scene not found": it sends the viewer home. The photos themselves
// are still in the catalog (data.gallery) and the lightbox lives on — it now powers the poster popup.
import { go } from '../router.js';

export default async function gallery() {
  go('/', { replace: true });
}
