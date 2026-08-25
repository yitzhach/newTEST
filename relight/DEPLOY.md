# Deploying the bench

The bench is static files with no build step, no dependencies, and no server
side. Anything that serves a directory over HTTPS will run it.

It does need to be served over **http/https, not opened as a `file://` path** —
it uses ES modules, which browsers refuse to load from the filesystem.

## Cloudflare Pages, from the repo

Connect the repository, then:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `relight` |
| Root directory | *(leave empty)* |

Leaving the build command empty matters — this repository's root also holds an
unrelated Vite site, and a framework preset would try to build that instead.

## Cloudflare Pages, direct upload

```bash
npx wrangler pages deploy relight --project-name=relight-bench
```

## Anything else

```bash
python3 -m http.server 8080     # then http://localhost:8080/relight/
npx serve relight
```

## What the browser needs

WebGL2 with `EXT_color_buffer_float`. That is current Chrome, Edge, Firefox, and
Safari 15+ including iOS. If the extension is missing the bench refuses to start
and says so, rather than rendering output that is wrong but still looks like
relief.

Everything runs on the viewer's GPU. No image ever leaves the browser — there is
no upload, no API, and no per-image cost.

## Caching

`_headers` sets `no-cache` so a redeploy is picked up immediately rather than
being masked by a stale module. Worth revisiting if this is ever pointed at real
traffic; for iterating on a private link it is the right trade.
