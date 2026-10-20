// Link previews: hover a link to get a small pop-up with a preview of the page
// it points to (in the style of gwern.net).
//
//   - Pages on this site are fetched live and shown in full.
//   - Wikipedia articles are pulled live from Wikipedia's API (lead section).
//   - Everything else comes from annotations.json, which is pre-built by
//     scripts/build_annotations.py (browsers can't fetch other sites directly).
//
// Popups use the site's own styles, so they follow light/dark mode for free.
(function () {
  const OPEN_DELAY = 400;   // ms of hovering before a popup appears
  const CLOSE_DELAY = 300;  // ms of grace after leaving before it disappears
  const OWN_HOSTS = ["liambald.win", "www.liambald.win", "liamsbaldwin.github.io"];

  // Touch screens have no hover; leave links alone there.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  const siteRoot = new URL(".", scriptUrl); // the site lives wherever popups.js does
  const annotationsUrl = new URL("annotations.json", scriptUrl).href;
  const siteIconUrl = new URL("icon-32.png", scriptUrl).href;

  // ── Link icons ──────────────────────────────────────────────────────────

  const svg = (body) =>
    'url("data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + body + "</svg>") +
    '")';

  const SVG_ICONS = {
    pdf: svg('<path d="M5 1h10l5 5v17H5z" fill="none" stroke="#000" stroke-width="2.2" stroke-linejoin="round"/><path d="M14 1v6h6M8.5 12h7M8.5 16h7M8.5 20h4" fill="none" stroke="#000" stroke-width="2.2"/>'),
    substack: svg('<path d="M3 2h18v3H3zM3 7.5h18v3H3zM3 13h18v10l-9-5-9 5z"/>'),
    youtube: svg('<path d="M2 6.5C2 5 3 4 4.5 4h15C21 4 22 5 22 6.5v11c0 1.5-1 2.5-2.5 2.5h-15C3 20 2 19 2 17.5zM10 8.5v7l6-3.5z" fill-rule="evenodd"/>'),
    external: svg('<path d="M14 3h7v7M21 3l-9 9M18 14v6H4V6h6" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  };

  // Short text badges for familiar sources, like gwern.net's.
  const TEXT_ICONS = [
    [/(^|\.)wikipedia\.org$/, "W", "wikipedia"],
    [/(^|\.)nber\.org$/, "NBER"],
    [/(^|\.)aeaweb\.org$/, "AEA"],
    [/(^|\.)jstor\.org$/, "JSTOR"],
    [/(^|\.)amazon\.com$/, "amzn"],
    [/(^|\.)worksinprogress\.co$/, "WiP"],
    [/(^|\.)mercatus\.org$/, "MC"],
    [/(^|\.)fee\.org$/, "FEE"],
    [/(^|\.)stlouisfed\.org$/, "FRB"],
    [/(^|\.)gwern\.net$/, "𝛘"],
    [/(^|\.)arxiv\.org$/, "𝛘", "arxiv"],
  ];
  const SUBSTACK_HOSTS = /(^|\.)(substack\.com|dwarkesh\.com|betonit\.ai)$/;

  function isOwnHost(host) {
    return host === location.host || OWN_HOSTS.includes(host);
  }

  function isPdf(url) {
    return /\.pdf$/i.test(url.pathname) || /\/(pdf|pdfplus)\//i.test(url.pathname);
  }

  // Returns { type: "text" | "svg" | "site", value, name } or null.
  function iconFor(url) {
    if (isOwnHost(url.host) && !/^\/collegemajors\b/.test(url.pathname)) {
      return { type: "site", value: siteIconUrl };
    }
    if (isPdf(url)) return { type: "svg", value: SVG_ICONS.pdf, name: "pdf" };
    for (const [re, text, name] of TEXT_ICONS) {
      if (re.test(url.hostname)) return { type: "text", value: text, name: name || "" };
    }
    if (SUBSTACK_HOSTS.test(url.hostname)) return { type: "svg", value: SVG_ICONS.substack, name: "substack" };
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname)) return { type: "svg", value: SVG_ICONS.youtube, name: "youtube" };
    if (isOwnHost(url.host)) return null;
    return { type: "svg", value: SVG_ICONS.external, name: "external" };
  }

  // Inline icon after the link text (own-site links get none, as on gwern.net).
  function decorateLink(a) {
    const url = parse(a);
    if (!url) return;
    const icon = iconFor(url);
    if (!icon || icon.type === "site") return;
    if (a.querySelector("img")) return; // don't tag image links
    a.dataset.linkIconType = icon.type;
    a.dataset.linkIconName = icon.name;
    if (icon.type === "text") a.dataset.linkIcon = icon.value;
    else a.style.setProperty("--link-icon", icon.value);
  }

  function iconElement(icon) {
    const el = document.createElement("span");
    el.className = "popup-icon";
    if (!icon) return el;
    if (icon.type === "site") {
      const img = document.createElement("img");
      img.src = icon.value;
      img.alt = "";
      el.appendChild(img);
    } else if (icon.type === "text") {
      el.textContent = icon.value;
      el.dataset.name = icon.name;
      el.classList.add("popup-icon-text");
    } else {
      el.classList.add("popup-icon-svg");
      el.style.setProperty("--link-icon", icon.value);
    }
    return el;
  }

  // ── Which links get popups ──────────────────────────────────────────────

  function parse(a) {
    const raw = a.getAttribute("href");
    if (!raw || raw.startsWith("#") || a.classList.contains("no-popup")) return null;
    let url;
    try { url = new URL(a.href); } catch (e) { return null; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Links back to the page you're already on.
    if (url.origin + url.pathname === location.origin + location.pathname) return null;
    return url;
  }

  function kindOf(url) {
    if (/(^|\.)wikipedia\.org$/.test(url.hostname) && url.pathname.startsWith("/wiki/")) return "wikipedia";
    if (isOwnHost(url.host)) return "local";
    return "external";
  }

  // ── Content loaders ─────────────────────────────────────────────────────

  let annotationsPromise = null;
  function annotations() {
    if (!annotationsPromise) {
      annotationsPromise = fetch(annotationsUrl)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return annotationsPromise;
  }

  const cache = new Map();
  function load(url, a) {
    const key = url.href;
    if (!cache.has(key)) {
      const loader = { wikipedia: loadWikipedia, local: loadLocal, external: loadAnnotation }[kindOf(url)];
      cache.set(key, loader(url, a).catch(() => loadAnnotation(url, a)));
    }
    return cache.get(key);
  }

  async function loadWikipedia(url) {
    const title = decodeURIComponent(url.pathname.slice("/wiki/".length));
    const api =
      url.origin +
      "/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1" +
      "&prop=extracts|pageimages&exintro=1&piprop=thumbnail&pithumbsize=320&titles=" +
      encodeURIComponent(title);
    const res = await fetch(api);
    if (!res.ok) throw new Error("wikipedia " + res.status);
    const page = (await res.json()).query.pages[0];
    if (!page || page.missing || !page.extract) throw new Error("no extract");
    const body = document.createElement("div");
    if (page.thumbnail) {
      const img = document.createElement("img");
      img.className = "popup-thumb";
      img.src = page.thumbnail.source;
      img.alt = "";
      body.appendChild(img);
    }
    body.appendChild(sanitize(page.extract, url));
    return { title: page.title, source: "Wikipedia", body };
  }

  async function loadLocal(url, a) {
    // Absolute links to liambald.win still preview the local copy when testing,
    // and root-relative paths resolve against the site root (for previews hosted
    // in a subfolder).
    const fetchUrl = url.origin === siteRoot.origin && url.pathname.startsWith(siteRoot.pathname)
      ? url
      : new URL(url.pathname.replace(/^\//, "") + url.search, siteRoot);
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error("local " + res.status);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const main = doc.querySelector("main.page");
    if (!main) throw new Error("not a site page"); // e.g. a separate app

    // Resolve relative links/images against the page they came from.
    main.querySelectorAll("[href]").forEach((el) => el.setAttribute("href", new URL(el.getAttribute("href"), fetchUrl).href));
    main.querySelectorAll("[src]").forEach((el) => el.setAttribute("src", new URL(el.getAttribute("src"), fetchUrl).href));
    main.querySelectorAll("script, .theme-toggle, iframe").forEach((el) => el.remove());
    // Drop "← Back to ..." footers; they mean nothing inside a popup.
    main.querySelectorAll("p").forEach((p) => {
      if (/^\s*←/.test(p.textContent)) p.remove();
    });
    // The homepage hides "Recent" entries older than 4 months with a script.
    const cutoff = new Date(new Date().getFullYear(), new Date().getMonth() - 4, 1);
    main.querySelectorAll(".recent-item[data-date]").forEach((item) => {
      const [y, m] = item.dataset.date.split("-").map(Number);
      if (new Date(y, m - 1, 1) < cutoff) item.remove();
    });
    main.querySelectorAll(".recent").forEach((s) => { if (!s.querySelector(".recent-item")) s.remove(); });
    // Footnote anchors would collide with the host page's ids.
    main.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

    const h1 = main.querySelector("h1");
    const title = h1 ? h1.textContent.trim() : doc.title;
    if (h1) h1.remove();

    const body = document.createElement("div");
    body.className = "popup-page";
    body.append(...main.childNodes);
    return { title, source: url.host === location.host ? "" : url.host, body };
  }

  async function loadAnnotation(url, a) {
    const all = await annotations();
    const entry = all[url.href] || all[a.getAttribute("href")];
    const body = document.createElement("div");
    if (!entry || !entry.html) {
      // Not annotated yet (run scripts/build_annotations.py): show where it goes.
      body.className = "popup-empty";
      const shown = url.href.replace(/^https?:\/\/(www\.)?/, "").split(/[?#]/)[0];
      try { body.textContent = decodeURI(shown); } catch (e) { body.textContent = shown; }
      return {
        title: (entry && entry.title) || a.textContent.trim() || url.hostname,
        source: url.hostname.replace(/^www\./, ""),
        body,
        compact: true,
      };
    }
    const meta = [entry.author, entry.date].filter(Boolean).join(" · ");
    if (meta) {
      const p = document.createElement("p");
      p.className = "popup-meta";
      p.textContent = meta;
      body.appendChild(p);
    }
    body.appendChild(sanitize(entry.html, url));
    return {
      title: entry.title || a.textContent.trim(),
      source: entry.site || url.hostname.replace(/^www\./, ""),
      body,
    };
  }

  // Keep only simple text formatting from outside HTML.
  const ALLOWED = new Set(["P", "EM", "I", "B", "STRONG", "A", "SUP", "SUB", "UL", "OL", "LI", "BLOCKQUOTE", "BR", "SPAN", "SMALL", "CODE"]);
  function sanitize(html, base) {
    const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    const frag = document.createDocumentFragment();
    (function walk(src, dest) {
      for (const node of src.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          dest.appendChild(document.createTextNode(node.textContent));
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (!ALLOWED.has(node.tagName)) {
            if (!["STYLE", "SCRIPT", "LINK", "META"].includes(node.tagName)) walk(node, dest);
            continue;
          }
          const el = document.createElement(node.tagName);
          if (node.tagName === "A" && node.getAttribute("href")) {
            try {
              const href = new URL(node.getAttribute("href"), base);
              if (href.protocol === "http:" || href.protocol === "https:") el.href = href.href;
            } catch (e) {}
          }
          walk(node, el);
          dest.appendChild(el);
        }
      }
    })(doc.body.firstChild, frag);
    // Drop the empty paragraphs Wikipedia leaves behind.
    frag.querySelectorAll && frag.querySelectorAll("p").forEach((p) => { if (!p.textContent.trim()) p.remove(); });
    return frag;
  }

  // ── Popup windows ───────────────────────────────────────────────────────

  let mouseX = 0, mouseY = 0, zIndex = 1000;
  document.addEventListener("mousemove", (e) => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });

  function openPopup(a) {
    const url = parse(a);
    if (!url) return;
    const parent = a.closest(".popup");
    // Only one popup per level: opening a new one replaces its siblings.
    allPopups().filter((p) => p._parent === parent).forEach(closePopup);

    const pop = document.createElement("div");
    pop.className = "popup popup-" + kindOf(url);
    pop._parent = parent;
    pop._link = a;
    pop.style.zIndex = ++zIndex;
    pop.setAttribute("role", "dialog");

    const bar = document.createElement("div");
    bar.className = "popup-bar";
    const titleLink = document.createElement("a");
    titleLink.className = "popup-title";
    titleLink.href = url.href;
    titleLink.textContent = a.textContent.trim() || url.hostname;
    if (a.target) titleLink.target = a.target;
    const source = document.createElement("span");
    source.className = "popup-source";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "popup-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.addEventListener("click", () => closePopup(pop));
    bar.append(iconElement(iconFor(url)), titleLink, source, close);

    const body = document.createElement("div");
    body.className = "popup-body";
    body.innerHTML = '<p class="popup-loading">Loading…</p>';

    pop.append(bar, body);
    document.body.appendChild(pop);
    a._popup = pop;
    a.classList.add("popup-open");
    position(pop, a);
    requestAnimationFrame(() => pop.classList.add("visible"));

    load(url, a).then((content) => {
      if (!pop.isConnected) return;
      titleLink.textContent = content.title;
      source.textContent = content.source || "";
      body.replaceChildren(content.body.cloneNode(true));
      body.querySelectorAll("a[href]").forEach(decorateLink);
      pop.classList.toggle("popup-compact", !!content.compact);
      position(pop, a);
    });
  }

  function allPopups() {
    return Array.from(document.querySelectorAll("body > .popup"));
  }

  function closePopup(pop) {
    allPopups().filter((p) => p._parent === pop).forEach(closePopup);
    clearTimeout(pop._closeTimer);
    if (pop._link) {
      pop._link._popup = null;
      pop._link.classList.remove("popup-open");
    }
    pop.remove();
  }

  function scheduleClose(pop) {
    clearTimeout(pop._closeTimer);
    pop._closeTimer = setTimeout(() => closePopup(pop), CLOSE_DELAY);
  }

  // Hovering a popup keeps it and every popup above it in the chain open.
  function keepOpen(pop) {
    for (let p = pop; p; p = p._parent) clearTimeout(p._closeTimer);
  }

  // Place below the hovered line of the link; flip above if it won't fit.
  function position(pop, a) {
    const rects = Array.from(a.getClientRects());
    const rect = rects.find((r) => mouseY >= r.top - 2 && mouseY <= r.bottom + 2) || rects[0] || a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const margin = 12, gap = 6;
    const w = pop.offsetWidth, h = pop.offsetHeight;

    let left = Math.min(Math.max(rect.left, mouseX - 40), vw - margin - w);
    left = Math.max(margin, left);
    let top = rect.bottom + gap;
    if (top + h > vh - margin) {
      top = rect.top - gap - h >= margin ? rect.top - gap - h : Math.max(margin, vh - margin - h);
    }
    pop.style.left = left + window.scrollX + "px";
    pop.style.top = top + window.scrollY + "px";
  }

  document.addEventListener("mouseover", (e) => {
    const pop = e.target.closest(".popup");
    if (pop) keepOpen(pop);

    const a = e.target.closest("a[href]");
    if (!a || a.contains(e.relatedTarget) || a.closest(".popup-bar") || !parse(a)) return;
    if (a._popup) { keepOpen(a._popup); return; }
    clearTimeout(a._openTimer);
    a._openTimer = setTimeout(() => openPopup(a), OPEN_DELAY);
  });

  document.addEventListener("mouseout", (e) => {
    const a = e.target.closest("a[href]");
    if (a && !a.contains(e.relatedTarget)) {
      clearTimeout(a._openTimer);
      if (a._popup) scheduleClose(a._popup);
    }
    const pop = e.target.closest(".popup");
    if (pop && !pop.contains(e.relatedTarget)) scheduleClose(pop);
  });

  // Clicking a link dismisses any pending popup; Esc / outside click closes all.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (a) clearTimeout(a._openTimer);
    if (!e.target.closest(".popup")) allPopups().forEach(closePopup);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") allPopups().forEach(closePopup);
  });

  // ── Init ────────────────────────────────────────────────────────────────

  document.querySelectorAll("main a[href]").forEach(decorateLink);
  annotations(); // warm the cache so the first external popup is instant
})();
