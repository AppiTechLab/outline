import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const TagsListSchema = BaseSchema.extend({
  body: z.object({
    /** Narrow the scan to a single collection. */
    collectionId: z.uuid().optional(),

    /** Whether `#a/b` should also count towards `#a`. */
    nested: z.boolean().default(true),
  }),
});

export const TagsDocumentsSchema = BaseSchema.extend({
  body: z.object({
    /** Tag to filter by, with or without a leading `#`. */
    tag: z.string().min(1).max(200),

    collectionId: z.uuid().optional(),

    nested: z.boolean().default(true),
  }),
});

export const TagsVocabularySchema = BaseSchema.extend({
  body: z.object({}).default({}),
});

export type TagsListReq = z.infer<typeof TagsListSchema>;
export type TagsDocumentsReq = z.infer<typeof TagsDocumentsSchema>;
export type TagsVocabularyReq = z.infer<typeof TagsVocabularySchema>;
