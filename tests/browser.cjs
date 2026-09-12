// Run with Playwright installed: node tests/browser.cjs
// Uses an isolated browser clipboard stub; never overwrites your OS clipboard.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/recruit/`);
    await page.waitForSelector('#tagList .button', { state: 'attached' });
    assert.equal(await page.evaluate(() => typeof Tesseract), 'undefined', 'OCR must be lazy-loaded');
    assert.equal(await page.locator('#tagList').isVisible(), true);
    assert.equal(await page.locator('#tagInput').isDisabled(), false);
    const tagTop = (await page.locator('#tagList').boundingBox()).y;
    await page.evaluate(() => { const box = document.getElementById('recommendation'); box.hidden = false; box.textContent = 'A recommendation with more detail. '.repeat(30); });
    assert.equal((await page.locator('#tagList').boundingBox()).y, tagTop, 'recommendation space must remain reserved');
    await page.evaluate(() => { document.getElementById('recommendation').hidden = true; });
    await page.locator('#screenshotToggle').click();
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
    await page.reload();
    await page.waitForSelector('#tagList .button', { state: 'attached' });
    assert.equal(await page.locator('#tagList').isVisible(), false, 'remember enabled screenshot input');
    await page.locator('#screenshotToggle').click();
    await page.reload();
    await page.waitForSelector('#tagList .button', { state: 'attached' });
    assert.equal(await page.locator('#tagList').isVisible(), true, 'remember disabled screenshot input');
    await page.locator('#screenshotToggle').click();
    await page.locator('#fullscreenToggle').click();
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    assert.equal(await page.locator('#tagList').isVisible(), false);
    await page.locator('#screenshotToggle').click();
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), true, 'turning input off must preserve fullscreen');
    assert.equal(await page.locator('#tagList').isVisible(), true);
    await page.locator('#screenshotToggle').click();
    console.log('PASS: manual default, saved screenshot preference, independent fullscreen icon, reserved message space');

    async function imageInput(file, scale = 1, padding = 0, paste = false, labels = null) {
      await page.evaluate(async ({ file, scale, padding, paste, labels }) => {
        const bitmap = await createImageBitmap(await (await fetch('/sampleimg/' + file)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width * scale + padding * 2;
        canvas.height = bitmap.height * scale + padding * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, padding, padding, bitmap.width * scale, bitmap.height * scale);
        bitmap.close();
        // Synthetic tag variants exercise positive recommendations with the same real UI.
        if (labels) {
          const small = document.createElement('canvas'); small.width = 1280; small.height = 720;
          small.getContext('2d').drawImage(canvas, 0, 0, 1280, 720);
          const boxes = RecruitVision.detectButtons(small.getContext('2d').getImageData(0, 0, 1280, 720));
          boxes.forEach((box, i) => {
            const ratio = canvas.width / 1280;
            ctx.fillStyle = '#333'; ctx.fillRect(box.x * ratio, box.y * ratio, box.width * ratio, box.height * ratio);
            ctx.fillStyle = '#fff'; ctx.font = `${box.height * ratio * 0.36}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(labels[i], (box.x + box.width / 2) * ratio, (box.y + box.height / 2) * ratio);
          });
        }
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        window.clipboardReads = 0;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => {
          window.clipboardReads++;
          return [{ types: ['image/png'], getType: async () => blob }];
        } } });
        if (paste) {
          const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
          document.getElementById('tagInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
        }
      }, { file, scale, padding, paste, labels });
      if (!paste) await page.locator('#screenshotStatus').click();
      await page.waitForFunction(() => /Read 5\/5|Could|No tags|unavailable/.test(document.getElementById('screenshotStatus').textContent), null, { timeout: 90000 });
      const status = await page.locator('#screenshotStatus').innerText();
      assert.match(status, /Read 5\/5/, status);
      assert.equal(await page.locator('.recognized-tag').count(), 5);
      assert.equal(await page.locator('#tagList .checked').count(), 5);
      assert.equal(await page.locator('#recruitResults [data-rarity="2"]').count(), 0);
    }

    const first = 'Arknights_B1lp26SeBZ.png', second = 'Arknights_LYbMFH4VHl.png';
    for (const [file, scale, padding, paste] of [[first, 1, 0, false], [second, 1, 0, false], [first, 0.5, 0, true], [second, 0.5, 160, false]]) {
      await imageInput(file, scale, padding, paste);
      const expected = file === first ? ['Guard', 'Medic', 'Starter', 'Survival', 'AoE'] : ['Medic', 'Supporter', 'Caster', 'Melee', 'AoE'];
      assert.deepEqual((await page.locator('#tagList .checked').allTextContents()).sort(), expected.sort());
      assert.match(await page.locator('#recommendation').innerText(), /No combination/);
      console.log(`PASS OCR: ${file}, scale ${scale}, padding ${padding}, ${paste ? 'paste event' : 'background click'}`);
    }
    await imageInput(first, 1, 0, false, ['Top Operator', 'Senior Operator', 'Guard', 'Survival', 'AoE']);
    assert.match(await page.locator('#recommendation').innerText(), /Guaranteed 6★/);
    assert.equal(await page.locator('.best-tag').count(), 1, 'outline only one tied combination at a time');
    await page.locator('#recommendationChoice').selectOption({ index: 1 });
    assert.equal(await page.locator('.best-tag').count(), 2);
    await page.evaluate(() => {
      window.previousScreenshotURL = document.querySelector('#screenshotBackground img').src;
      window.previousResult = document.querySelector('#recruitResults tr');
      window.previousChoice = document.getElementById('recommendationChoice');
      window.previousHighlight = document.querySelector('.recognized-tag');
    });
    await imageInput(first, 0.5, 0, true, ['Top Operator', 'Senior Operator', 'Guard', 'Survival', 'AoE']);
    assert.equal(await page.evaluate(() => document.querySelector('#screenshotBackground img').src === previousScreenshotURL && document.querySelector('#recruitResults tr') === previousResult && document.getElementById('recommendationChoice') === previousChoice && document.querySelector('.recognized-tag') === previousHighlight), true, 'same five tags must preserve screenshot, rows, dropdown, and outlines');
    assert.equal(await page.locator('#recommendationChoice').inputValue(), '1');
    assert.ok(await page.locator('.recommended-result').count() > 0);
    assert.equal(await page.locator('.recommended-result .operatorCheckbox:not([data-rarity="5"])').count(), 0);
    if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH });
    const reads = await page.evaluate(() => clipboardReads);
    await page.locator('#noobMode').click();
    assert.equal(await page.evaluate(() => clipboardReads), reads, 'control clicks must not read clipboard');
    assert.equal(await page.locator('#recruitResults [data-rarity="2"]').count(), 0);
    await page.locator('#screenshotToggle').click();
    await page.locator('#tagList [data-tag-id="11"]').click();
    assert.match(await page.locator('#recommendation').innerText(), /Guaranteed 5★/);
    assert.equal(await page.locator('body.screenshot-overlay').count(), 0);
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
    await page.locator('#screenshotToggle').click();
    console.log('PASS: 6-star priority, 5-star fallback, screenshot highlights, manual corrections, control exclusions, clear image');

    await imageInput(first, 1, 0, false, ['Fast-Redeploy', 'Caster', 'Medic', 'Starter', 'AoE']);
    assert.match(await page.locator('#recommendation').innerText(), /4★ or better/);
    assert.ok(await page.locator('.best-tag').count() > 0);
    assert.equal(await page.locator('.recommended-result [data-rarity="2"]').count(), 0);
    await page.locator('#clearScreenshot').click();
    assert.equal(await page.locator('#tagList').isVisible(), false, 'clearing the image must keep screenshot input enabled');

    // Disabling image input while a clipboard read is pending must invalidate it.
    await page.evaluate(() => { navigator.clipboard.read = () => new Promise(resolve => { window.resolveClipboard = resolve; }); });
    await page.locator('#screenshotStatus').click();
    await page.locator('#screenshotToggle').click();
    await page.evaluate(async () => {
      const blob = await (await fetch('/sampleimg/Arknights_B1lp26SeBZ.png')).blob();
      window.resolveClipboard([{ types: ['image/png'], getType: async () => blob }]);
    });
    assert.equal(await page.locator('body.screenshot-overlay').count(), 0);
    await page.locator('#screenshotToggle').click();
    console.log('PASS: 4-star-safe fallback and cancellation of pending clipboard input');

    // Clipboard denied and text-only clipboard leave the existing selection alone.
    const selected = await page.locator('#tagList .checked').allTextContents();
    await page.evaluate(() => { navigator.clipboard.read = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await page.locator('#screenshotStatus').click();
    await page.waitForFunction(() => document.getElementById('screenshotStatus').textContent.includes('blocked'));
    await page.evaluate(() => { navigator.clipboard.read = async () => []; });
    await page.locator('#screenshotStatus').click();
    await page.waitForFunction(() => document.getElementById('screenshotStatus').textContent.includes('No image'));
    assert.deepEqual(await page.locator('#tagList .checked').allTextContents(), selected);
    await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      navigator.clipboard.read = async () => [{ types: ['image/png'], getType: async () => new Promise(resolve => canvas.toBlob(resolve)) }];
    });
    await page.locator('#screenshotStatus').click();
    await page.waitForFunction(() => document.getElementById('screenshotStatus').textContent.includes('Could not find all five tag buttons'));
    assert.deepEqual(await page.locator('#tagList .checked').allTextContents(), selected, 'an unreadable candidate must preserve the previous input');
    await page.evaluate(async () => {
      await document.exitFullscreen();
      document.documentElement.requestFullscreen = async () => { throw new TypeError('Fullscreen denied'); };
    });
    await page.locator('#fullscreenToggle').click();
    await page.waitForSelector('#fullscreenHint');
    assert.equal(await page.locator('#tagList').isVisible(), false);
    await require('./screen-share-check.cjs')(page);
    await require('./screen-share-timing.cjs')(page);
    assert.deepEqual(errors, []);
    console.log('PASS: permission denied, non-image clipboard, invalid screenshot, no stale recommendation, no JavaScript errors');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
