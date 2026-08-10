/**
 * Extracts #hashtags from document markdown.
 *
 * Outline has no tag primitive, so a tag is simply a `#word` written in the
 * text. That makes the parser's job mostly about *not* matching things that
 * merely contain a hash: URLs with fragments, CSS colours, code, headings.
 */

/**
 * A hashtag: `#` preceded by start-of-line or whitespace, then at least one
 * letter, then word characters, hyphens or slashes.
 *
 * Requiring a letter first rejects `#1`, `#2026` and CSS colours like `#fff`
 * only partially — see `isColorLike` for the rest. The leading-boundary
 * requirement is what keeps `page#section` and `https://x/y#anchor` out.
 */
const TAG_RE = /(^|[\s(\[])#([A-Za-zÀ-ÿ][\wÀ-ÿ-]*(?:\/[\wÀ-ÿ-]+)*)/gu;

/** Fenced code blocks and inline code spans, removed before scanning. */
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;

/** Markdown link and image targets, removed so URL fragments aren't tags. */
const LINK_TARGET_RE = /\]\([^)]*\)/g;

/** Bare URLs, removed for the same reason. */
const BARE_URL_RE = /https?:\/\/\S+/g;

/**
 * A markdown-escaped hash.
 *
 * Outline's serializer escapes `#` when it starts a line, so the paragraph
 * doesn't round-trip as a heading — see `esc()` in
 * `shared/editor/lib/markdown/serializer.ts`. A tag written on its own line
 * therefore reaches us as `\#wp1`, and the backslash is not one of the
 * characters the tag pattern allows before a hash.
 *
 * The escape is inserted by the serializer rather than by the author, so
 * undoing it is a faithful reading of what was written.
 */
const ESCAPED_HASH_RE = /\\#/g;

/** Three, four, six or eight hex digits — `#fff`, `#aabbcc`. */
const HEX_COLOR_RE = /^[0-9a-fA-F]{3,8}$/;

export type TagCount = {
  /** Lowercased form, used for matching and as the stable key. */
  tag: string;
  /** First-seen casing, used for display. */
  display: string;
  /** How many documents contain it. */
  count: number;
};

/**
 * True for strings that look like a CSS hex colour rather than a tag.
 *
 * `#fff` and `#DEADBEEF` are valid hex and also plausible words, so length and
 * composition are the only signal available.
 */
function isColorLike(tag: string): boolean {
  return (
    (tag.length === 3 ||
      tag.length === 4 ||
      tag.length === 6 ||
      tag.length === 8) &&
    HEX_COLOR_RE.test(tag)
  );
}

/**
 * Strips the regions of a markdown document where a `#` is never a tag.
 *
 * Headings are left alone deliberately: `# Heading` doesn't match TAG_RE
 * anyway, because a heading's hash is followed by a space.
 */
function stripNonTagRegions(markdown: string): string {
  return markdown
    .replace(CODE_RE, " ")
    .replace(LINK_TARGET_RE, " ")
    .replace(BARE_URL_RE, " ")
    // After the strips, so an escaped hash inside code is already gone.
    .replace(ESCAPED_HASH_RE, "#");
}

/**
 * Expands a nested tag into itself and all of its ancestors.
 *
 * `#project/alpha/spec` yields `project/alpha/spec`, `project/alpha` and
 * `project`, so filtering by a parent finds everything beneath it.
 */
export function expandNested(tag: string): string[] {
  const segments = tag.split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

/**
 * Extracts every tag in a document.
 *
 * @param markdown The document body.
 * @param options.nested Whether to include ancestors of nested tags.
 * @returns lowercased tags mapped to their first-seen display casing, in the
 *   order encountered.
 */
export function extractTags(
  markdown: string,
  options: { nested?: boolean } = {}
): Map<string, string> {
  const { nested = true } = options;
  const found = new Map<string, string>();
  const text = stripNonTagRegions(markdown);

  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(text)) !== null) {
    const raw = match[2];

    if (isColorLike(raw)) {
      continue;
    }

    // A trailing slash or hyphen reads as punctuation, not part of the tag.
    const trimmed = raw.replace(/[/-]+$/, "");
    if (!trimmed) {
      continue;
    }

    const variants = nested ? expandNested(trimmed) : [trimmed];

    for (const variant of variants) {
      const key = variant.toLowerCase();
      if (!found.has(key)) {
        found.set(key, variant);
      }
    }
  }

  return found;
}

/**
 * Aggregates per-document tag maps into counts across a workspace.
 *
 * @param documents One tag map per document, as returned by extractTags.
 * @returns tags sorted by descending count, then alphabetically.
 */
export function countTags(documents: Map<string, string>[]): TagCount[] {
  const counts = new Map<string, { display: string; count: number }>();

  for (const tags of documents) {
    for (const [key, display] of tags) {
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { display, count: 1 });
      }
    }
  }

  return Array.from(counts, ([tag, { display, count }]) => ({
    tag,
    display,
    count,
  })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Normalises user input into a matchable tag key, so `#Project/Alpha`,
 * `Project/Alpha` and `project/alpha` all resolve to the same thing.
 */
export function normalizeTag(input: string): string {
  return input.trim().replace(/^#/, "").replace(/[/-]+$/, "").toLowerCase();
}

/**
 * Builds the DOM id used to jump to one occurrence of a tag.
 *
 * The editor renders an anchor with this id beside every tag, and the tag
 * browser links to it. Both sides derive it from the same function so they
 * cannot drift apart. Slashes become hyphens because the id is fed to
 * `querySelector` as a fragment selector.
 *
 * @param tag The normalised tag.
 * @param occurrence Zero-based index of this occurrence within the document.
 */
export function anchorId(tag: string, occurrence: number): string {
  return `tag-${normalizeTag(tag).replace(/\//g, "-")}-${occurrence}`;
}

/**
 * URL of the page listing every line that mentions a tag.
 *
 * Nested tags keep their slashes and become path segments, so
 * `#PM/assign/Antoine` reads as `/tags/pm/assign/antoine` rather than a mess of
 * percent-encoding. The route is declared with `:tag+` to match them.
 */
export function tagPath(tag: string): string {
  return `/tags/${normalizeTag(tag)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** One line of a document that mentions a tag. */
export type TagLine = {
  /** Zero-based line number in the serialized markdown. */
  lineNumber: number;
  /** Zero-based index of this occurrence within the document. */
  occurrence: number;
  /** The line's text, cleaned of markdown escapes, for display. */
  text: string;
  /** DOM id to jump to. */
  anchor: string;
};

/**
 * Finds the lines of a document that carry a given tag.
 *
 * Occurrence numbering counts every appearance of the tag in document order,
 * including several on one line, so it matches the order the editor renders
 * its anchors in.
 *
 * @param markdown The serialized document.
 * @param tag The tag to look for, normalised or not.
 * @param options.nested Whether `#a/b` should satisfy a search for `#a`.
 */
export function findTagLines(
  markdown: string,
  tag: string,
  options: { nested?: boolean } = {}
): TagLine[] {
  const { nested = true } = options;
  const wanted = normalizeTag(tag);
  const lines = stripNonTagRegions(markdown).split("\n");
  const displayLines = markdown.split("\n");

  const found: TagLine[] = [];
  let occurrence = 0;

  lines.forEach((line, lineNumber) => {
    let match: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;

    while ((match = TAG_RE.exec(line)) !== null) {
      const raw = match[2].replace(/[/-]+$/, "");
      if (!raw || isColorLike(raw)) {
        continue;
      }

      const variants = nested ? expandNested(raw) : [raw];
      if (!variants.some((variant) => variant.toLowerCase() === wanted)) {
        // Still an occurrence of *some* tag, but not this one — and the
        // editor numbers anchors per tag, so it must not advance the counter.
        continue;
      }

      found.push({
        lineNumber,
        occurrence,
        // The raw line rather than the stripped one, so code and links read
        // normally in the results; only the serializer's escapes are undone.
        text: (displayLines[lineNumber] ?? "").replace(/\\([#\-*+:])/g, "$1").trim(),
        anchor: anchorId(wanted, occurrence),
      });
      occurrence++;
    }
  });

  return found;
}
