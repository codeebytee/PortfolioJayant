# Publishing a blog post

Publishing is: **add a Markdown file to `posts/`, commit, push.** That's the
whole workflow. There is no build step, no manifest to update, and no per-post
HTML page to write.

## 1. Create the file

One file per post in `posts/`, named however you like — the filename (minus
`.md`) becomes the post's URL slug. A dated name keeps the folder tidy:

```
posts/2026-08-06-hello-world.md   ->   /blog/post.html?slug=2026-08-06-hello-world
```

Use only letters, numbers, `.`, `-` and `_` in the filename.

## 2. Add frontmatter

The file must start with a YAML frontmatter block on line 1:

```markdown
---
title: Notes on volatility surfaces
date: 2026-08-06
excerpt: Working through implied vol construction and what it teaches about market expectations.
---

Your post body, in normal Markdown. Headings, lists, links, code blocks,
tables, images and blockquotes all render.
```

| Field     | Required | Notes                                                       |
| --------- | -------- | ----------------------------------------------------------- |
| `title`   | yes      | Shown on the index, the post page and the browser tab.       |
| `date`    | yes      | `YYYY-MM-DD`. Posts are sorted newest-first by this value.   |
| `excerpt` | no       | Index blurb. If omitted, the first paragraph is used.        |

Only flat `key: value` pairs are supported — no nested YAML, no lists.

## 3. Push

GitHub Pages serves the same repo the blog reads from, so the post appears on
`/blog/` and in the "Blog" section of the homepage as soon as the push lands.

## How it works

- `blog/index.html` asks the GitHub Contents API what is in `posts/`, fetches
  each file's raw content, parses the frontmatter and lists the posts.
- `blog/post.html?slug=…` fetches that one file from `raw.githubusercontent.com`
  and renders the Markdown with [marked.js](https://marked.js.org/) from a CDN.
- `blog/blog.js` holds the shared config and fetch/parse logic for both pages
  and for the homepage's "recent posts" list.

**This requires the repo to stay public.** Both the GitHub API and
`raw.githubusercontent.com` are called without an auth token; making the repo
private would break the blog.

Anonymous GitHub API requests are rate-limited (~60/hour per IP). If a reader
hits that limit the pages show a plain "try again shortly" message rather than
breaking.

To point the blog at a different repo or branch, edit `CONFIG` at the top of
`blog/blog.js`.
