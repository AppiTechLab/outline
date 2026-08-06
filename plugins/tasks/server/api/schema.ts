import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const TasksListSchema = BaseSchema.extend({
  body: z.object({
    /**
     * The raw body of a ```tasks code block. Parsed server side so that the
     * query language can evolve without shipping a new client bundle.
     */
    query: z.string().max(4000).default(""),

    /**
     * Restrict the scan to a single collection. Optional; when absent every
     * collection the user can read is searched.
     */
    collectionId: z.uuid().optional(),
  }),
});

export type TasksListReq = z.infer<typeof TasksListSchema>;
