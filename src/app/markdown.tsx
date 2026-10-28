/** @jsxImportSource solid-js */
import { createMemo } from "solid-js";
import { Marked } from "marked";
import DOMPurify from "dompurify";

const escapeText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', "&quot;");

const markdown = new Marked({
  gfm: true,
  renderer: {
    // Model output is untrusted. HTML is displayed as text, never executed.
    html: ({ text }) => escapeText(text),
    // Never fetch model-supplied image URLs automatically; keep them as links.
    image: ({ href, text }) => `<a href="${escapeAttribute(href)}">${escapeText(text || "View image")}</a>`,
    checkbox: ({ checked }) => checked ? "☑ " : "☐ ",
  },
});

const allowedTags = ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "del", "blockquote", "pre", "code",
  "a", "table", "thead", "tbody", "tr", "th", "td", "span"];

const allowedProtocols = ["https:", "http:", "mailto:"];

const render = (text: string) => {
  const fragment = DOMPurify.sanitize(markdown.parse(text, { async: false }), {
    RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: ["href", "title", "start"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });

  for (const link of fragment.querySelectorAll("a[href]")) {
    try {
      const url = new URL(link.getAttribute("href") ?? "", location.href);

      if (!allowedProtocols.includes(url.protocol)) {
        link.removeAttribute("href");
        continue;
      }

      if (url.protocol !== "mailto:") {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    } catch { link.removeAttribute("href"); }
  }

  for (const table of fragment.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "chat-table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Scrollable table");
    table.replaceWith(scroll);
    scroll.append(table);
  }

  const container = document.createElement("div");
  container.append(fragment);

  return container.innerHTML;
};

export function Markdown(props: { text: string }) {
  const html = createMemo(() => render(props.text));

  // Only allowlisted, sanitized markup reaches this sink; raw source and URLs are
  // never interpolated into HTML afterward.
  return <div class="chat-markdown" innerHTML={html()} />;
}
