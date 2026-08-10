import { IsOptional } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";

class TagsPluginEnvironment extends Environment {
  /**
   * Identifies the document holding the approved tag vocabulary — either its
   * UUID or its urlId (the slug fragment in the document URL).
   *
   * When unset, the plugin looks for a document titled TAGS_VOCABULARY_TITLE
   * instead, so a workspace can adopt this without touching configuration.
   */
  @IsOptional()
  public TAGS_VOCABULARY_DOCUMENT = this.toOptionalString(
    environment.TAGS_VOCABULARY_DOCUMENT
  );

  /** Title searched for when TAGS_VOCABULARY_DOCUMENT is unset. */
  @IsOptional()
  public TAGS_VOCABULARY_TITLE =
    environment.TAGS_VOCABULARY_TITLE ?? "Tag vocabulary";

  /**
   * Seconds to cache the parsed vocabulary. Short, because editing the
   * vocabulary document should take effect without a restart; long enough that
   * a tag listing doesn't reload it per request.
   */
  @IsOptional()
  public TAGS_VOCABULARY_TTL = parseInt(
    environment.TAGS_VOCABULARY_TTL ?? "60",
    10
  );
}

export default new TagsPluginEnvironment();
