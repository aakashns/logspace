# Social preview artwork

`social-preview.html` is a 1200 × 630 card for a site's social preview image, the image link previews show for pages without one of their own. It imports the app's theme stylesheet, fixes the color scheme to dark, and uses the site's self-hosted fonts (plus Inter, from `design/fonts/`, for the body text). The query string fills it in: `?title=Your%20Name&tagline=Posts,%20pictures,%20and%20videos.&domain=example.com`.

To make a PNG of it:

1. Serve `webapp/` locally, for example with `python3 -m http.server 44120 --bind 127.0.0.1` from that directory.
2. Open `/design/social-preview.html` with your query string in Playwright with a 1200 × 630 viewport and device scale factor 1.
3. Wait for `document.fonts.ready`, then save a PNG screenshot.
4. Upload it as the social preview image at `/admin/config`, with alt text describing it.
