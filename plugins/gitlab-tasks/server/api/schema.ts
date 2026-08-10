import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

const scope = z.object({
  /**
   * Restrict the sync to one document. Omit to sweep every document the user
   * can read, which is the "sync everything" case.
   */
  documentId: z.uuid().optional(),

  /** Report what would happen without calling GitLab or editing documents. */
  dryRun: z.boolean().default(false),
});

export const GitLabTasksPushSchema = BaseSchema.extend({ body: scope });
export const GitLabTasksPullSchema = BaseSchema.extend({ body: scope });
export const GitLabTasksStatusSchema = BaseSchema.extend({
  body: z.object({}).default({}),
});

export type GitLabTasksPushReq = z.infer<typeof GitLabTasksPushSchema>;
export type GitLabTasksPullReq = z.infer<typeof GitLabTasksPullSchema>;
export type GitLabTasksStatusReq = z.infer<typeof GitLabTasksStatusSchema>;
