// Run with Playwright installed: node tests/browser-smoke.mjs
// Uses synthetic messages and an isolated browser; never opens the live chat.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const files = new Set(['/dev/ui-fixture.html', '/tl_view.js', '/tl_model.js', '/tl_style.css']);
const server = createServer(async (req, res) => {
    if (!files.has(req.url)) { res.writeHead(404).end(); return; }
    const body = await readFile(new URL(`..${req.url}`, import.meta.url));
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE} : {})});
try {
 const page = await browser.newPage({viewport: {width:1280,height:850}});
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.goto(`${baseUrl}/dev/ui-fixture.html`);await page.waitForLoadState('networkidle');
 const dot=page.locator('.tlp-dot').first();await dot.waitFor();
 const chatBefore=await page.locator('#sheld').boundingBox();
 const dock=await page.locator('#tlpDock').boundingBox();assert.equal(dock.x+dock.width,1280);assert.equal(dock.y,0);
 const portrait=await page.locator('.tlp-portrait').boundingBox();assert.equal(portrait.width,portrait.height);
 const count=await page.locator('.tlp-dot').count();await dot.dblclick();await page.waitForTimeout(350);const expanded=await page.locator('.tlp-dot').count();assert.ok(expanded>count);
 await page.locator('.tlp-dot').first().dblclick();await page.waitForTimeout(350);assert.equal(await page.locator('.tlp-dot').count(),count);
 await page.locator('.tlp-dot').first().click();await page.locator('.tlp-bubble').waitFor();
 const bubble=await page.locator('.tlp-bubble').boundingBox();assert.ok(bubble.height<=190.1);
 await page.locator('.tlp-dot').nth(2).hover();assert.equal(await page.locator('.tlp-hover').count(),0);
 assert.deepEqual(await page.locator('#sheld').boundingBox(),chatBefore);
 await page.getByRole('button',{name:'You are here',exact:true}).click();assert.equal(await page.locator('.tlp-board').evaluate(e=>e.style.transform),'scale(5)');
 const current=await page.locator('.tlp-dot.is-current').boundingBox();assert.ok(current.x>=dock.x && current.x<1280 && current.y>=0 && current.y<850);
 await page.getByRole('button',{name:'Show all',exact:true}).click();
 let scale=await page.locator('.tlp-board').evaluate(e=>e.style.transform);await page.locator('.tlp-stage').hover();await page.mouse.wheel(0,-100);await page.waitForTimeout(100);assert.equal(await page.locator('.tlp-board').evaluate(e=>e.style.transform),scale);
 await page.evaluate(()=>view.update({scrollZoom:true}));await page.locator('.tlp-stage').hover();await page.mouse.wheel(0,-100);await page.waitForTimeout(100);assert.notEqual(await page.locator('.tlp-board').evaluate(e=>e.style.transform),scale);
 await page.getByRole('button',{name:'Pop out',exact:true}).click();
 const stage=await page.locator('.tlp-stage').boundingBox();const side=await page.locator('.tlp-bubble').boundingBox();assert.ok(side.x>=stage.x+stage.width-1);assert.ok(side.height>stage.height*.9);
 if (process.env.TIMELINE_SCREENSHOT) await page.screenshot({path:process.env.TIMELINE_SCREENSHOT});
 await page.setViewportSize({width:390,height:740});await page.waitForTimeout(100);const mobile=await page.locator('.tlp-bubble').boundingBox();assert.ok(mobile.x>=0 && mobile.x+mobile.width<=390);assert.ok(mobile.height<200);
 assert.deepEqual(errors,[]);console.log('PASS: edge dock, unchanged chat, square avatar, double-click expand/collapse, viewer height, hover suppression, 5× current-node focus, optional wheel zoom, popout sidebar, narrow viewport, no page errors');
} finally {await browser.close(); server.close();}
