import {
  countTags,
  expandNested,
  extractTags,
  normalizeTag,
} from "./parser";

const tags = (markdown: string, nested = true) =>
  Array.from(extractTags(markdown, { nested }).keys());

describe("extractTags", () => {
  it("finds a simple tag", () => {
    expect(tags("Some notes #work here")).toEqual(["work"]);
  });

  it("finds a tag at the start of a line", () => {
    expect(tags("#work at the start")).toEqual(["work"]);
  });

  it("finds tags inside brackets and parentheses", () => {
    expect(tags("see (#work) and [#home]")).toEqual(["work", "home"]);
  });

  it("lowercases for matching but keeps first-seen casing for display", () => {
    const found = extractTags("#Work then #work");
    expect(Array.from(found.entries())).toEqual([["work", "Work"]]);
  });

  it("deduplicates within a document", () => {
    expect(tags("#work #work #work")).toEqual(["work"]);
  });

  it("supports accented characters", () => {
    expect(tags("#filière")).toEqual(["filière"]);
  });

  it("supports hyphens", () => {
    expect(tags("#needs-analysis")).toEqual(["needs-analysis"]);
  });

  describe("markdown-escaped hashes", () => {
    // Outline's serializer escapes a `#` that starts a line so the paragraph
    // doesn't round-trip as a heading, which is exactly how a tag on its own
    // line reaches this parser.
    it("finds a tag that the serializer escaped", () => {
      expect(tags("\\#wp1 — Management")).toEqual(["wp1"]);
    });

    it("finds every tag in a serialized vocabulary document", () => {
      const serialized = [
        "\\#wp1 — Management",
        "",
        "\\#wp2 — Needs analysis",
        "",
        "\\#blocked · waiting on someone outside the team",
        "",
        "\\#PM/assign/Antoine",
      ].join("\n");

      expect(tags(serialized, false)).toEqual([
        "wp1",
        "wp2",
        "blocked",
        "pm/assign/antoine",
      ]);
    });

    it("does not resurrect a hash escaped inside code", () => {
      expect(tags("`\\#wp1`")).toEqual([]);
    });
  });

  describe("things that are not tags", () => {
    it("ignores a markdown heading", () => {
      expect(tags("# Heading\n## Subheading")).toEqual([]);
    });

    it("ignores a URL fragment", () => {
      expect(tags("https://example.com/page#section")).toEqual([]);
    });

    it("ignores a link target's fragment", () => {
      expect(tags("[docs](https://example.com/a#anchor)")).toEqual([]);
    });

    it("ignores inline code", () => {
      expect(tags("use `#include <stdio.h>` here")).toEqual([]);
    });

    it("ignores fenced code blocks", () => {
      expect(tags("```\n#!/bin/sh\n#work\n```")).toEqual([]);
    });

    it("ignores hex colours", () => {
      expect(tags("#fff #aabbcc #DEADBEEF")).toEqual([]);
    });

    it("ignores issue-number style references", () => {
      expect(tags("see #1234 for details")).toEqual([]);
    });

    it("ignores a hash mid-word", () => {
      expect(tags("page#section C#")).toEqual([]);
    });

    it("keeps a tag that merely looks colour-adjacent but is the wrong length", () => {
      expect(tags("#faded")).toEqual(["faded"]);
    });
  });

  describe("nesting", () => {
    it("expands ancestors by default", () => {
      expect(tags("#project/alpha/spec")).toEqual([
        "project",
        "project/alpha",
        "project/alpha/spec",
      ]);
    });

    it("can be disabled", () => {
      expect(tags("#project/alpha/spec", false)).toEqual([
        "project/alpha/spec",
      ]);
    });

    it("does not duplicate a parent written explicitly", () => {
      expect(tags("#project #project/alpha")).toEqual([
        "project",
        "project/alpha",
      ]);
    });

    it("drops a trailing slash", () => {
      expect(tags("#project/")).toEqual(["project"]);
    });
  });
});

describe("expandNested", () => {
  it("returns each ancestor path", () => {
    expect(expandNested("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("returns a flat tag unchanged", () => {
    expect(expandNested("a")).toEqual(["a"]);
  });
});

describe("countTags", () => {
  it("counts documents, not occurrences", () => {
    const counts = countTags([
      extractTags("#work #work #work"),
      extractTags("#work #home"),
    ]);

    expect(counts).toEqual([
      { tag: "work", display: "work", count: 2 },
      { tag: "home", display: "home", count: 1 },
    ]);
  });

  it("sorts by count then alphabetically", () => {
    const counts = countTags([
      extractTags("#b #c"),
      extractTags("#b #a"),
      extractTags("#a"),
    ]);

    expect(counts.map((c) => c.tag)).toEqual(["a", "b", "c"]);
  });

  it("keeps the first display casing seen across documents", () => {
    const counts = countTags([extractTags("#Work"), extractTags("#work")]);
    expect(counts[0].display).toBe("Work");
  });

  it("returns nothing for documents with no tags", () => {
    expect(countTags([extractTags("plain text")])).toEqual([]);
  });

  it("counts a parent once per document even with several children", () => {
    const counts = countTags([extractTags("#p/a #p/b #p/c")]);
    expect(counts.find((c) => c.tag === "p")?.count).toBe(1);
  });
});

describe("normalizeTag", () => {
  it("strips a leading hash", () => {
    expect(normalizeTag("#work")).toBe("work");
  });

  it("lowercases", () => {
    expect(normalizeTag("Project/Alpha")).toBe("project/alpha");
  });

  it("trims whitespace and trailing separators", () => {
    expect(normalizeTag("  #project/  ")).toBe("project");
  });
});
