import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import gitlabTasks from "./api/gitlabTasks";
import env from "./env";

// Registering unconditionally would expose endpoints that can only ever return
// a configuration error, so the routes appear only once GitLab is set up.
const enabled = !!env.GITLAB_TASKS_URL && !!env.GITLAB_TASKS_TOKEN;

if (enabled) {
  PluginManager.add([
    {
      ...config,
      type: Hook.API,
      value: gitlabTasks,
    },
  ]);
}
