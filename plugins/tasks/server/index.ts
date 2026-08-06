import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import tasks from "./api/tasks";

PluginManager.add([
  {
    ...config,
    type: Hook.API,
    value: tasks,
  },
]);
