/**
 * Route target for `/tags/:tag+`.
 *
 * Deliberately a re-export: the scene itself lives in `plugins/tags` alongside
 * the parser and API it depends on, so the core diff carried across upstream
 * merges stays a single line. Client plugins cannot register routes — only
 * Settings, Imports and Icon hooks — which is why this file has to exist at
 * all.
 */
export { default } from "../../../plugins/tags/client/TagScene";
