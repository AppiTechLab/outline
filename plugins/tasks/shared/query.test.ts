import { parseTask } from "./parser";
import { applyQuery, parseQuery } from "./query";
import { TaskPriority } from "./types";

const now = new Date(2026, 7, 6); // 6 August 2026, local time

const context = {
  documentId: "doc-1",
  documentTitle: "Roadmap",
  documentUrl: "/doc/roadmap",
  path: "Engineering",
};

const build = (text: string, completed = false, index = 0) =>
  parseTask(text, completed, { ...context, index });

describe("parseQuery", () => {
  it("ignores blank lines and comments", () => {
    const query = parseQuery("\n# a comment\n\nnot done\n", now);
    expect(query.filters).toHaveLength(1);
    expect(query.errors).toEqual([]);
  });

  it("parses status filters", () => {
    expect(parseQuery("done", now).filters).toEqual([
      { kind: "status", completed: true },
    ]);
    expect(parseQuery("not done", now).filters).toEqual([
      { kind: "status", completed: false },
    ]);
  });

  it("resolves relative dates at parse time", () => {
    expect(parseQuery("due before today", now).filters).toEqual([
      { kind: "date", field: "due", comparator: "before", value: "2026-08-06" },
    ]);
  });

  it("parses the compound date comparators", () => {
    expect(parseQuery("scheduled on or after 2026-01-01", now).filters).toEqual(
      [
        {
          kind: "date",
          field: "scheduled",
          comparator: "onOrAfter",
          value: "2026-01-01",
        },
      ]
    );
  });

  it("parses presence filters", () => {
    expect(parseQuery("no due date", now).filters).toEqual([
      { kind: "hasDate", field: "due", present: false },
    ]);
    expect(parseQuery("has done date", now).filters).toEqual([
      { kind: "hasDate", field: "done", present: true },
    ]);
  });

  it("parses priority filters", () => {
    expect(parseQuery("priority above medium", now).filters).toEqual([
      { kind: "priority", comparator: "above", value: TaskPriority.Medium },
    ]);
    expect(parseQuery("priority is not none", now).filters).toEqual([
      { kind: "priority", comparator: "isNot", value: TaskPriority.None },
    ]);
  });

  it("parses inclusion filters and their negations", () => {
    expect(parseQuery("tag includes work", now).filters).toEqual([
      { kind: "tag", value: "work", negated: false },
    ]);
    expect(parseQuery("tag does not include #work", now).filters).toEqual([
      { kind: "tag", value: "work", negated: true },
    ]);
    expect(parseQuery("text includes Review", now).filters).toEqual([
      { kind: "text", value: "review", negated: false },
    ]);
  });

  it("parses sort, limit and display directives", () => {
    const query = parseQuery(
      "sort by due\nsort by priority reverse\nlimit 5\nhide path",
      now
    );
    expect(query.sort).toEqual([
      { key: "due", reverse: false },
      { key: "priority", reverse: true },
    ]);
    expect(query.limit).toBe(5);
    expect(query.showPath).toBe(false);
  });

  it("collects errors instead of throwing", () => {
    const query = parseQuery(
      "due before notadate\npriority is spicy\nsort by colour\nfrobnicate",
      now
    );
    expect(query.errors).toHaveLength(4);
    expect(query.filters).toHaveLength(0);
  });

  it("is case insensitive", () => {
    expect(parseQuery("NOT DONE", now).filters).toEqual([
      { kind: "status", completed: false },
    ]);
  });
});

describe("applyQuery", () => {
  const tasks = [
    build("overdue [due:: 2026-01-01] [priority:: high] #work", false, 0),
    build("future [due:: 2030-01-01] #work", false, 1),
    build("undated [priority:: highest] #work", false, 2),
    build("finished [due:: 2026-01-01] #home", true, 3),
  ];

  it("filters by status", () => {
    expect(
      applyQuery(tasks, parseQuery("done", now)).tasks.map((t) => t.text)
    ).toEqual(["finished #home"]);
  });

  it("filters by date, excluding undated tasks", () => {
    const result = applyQuery(tasks, parseQuery("due before today", now));
    expect(result.tasks.map((t) => t.text)).toEqual([
      "overdue #work",
      "finished #home",
    ]);
  });

  it("combines filters with AND", () => {
    const result = applyQuery(
      tasks,
      parseQuery("not done\ndue before today", now)
    );
    expect(result.tasks.map((t) => t.text)).toEqual(["overdue #work"]);
  });

  it("finds tasks with no date", () => {
    const result = applyQuery(tasks, parseQuery("no due date", now));
    expect(result.tasks.map((t) => t.text)).toEqual(["undated #work"]);
  });

  it("sorts by priority, most urgent first", () => {
    const result = applyQuery(tasks, parseQuery("not done\nsort by priority", now));
    expect(result.tasks.map((t) => t.priority)).toEqual([
      TaskPriority.Highest,
      TaskPriority.High,
      TaskPriority.None,
    ]);
  });

  it("sorts undated tasks last regardless of direction", () => {
    const ascending = applyQuery(tasks, parseQuery("not done\nsort by due", now));
    expect(ascending.tasks[ascending.tasks.length - 1].text).toBe(
      "undated #work"
    );

    const descending = applyQuery(
      tasks,
      parseQuery("not done\nsort by due reverse", now)
    );
    expect(descending.tasks[descending.tasks.length - 1].text).toBe(
      "undated #work"
    );
  });

  it("reports the pre-limit total", () => {
    const result = applyQuery(tasks, parseQuery("not done\nlimit 2", now));
    expect(result.total).toBe(3);
    expect(result.tasks).toHaveLength(2);
  });

  it("negates tag filters", () => {
    const result = applyQuery(tasks, parseQuery("tag does not include work", now));
    expect(result.tasks.map((t) => t.text)).toEqual(["finished #home"]);
  });

  describe("nested tags", () => {
    const nested = [
      build("gate work #PM/project/Gate", false, 0),
      build("other work #PM/project/Other", false, 1),
      build("unrelated #home", false, 2),
    ];

    it("matches the exact tag", () => {
      expect(
        applyQuery(nested, parseQuery("tag includes PM/project/Gate", now)).tasks
      ).toHaveLength(1);
    });

    it("matches a parent tag against its children", () => {
      expect(
        applyQuery(nested, parseQuery("tag includes PM/project", now)).tasks
      ).toHaveLength(2);
      expect(
        applyQuery(nested, parseQuery("tag includes PM", now)).tasks
      ).toHaveLength(2);
    });

    it("does not match a partial segment", () => {
      // `PM/pro` is not an ancestor of `PM/project/Gate`.
      expect(
        applyQuery(nested, parseQuery("tag includes PM/pro", now)).tasks
      ).toHaveLength(0);
    });

    it("negation covers descendants too", () => {
      expect(
        applyQuery(
          nested,
          parseQuery("tag does not include PM/project", now)
        ).tasks.map((t) => t.text)
      ).toEqual(["unrelated #home"]);
    });
  });

  it("matches path against the collection name and document title", () => {
    expect(
      applyQuery(tasks, parseQuery("path includes engineering", now)).total
    ).toBe(4);
    expect(
      applyQuery(tasks, parseQuery("path includes marketing", now)).total
    ).toBe(0);
  });

  it("returns everything when the query has no filters", () => {
    expect(applyQuery(tasks, parseQuery("", now)).total).toBe(4);
  });
});
