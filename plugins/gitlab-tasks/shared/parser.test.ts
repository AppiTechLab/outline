import {
  extractAssignees,
  extractDueDate,
  extractIssueLink,
  extractRepo,
  findTaggedTasks,
  normalizePrefix,
  stampCompleted,
  stampSynced,
  toIssueTitle,
} from "./parser";

const context = {
  documentId: "doc-1",
  documentTitle: "Sprint notes",
  documentUrl: "/doc/sprint-notes-abc",
};

const options = {
  tagPrefix: "PM",
  syncedTag: "#synced",
  gitlabUrl: "https://gitlab.example.com",
};

describe("normalizePrefix", () => {
  it("accepts the prefix with or without decoration", () => {
    expect(normalizePrefix("PM")).toBe("PM");
    expect(normalizePrefix("#PM")).toBe("PM");
    expect(normalizePrefix("#PM/")).toBe("PM");
  });
});

describe("extractRepo", () => {
  it("reads the repository name", () => {
    expect(extractRepo("Fix login #PM/gitlab/myrepo", "PM")).toBe("myrepo");
  });

  it("stops at the next tag", () => {
    expect(extractRepo("x #PM/gitlab/myrepo #PM/assign/lr", "PM")).toBe(
      "myrepo"
    );
  });

  it("returns undefined without a routing tag", () => {
    expect(extractRepo("Fix login #work", "PM")).toBeUndefined();
  });

  it("honours a custom prefix", () => {
    expect(extractRepo("x #ops/gitlab/infra", "ops")).toBe("infra");
    expect(extractRepo("x #ops/gitlab/infra", "PM")).toBeUndefined();
  });

  it("treats a regex-special prefix literally", () => {
    expect(extractRepo("x #a.b/gitlab/repo", "a.b")).toBe("repo");
    expect(extractRepo("x #axb/gitlab/repo", "a.b")).toBeUndefined();
  });
});

describe("extractAssignees", () => {
  it("collects several assignees in order", () => {
    expect(
      extractAssignees("x #PM/assign/lr #PM/assign/aw", "PM")
    ).toEqual(["lr", "aw"]);
  });

  it("deduplicates case-insensitively", () => {
    expect(extractAssignees("x #PM/assign/LR #PM/assign/lr", "PM")).toEqual([
      "LR",
    ]);
  });

  it("returns an empty list when there are none", () => {
    expect(extractAssignees("x #PM/gitlab/repo", "PM")).toEqual([]);
  });
});

describe("extractDueDate", () => {
  it("reads the Dataview field", () => {
    expect(extractDueDate("Ship it [due:: 2026-08-20]")).toBe("2026-08-20");
  });

  it("tolerates whitespace around the separator", () => {
    expect(extractDueDate("Ship it [due ::  2026-08-20 ]")).toBe("2026-08-20");
  });

  it("ignores the Obsidian emoji form", () => {
    expect(extractDueDate("Ship it 📅 2026-08-20")).toBeUndefined();
  });

  it("reads the field even when a stray emoji date is also present", () => {
    expect(extractDueDate("x 📅 2026-01-01 [due:: 2026-12-31]")).toBe(
      "2026-12-31"
    );
  });

  it("returns undefined when absent", () => {
    expect(extractDueDate("Ship it")).toBeUndefined();
  });
});

describe("extractIssueLink", () => {
  it("reads the iid, url and project path", () => {
    const link = extractIssueLink(
      "x #synced [GL-#42](https://gitlab.example.com/group/proj/-/issues/42)",
      "https://gitlab.example.com"
    );

    expect(link).toEqual({
      iid: 42,
      url: "https://gitlab.example.com/group/proj/-/issues/42",
      projectPath: "group/proj",
    });
  });

  it("handles nested subgroups", () => {
    expect(
      extractIssueLink(
        "x [GL-#7](https://gitlab.example.com/a/b/c/-/issues/7)",
        "https://gitlab.example.com"
      )?.projectPath
    ).toBe("a/b/c");
  });

  it("handles the work_items url form", () => {
    expect(
      extractIssueLink(
        "x [GL-#9](https://gitlab.example.com/g/p/-/work_items/9)",
        "https://gitlab.example.com"
      )?.projectPath
    ).toBe("g/p");
  });

  it("tolerates a trailing slash on the base url", () => {
    expect(
      extractIssueLink(
        "x [GL-#1](https://gitlab.example.com/g/p/-/issues/1)",
        "https://gitlab.example.com/"
      )?.projectPath
    ).toBe("g/p");
  });

  it("returns undefined when there is no link", () => {
    expect(extractIssueLink("x #synced", "https://gitlab.example.com")).toBeUndefined();
  });
});

describe("toIssueTitle", () => {
  it("strips tags and inline fields", () => {
    expect(
      toIssueTitle(
        "Fix the login page #PM/gitlab/myrepo #PM/assign/lr [due:: 2026-08-20] [priority:: high]"
      )
    ).toBe("Fix the login page");
  });

  it("leaves emoji metadata in place, since it no longer means anything", () => {
    expect(toIssueTitle("Fix the login page 📅 2026-08-20")).toBe(
      "Fix the login page 📅 2026-08-20"
    );
  });

  it("strips an existing issue link", () => {
    expect(
      toIssueTitle(
        "Fix login #synced [GL-#42](https://gitlab.example.com/g/p/-/issues/42)"
      )
    ).toBe("Fix login");
  });

  it("leaves ordinary text untouched", () => {
    expect(toIssueTitle("Just a task")).toBe("Just a task");
  });
});

describe("findTaggedTasks", () => {
  const markdown = [
    "## Sprint",
    "",
    "- [ ] Fix login #PM/gitlab/myrepo #PM/assign/lr [due:: 2026-08-20]",
    "- [x] Done thing #PM/gitlab/myrepo",
    "- [ ] Untagged task",
    "* [ ] Star bullet #PM/gitlab/other",
    "1. [ ] Numbered #PM/gitlab/myrepo",
    "    - [ ] Indented #PM/gitlab/myrepo",
    "- [ ] Pushed already #PM/gitlab/myrepo #synced [GL-#42](https://gitlab.example.com/g/p/-/issues/42)",
    "Just prose #PM/gitlab/myrepo",
  ].join("\n");

  const tasks = findTaggedTasks(markdown, context, options);

  it("finds only tagged checkbox lines", () => {
    expect(tasks).toHaveLength(6);
    expect(tasks.map((t) => t.title)).toEqual([
      "Fix login",
      "Done thing",
      "Star bullet",
      "Numbered",
      "Indented",
      "Pushed already",
    ]);
  });

  it("records the raw line verbatim for patching", () => {
    expect(tasks[0].rawLine).toBe(
      "- [ ] Fix login #PM/gitlab/myrepo #PM/assign/lr [due:: 2026-08-20]"
    );
  });

  it("records line numbers against the markdown", () => {
    expect(tasks[0].lineNumber).toBe(2);
  });

  it("parses per-task metadata", () => {
    expect(tasks[0].repo).toBe("myrepo");
    expect(tasks[0].assignees).toEqual(["lr"]);
    expect(tasks[0].dueDate).toBe("2026-08-20");
    expect(tasks[0].completed).toBe(false);
  });

  it("marks completed tasks", () => {
    expect(tasks[1].completed).toBe(true);
  });

  it("carries the issue link when already pushed", () => {
    expect(tasks[5].issue).toEqual({
      iid: 42,
      url: "https://gitlab.example.com/g/p/-/issues/42",
      projectPath: "g/p",
    });
  });

  it("leaves issue undefined when not pushed", () => {
    expect(tasks[0].issue).toBeUndefined();
  });

  it("returns nothing for a document with no tagged tasks", () => {
    expect(findTaggedTasks("- [ ] plain", context, options)).toEqual([]);
  });
});

describe("stampSynced", () => {
  it("appends the tag and issue link", () => {
    expect(
      stampSynced(
        "- [ ] Fix login #PM/gitlab/myrepo",
        "#synced",
        42,
        "https://gitlab.example.com/g/p/-/issues/42"
      )
    ).toBe(
      "- [ ] Fix login #PM/gitlab/myrepo #synced [GL-#42](https://gitlab.example.com/g/p/-/issues/42)"
    );
  });

  it("does not leave double spaces on a padded line", () => {
    expect(stampSynced("- [ ] Task   ", "#synced", 1, "https://x/1")).toBe(
      "- [ ] Task #synced [GL-#1](https://x/1)"
    );
  });

  it("round-trips: the stamped line parses back with its issue", () => {
    const stamped = stampSynced(
      "- [ ] Fix login #PM/gitlab/myrepo",
      "#synced",
      42,
      "https://gitlab.example.com/g/p/-/issues/42"
    );
    const [task] = findTaggedTasks(stamped, context, options);

    expect(task.issue?.iid).toBe(42);
    expect(task.title).toBe("Fix login");
  });
});

describe("stampCompleted", () => {
  it("ticks the checkbox", () => {
    expect(stampCompleted("- [ ] Fix login")).toBe("- [x] Fix login");
  });

  it("only touches the task's own marker, not brackets in the text", () => {
    expect(stampCompleted("- [ ] See [ ] in the docs")).toBe(
      "- [x] See [ ] in the docs"
    );
  });

  it("preserves indentation", () => {
    expect(stampCompleted("    - [ ] Nested")).toBe("    - [x] Nested");
  });

  it("leaves an already-ticked line alone", () => {
    expect(stampCompleted("- [x] Done")).toBe("- [x] Done");
  });
});
