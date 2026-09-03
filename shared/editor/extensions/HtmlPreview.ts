/**
 * Renders a live preview of a ```htmlpreview code block underneath it.
 *
 * The code fence stays visible and editable — it is the source — but is capped
 * to a few lines and scrolls, so a large paste doesn't take over the page. The
 * preview itself renders in a tall, fixed "window" below that scrolls its own
 * content. A widget decoration holds the window, exactly as the tasks query
 * extension appends its results.
 *
 * The block accepts either plain HTML or a pasted MHTML archive (a saved
 * "Webpage, Single File", e.g. an offline Claude artifact). MHTML is detected
 * and reconstructed into a single self-contained HTML string — assets inlined
 * as data: URLs — before rendering; see `../lib/mhtml`.
 *
 * The HTML runs inside an iframe with `sandbox="allow-scripts allow-popups"`
 * and deliberately WITHOUT `allow-same-origin`, so it executes in a null
 * origin: it can render and run its own scripts (and pull public assets such as
 * a CDN library) but cannot reach this app's DOM, cookies, API or localStorage.
 * That isolation is the point — page content is authored by any workspace
 * member, so the preview is treated as untrusted.
 *
 * This module is part of `shared/`, so it is also compiled for the server. All
 * browser access is guarded; on the server it contributes nothing beyond its
 * imports.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import Extension from "../lib/Extension";
import { looksLikeMhtml, parseMhtml } from "../lib/mhtml";

export const pluginKey = new PluginKey("htmlPreview");

/** The code fence language that turns a block into a rendered HTML preview. */
export const HtmlPreviewLanguage = "htmlpreview";

/** How long to wait after the last keystroke before re-rendering. */
const DebounceMs = 500;

/** Height of the render window. Tall on purpose; content scrolls within it. */
const RenderHeightPx = 800;

/** How tall the source fence may grow before it scrolls — roughly five lines. */
const SourceMaxHeight = "8.5em";

/** id of the once-injected stylesheet that caps the source fence height. */
const SourceStyleId = "html-preview-source-style";

const isBrowser = typeof window !== "undefined";

/**
 * Returns true when the node is a code fence carrying an HTML preview.
 */
export function isHtmlPreview(node: ProsemirrorNode): boolean {
  return (
    (node.type.name === "code_fence" || node.type.name === "code_block") &&
    node.attrs.language === HtmlPreviewLanguage
  );
}

/** Escapes text for safe insertion into an HTML error page. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Makes links open in a new browser tab rather than navigating the preview
 * frame in place. Only links that go somewhere other than an in-page #anchor
 * are touched, and only when the author hasn't already set a target — so a
 * table-of-contents anchor still scrolls within the preview. Paired with the
 * frame's `allow-popups-to-escape-sandbox`, the opened tab is a normal
 * top-level page (cookies, login), not a crippled sandboxed one. Done as a
 * static rewrite because the host CSP won't run an inline script to do it.
 */
function addLinkTargets(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs: string) => {
    if (!/\bhref\s*=/i.test(attrs) || /\btarget\s*=/i.test(attrs)) {
      return match;
    }
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const value = href ? (href[2] ?? href[3] ?? href[4] ?? "") : "";
    if (value.startsWith("#")) {
      return match;
    }
    return `<a${attrs} target="_blank" rel="noopener noreferrer">`;
  });
}

/**
 * Turns the block's source into the HTML to render: an MHTML archive is
 * reconstructed; anything else is treated as HTML verbatim. Either way, links
 * are rewritten to open in a new tab.
 */
function toRenderableHtml(source: string): string {
  let html: string;
  if (looksLikeMhtml(source)) {
    try {
      const parsed = parseMhtml(source);
      if (!parsed) {
        return `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;color:#b00;padding:12px">Could not read this MHTML archive.</body>`;
      }
      html = parsed;
    } catch (err) {
      return `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;color:#b00;padding:12px">MHTML error: ${escapeHtml(
        String(err)
      )}</body>`;
    }
  } else {
    html = source;
  }
  return addLinkTargets(html);
}

/**
 * Owns one rendered preview: its wrapper element, the iframe inside it and the
 * debounce timer that throttles re-renders while the user types.
 */
class PreviewRenderer {
  public readonly element: HTMLElement;
  private readonly frame: HTMLIFrameElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSource: string | undefined;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "html-preview";
    this.element.contentEditable = "false";
    this.element.setAttribute("data-html-preview", "true");
    this.element.style.cssText = [
      "margin: -0.5em 0 1em",
      "border: 1px solid var(--divider-color, rgba(0,0,0,0.1))",
      "border-top: 0",
      "border-radius: 0 0 4px 4px",
      "overflow: hidden",
    ].join(";");

    this.frame = document.createElement("iframe");
    // No allow-same-origin: the content runs in a null origin and cannot reach
    // this app. allow-scripts lets legitimate widgets and charts run.
    this.frame.setAttribute(
      "sandbox",
      "allow-scripts allow-popups allow-popups-to-escape-sandbox"
    );
    this.frame.setAttribute("referrerpolicy", "no-referrer");
    this.frame.setAttribute("loading", "lazy");
    this.frame.setAttribute("title", "HTML preview");
    this.frame.style.cssText = [
      "display: block",
      "width: 100%",
      "border: 0",
      // A tall, fixed window: the rendered page scrolls inside it, so even a
      // very long artifact never stretches the document out of hand.
      `height: ${RenderHeightPx}px`,
      "background: #ffffff",
    ].join(";");

    this.element.appendChild(this.frame);
  }

  /**
   * Re-renders if the source changed. Repeated calls with the same source are
   * no-ops, which keeps typing elsewhere in the document from reloading it.
   */
  public update(source: string) {
    if (source === this.lastSource) {
      return;
    }
    this.lastSource = source;

    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.render(source), DebounceMs);
  }

  public destroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private render(source: string) {
    this.frame.srcdoc = source.trim() ? toRenderableHtml(source) : "";
  }
}

/**
 * Collects every HTML preview block in the document, in order.
 */
function findPreviewBlocks(doc: ProsemirrorNode) {
  const blocks: { node: ProsemirrorNode; pos: number }[] = [];

  doc.descendants((node, pos) => {
    if (isHtmlPreview(node)) {
      blocks.push({ node, pos });
      return false;
    }
    return true;
  });

  return blocks;
}

function buildDecorations(
  doc: ProsemirrorNode,
  renderers: Map<number, PreviewRenderer>
) {
  const blocks = findPreviewBlocks(doc);
  const decorations: Decoration[] = [];
  const seen = new Set<number>();

  blocks.forEach((block, index) => {
    seen.add(index);

    let renderer = renderers.get(index);
    if (!renderer) {
      renderer = new PreviewRenderer();
      renderers.set(index, renderer);
    }
    renderer.update(block.node.textContent);

    decorations.push(
      Decoration.widget(block.pos + block.node.nodeSize, renderer.element, {
        side: 1,
        ignoreSelection: true,
        key: `html-preview-${index}`,
      })
    );
  });

  // Tear down renderers for blocks that no longer exist.
  for (const [index, renderer] of renderers) {
    if (!seen.has(index)) {
      renderer.destroy();
      renderers.delete(index);
    }
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Injects, once, the rule that caps the source fence to a few scrolling lines.
 * Targets the `data-language` attribute the code fence already renders, so it
 * only ever affects htmlpreview blocks and needs no per-node decoration.
 */
function ensureSourceStyle() {
  if (document.getElementById(SourceStyleId)) {
    return;
  }
  const style = document.createElement("style");
  style.id = SourceStyleId;
  style.textContent =
    `[data-language="${HtmlPreviewLanguage}"] > pre{` +
    `max-height:${SourceMaxHeight};overflow:auto}`;
  document.head.appendChild(style);
}

export default class HtmlPreview extends Extension {
  get name() {
    return "htmlPreview";
  }

  /** Previews must render for readers too, not only editors. */
  get allowInReadOnly() {
    return true;
  }

  get plugins() {
    // The server compiles this file too, but never renders; bail out rather
    // than reaching for `document` or `window`.
    if (!isBrowser) {
      return [];
    }

    const renderers = new Map<number, PreviewRenderer>();

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, renderers),
          apply: (tr, value: DecorationSet) => {
            if (!tr.docChanged) {
              return value.map(tr.mapping, tr.doc);
            }
            return buildDecorations(tr.doc, renderers);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
        view: () => {
          ensureSourceStyle();
          return {
            destroy: () => {
              renderers.forEach((renderer) => renderer.destroy());
              renderers.clear();
            },
          };
        },
      }),
    ];
  }
}
