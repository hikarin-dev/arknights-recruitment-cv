// Measures capture scheduling and CV overhead, excluding OCR runtime.
const { chromium } = require('playwright');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const root = process.cwd();
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const output = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 2560; c.height = 1440;
      const ctx = c.getContext('2d');
      const bitmap = await createImageBitmap(await (await fetch('/sampleimg/Arknights_B1lp26SeBZ.png')).blob());
      let sent = 0, resolve, cv = 0, cvMs = 0;
      const realDetect = RecruitVision.detectButtons;
      RecruitVision.detectButtons = (...args) => { const start = performance.now(); const out = realDetect(...args); cvMs += performance.now() - start; cv++; return out; };
      const draw = word => {
        ctx.drawImage(bitmap, 0, 0);
        ctx.fillStyle = '#333'; ctx.fillRect(750, 720, 290, 94);
        ctx.fillStyle = 'white'; ctx.font = '32px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(word, 895, 767);
      };
      draw('Guard');
      navigator.mediaDevices.getDisplayMedia = async () => { const stream = c.captureStream(30); draw('Guard'); return stream; };
      const button = document.createElement('button');
      const controller = RecruitScreenShare({ button, onRequest() {}, onStart() {}, onStop() {}, onMissing() {}, onStatus() {}, onFrame: async () => { resolve?.(performance.now() - sent); return true; } });
      const waitForCapture = action => new Promise((done, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for a stable capture')), 15000);
        resolve = value => { clearTimeout(timeout); done(value); };
        action();
      });
      await waitForCapture(() => button.click());
      const results = [];
      for (const word of ['Defender', 'Guard', 'Defender', 'Guard', 'Defender', 'Guard']) {
        await new Promise(r => setTimeout(r, 350));
        const elapsed = await waitForCapture(() => { sent = performance.now(); draw(word); });
        results.push(Math.round(elapsed));
      }
      controller.stop(); bitmap.close();
      return { changeToRecognitionMs: results, fullScans: cv, fullScanMs: Math.round(cvMs) };
    });
    console.log(JSON.stringify(output));
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
