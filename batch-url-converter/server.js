const express = require('express');
const puppeteer = require('puppeteer');
const archiver = require('archiver');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4173;

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

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

app.post('/api/convert', async (req, res) => {
  const { urls, formats } = req.body || {};
  const wantHtml = !!(formats && formats.html);
  const wantPdf = !!(formats && formats.pdf);

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

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="batch-export-${Date.now()}.zip"`,
  });

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (let i = 0; i < cleanUrls.length; i++) {
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
          archive.append(pdfBuffer, { name: `pdf/${name}.pdf` });
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
