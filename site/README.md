# Yuxuan Liu’s website

The selected minimalist website is served at https://yuxuanliu.me/ through the repository’s existing GitHub Pages deployment.

## Edit and preview

From the repository root, run `python3 site/scripts/build.py --source .` to rebuild this website. Run `python3 -m http.server 4174 --bind 127.0.0.1 --directory site` to preview it.

- Biography, news, social links, and publication title overrides: `site/content-overrides.json`.
- Publications and abstracts: `_bibliography/papers.bib`.
- Layout: `site/scripts/build.py` and `site/styles.css`.
- CV: edit `_cv/cv.tex`, run `tectonic cv.tex` in `_cv`, then rebuild the site.
- GAM’s supplied demo PDF: `site/assets/papers/gam-uist-2026.pdf`.
- Official icon sources: `site/assets/icons/SOURCES.md`.

The static HTML works without JavaScript. `motion.js` adds the WorldScribe animation, keyboard pause/play, and reduced-motion support. PDF links have explicit format hints for screen readers. The favicon preserves the original ☰ symbol.

## Deployment

Push to `master` to run the existing Deploy site workflow. Jekyll first builds the existing pages and assets, preserving their URLs, including the unlisted GAM walkthrough. The workflow then builds this site and overlays its homepage, assets, accessible 404 page, and redirects from `/publications/` and `/news/`. `site/` is excluded from Jekyll’s output. The custom domain stays `yuxuanliu.me`.

The page is independently implemented with visual inspiration from https://www.yuchenzh.com/; that site’s source code was not reused.

## Accessibility checks

In `site`, run `npm ci`, then `npm test` with the preview running. Set `SITE_URL` to check a staging or production URL. On macOS the checks use installed Chrome; on other systems run `npx playwright install chromium`. `CHROME_PATH` can override the executable. Reports and desktop/mobile screenshots are written to ignored `site/test-results/`.

The checks cover keyboard traversal, focus, landmarks, contextual link names, image alternatives, native disclosure states, reduced motion, forced colors, responsive reflow, 200% text, no-JavaScript behavior, PDF loading, and four axe WCAG scans. They inspect Chromium’s accessibility tree; actual VoiceOver/NVDA speech and the PDFs’ internal tagging are outside these automated checks.
