import { UserRole } from "@shared/types";
import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./Icon";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      // Deliberately not "Integrations". The settings sidebar hides plugins in
      // that group until an Integration record exists, which is created by an
      // OAuth connect flow — this plugin is configured by environment
      // variables and never creates one, so it would never appear.
      group: "Workspace",
      icon: Icon,
      description:
        "Push tagged tasks to GitLab as issues, and tick them off when the issue closes.",
      component: createLazyComponent(() => import("./Settings")),
      // Syncing edits other people's documents and creates issues under a
      // shared token, so it isn't a per-user action.
      enabled: (_team, user) => user.role === UserRole.Admin,
    },
  },
]);
