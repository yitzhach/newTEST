# Batch URL Converter

A small local tool: paste 50+ URLs, save each page as a standalone HTML file and/or a printed PDF, and get everything back in one zip.

## Why this isn't a pure client-side HTML file

Browsers block JavaScript on a web page from reading the content of another site (CORS / same-origin policy), and there's no browser API to silently "print to PDF" a page you don't control. To actually visit each URL and capture it, this tool runs a tiny local server that drives a real (headless) browser — [Puppeteer](https://pptr.dev/) — to load each page and export it. Everything still runs entirely on your machine; nothing is uploaded anywhere.

## Setup

```bash
cd batch-url-converter
npm install
npm start
```

Then open **http://localhost:4173** in your browser.

## Use

1. Paste your list of URLs, one per line (50+ is fine).
2. Choose HTML, PDF, or both.
3. Click **Convert & Download Zip**.
4. A zip downloads containing:
   - `html/001_example.com.html`, `html/002_...` — full rendered HTML per page
   - `pdf/001_example.com.pdf`, `pdf/002_...` — a print-to-PDF of each page
   - `manifest.json` — status per URL, including any that failed to load

Large batches take a while since each page is loaded in a real browser one at a time (needed for pages that render content with JavaScript). For 50 URLs, expect a few minutes depending on site speed.
