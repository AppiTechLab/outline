import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import tags from "./api/tags";

PluginManager.add([
  {
    ...config,
    type: Hook.API,
    value: tags,
  },
]);
