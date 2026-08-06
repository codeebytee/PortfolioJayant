/*
 * Shared blog logic for blog/index.html and blog/post.html.
 *
 * Posts live as Markdown files in /posts at the repo root. Publishing a post
 * is: add a .md file with frontmatter, commit, push. Nothing else to update.
 *
 * Frontmatter format (must be the very first thing in the file):
 *
 *   ---
 *   title: My post title
 *   date: 2026-08-06
 *   excerpt: One or two sentences shown on the blog index.
 *   ---
 *
 * `title` and `date` (YYYY-MM-DD) are required, `excerpt` is optional — if it
 * is missing, the first paragraph of the body is used instead.
 *
 * This relies on the repo being public: the file list comes from the
 * unauthenticated GitHub Contents API and the file bodies from
 * raw.githubusercontent.com. No token, no build step, no manifest.
 */
(function (global) {
  "use strict";

  var CONFIG = {
    owner: 'codeebytee',
    repo: 'PortfolioJayant',
    branch: 'main',
    dir: 'posts'
  };

  var LIST_URL = 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo +
    '/contents/' + CONFIG.dir + '?ref=' + CONFIG.branch;

  function rawUrl(slug) {
    return 'https://raw.githubusercontent.com/' + CONFIG.owner + '/' + CONFIG.repo +
      '/' + CONFIG.branch + '/' + CONFIG.dir + '/' + encodeURIComponent(slug) + '.md';
  }

  // ---- errors -------------------------------------------------------------
  // Anything thrown here carries a message that is safe to show to a reader.

  function BlogError(message) {
    var e = new Error(message);
    e.isBlogError = true;
    return e;
  }

  function messageForStatus(status) {
    if (status === 403 || status === 429) {
      return 'GitHub is rate-limiting this page right now (it allows a limited ' +
        'number of anonymous requests per hour from the same network). ' +
        'Please try again in a little while.';
    }
    if (status === 404) {
      return 'Could not find the posts on GitHub — the file may have been renamed or removed.';
    }
    return 'GitHub returned an unexpected error (HTTP ' + status + '). Please try again later.';
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw BlogError(messageForStatus(res.status));
      return res.text();
    }, function () {
      throw BlogError('Could not reach GitHub. Check your connection and try again.');
    });
  }

  function fetchJson(url) {
    return fetch(url, {
      cache: 'no-store',
      headers: { 'Accept': 'application/vnd.github+json' }
    }).then(function (res) {
      if (!res.ok) throw BlogError(messageForStatus(res.status));
      return res.json();
    }, function () {
      throw BlogError('Could not reach GitHub. Check your connection and try again.');
    });
  }

  function errorMessage(err) {
    return (err && err.isBlogError && err.message)
      ? err.message
      : 'Something went wrong loading the posts. Please try again later.';
  }

  // ---- parsing ------------------------------------------------------------

  function stripQuotes(value) {
    var v = value.trim();
    if (v.length > 1 && (v.charAt(0) === '"' || v.charAt(0) === "'") && v.charAt(v.length - 1) === v.charAt(0)) {
      return v.slice(1, -1);
    }
    return v;
  }

  // Minimal YAML frontmatter reader: flat `key: value` pairs only, which is
  // all the post format needs.
  function parseFrontmatter(text) {
    var source = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
    var match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
    if (!match) return { meta: {}, body: source.trim() };

    var meta = {};
    match[1].split('\n').forEach(function (line) {
      if (!line.trim() || line.trim().charAt(0) === '#') return;
      var sep = line.indexOf(':');
      if (sep === -1) return;
      meta[line.slice(0, sep).trim().toLowerCase()] = stripQuotes(line.slice(sep + 1));
    });

    return { meta: meta, body: source.slice(match[0].length).trim() };
  }

  // First non-heading paragraph, trimmed — used when a post has no excerpt.
  function deriveExcerpt(body) {
    var blocks = body.split(/\n\s*\n/);
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i].trim();
      if (!block || block.charAt(0) === '#' || block.charAt(0) === '!') continue;
      var plain = block.replace(/\s+/g, ' ').replace(/[*_`>]/g, '');
      return plain.length > 180 ? plain.slice(0, 177).trim() + '…' : plain;
    }
    return '';
  }

  function toPost(slug, text) {
    var parsed = parseFrontmatter(text);
    return {
      slug: slug,
      title: parsed.meta.title || slug.replace(/[-_]/g, ' '),
      date: parsed.meta.date || '',
      excerpt: parsed.meta.excerpt || deriveExcerpt(parsed.body),
      body: parsed.body
    };
  }

  // ---- fetching -----------------------------------------------------------

  // Resolves to posts sorted newest-first. Resolves to [] when there are no
  // posts yet (including when the posts/ folder does not exist).
  function listPosts() {
    return fetchJson(LIST_URL).then(function (entries) {
      if (!Array.isArray(entries)) return [];
      var files = entries.filter(function (entry) {
        return entry.type === 'file' && /\.md$/i.test(entry.name);
      });
      return Promise.all(files.map(function (file) {
        return fetchText(file.download_url).then(function (text) {
          return toPost(file.name.replace(/\.md$/i, ''), text);
        });
      }));
    }, function (err) {
      // An empty/absent posts folder is an empty blog, not an error.
      if (err && err.isBlogError && /Could not find the posts/.test(err.message)) return [];
      throw err;
    }).then(function (posts) {
      return posts.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return a.slug < b.slug ? 1 : -1;
      });
    });
  }

  function loadPost(slug) {
    return fetchText(rawUrl(slug)).then(function (text) {
      return toPost(slug, text);
    }, function (err) {
      if (err && err.isBlogError && /Could not find the posts/.test(err.message)) {
        throw BlogError('That post does not exist (or has been renamed).');
      }
      throw err;
    });
  }

  // ---- formatting ---------------------------------------------------------

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // 2026-08-06 -> 2026.08.06 (matches the terminal-ish dates on the homepage)
  function formatDate(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replace(/-/g, '.') : String(date || '');
  }

  function postUrl(slug, prefix) {
    return (prefix || '') + 'post.html?slug=' + encodeURIComponent(slug);
  }

  global.Blog = {
    CONFIG: CONFIG,
    listPosts: listPosts,
    loadPost: loadPost,
    parseFrontmatter: parseFrontmatter,
    errorMessage: errorMessage,
    formatDate: formatDate,
    postUrl: postUrl,
    esc: esc
  };
})(window);
