import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const variant = new URL('../', import.meta.url);
const artifacts = new URL('../test-results/', import.meta.url);
await mkdir(artifacts, {recursive:true});
const url = process.env.SITE_URL || 'http://127.0.0.1:4174/';
const content = JSON.parse(await readFile(new URL('content.json', variant), 'utf8'));
const stripFrontmatter = (text) => text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim();
const plainMarkdown = (text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const report = { testedAt: new Date().toISOString(), url, checks: [], axe: [], measurements: [], limitations: [
  'Automated Chromium accessibility tree and keyboard checks; no manual VoiceOver/NVDA session.',
  'External websites/videos and the internal accessibility of PDF documents are outside this audit.'
] };
async function check(name, action) {
  try { await action(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function axe(page, name) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  report.axe.push({ name, passedRules: result.passes.length, manualReviewRuleIds: result.incomplete.map(({ id }) => id), violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })) });
  assert.equal(result.violations.length, 0, JSON.stringify(report.axe.at(-1).violations));
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  assert.ok(sizes.scroll <= sizes.viewport + 1, JSON.stringify(sizes));
}

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : process.platform==='darwin' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(request.url()));
  await page.goto(url, { waitUntil: 'networkidle' });
  const ax = await context.newCDPSession(page);
  async function disclosureState(title) {
    const { nodes } = await ax.send('Accessibility.getFullAXTree');
    const node = nodes.find((node) => node.role?.value === 'DisclosureTriangle' && node.name?.value === `Abstract for ${title}`);
    assert.ok(node, `Disclosure accessible name missing: ${title}`);
    assert.equal(node.properties.find(({ name }) => name === 'focusable')?.value.value, true);
    return node.properties.find(({ name }) => name === 'expanded')?.value.value;
  }

  await check('Semantic structure, image alternatives and decorative award icon', async () => {
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.getByRole('main').count(), 1);
    assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).count(), 1);
    assert.deepEqual(await page.locator('h1,h2,h3,h4,h5,h6').evaluateAll((items) => items.map((item) => item.tagName)), ['H1', 'H2', 'H2', 'H3', 'H3', 'H3', 'H3']);
    assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), content.name);
    assert.equal(await page.getByRole('img').count(), 5);
    for (const image of [content.portrait, ...content.publications.map(({ image }) => image)]) assert.equal(await page.getByRole('img', { name: image.alt, exact: true }).count(), 1);
    const award = page.locator('.award');
    assert.equal((await award.innerText()).trim(), 'Best Paper Award');
    assert.equal(await award.locator('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(await award.locator('svg').getAttribute('focusable'), 'false');
  });
  await check('Rendered prose, news, full abstracts, authors and contextual resource links match content', async () => {
    assert.deepEqual(await page.locator('.bio p').allTextContents(), content.biography.map(plainMarkdown));
    assert.deepEqual(await page.locator('.news-copy').allTextContents(), content.news.map(({ text }) => plainMarkdown(text)));
    assert.deepEqual(await page.locator('.news-date').evaluateAll((dates) => dates.map((date) => date.getAttribute('datetime'))), content.news.map(({ date }) => date));
    for (const paper of content.publications) {
      const article = page.getByRole('article', { name: paper.title, exact: true });
      assert.equal(await article.count(), 1);
      assert.equal(await article.locator('h3').textContent(), paper.title);
      assert.equal(await article.locator('h3 a').getAttribute('aria-describedby'), 'pdf-format-description');
      assert.equal(await article.locator('.abstract-text').textContent(), paper.abstract);
      assert.equal(await article.locator('.venue').textContent(), paper.venue);
      assert.equal(await article.locator('.authors').textContent(), `${paper.authors.slice(0, -1).join(', ')}, and ${paper.authors.at(-1)}`);
      for (const resource of paper.resources) assert.equal(await article.getByRole('link', { name: `${resource.label} for ${paper.title}${["Paper", "Demo Abstract"].includes(resource.label) ? " (PDF)" : ""}`, exact: true }).getAttribute('href'), resource.href);
    }
    for (const link of content.profile_links) assert.equal(await page.getByRole('link', { name: link.label, exact: true }).getAttribute('href'), link.href);
  });
  await check('Desktop WCAG scan with abstracts collapsed', () => axe(page, 'desktop-collapsed'));
  await check('Skip link is first in keyboard order and focuses main', async () => {
    await page.goto(url);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'Skip to main content');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'main');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'Michigan CSE');
  });
  await check('All navigation anchors transfer focus to their section', async () => {
    for (const [name, id] of [['About', 'about'], ['News', 'news'], ['Publications', 'publications']]) {
      await page.getByRole('navigation').getByRole('link', { name, exact: true }).focus();
      await page.keyboard.press('Enter');
      assert.equal(new URL(page.url()).hash, `#${id}`);
      assert.equal(await page.locator(':focus').getAttribute('id'), id);
    }
  });
  await check('All four native abstracts support Enter/Space and expose expanded state', async () => {
    for (const paper of content.publications) {
      const article = page.getByRole('article', { name: paper.title, exact: true });
      const summary = article.locator('summary');
      await summary.focus();
      assert.equal(await disclosureState(paper.title), false);
      await page.keyboard.press('Enter');
      assert.equal(await disclosureState(paper.title), true);
      assert.ok(await article.locator('.abstract-text').isVisible());
      await page.keyboard.press('Space');
      assert.equal(await disclosureState(paper.title), false);
      assert.ok(await summary.evaluate((element) => document.activeElement === element));
      await page.keyboard.press('Enter');
    }
  });
  await check('Desktop WCAG scan with abstracts expanded', () => axe(page, 'desktop-expanded'));
  await page.locator('details').evaluateAll((items) => items.forEach((item) => { item.open = false; }));
  await check('Every figure link opens its full image with keyboard Enter', async () => {
    for (const paper of content.publications) {
      await page.goto(url);
      const link = page.getByRole('link', { name: `View full figure for ${paper.title}`, exact: true });
      const expectedSrc = paper.id === 'worldscribe' ? 'assets/images/worldscribe-poster.png' : paper.image.src;
      assert.equal(new URL(await link.getAttribute('href'), url).href, new URL(expectedSrc, url).href);
      await link.focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(new URL(expectedSrc, url).href);
      assert.equal(new URL(page.url()).href, new URL(expectedSrc, url).href);
      assert.equal(await page.locator('img').count(), 1);
      await page.locator('img').evaluate((image) => image.decode());
    }
    await page.goto(url, { waitUntil: 'networkidle' });
  });

  for (const width of [320, 390, 768, 1440]) {
    await check(`Reflow and equal figure frames at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1100 });
      await noOverflow(page);
      const frames = await page.locator('.paper-image').evaluateAll((images) => images.map((image) => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, fit: getComputedStyle(image).objectFit })));
      report.measurements.push({ width, frames });
      assert.equal(frames.length, 4);
      assert.ok(frames.every((frame) => Math.abs(frame.width - frames[0].width) < 1 && Math.abs(frame.height - frames[0].height) < 1 && ['contain', 'cover'].includes(frame.fit)));
      await page.locator('details').evaluateAll((items) => items.forEach((item) => { item.open = true; }));
      await noOverflow(page);
      await page.locator('details').evaluateAll((items) => items.forEach((item) => { item.open = false; }));
    });
  }
  await check('200% enlarged text reflows at 1280px', async () => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    const style = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    try { await noOverflow(page); } finally { await style.evaluate((element) => element.remove()); }
  });
  await check('WCAG text-spacing overrides reflow on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const style = await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
    try { await noOverflow(page); } finally { await style.evaluate((element) => element.remove()); }
  });
  await check('Mobile WCAG scan with abstracts collapsed', () => axe(page, 'mobile-collapsed'));
  await page.locator('details').evaluateAll((items) => items.forEach((item) => { item.open = true; }));
  await check('Mobile WCAG scan with abstracts expanded', () => axe(page, 'mobile-expanded'));
  await page.locator('details').evaluateAll((items) => items.forEach((item) => { item.open = false; }));
  await check('All images and four paper PDFs load without browser errors', async () => {
    const images = await page.locator('img').evaluateAll(async (items) => Promise.all(items.map(async (image) => { image.loading = 'eager'; await image.decode(); return image.naturalWidth; })));
    assert.equal(images.length, 8);
    assert.ok(images.every((width) => width > 0));
    const pdfs = content.publications.flatMap(({ resources }) => resources.filter(({ label }) => ['Paper', 'Demo Abstract'].includes(label)));
    assert.equal(pdfs.length, 4);
    for (const pdf of pdfs) {
      const response = await context.request.get(new URL(pdf.href, url).href);
      assert.equal(response.status(), 200);
      assert.equal((await response.body()).subarray(0, 5).toString(), '%PDF-');
    }
    assert.deepEqual(errors, []);
  });
  await check('Native reading, summaries and navigation work without JavaScript', async () => {
    const noJSContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    try {
      const noJS = await noJSContext.newPage();
      await noJS.goto(url);
      assert.equal(await noJS.getByRole('heading', { level: 1 }).textContent(), content.name);
      const staticFigure = noJS.locator('#worldscribe-animation');
      assert.match(await staticFigure.getAttribute('src'), /poster\.png$/);
      assert.match(await staticFigure.locator('..').getAttribute('href'), /poster\.png$/);
      assert.equal(await noJS.locator('.motion-toggle').count(), 0);
      await noJS.getByRole('navigation').getByRole('link', { name: 'Publications', exact: true }).focus();
      await noJS.keyboard.press('Enter');
      assert.equal(await noJS.locator(':focus').getAttribute('id'), 'publications');
      for (const paper of content.publications) {
        const article = noJS.getByRole('article', { name: paper.title, exact: true });
        await article.locator('summary').focus();
        await noJS.keyboard.press('Enter');
        assert.ok(await article.locator('.abstract-text').isVisible());
        await noJS.keyboard.press('Space');
        assert.equal(await article.locator('details').getAttribute('open'), null);
      }
      await noOverflow(noJS);
    } finally { await noJSContext.close(); }
  });
  await check('Tab and Shift+Tab reach every control with visible focus and no trap', async () => {
    await page.goto(url);
    const expected = await page.locator('a[href],button:not([hidden]),summary').count();
    const visited = new Set();
    for (let i = 0; i < expected; i++) {
      await page.keyboard.press('Tab');
      const info = await page.locator(':focus').evaluate(el => {
        const style=getComputedStyle(el), r=el.getBoundingClientRect();
        return {index:[...document.querySelectorAll('a[href],button:not([hidden]),summary')].indexOf(el), outline:parseFloat(style.outlineWidth), top:r.top,bottom:r.bottom};
      });
      assert.ok(info.index >= 0); assert.ok(!visited.has(info.index)); visited.add(info.index);
      assert.ok(info.outline >= 2); assert.ok(info.bottom > 0 && info.top < 844);
    }
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.locator(':focus').count());
    assert.equal(await page.locator('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').count(),0);
  });
  await check('Animation autoplays without a button and honors reduced-motion changes', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(url);
    const image=page.locator('#worldscribe-animation');
    assert.equal(await page.locator('.motion-toggle').count(), 0);
    assert.match(await image.getAttribute('src'), /webp$/);
    assert.match(await image.locator('..').getAttribute('href'), /webp$/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#worldscribe-animation').src.endsWith('poster.png'));
    assert.match(await image.locator('..').getAttribute('href'), /poster\.png$/);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('#worldscribe-animation').src.endsWith('.webp'));
    assert.match(await image.locator('..').getAttribute('href'), /webp$/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#worldscribe-animation').src.endsWith('poster.png'));
  });
  await check('CV navigation opens live HTML and the original PDF URL stays available', async () => {
    const link=page.getByRole('link',{name:'CV',exact:true});
    const cvURL=new URL(await link.getAttribute('href'),url).href;
    const cv=await context.newPage();
    try {
      const response=await cv.goto(cvURL);
      assert.equal(response.status(),200);
      assert.match(response.headers()['content-type'],/text\/html/);
      assert.equal(await cv.getByRole('main').count(),1);
      assert.equal(await cv.getByRole('heading',{level:1}).count(),1);
      const pdf=await context.request.get(new URL('assets/documents/yuxuan-liu-cv.pdf',url).href);
      assert.equal(pdf.status(),200);
      const pdfBytes=await pdf.body();
      assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');
      assert.equal(digest(pdfBytes),digest(await readFile(new URL('../_cv/cv.pdf',variant))));
    } finally { await cv.close(); }
  });
  const cv = await context.newPage();
  try {
    await cv.goto(new URL('cv/', url).href, { waitUntil: 'networkidle' });
    await cv.evaluate(() => document.fonts.ready);
    await check('HTML CV source headings, links, original text and keyboard skip link', async () => {
      const sourceTex=(await readFile(new URL('../_cv/cv.tex',variant),'utf8')).replace(/(?<!\\)%[^\n]*/g,'');
      const sourceHeadings=[...sourceTex.matchAll(/\\section\{([^}]+)\}/g)].map(match=>match[1]);
      const sourceLinks=[...sourceTex.matchAll(/\\href\{([^}]+)\}/g)].map(match=>match[1]);
      assert.equal(await cv.locator('h1').count(), 1);
      assert.equal(await cv.locator('h2').count(), 9);
      assert.equal(await cv.locator('h3').count(), 3);
      assert.deepEqual(await cv.locator('h2').allTextContents(),sourceHeadings);
      assert.deepEqual(await cv.locator('main a[href]').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),sourceLinks);
      assert.equal(await cv.getByRole('heading',{level:2,name:'Service',exact:true}).count(),1);
      assert.equal(await cv.getByRole('heading',{level:2,name:'Press Coverage',exact:true}).getAttribute('id'),'press-coverage');
      assert.equal(await cv.getByRole('heading',{level:3,name:'Reviewer',exact:true}).count(),1);
      assert.equal(await cv.locator('main img, main canvas, iframe, object, embed').count(),0);
      assert.ok((await cv.locator('main').textContent()).includes('UIST 2027 Student Volunteer (Program Committee Meeting)'));
      assert.ok(!(await cv.locator('main').textContent()).includes('(To Appear)'));
      const awardText=await cv.locator('.cv-section[aria-labelledby="awards-and-honors"]').textContent();
      assert.ok(awardText.includes('CSE Departmental Fellowship'));
      assert.ok(!awardText.includes('CSE First-Year Ph.D. Departmental Fellowship'));
      for(const section of await cv.locator('.cv-section').all()) {
        assert.equal(await section.getAttribute('aria-labelledby'),await section.locator('h2').getAttribute('id'));
      }
      await cv.keyboard.press('Tab');
      assert.equal(await cv.locator(':focus').textContent(),'Skip to curriculum vitae');
      await cv.keyboard.press('Enter');
      assert.equal(await cv.locator(':focus').getAttribute('id'),'cv-content');
      await cv.keyboard.press('Tab');
      assert.ok(await cv.locator('main a').first().evaluate(el=>el===document.activeElement));
    });
    await check('HTML CV is a continuous webpage without toolbar or paper surfaces', async () => {
      assert.equal(await cv.locator('.cv-tools, nav, button, details, summary').count(),0);
      assert.equal(await cv.getByRole('link',{name:'Back to website',exact:true}).count(),0);
      assert.equal(await cv.getByRole('link',{name:'Download PDF',exact:true}).count(),0);
      for(const width of [390,1440]) {
        await cv.setViewportSize({width,height:1100});
        assert.equal(await cv.locator('.page-footer:visible').count(),0);
        const surfaceStyles=await cv.locator('.cv-page').evaluateAll(pages=>pages.map(page=>({
          shadow:getComputedStyle(page).boxShadow,
          minimumHeight:getComputedStyle(page).minHeight
        })));
        assert.equal(surfaceStyles.length,2);
        assert.ok(surfaceStyles.every(style=>style.shadow==='none' && style.minimumHeight==='0px'),JSON.stringify(surfaceStyles));
        const gaps=await cv.locator('.cv-section').evaluateAll(sections=>sections.slice(1).map((section,index)=>
          section.getBoundingClientRect().top-sections[index].getBoundingClientRect().bottom));
        assert.equal(gaps.length,8);
        assert.ok(gaps.every(gap=>gap>=0 && gap<=48),JSON.stringify({width,gaps}));
      }
    });
    await check('HTML CV desktop WCAG scan and all local fonts load', async () => {
      await cv.setViewportSize({width:1440,height:1100});
      await axe(cv,'cv-desktop');
      assert.ok(await cv.evaluate(()=>document.fonts.check('16px Libertinus')));
      await cv.screenshot({path:new URL('cv-desktop.png',artifacts).pathname,fullPage:true});
    });
    await check('HTML CV narrow-screen and 200% text reflow', async () => {
      for (const width of [320,390,768,1440]) {
        await cv.setViewportSize({width,height:1100}); await noOverflow(cv);
      }
      await cv.setViewportSize({width:1280,height:1100});
      const style=await cv.addStyleTag({content:'html { font-size: 200% !important; }'});
      try { await noOverflow(cv); } finally { await style.evaluate(el=>el.remove()); }
    });
    await check('HTML CV mobile WCAG scan and text-spacing reflow', async () => {
      await cv.setViewportSize({width:390,height:844});
      await axe(cv,'cv-mobile');
      await cv.screenshot({path:new URL('cv-mobile.png',artifacts).pathname,fullPage:true});
      const style=await cv.addStyleTag({content:'* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }'});
      try { await noOverflow(cv); } finally { await style.evaluate(el=>el.remove()); }
    });
    await check('HTML CV tab order, visible focus and no positive tabindex', async () => {
      await cv.goto(new URL('cv/',url).href);
      const count=await cv.locator('a[href]:visible,summary').count();
      const visited=new Set();
      for(let i=0;i<count;i++) {
        await cv.keyboard.press('Tab');
        const info=await cv.locator(':focus').evaluate(el=>({
          index:[...document.querySelectorAll('a[href],summary')].indexOf(el),
          outline:parseFloat(getComputedStyle(el).outlineWidth)
        }));
        assert.ok(info.index>=0);assert.ok(!visited.has(info.index));visited.add(info.index);
        assert.ok(info.outline>=2);
      }
      assert.equal(await cv.locator('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').count(),0);
    });
  } finally { await cv.close(); }
  await check('Forced colors keeps visible keyboard focus and readable icon backing', async () => {
    await page.emulateMedia({forcedColors:'active'});
    await page.getByRole('link',{name:'Google Scholar',exact:true}).focus();
    assert.ok(await page.locator(':focus').evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth)>=2));
    assert.equal(await page.locator('.brand-icon').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
    await page.emulateMedia({forcedColors:'none'});
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: new URL('launch-mobile.png', artifacts).pathname, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: new URL('launch-desktop.png', artifacts).pathname, fullPage: true });
} catch (error) {
  report.checks.push({ name: 'Test infrastructure', passed: false, error: error.stack });
  console.error(error);
} finally {
  if (browser) await browser.close();
  report.passed = report.checks.every(({ passed }) => passed);
  await writeFile(new URL('launch-validation.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.checks.filter(({ passed }) => passed).length}/${report.checks.length} checks passed.`);
  if (!report.passed) process.exitCode = 1;
}
