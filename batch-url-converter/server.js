const express = require('express');
const puppeteer = require('puppeteer');
const archiver = require('archiver');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4173;
const VERSION = require('./package.json').version;

const DEFAULT_DELAY_MIN_MS = 3000;
const DEFAULT_DELAY_MAX_MS = 7000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function safeFilename(url, index) {
  let base;
  try {
    const u = new URL(url);
    base = `${u.hostname}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    base = url;
  }
  base = base.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'page';
  base = base.slice(0, 80);
  return `${String(index + 1).padStart(3, '0')}_${base}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Random-ish pause between page loads so requests don't fire back-to-back
// like a bot. Widen or narrow this range if a site is still rate-limiting you.
function randomDelayMs(minMs = 3000, maxMs = 7000) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

app.get('/api/info', (_req, res) => {
  res.json({
    version: VERSION,
    delayMinMs: DEFAULT_DELAY_MIN_MS,
    delayMaxMs: DEFAULT_DELAY_MAX_MS,
  });
});

app.post('/api/convert', async (req, res) => {
  const { urls, formats, delayEnabled } = req.body || {};
  const wantHtml = !!(formats && formats.html);
  const wantPdf = !!(formats && formats.pdf);
  const useDelay = delayEnabled !== false;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided.' });
  }
  if (!wantHtml && !wantPdf) {
    return res.status(400).json({ error: 'Select at least one output format.' });
  }

  const cleanUrls = urls
    .map(normalizeUrl)
    .filter(Boolean)
    .slice(0, 200);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-url-'));
  const results = [];

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    fs.rmSync(workDir, { recursive: true, force: true });
    return res.status(500).json({
      error: `Could not launch a browser to render pages: ${String(err.message || err)}`,
    });
  }

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="batch-export-${Date.now()}.zip"`,
  });

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('Zip archive error:', err);
    res.end();
  });
  archive.pipe(res);

  try {
    for (let i = 0; i < cleanUrls.length; i++) {
      if (i > 0 && useDelay) {
        await sleep(randomDelayMs(DEFAULT_DELAY_MIN_MS, DEFAULT_DELAY_MAX_MS));
      }
      const url = cleanUrls[i];
      const name = safeFilename(url, i);
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

        if (wantHtml) {
          const html = await page.content();
          archive.append(html, { name: `html/${name}.html` });
        }
        if (wantPdf) {
          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
          });
          archive.append(Buffer.from(pdfBuffer), { name: `pdf/${name}.pdf` });
        }
        results.push({ url, status: 'ok' });
      } catch (err) {
        results.push({ url, status: 'failed', error: String(err.message || err) });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  archive.append(JSON.stringify(results, null, 2), { name: 'manifest.json' });
  await archive.finalize();
});

app.listen(PORT, () => {
  console.log(`Batch URL Converter running at http://localhost:${PORT}`);
});
