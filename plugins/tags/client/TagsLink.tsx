import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import Flex from "@shared/components/Flex";
import SidebarLink from "~/components/Sidebar/components/SidebarLink";
import Relative from "~/components/Sidebar/components/Relative";
import { loadVocabulary } from "~/editor/components/TagMenu";
import { tagPath } from "../shared/parser";
import Icon from "./Icon";

type TagNode = {
  /** Full normalised tag, e.g. `pm/assign/antoine`. */
  tag: string;
  /** Last path segment, used as the label. */
  segment: string;
  /** Nesting level, 0 for a top-level tag. */
  level: number;
};

/**
 * Flattens the vocabulary into a depth-ordered tree.
 *
 * The vocabulary already contains every ancestor — `extractTags` expands nested
 * tags — so the list only needs sorting and annotating rather than assembling.
 * Sorting by the full path puts each parent immediately before its children.
 */
export function toTree(vocabulary: string[]): TagNode[] {
  return [...vocabulary]
    .sort((a, b) => a.localeCompare(b))
    .map((tag) => {
      const segments = tag.split("/");
      return {
        tag,
        segment: segments[segments.length - 1],
        level: segments.length - 1,
      };
    });
}

/**
 * Sidebar section listing the tag vocabulary as a tree.
 *
 * Every tag, including nested ones, links to its own page. Because the
 * vocabulary is curated rather than a free folksonomy, the list stays a
 * manageable size — which is what makes a sidebar listing viable at all.
 */
function TagsLink() {
  const { t } = useTranslation();
  const [vocabulary, setVocabulary] = React.useState<string[]>([]);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    // Shares the module-level cache the `#` menu fills, so in the common case
    // where a document has been opened this costs no request at all.
    void loadVocabulary().then((tags) => {
      if (!cancelled) {
        setVocabulary(tags);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const nodes = React.useMemo(() => toTree(vocabulary), [vocabulary]);

  const handleDisclosureClick = React.useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setExpanded((value) => !value);
    },
    []
  );

  // Nothing to disclose until the vocabulary loads, and an empty section is
  // just clutter for a workspace that hasn't set one up.
  if (!nodes.length) {
    return null;
  }

  return (
    <Flex column>
      <SidebarLink
        icon={<Icon />}
        label={t("Tags")}
        depth={0}
        expanded={expanded}
        onDisclosureClick={handleDisclosureClick}
        // No `to`: the heading is a disclosure, not a destination. There is no
        // "all tags" page, and sending it to an arbitrary first tag would be
        // worse than sending it nowhere.
        onClick={handleDisclosureClick}
      />
      {expanded ? (
        <Relative>
          {nodes.map((node) => (
            <SidebarLink
              key={node.tag}
              to={tagPath(node.tag)}
              // Indentation carries the hierarchy, so only the final segment is
              // shown — `#pm/assign/antoine` reads as `antoine` beneath
              // `assign` beneath `#pm`.
              label={node.level === 0 ? `#${node.segment}` : node.segment}
              depth={2 + node.level}
            />
          ))}
        </Relative>
      ) : null}
    </Flex>
  );
}

export default observer(TagsLink);
