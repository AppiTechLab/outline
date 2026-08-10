import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import Extension from "@shared/editor/lib/Extension";
// Relative rather than aliased: tsconfig maps `plugins/*` but vite.config.ts
// does not, so only a relative path resolves in the client bundle. Importing
// rather than reimplementing keeps anchor ids identical to the ones the tags
// plugin generates server side — if they drift, every deep link breaks.
import {
  anchorId,
  expandNested,
  normalizeTag,
  tagPath,
} from "../../../plugins/tags/shared/parser";
import history from "~/utils/history";

export const pluginKey = new PluginKey("tag-highlight");

/**
 * Matches a hashtag within a single text node.
 *
 * Deliberately kept in step with the `tags` plugin's parser: a boundary, then a
 * hash, then a letter-led term that may contain slashes. Group 1 is the
 * boundary, so the tag itself begins after it.
 */
const TAG_RE = /(^|[\s(\[])#([A-Za-zÀ-ÿ][\wÀ-ÿ-]*(?:\/[\wÀ-ÿ-]+)*)/gu;

const HEX_COLOR_RE = /^[0-9a-fA-F]{3,8}$/;

function isColorLike(tag: string): boolean {
  return (
    (tag.length === 3 ||
      tag.length === 4 ||
      tag.length === 6 ||
      tag.length === 8) &&
    HEX_COLOR_RE.test(tag)
  );
}

type Found = { from: number; to: number; tag: string };

/**
 * Collects every tag occurrence in the document, in reading order.
 *
 * Code is skipped rather than stripped: in a Prosemirror document the code
 * block and the inline code mark are structural, so there's no need for the
 * text-mangling the markdown parser has to do.
 */
function findTags(doc: ProsemirrorNode): Found[] {
  const found: Found[] = [];

  doc.descendants((node, pos) => {
    if (node.type.spec.code) {
      return false;
    }

    if (!node.isText || !node.text) {
      return true;
    }

    if (node.marks.some((mark) => mark.type.name === "code_inline")) {
      return false;
    }

    const text = node.text;
    let match: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;

    while ((match = TAG_RE.exec(text)) !== null) {
      const raw = match[2].replace(/[/-]+$/, "");
      if (!raw || isColorLike(raw)) {
        continue;
      }

      // Group 1 is the boundary character, which is not part of the tag.
      const start = match.index + match[1].length;
      found.push({
        from: pos + start,
        // +1 for the hash itself.
        to: pos + start + raw.length + 1,
        tag: raw,
      });
    }

    return true;
  });

  return found;
}

function buildDecorations(doc: ProsemirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  // Anchors are numbered per tag, and a nested tag counts towards each of its
  // ancestors, so `#a/b` is simultaneously an occurrence of `a` and of `a/b`.
  // The tags plugin numbers them the same way; `anchorId` is imported from it
  // rather than reimplemented so the two cannot drift.
  const counters = new Map<string, number>();

  for (const { from, to, tag } of findTags(doc)) {
    decorations.push(
      Decoration.inline(from, to, {
        nodeName: "span",
        "data-tag": normalizeTag(tag),
        // Inline rather than a class, to avoid patching the editor stylesheet
        // for one rule. currentColor keeps it legible in both themes.
        style: [
          "color: var(--accent, #0366d6)",
          "background: rgba(3, 102, 214, 0.08)",
          "border-radius: 3px",
          "padding: 0 2px",
          "cursor: pointer",
        ].join(";"),
      })
    );

    for (const variant of expandNested(tag)) {
      const key = normalizeTag(variant);
      const occurrence = counters.get(key) ?? 0;
      counters.set(key, occurrence + 1);

      decorations.push(
        Decoration.widget(
          from,
          () => {
            const anchor = document.createElement("a");
            anchor.id = anchorId(key, occurrence);
            // Zero-size and out of the flow: this exists only as a
            // scroll target for Editor.scrollToAnchor.
            anchor.style.cssText =
              "display:inline-block;width:0;height:0;overflow:hidden";
            return anchor;
          },
          { side: -1, key: anchorId(key, occurrence) }
        )
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Highlights `#tags` in the document and makes them clickable.
 *
 * Decorations rather than a schema mark: tags stay plain text, so nothing is
 * added to the document that could fail to serialize, and existing documents
 * light up without migration.
 *
 * Each occurrence also gets an invisible anchor, which is what lets the tag
 * browser link to a specific line — `Editor.scrollToAnchor` already watches for
 * an element matching `window.location.hash` and scrolls to it.
 */
export default class TagHighlight extends Extension {
  get name() {
    return "tag-highlight";
  }

  /** Readers benefit from this as much as authors. */
  get allowInReadOnly() {
    return true;
  }

  get plugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (tr, value: DecorationSet) =>
            tr.docChanged ? buildDecorations(tr.doc) : value.map(tr.mapping, tr.doc),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleDOMEvents: {
            // Modifier-free clicks only, so cmd-click, text selection and
            // placing the caret inside a tag to edit it all still work.
            mousedown: (_view, event: MouseEvent) => {
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              ) {
                return false;
              }

              const target = event.target as HTMLElement | null;
              const element = target?.closest?.("[data-tag]");
              const tag = element?.getAttribute("data-tag");

              if (!tag) {
                return false;
              }

              event.preventDefault();
              history.push(tagPath(tag));
              return true;
            },
          },
        },
      }),
    ];
  }
}
