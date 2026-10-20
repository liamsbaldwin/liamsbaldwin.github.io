#!/usr/bin/env python3
"""Build annotations.json: short previews of every outside page the site links to.

popups.js shows these when you hover a link. Browsers won't let one site read
another site's pages, so the previews are fetched here ahead of time (the way
gwern.net does it) and saved as plain JSON next to the HTML.

    pip install requests beautifulsoup4      # pdftotext (poppler) for PDFs
    python3 scripts/build_annotations.py             # add new links only
    python3 scripts/build_annotations.py --refresh   # re-fetch everything

Each entry looks like:
    "https://...": {"title": ..., "author": ..., "date": ..., "site": ..., "html": "<p>...</p>"}
"""

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "annotations.json"
OWN_HOSTS = {"liambald.win", "www.liambald.win", "liamsbaldwin.github.io"}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; liambald.win link previews; +https://liambald.win/)",
    "Accept-Language": "en",
}
MAX_CHARS = 1400      # roughly a popup's worth of text
MIN_PARAGRAPH = 80    # shorter <p>s are usually captions, bylines, nav, etc.
INLINE_TAGS = {"em", "i", "b", "strong", "sup", "sub", "code", "a"}


def site_links():
    """{url: link text} for every outside link in the site's HTML."""
    links = {}
    for page in sorted(ROOT.rglob("*.html")):
        if ".git" in page.parts:
            continue
        soup = BeautifulSoup(page.read_text(encoding="utf-8"), "html.parser")
        for a in soup.find_all("a", href=True):
            url = a["href"].strip()
            if not url.startswith(("http://", "https://")):
                continue
            parsed = urlparse(url)
            # Pages from this repo are previewed live by popups.js.
            if parsed.hostname in OWN_HOSTS and is_repo_page(parsed.path):
                continue
            links.setdefault(url, a.get_text(" ", strip=True))
    return links


def is_repo_page(path):
    path = unquote(path).lstrip("/")
    target = ROOT / path
    return (target.is_dir() and (target / "index.html").exists()) or target.is_file() or path == ""


# ── Wikipedia ────────────────────────────────────────────────────────────────

def wikipedia(url):
    parsed = urlparse(url)
    title = unquote(parsed.path[len("/wiki/"):])
    r = requests.get(
        f"{parsed.scheme}://{parsed.netloc}/w/api.php",
        params={
            "action": "query", "format": "json", "formatversion": 2, "redirects": 1,
            "prop": "extracts", "exintro": 1, "titles": title,
        },
        headers=HEADERS, timeout=20,
    )
    r.raise_for_status()
    page = r.json()["query"]["pages"][0]
    return {"title": page["title"], "site": "Wikipedia", "html": page.get("extract", "")}


# ── PDFs ─────────────────────────────────────────────────────────────────────

def pdf(content, link_text):
    if not shutil.which("pdftotext"):
        print("    (skipping: pdftotext not installed)", file=sys.stderr)
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(content)
        f.flush()
        text = subprocess.run(["pdftotext", "-l", "3", "-enc", "UTF-8", f.name, "-"],
                              capture_output=True, text=True).stdout
        info = subprocess.run(["pdfinfo", f.name], capture_output=True, text=True).stdout

    meta = dict(re.findall(r"^(\w+):\s+(.*)$", info, re.M))
    title = meta.get("Title", "").strip()
    if len(title) < 4 or re.search(r"^Microsoft Word|\.docx?$|^untitled", title, re.I):
        title = link_text

    # Start at the abstract when there is one.
    m = re.search(r"\babstract\b[.:]?\s*", text[:8000], re.I)
    if m:
        text = text[m.end():]

    paragraphs = []
    for block in re.split(r"\n\s*\n", text):
        block = re.sub(r"-\n(?=[a-z])", "", block)       # re-join hyphenated words
        block = re.sub(r"\s+", " ", block).strip()
        if len(block) < 120 or not re.search(r"[a-z]{3,}.*[.?!]", block):
            continue
        paragraphs.append(f"<p>{html.escape(block)}</p>")
        if sum(map(len, paragraphs)) > MAX_CHARS:
            break
    return {"title": title, "author": meta.get("Author", "").strip() or None, "html": "".join(paragraphs)}


# ── Ordinary web pages ──────────────────────────────────────────────────────

def meta(soup, *names):
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return None


def clean_inline(node):
    """A <p>'s contents with only simple inline formatting kept."""
    out = []
    for child in node.children:
        if isinstance(child, NavigableString):
            out.append(html.escape(str(child)))
        elif child.name in INLINE_TAGS:
            inner = clean_inline(child)
            if child.name == "a":
                out.append(inner)  # links in excerpts mostly point at nav/ads; keep text only
            else:
                out.append(f"<{child.name}>{inner}</{child.name}>")
        elif child.name not in ("script", "style", "button", "svg", "figure"):
            out.append(clean_inline(child))
    return re.sub(r"\s+", " ", "".join(out)).strip()


def main_text(soup):
    for junk in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript"]):
        junk.decompose()
    # The container with the most paragraph text is almost always the article.
    candidates = soup.find_all(["article", "main"]) or []
    candidates += [p.parent for p in soup.find_all("p")]
    best = max(candidates, key=lambda c: sum(len(p.get_text()) for p in c.find_all("p", recursive=False)) +
               (500 if c.name in ("article", "main") else 0), default=None)
    if best is None:
        return ""
    paragraphs, total = [], 0
    for p in best.find_all("p"):
        text = clean_inline(p)
        if len(BeautifulSoup(text, "html.parser").get_text()) < MIN_PARAGRAPH:
            continue
        paragraphs.append(f"<p>{text}</p>")
        total += len(text)
        if total > MAX_CHARS:
            break
    return "".join(paragraphs)


def webpage(content, url, link_text):
    soup = BeautifulSoup(content, "html.parser")
    title = meta(soup, "og:title", "twitter:title", "citation_title") or (
        soup.title.get_text(strip=True) if soup.title else link_text)
    description = meta(soup, "og:description", "description", "twitter:description")
    body = main_text(soup)
    if not body and description:
        body = f"<p>{html.escape(description)}</p>"
    return {
        "title": title,
        "author": meta(soup, "author", "article:author", "citation_author"),
        "date": (meta(soup, "article:published_time", "citation_publication_date", "date") or "")[:10] or None,
        "site": meta(soup, "og:site_name"),
        "html": body,
    }


# ── Driver ───────────────────────────────────────────────────────────────────

def annotate(url, link_text):
    host = urlparse(url).hostname or ""
    if host.endswith("wikipedia.org") and "/wiki/" in url:
        return wikipedia(url)
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    if "pdf" in r.headers.get("Content-Type", "") or r.content[:5] == b"%PDF-":
        return pdf(r.content, link_text)
    r.encoding = r.encoding or r.apparent_encoding
    return webpage(r.text, url, link_text)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh", action="store_true", help="re-fetch links that already have a preview")
    args = parser.parse_args()

    existing = json.loads(OUT.read_text()) if OUT.exists() else {}
    links = site_links()
    result = {url: existing[url] for url in links if url in existing and existing[url].get("html")}

    for url, link_text in links.items():
        if url in result and not args.refresh:
            continue
        print(f"→ {url}", file=sys.stderr)
        try:
            entry = annotate(url, link_text)
        except Exception as e:  # one dead link shouldn't stop the build
            print(f"    failed: {e}", file=sys.stderr)
            entry = existing.get(url)
        if entry:
            result[url] = {k: v for k, v in entry.items() if v}

    OUT.write_text(json.dumps(dict(sorted(result.items())), indent=2, ensure_ascii=False) + "\n")
    with_text = sum(1 for e in result.values() if e.get("html"))
    print(f"Wrote {OUT.name}: {with_text}/{len(links)} links have previews.", file=sys.stderr)


if __name__ == "__main__":
    main()
