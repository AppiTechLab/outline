import {
  addDays,
  extractFields,
  parseISODate,
  parseTask,
  parseTasksFromMarkdown,
  resolveDate,
  toISODate,
} from "./parser";
import { TaskPriority } from "./types";

const context = {
  documentId: "doc-1",
  documentTitle: "Roadmap",
  documentUrl: "/doc/roadmap-abc",
  path: "Engineering",
};

describe("extractFields", () => {
  it("pulls out fields and strips them from the display text", () => {
    const result = extractFields(
      "Draft the proposal [due:: 2026-08-12] [priority:: high]"
    );

    expect(result.text).toBe("Draft the proposal");
    expect(result.fields).toEqual({ due: "2026-08-12", priority: "high" });
  });

  it("keeps tags in the display text but also collects them", () => {
    const result = extractFields("Review the PR #work #eng");

    expect(result.text).toBe("Review the PR #work #eng");
    expect(result.tags).toEqual(["work", "eng"]);
  });

  it("deduplicates and lowercases tags", () => {
    expect(extractFields("a #Work b #work").tags).toEqual(["work"]);
  });

  it("does not treat a heading-like hash mid-word as a tag", () => {
    expect(extractFields("issue no1#2 here").tags).toEqual([]);
  });

  it("tolerates whitespace around the field separator", () => {
    expect(extractFields("x [due ::  2026-01-02 ]").fields.due).toBe(
      "2026-01-02"
    );
  });

  it("leaves text alone when there are no annotations", () => {
    expect(extractFields("plain task").text).toBe("plain task");
  });
});

describe("parseISODate", () => {
  it("parses a valid date", () => {
    expect(toISODate(parseISODate("2026-08-12")!)).toBe("2026-08-12");
  });

  it("rejects impossible dates rather than rolling them forward", () => {
    expect(parseISODate("2026-02-31")).toBeUndefined();
    expect(parseISODate("2026-13-01")).toBeUndefined();
  });

  it("rejects other formats", () => {
    expect(parseISODate("12/08/2026")).toBeUndefined();
    expect(parseISODate("tomorrow")).toBeUndefined();
  });
});

describe("resolveDate", () => {
  const now = new Date(2026, 7, 6); // 6 August 2026, local time

  it("resolves relative keywords", () => {
    expect(resolveDate("today", now)).toBe("2026-08-06");
    expect(resolveDate("tomorrow", now)).toBe("2026-08-07");
    expect(resolveDate("yesterday", now)).toBe("2026-08-05");
  });

  it("passes through ISO dates", () => {
    expect(resolveDate("2026-12-25", now)).toBe("2026-12-25");
  });

  it("returns undefined for nonsense", () => {
    expect(resolveDate("next tuesday", now)).toBeUndefined();
  });
});

describe("addDays", () => {
  it("crosses month boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap days", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("parseTask", () => {
  it("builds a task with all recognised fields", () => {
    const task = parseTask(
      "Ship the thing [due:: 2026-08-12] [scheduled:: 2026-08-10] [priority:: highest] #work",
      false,
      { ...context, index: 3 }
    );

    expect(task.text).toBe("Ship the thing #work");
    expect(task.due).toBe("2026-08-12");
    expect(task.scheduled).toBe("2026-08-10");
    expect(task.priority).toBe(TaskPriority.Highest);
    expect(task.tags).toEqual(["work"]);
    expect(task.completed).toBe(false);
    expect(task.id).toBe("doc-1:3");
    expect(task.documentTitle).toBe("Roadmap");
  });

  it("defaults priority to None when unset or unknown", () => {
    expect(parseTask("a", false, { ...context, index: 0 }).priority).toBe(
      TaskPriority.None
    );
    expect(
      parseTask("a [priority:: spicy]", false, { ...context, index: 0 }).priority
    ).toBe(TaskPriority.None);
  });

  it("ignores malformed dates instead of storing them", () => {
    const task = parseTask("a [due:: sometime]", false, {
      ...context,
      index: 0,
    });
    expect(task.due).toBeUndefined();
  });

  it("captures a recurrence rule without acting on it", () => {
    const task = parseTask("water plants [repeat:: every week]", false, {
      ...context,
      index: 0,
    });
    expect(task.repeat).toBe("every week");
  });

  it("preserves the raw text", () => {
    const raw = "a [due:: 2026-01-01]";
    expect(parseTask(raw, true, { ...context, index: 0 }).raw).toBe(raw);
  });
});

describe("parseTasksFromMarkdown", () => {
  it("finds checkbox lines and ignores everything else", () => {
    const tasks = parseTasksFromMarkdown(
      [
        "# Heading",
        "Some prose.",
        "- [ ] alpha [due:: 2026-01-01]",
        "- [x] beta",
        "* [ ] gamma",
        "+ [X] delta",
        "- not a task",
      ].join("\n"),
      context
    );

    expect(tasks).toHaveLength(4);
    expect(tasks.map((t) => t.text)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
    ]);
    expect(tasks.map((t) => t.completed)).toEqual([false, true, false, true]);
  });

  it("indexes tasks in document order", () => {
    const tasks = parseTasksFromMarkdown("- [ ] a\n- [ ] b", context);
    expect(tasks.map((t) => t.id)).toEqual(["doc-1:0", "doc-1:1"]);
  });

  it("handles indented (nested) tasks", () => {
    const tasks = parseTasksFromMarkdown("- [ ] a\n    - [ ] b", context);
    expect(tasks).toHaveLength(2);
  });
});
