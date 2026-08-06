/**
 * Renders the results of a ```tasks code block underneath it.
 *
 * The code fence stays visible and editable — it is the query source — and a
 * widget decoration holding the results is appended after it. Results are
 * fetched from `/api/tasks.list`, which is provided by the `tasks` plugin.
 *
 * This module is part of `shared/`, so it is also compiled for the server. All
 * browser access is therefore guarded; on the server the plugin list is empty
 * and this file contributes nothing beyond its imports.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import Extension from "../lib/Extension";

export const pluginKey = new PluginKey("tasksQuery");

/** The code fence language that turns a block into a task query. */
export const TasksLanguage = "tasks";

/** How long to wait after the last keystroke before re-running a query. */
const DebounceMs = 600;

const isBrowser = typeof window !== "undefined";

type TaskResult = {
  id: string;
  documentId: string;
  documentTitle: string;
  documentUrl: string;
  path: string;
  text: string;
  completed: boolean;
  due?: string;
  scheduled?: string;
  start?: string;
  done?: string;
  priority: number;
  tags: string[];
};

type ListResponse = {
  data: {
    tasks: TaskResult[];
    total: number;
    scanned: number;
    truncated?: boolean;
    errors: string[];
  };
};

const priorityNames = ["", "lowest", "low", "medium", "high", "highest"];

/**
 * Returns true when the node is a code fence carrying a task query.
 */
export function isTasksQuery(node: ProsemirrorNode): boolean {
  return (
    (node.type.name === "code_fence" || node.type.name === "code_block") &&
    node.attrs.language === TasksLanguage
  );
}

/**
 * Reads the CSRF token the server set as a cookie.
 *
 * Deliberately duplicated from `app/utils/csrf` rather than imported: this file
 * lives in `shared/` and must not pull in the client bundle, which would break
 * the server build.
 */
function getCSRFToken(): string {
  if (!isBrowser) {
    return "";
  }
  const match = /(?:^|;\s*)(?:__Host-csrfToken|csrfToken)=([^;]*)/.exec(
    document.cookie
  );
  return match ? decodeURIComponent(match[1]) : "";
}

/** Escapes text for safe insertion via innerHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Formats an ISO date relative to today: "today", "in 3 days", "5 days ago".
 * Falls back to the raw date beyond a fortnight, where relative phrasing stops
 * being easier to read than the date itself.
 */
function formatDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) {
    return iso;
  }
  const target = new Date(
    Number(parts[1]),
    Number(parts[2]) - 1,
    Number(parts[3])
  );
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const days = Math.round(
    (target.getTime() - startOfToday.getTime()) / 86400000
  );

  if (days === 0) {
    return "today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  if (days === -1) {
    return "yesterday";
  }
  if (days > 1 && days <= 14) {
    return `in ${days} days`;
  }
  if (days < -1 && days >= -14) {
    return `${Math.abs(days)} days ago`;
  }
  return iso;
}

/**
 * Owns one rendered result list: its DOM element, its in-flight request and
 * the debounce timer that throttles re-queries while the user types.
 */
class QueryRenderer {
  public readonly element: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastQuery: string | undefined;
  /** Incremented per request so late responses can be discarded. */
  private generation = 0;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tasks-query-results";
    this.element.contentEditable = "false";
    this.element.setAttribute("data-tasks-query", "true");
    this.element.style.cssText = [
      "margin: -0.5em 0 1em",
      "padding: 0.75em 1em",
      "border: 1px solid var(--divider-color, rgba(0,0,0,0.1))",
      "border-top: 0",
      "border-radius: 0 0 4px 4px",
      "font-size: 0.9em",
    ].join(";");
    this.renderMessage("…");
  }

  /**
   * Schedules a re-run if the query text changed. Repeated calls with the same
   * text are no-ops, which is what keeps typing elsewhere in the document from
   * re-querying.
   */
  public update(query: string) {
    if (query === this.lastQuery) {
      return;
    }
    this.lastQuery = query;

    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.run(query), DebounceMs);
  }

  public destroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.generation++;
  }

  private async run(query: string) {
    const generation = ++this.generation;

    if (!query.trim()) {
      this.renderMessage(
        "Empty query. Try <code>not done</code> and <code>due before today</code>."
      );
      return;
    }

    try {
      const response = await fetch("/api/tasks.list", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCSRFToken(),
        },
        body: JSON.stringify({ query }),
      });

      if (generation !== this.generation) {
        return;
      }

      if (!response.ok) {
        this.renderMessage(
          response.status === 404
            ? "The tasks plugin is not enabled on this server."
            : `Could not load tasks (${response.status}).`
        );
        return;
      }

      const body = (await response.json()) as ListResponse;
      if (generation !== this.generation) {
        return;
      }
      this.renderResults(body.data);
    } catch (_err) {
      if (generation === this.generation) {
        this.renderMessage("Could not reach the server.");
      }
    }
  }

  private renderMessage(html: string) {
    this.element.innerHTML = `<div style="opacity:0.6">${html}</div>`;
  }

  private renderResults(data: ListResponse["data"]) {
    const chunks: string[] = [];

    for (const error of data.errors) {
      chunks.push(
        `<div style="color:var(--danger-color,#d0021b);margin-bottom:0.5em">${escapeHtml(
          error
        )}</div>`
      );
    }

    if (!data.tasks.length) {
      chunks.push(`<div style="opacity:0.6">No matching tasks.</div>`);
    } else {
      const items = data.tasks.map((task) => {
        const meta: string[] = [];

        if (task.due) {
          const overdue =
            !task.completed && task.due < new Date().toISOString().slice(0, 10);
          meta.push(
            `<span style="opacity:0.7;${
              overdue ? "color:var(--danger-color,#d0021b);opacity:1" : ""
            }">due ${escapeHtml(formatDate(task.due))}</span>`
          );
        }
        if (task.scheduled) {
          meta.push(
            `<span style="opacity:0.7">scheduled ${escapeHtml(
              formatDate(task.scheduled)
            )}</span>`
          );
        }
        if (task.priority) {
          meta.push(
            `<span style="opacity:0.7">${escapeHtml(
              priorityNames[task.priority] ?? ""
            )}</span>`
          );
        }
        meta.push(
          `<a href="${escapeHtml(
            task.documentUrl
          )}" style="opacity:0.7">${escapeHtml(task.documentTitle)}</a>`
        );

        return [
          `<li style="display:flex;gap:0.5em;align-items:baseline;margin:0.35em 0;list-style:none">`,
          `<span style="opacity:0.6">${task.completed ? "☑" : "☐"}</span>`,
          `<span style="flex:1">`,
          `<span style="${
            task.completed ? "opacity:0.5;text-decoration:line-through" : ""
          }">${escapeHtml(task.text)}</span>`,
          meta.length
            ? ` <span style="font-size:0.85em">· ${meta.join(" · ")}</span>`
            : "",
          `</span>`,
          `</li>`,
        ].join("");
      });

      chunks.push(
        `<ul style="margin:0;padding:0">${items.join("")}</ul>`,
        `<div style="opacity:0.5;margin-top:0.5em;font-size:0.85em">${
          data.total
        } task${data.total === 1 ? "" : "s"}${
          data.tasks.length < data.total
            ? `, showing ${data.tasks.length}`
            : ""
        }${
          data.truncated
            ? ` · only the ${data.scanned} most recently updated documents were searched`
            : ""
        }</div>`
      );
    }

    this.element.innerHTML = chunks.join("");
  }
}

/**
 * Collects every task query block in the document, in order.
 */
function findQueryBlocks(doc: ProsemirrorNode) {
  const blocks: { node: ProsemirrorNode; pos: number }[] = [];

  doc.descendants((node, pos) => {
    if (isTasksQuery(node)) {
      blocks.push({ node, pos });
      return false;
    }
    return true;
  });

  return blocks;
}

function buildDecorations(
  doc: ProsemirrorNode,
  renderers: Map<number, QueryRenderer>
) {
  const blocks = findQueryBlocks(doc);
  const decorations: Decoration[] = [];
  const seen = new Set<number>();

  blocks.forEach((block, index) => {
    seen.add(index);

    let renderer = renderers.get(index);
    if (!renderer) {
      renderer = new QueryRenderer();
      renderers.set(index, renderer);
    }
    renderer.update(block.node.textContent);

    decorations.push(
      Decoration.widget(block.pos + block.node.nodeSize, renderer.element, {
        side: 1,
        // Keeps ProseMirror from treating the widget as editable content.
        ignoreSelection: true,
        key: `tasks-query-${index}`,
      })
    );
  });

  // Tear down renderers for blocks that no longer exist.
  for (const [index, renderer] of renderers) {
    if (!seen.has(index)) {
      renderer.destroy();
      renderers.delete(index);
    }
  }

  return DecorationSet.create(doc, decorations);
}

export default class TasksQuery extends Extension {
  get name() {
    return "tasksQuery";
  }

  /**
   * Results must render for readers too, not just people with edit access —
   * without this the extension is never instantiated in read-only mode.
   */
  get allowInReadOnly() {
    return true;
  }

  get plugins() {
    // The server compiles this file too, but never renders; bail out rather
    // than reaching for `document`.
    if (!isBrowser) {
      return [];
    }

    const renderers = new Map<number, QueryRenderer>();

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, renderers),
          apply: (tr, value: DecorationSet) => {
            if (!tr.docChanged) {
              return value.map(tr.mapping, tr.doc);
            }
            return buildDecorations(tr.doc, renderers);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
        view: () => ({
          destroy: () => {
            renderers.forEach((renderer) => renderer.destroy());
            renderers.clear();
          },
        }),
      }),
    ];
  }
}
