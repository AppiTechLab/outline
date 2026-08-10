/**
 * Loads the approved tag vocabulary from a designated Outline document.
 *
 * Keeping the list in a normal document rather than a settings table means the
 * taxonomy is edited like any other page: permissions decide who may change it,
 * and revision history records who changed it and when. There is nothing new to
 * back up and no new UI to build.
 *
 * The document needs no special syntax — every `#tag` written in it is
 * approved, so it can be a readable page with headings and explanations rather
 * than a bare list.
 */

import { Op } from "sequelize";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import Logger from "@server/logging/Logger";
import { extractTags } from "../shared/parser";
import env from "./env";

export type Vocabulary = {
  /** Lowercased approved tags, for matching. */
  approved: Set<string>;
  /** Lowercased tag mapped to its display casing. */
  display: Map<string, string>;
  /** The document the list came from, when one was found. */
  documentId?: string;
  documentTitle?: string;
  documentUrl?: string;
  /** True when no vocabulary document exists, meaning "allow everything". */
  unconfigured: boolean;
};

type CacheEntry = { value: Vocabulary; expiresAt: number };

// Keyed by team so a multi-team install can't leak one team's taxonomy into
// another's. Each web process keeps its own copy; the TTL is short enough that
// they converge quickly after an edit.
const cache = new Map<string, CacheEntry>();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Finds the vocabulary document, by explicit id/urlId when configured and by
 * title otherwise.
 */
async function findVocabularyDocument(
  teamId: string
): Promise<Document | null> {
  const identifier = env.TAGS_VOCABULARY_DOCUMENT;

  const base = {
    teamId,
    deletedAt: { [Op.eq]: null },
    archivedAt: { [Op.eq]: null },
  };

  if (identifier) {
    return Document.unscoped().findOne({
      attributes: ["id", "urlId", "title", "text", "content"],
      where: UUID_RE.test(identifier)
        ? { ...base, id: identifier }
        : { ...base, urlId: identifier },
    });
  }

  // Case-insensitive, because "Tag Vocabulary" and "Tag vocabulary" are the
  // same intent and an exact match makes for a baffling failure. Oldest wins
  // if someone has created two, so the vocabulary doesn't change when a
  // duplicate appears.
  return Document.unscoped().findOne({
    attributes: ["id", "urlId", "title", "text", "content"],
    where: {
      ...base,
      title: { [Op.iLike]: env.TAGS_VOCABULARY_TITLE },
    },
    order: [["createdAt", "ASC"]],
  });
}

/**
 * Returns the approved vocabulary for a team.
 *
 * When no vocabulary document exists the result is `unconfigured`, and callers
 * should treat every tag as approved — a workspace that hasn't opted in
 * shouldn't suddenly see all of its tags flagged as unrecognised.
 *
 * @param teamId The team to load the vocabulary for.
 */
export async function getVocabulary(teamId: string): Promise<Vocabulary> {
  const cached = cache.get(teamId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let value: Vocabulary;

  try {
    const document = await findVocabularyDocument(teamId);

    if (!document) {
      value = {
        approved: new Set(),
        display: new Map(),
        unconfigured: true,
      };
    } else {
      // Deliberately not `document.text`. That column is deprecated upstream
      // and, crucially, documentCollaborativeUpdater never writes it — it
      // persists only `content` and `state`. A document edited in the browser
      // therefore has stale or empty `text` while `content` is current.
      const markdown = await DocumentHelper.toMarkdown(document, {
        includeTitle: false,
      });

      // Nested expansion means listing #project/alpha also approves #project,
      // which is what a reader of the document would assume.
      const tags = extractTags(markdown, { nested: true });

      value = {
        approved: new Set(tags.keys()),
        display: tags,
        documentId: document.id,
        documentTitle: document.title || "Untitled",
        documentUrl: document.path,
        unconfigured: false,
      };
    }
  } catch (err) {
    Logger.warn("Failed to load tag vocabulary", {
      teamId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail open: a broken vocabulary lookup shouldn't make every tag in the
    // workspace look wrong.
    value = { approved: new Set(), display: new Map(), unconfigured: true };
  }

  cache.set(teamId, {
    value,
    expiresAt: Date.now() + env.TAGS_VOCABULARY_TTL * 1000,
  });

  return value;
}

/** Drops the cached vocabulary, so the next read reflects a fresh edit. */
export function invalidateVocabulary(teamId?: string) {
  if (teamId) {
    cache.delete(teamId);
  } else {
    cache.clear();
  }
}
