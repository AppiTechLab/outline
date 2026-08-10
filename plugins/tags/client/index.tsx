import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./Icon";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Workspace",
      icon: Icon,
      description:
        "Browse every #hashtag written across your documents, and jump to the documents carrying one.",
      component: createLazyComponent(() => import("./Settings")),
    },
  },
]);
