import { observer } from "mobx-react";
import * as React from "react";
import { client } from "~/utils/ApiClient";
import Logger from "~/utils/Logger";
import { useEditor } from "./EditorContext";
import type { Props as SuggestionsMenuProps } from "./SuggestionsMenu";
import SuggestionsMenu from "./SuggestionsMenu";
import SuggestionsMenuItem from "./SuggestionsMenuItem";

type TagItem = {
  name: string;
  title: string;
  /** The tag exactly as written in the vocabulary document. */
  tag: string;
  onClick: () => void;
};

type Props = Omit<
  SuggestionsMenuProps<TagItem>,
  "renderMenuItem" | "items" | "embeds"
>;

/**
 * How long a fetched vocabulary is trusted before it is refreshed. Editing the
 * vocabulary document should reach open tabs without a reload, but the list
 * changes rarely enough that polling would be wasteful — so it is re-checked
 * lazily, when the menu is next opened.
 */
const StaleAfterMs = 2 * 60 * 1000;

/**
 * The vocabulary is identical for every editor on the page, so it is cached at
 * module scope rather than per editor instance. A single in-flight promise is
 * shared so mounting several editors at once produces one request.
 */
let vocabularyRequest: Promise<string[]> | undefined;
let vocabularyFetchedAt = 0;

/**
 * Fetches the approved vocabulary, sharing one in-flight promise and one cached
 * result across every consumer. Exported so the sidebar can reuse the copy the
 * editor has usually already fetched, rather than issuing its own request.
 */
export function loadVocabulary(): Promise<string[]> {
  if (!vocabularyRequest) {
    vocabularyFetchedAt = Date.now();

    vocabularyRequest = client
      .post("/tags.vocabulary", {})
      .then((res) => (res.data.tags as string[]) ?? [])
      .catch((err) => {
        // The tags plugin may not be installed; an empty vocabulary simply
        // means the menu never has anything to offer.
        Logger.warn("Could not load tag vocabulary", err);
        // Clear so the next attempt retries rather than caching the failure.
        vocabularyRequest = undefined;
        return [];
      });
  }
  return vocabularyRequest;
}

/** True when the cached vocabulary is old enough to be worth re-fetching. */
function isStale(): boolean {
  return Date.now() - vocabularyFetchedAt > StaleAfterMs;
}

/** Discards the cached vocabulary, so the next read reflects a fresh edit. */
export function invalidateTagVocabulary() {
  vocabularyRequest = undefined;
  vocabularyFetchedAt = 0;
}

const TagMenu = (props: Props) => {
  const { view } = useEditor();
  const { search = "" } = props;

  const [vocabulary, setVocabulary] = React.useState<string[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  // Fetched when the editor mounts, so the list is already in hand by the time
  // anyone types `#`, and re-checked whenever the menu opens with a stale
  // cache. That way an edit to the vocabulary document reaches open tabs
  // without a reload, and without polling.
  const { isActive, onClose } = props;

  React.useEffect(() => {
    let cancelled = false;

    if (isActive && isStale()) {
      invalidateTagVocabulary();
    }

    void loadVocabulary().then((tags) => {
      if (!cancelled) {
        setVocabulary(tags);
        setLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isActive]);

  /**
   * Inserts the tag as plain text.
   *
   * `SuggestionsMenu` has already removed the trigger and whatever was typed
   * after it by the time this runs, so the cursor sits where the `#` was.
   * Plain text keeps tags out of the document schema entirely — nothing to
   * serialize, nothing to corrupt, and the same characters a colleague would
   * have typed by hand.
   */
  const insert = React.useCallback(
    (tag: string) => {
      const { state, dispatch } = view;
      dispatch(state.tr.insertText(`#${tag} `));
    },
    [view]
  );

  const items = React.useMemo(() => {
    const needle = search.toLowerCase();

    return vocabulary
      .filter((tag) => tag.toLowerCase().includes(needle))
      .sort((a, b) => {
        // Prefix matches first — typing "wp" should offer "wp1" before
        // "backlog/wp-review".
        const aStarts = a.toLowerCase().startsWith(needle);
        const bStarts = b.toLowerCase().startsWith(needle);
        if (aStarts !== bStarts) {
          return aStarts ? -1 : 1;
        }
        return a.localeCompare(b);
      })
      .slice(0, 15)
      .map((tag) => ({
        // "noop" tells SuggestionsMenu to call onClick instead of looking for
        // an editor command of this name.
        name: "noop",
        title: `#${tag}`,
        tag,
        onClick: () => insert(tag),
      }));
  }, [vocabulary, search, insert]);

  /**
   * Closes the menu when there is nothing to offer.
   *
   * An open menu swallows Enter, Tab and the arrow keys — `handleKeyDown` in
   * SuggestionsMenuPlugin returns `open` for those. With no items that is pure
   * obstruction: you couldn't press Enter after typing a tag the vocabulary
   * doesn't contain, which is exactly what you're doing while writing the
   * vocabulary document itself.
   */
  React.useEffect(() => {
    if (isActive && loaded && items.length === 0) {
      onClose();
    }
  }, [isActive, loaded, items.length, onClose]);

  const renderMenuItem = React.useCallback(
    (item: TagItem, _index: number, options) => (
      <SuggestionsMenuItem {...options} title={item.title} />
    ),
    []
  );

  return (
    <SuggestionsMenu
      {...props}
      filterable={false}
      renderMenuItem={renderMenuItem}
      items={items}
    />
  );
};

export default observer(TagMenu);
