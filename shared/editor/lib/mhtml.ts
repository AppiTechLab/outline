/**
 * A small, dependency-free MHTML (MIME HTML, `.mhtml`/`.mht`) reader.
 *
 * MHTML is what a browser's "Save page as — Webpage, Single File" produces: a
 * `multipart/related` MIME message bundling the page's HTML together with every
 * asset it needs (images, CSS, fonts) as separate parts. This module turns such
 * an archive back into a single self-contained HTML string, with each asset
 * inlined as a `data:` URL, so it can be dropped straight into a sandboxed
 * iframe with no network access.
 *
 * It is intentionally pragmatic rather than a full RFC 2557 implementation:
 * assets are matched to references by their absolute `Content-Location` (and by
 * `cid:` for Content-ID references), which is the form a saved Claude artifact
 * or a Chrome-saved page uses. A self-contained artifact saved to MHTML is
 * usually a single HTML part, which this handles as the trivial case.
 *
 * Pure functions only — this file compiles for the server too, but is invoked
 * only in the browser. `atob`/`btoa`/`TextDecoder` exist in both environments.
 */

/** Cheap check: does this text look like an MHTML archive? */
export function looksLikeMhtml(raw: string): boolean {
  const head = raw.slice(0, 4000);
  return (
    /content-type:\s*multipart\/related/i.test(head) && /boundary=/i.test(head)
  );
}

/** A single decoded MIME part. */
type Part = {
  headers: Map<string, string>;
  contentType: string;
  /** Lowercased, e.g. "text/html". */
  mime: string;
  location?: string;
  /** Content-ID with the surrounding angle brackets stripped. */
  contentId?: string;
  bytes: Uint8Array;
};

/** Unfolds MIME header continuation lines, then splits into name→value. */
function parseHeaders(block: string): Map<string, string> {
  const unfolded = block.replace(/\r?\n[\t ]+/g, " ");
  const headers = new Map<string, string>();
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name) {
      headers.set(name, value);
    }
  }
  return headers;
}

/** Extracts a parameter such as boundary="…" or type=… from a header value. */
function getParam(headerValue: string | undefined, name: string): string | undefined {
  if (!headerValue) {
    return undefined;
  }
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, "i");
  const match = re.exec(headerValue);
  if (!match) {
    return undefined;
  }
  return match[2] !== undefined ? match[2] : match[3];
}

function decodeQuotedPrintable(input: string): Uint8Array {
  const normalized = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "=" && i + 2 < normalized.length) {
      const hex = normalized.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(normalized.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(bytes);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function rawToBytes(input: string): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input.charCodeAt(i) & 0xff;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(bin);
}

function decodeBody(body: string, encoding: string | undefined): Uint8Array {
  switch ((encoding ?? "").toLowerCase()) {
    case "base64":
      return base64ToBytes(body);
    case "quoted-printable":
      return decodeQuotedPrintable(body);
    default:
      // 7bit, 8bit, binary, or unspecified: bytes are the characters as-is.
      return rawToBytes(body);
  }
}

/** Reads the charset from a Content-Type, defaulting to utf-8. */
function charsetOf(contentType: string): string {
  return (getParam(contentType, "charset") ?? "utf-8").toLowerCase();
}

function bytesToText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Splits the message body into raw part strings using the MIME boundary. */
function splitParts(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const segments = body.split(marker);
  const parts: string[] = [];
  // segments[0] is the preamble; a segment starting with "--" is the closer.
  for (let i = 1; i < segments.length; i++) {
    let seg = segments[i];
    if (seg.startsWith("--")) {
      break;
    }
    seg = seg.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    parts.push(seg);
  }
  return parts;
}

/** Parses one raw part into headers plus decoded bytes. */
function parsePart(raw: string): Part | undefined {
  const split = /\r?\n\r?\n/.exec(raw);
  if (!split) {
    return undefined;
  }
  const headerText = raw.slice(0, split.index);
  const body = raw.slice(split.index + split[0].length);
  const headers = parseHeaders(headerText);

  const contentType = headers.get("content-type") ?? "application/octet-stream";
  const cidRaw = headers.get("content-id");
  return {
    headers,
    contentType,
    mime: contentType.split(";")[0].trim().toLowerCase(),
    location: headers.get("content-location"),
    contentId: cidRaw ? cidRaw.replace(/^<|>$/g, "") : undefined,
    bytes: decodeBody(body, headers.get("content-transfer-encoding")),
  };
}

/** Escapes a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces every occurrence of each key string with its mapped value. */
function replaceAll(text: string, map: Map<string, string>): string {
  // Longest keys first so one URL can't clobber another it is a prefix of.
  const keys = Array.from(map.keys()).sort((a, b) => b.length - a.length);
  let out = text;
  for (const key of keys) {
    if (key) {
      out = out.split(key).join(map.get(key) as string);
    }
  }
  return out;
}

/**
 * Parses an MHTML archive into a single self-contained HTML string.
 *
 * @returns the reconstructed HTML, or null if the input isn't parseable MHTML.
 */
export function parseMhtml(raw: string): string | null {
  if (!looksLikeMhtml(raw)) {
    return null;
  }

  const headerSplit = /\r?\n\r?\n/.exec(raw);
  if (!headerSplit) {
    return null;
  }
  const topHeaders = parseHeaders(raw.slice(0, headerSplit.index));
  const topContentType = topHeaders.get("content-type");
  const boundary = getParam(topContentType, "boundary");
  if (!boundary) {
    return null;
  }

  const body = raw.slice(headerSplit.index + headerSplit[0].length);
  const parts = splitParts(body, boundary)
    .map(parsePart)
    .filter((p): p is Part => p !== undefined);

  if (!parts.length) {
    return null;
  }

  // Pick the root HTML part: the one named by `start`, else the first HTML part.
  const start = getParam(topContentType, "start")?.replace(/^<|>$/g, "");
  let root =
    (start && parts.find((p) => p.contentId === start)) ||
    parts.find((p) => p.mime === "text/html") ||
    parts[0];

  const resources = parts.filter((p) => p !== root);

  // Phase 1: data URLs for binary/non-CSS assets (images, fonts, scripts).
  // Images keep data: URLs, which the host CSP allows for img-src.
  const assetMap = new Map<string, string>();
  const cssParts: Part[] = [];
  for (const part of resources) {
    if (part.mime === "text/css") {
      cssParts.push(part);
      continue;
    }
    const dataUrl = `data:${part.mime};base64,${bytesToBase64(part.bytes)}`;
    if (part.location) {
      assetMap.set(part.location, dataUrl);
    }
    if (part.contentId) {
      assetMap.set(`cid:${part.contentId}`, dataUrl);
    }
  }

  // Phase 2: decode each stylesheet and inline its own asset references. The
  // sheet is injected as a <style> element, not a `data:` <link> — the host CSP
  // allows inline styles (style-src 'unsafe-inline') but not `style-src data:`,
  // so a data: stylesheet link would be refused and the page would render
  // unstyled.
  const styles = cssParts.map((part) => ({
    locations: [
      part.location,
      part.contentId ? `cid:${part.contentId}` : undefined,
    ].filter((v): v is string => !!v),
    // `@charset` is only valid in an external sheet; strip it for inlining.
    css: replaceAll(
      bytesToText(part.bytes, charsetOf(part.contentType)),
      assetMap
    ).replace(/^\uFEFF?\s*@charset[^;]*;/i, ""),
  }));

  // Phase 3: inline images in the root HTML, then swap each stylesheet <link>
  // for its <style>. A sheet whose link isn't found is appended to <head> so
  // its rules still apply.
  let html = replaceAll(
    bytesToText(root.bytes, charsetOf(root.contentType)),
    assetMap
  );
  const leftover: string[] = [];
  for (const sheet of styles) {
    const styleTag = `<style>${sheet.css}</style>`;
    let injected = false;
    for (const loc of sheet.locations) {
      const linkRe = new RegExp(
        `<link\\b[^>]*href\\s*=\\s*["']${escapeRegExp(loc)}["'][^>]*>`,
        "gi"
      );
      if (linkRe.test(html)) {
        html = html.replace(linkRe, styleTag);
        injected = true;
        break;
      }
    }
    if (!injected) {
      leftover.push(styleTag);
    }
  }
  if (leftover.length) {
    const blob = leftover.join("");
    html = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, `${blob}</head>`)
      : blob + html;
  }
  return html;
}
