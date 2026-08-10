import Router from "koa-router";
import { Op, Sequelize } from "sequelize";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import type { APIContext } from "@server/types";
import type { TagCount } from "../../shared/parser";
import {
  countTags,
  extractTags,
  findTagLines,
  normalizeTag,
} from "../../shared/parser";
import { getVocabulary, invalidateVocabulary } from "../vocabulary";
import pluginEnv from "../env";
import * as T from "./schema";

const router = new Router();

/** Ceiling on documents opened by one request. */
const MaxDocumentsScanned = 2000;

/**
 * Postgres POSIX pattern for "a `#` immediately followed by a letter".
 *
 * Deliberately looser than the parser's regex, which also requires whitespace
 * or a bracket before the hash. This pattern is matched against `content`,
 * where the document is JSON and a tag appears as `"#wp1 — Management"` — the
 * character before the hash is a quote, so requiring a word boundary here
 * filtered out every tagged document.
 *
 * Being loose is fine: this only decides which documents to open, and the
 * parser applies the real rules afterwards. Prefiltering on a bare `#` would be
 * useless, since almost every markdown document has a heading.
 */
const TagLikePattern = "#[A-Za-z]";

/**
 * Loads documents the user can read that plausibly contain a tag.
 *
 * @param excludeId Document to omit — used to keep the vocabulary document's
 *   own tags out of the counts, where every approved tag would otherwise
 *   appear to be used once.
 */
async function scannableDocuments(
  ctx: APIContext,
  collectionId?: string,
  excludeId?: string
) {
  const { user } = ctx.state.auth;

  const readableCollectionIds = await user.collectionIds();
  const collectionIds = collectionId
    ? readableCollectionIds.filter((id) => id === collectionId)
    : readableCollectionIds;

  if (!collectionIds.length) {
    return [];
  }

  return Document.findAll({
    attributes: ["id", "urlId", "title", "text", "content", "updatedAt"],
    where: {
      teamId: user.teamId,
      collectionId: { [Op.in]: collectionIds },
      deletedAt: { [Op.eq]: null },
      archivedAt: { [Op.eq]: null },
      template: false,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      [Op.or]: [
        Sequelize.literal(`"document"."content"::text ~ '${TagLikePattern}'`),
        Sequelize.literal(`"document"."text" ~ '${TagLikePattern}'`),
      ],
    },
    order: [["updatedAt", "DESC"]],
    limit: MaxDocumentsScanned,
  });
}

/**
 * Returns a document's markdown, serialized from the ProseMirror content.
 *
 * An earlier version read the `text` column, which is much cheaper. That was
 * wrong: `documentCollaborativeUpdater` persists only `content` and `state`, so
 * `text` is stale for any document edited in the browser — which is most of
 * them. `content` is the only current source.
 */
async function markdownFor(document: Document): Promise<string> {
  try {
    return await DocumentHelper.toMarkdown(document, { includeTitle: false });
  } catch (_err) {
    // One unparseable document shouldn't empty the whole tag list.
    return "";
  }
}

/**
 * The approved vocabulary, for the tag browser and the editor decorations.
 */
router.post(
  "tags.vocabulary",
  auth(),
  validate(T.TagsVocabularySchema),
  async (ctx: APIContext<T.TagsVocabularyReq>) => {
    const { user } = ctx.state.auth;
    const vocabulary = await getVocabulary(user.teamId);

    ctx.body = {
      data: {
        // Sorted so the client can render without further work, and so a
        // changed ordering never causes a spurious re-render.
        tags: Array.from(vocabulary.display.values()).sort((a, b) =>
          a.localeCompare(b)
        ),
        unconfigured: vocabulary.unconfigured,
        // Echoed back so a title mismatch is diagnosable from the UI rather
        // than by reading the source to find out what it looked for.
        searchedFor: pluginEnv.TAGS_VOCABULARY_DOCUMENT
          ? `document ${pluginEnv.TAGS_VOCABULARY_DOCUMENT}`
          : `a document titled “${pluginEnv.TAGS_VOCABULARY_TITLE}”`,
        document: vocabulary.documentId
          ? {
              id: vocabulary.documentId,
              title: vocabulary.documentTitle,
              url: vocabulary.documentUrl,
            }
          : undefined,
      },
    };
  }
);

/**
 * Forces a reload of the vocabulary, for when you've just edited the document
 * and don't want to wait out the cache.
 */
router.post(
  "tags.refresh",
  auth(),
  validate(T.TagsVocabularySchema),
  async (ctx: APIContext<T.TagsVocabularyReq>) => {
    const { user } = ctx.state.auth;
    invalidateVocabulary(user.teamId);
    const vocabulary = await getVocabulary(user.teamId);

    ctx.body = {
      data: { approved: vocabulary.approved.size },
    };
  }
);

router.post(
  "tags.list",
  auth(),
  validate(T.TagsListSchema),
  async (ctx: APIContext<T.TagsListReq>) => {
    const { collectionId, nested } = ctx.input.body;
    const { user } = ctx.state.auth;

    const vocabulary = await getVocabulary(user.teamId);
    const documents = await scannableDocuments(
      ctx,
      collectionId,
      vocabulary.documentId
    );

    const perDocument = await Promise.all(
      documents.map(async (document) =>
        extractTags(await markdownFor(document), { nested })
      )
    );

    const all = countTags(perDocument);

    // With no vocabulary document, every tag counts as approved — a workspace
    // that hasn't opted in shouldn't see all of its tags flagged.
    const approved: TagCount[] = [];
    const unrecognised: TagCount[] = [];

    for (const tag of all) {
      if (vocabulary.unconfigured || vocabulary.approved.has(tag.tag)) {
        approved.push(tag);
      } else {
        unrecognised.push(tag);
      }
    }

    // Approved tags with no uses yet are still worth showing, so the browser
    // reflects the taxonomy rather than only what happens to be in use.
    const used = new Set(all.map((tag) => tag.tag));
    const unused: TagCount[] = vocabulary.unconfigured
      ? []
      : Array.from(vocabulary.display.entries())
          .filter(([key]) => !used.has(key))
          .map(([tag, display]) => ({ tag, display, count: 0 }))
          .sort((a, b) => a.tag.localeCompare(b.tag));

    ctx.body = {
      data: {
        tags: [...approved, ...unused],
        unrecognised,
        unconfigured: vocabulary.unconfigured,
        searchedFor: pluginEnv.TAGS_VOCABULARY_DOCUMENT
          ? `document ${pluginEnv.TAGS_VOCABULARY_DOCUMENT}`
          : `a document titled “${pluginEnv.TAGS_VOCABULARY_TITLE}”`,
        vocabularyDocument: vocabulary.documentId
          ? {
              id: vocabulary.documentId,
              title: vocabulary.documentTitle,
              url: vocabulary.documentUrl,
            }
          : undefined,
        scanned: documents.length,
        truncated: documents.length >= MaxDocumentsScanned,
      },
    };
  }
);

router.post(
  "tags.documents",
  auth(),
  validate(T.TagsDocumentsSchema),
  async (ctx: APIContext<T.TagsDocumentsReq>) => {
    const { tag, collectionId, nested } = ctx.input.body;
    const { user } = ctx.state.auth;
    const wanted = normalizeTag(tag);

    const vocabulary = await getVocabulary(user.teamId);
    const documents = await scannableDocuments(
      ctx,
      collectionId,
      vocabulary.documentId
    );

    const matches = [];

    for (const document of documents) {
      const markdown = await markdownFor(document);
      const tags = extractTags(markdown, { nested });

      if (!tags.has(wanted)) {
        continue;
      }

      // The lines carrying the tag, each with an anchor the editor renders so
      // the browser can jump straight to that occurrence.
      const lines = findTagLines(markdown, wanted, { nested });

      matches.push({
        id: document.id,
        title: document.title || "Untitled",
        url: document.path,
        updatedAt: document.updatedAt,
        lines: lines.map((line) => ({
          text: line.text,
          anchor: line.anchor,
          url: `${document.path}#${line.anchor}`,
        })),
      });
    }

    ctx.body = {
      data: {
        tag: wanted,
        approved: vocabulary.unconfigured || vocabulary.approved.has(wanted),
        documents: matches,
        scanned: documents.length,
        truncated: documents.length >= MaxDocumentsScanned,
      },
    };
  }
);

export default router;
