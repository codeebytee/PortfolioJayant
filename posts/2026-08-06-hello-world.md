---
title: Hello, world — this blog is now a folder of Markdown files
date: 2026-08-06
excerpt: How the writing on this site gets published: drop a Markdown file in posts/, push, done. No build step, no manifest, no per-post HTML.
---

## Why bother

I kept a hardcoded list of "recent writing" on the homepage for a while, and the
obvious problem showed up immediately: editing HTML to publish a paragraph is
enough friction that you stop publishing. So the blog now reads itself from the
repo. The page asks GitHub what is in `posts/`, pulls each file, and renders it.

## How to publish

Add a Markdown file to `posts/`, give it frontmatter, commit, push. GitHub Pages
serves the same repo the API reads from, so the post is live as soon as the push
lands — no build, no manifest to keep in sync, no separate HTML page per post.

The frontmatter block at the top of this file is the whole contract:

```yaml
---
title: Your title here
date: 2026-08-06
excerpt: Optional one-liner for the index page.
---
```

`title` and `date` are required, `excerpt` is optional — if you leave it out,
the index falls back to the first paragraph of the post.

## What's next

Mostly notes on quant finance and on things I build: volatility surfaces,
the architecture behind [StockInds](https://github.com/codeebytee/StockInds),
and whatever I'm reading. If it was useful to figure out, it's probably worth
writing down.
