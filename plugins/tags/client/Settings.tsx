import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import Heading from "~/components/Heading";
import Notice from "~/components/Notice";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";
import { invalidateTagVocabulary } from "~/editor/components/TagMenu";
import { tagPath } from "../shared/parser";
import Icon from "./Icon";

type TagCount = {
  tag: string;
  display: string;
  count: number;
};

type VocabularyDocument = {
  id: string;
  title: string;
  url: string;
};

/**
 * Manages the tag vocabulary and shows what's in use.
 *
 * The per-tag results live at `/tags/<tag>` rather than here — this page is
 * about the taxonomy, not about finding things.
 */
function Tags() {
  const { t } = useTranslation();

  const [approved, setApproved] = React.useState<TagCount[]>([]);
  const [unrecognised, setUnrecognised] = React.useState<TagCount[]>([]);
  const [vocabularyDocument, setVocabularyDocument] = React.useState<
    VocabularyDocument | undefined
  >();
  const [unconfigured, setUnconfigured] = React.useState(false);
  const [searchedFor, setSearchedFor] = React.useState("");
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.post("/tags.list", {});
      setApproved(res.data.tags);
      setUnrecognised(res.data.unrecognised);
      setVocabularyDocument(res.data.vocabularyDocument);
      setUnconfigured(Boolean(res.data.unconfigured));
      setSearchedFor(res.data.searchedFor ?? "");
      setTruncated(Boolean(res.data.truncated));
    } catch (err) {
      toast.error(errToString(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = React.useCallback(async () => {
    try {
      // Two caches to clear: the server's, and the editor's copy feeding the
      // `#` menu. Without the second, autocomplete in an already-open document
      // tab would keep offering the old vocabulary.
      await client.post("/tags.refresh", {});
      invalidateTagVocabulary();
      await load();
      toast.success(t("Reloaded"));
    } catch (err) {
      toast.error(errToString(err));
    }
  }, [load, t]);

  const renderTags = (tags: TagCount[], warning = false) => (
    <TagList>
      {tags.map((tag) => (
        <TagChip key={tag.tag} to={tagPath(tag.tag)} $warning={warning}>
          #{tag.display}
          <Count>{tag.count}</Count>
        </TagChip>
      ))}
    </TagList>
  );

  return (
    <Scene title={t("Tags")} icon={<Icon />}>
      <Heading>{t("Tags")}</Heading>

      {unconfigured ? (
        <Notice>
          No tag vocabulary was found, so every tag counts as approved and the{" "}
          <code>#</code> menu has nothing to offer.
          <br />
          Looked for <strong>{searchedFor}</strong>. Create it — or rename an
          existing page to match — and write the approved tags in it. Every{" "}
          <code>#tag</code> in that document becomes part of the vocabulary.
          Drafts, archived and deleted documents are ignored.
        </Notice>
      ) : (
        <Text as="p" type="secondary">
          Approved tags come from{" "}
          {vocabularyDocument ? (
            <a href={vocabularyDocument.url}>{vocabularyDocument.title}</a>
          ) : (
            "the vocabulary document"
          )}
          . Edit that document to change the vocabulary, then{" "}
          <LinkButton type="button" onClick={() => void handleRefresh()}>
            reload
          </LinkButton>
          . Select a tag to see every line that mentions it.
        </Text>
      )}

      {truncated && (
        <Notice>
          Only the most recently updated documents were searched — this
          workspace has more documents than the scan limit.
        </Notice>
      )}

      {loading ? (
        <Text as="p" type="secondary">
          {t("Loading")}…
        </Text>
      ) : (
        <>
          <Heading as="h2">Approved</Heading>
          {approved.length === 0 ? (
            <Text as="p" type="secondary">
              No approved tags yet.
            </Text>
          ) : (
            renderTags(approved)
          )}

          {unrecognised.length > 0 && (
            <>
              <Heading as="h2">Not in the vocabulary</Heading>
              <Text as="p" type="secondary">
                These are in use but not approved — usually a typo, sometimes a
                tag worth adding. Fix the document, or add the tag to the
                vocabulary.
              </Text>
              {renderTags(unrecognised, true)}
            </>
          )}
        </>
      )}
    </Scene>
  );
}

const TagList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
`;

const TagChip = styled(Link)<{ $warning: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid
    ${(props) => (props.$warning ? props.theme.danger : props.theme.divider)};
  border-radius: 12px;
  color: ${(props) =>
    props.$warning ? props.theme.danger : props.theme.text};
  font-size: 14px;

  &:hover {
    border-color: ${(props) => props.theme.inputBorderFocused};
  }
`;

const Count = styled.span`
  opacity: 0.6;
  font-size: 12px;
`;

const LinkButton = styled.button`
  border: 0;
  background: none;
  padding: 0;
  color: ${(props) => props.theme.accent};
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
`;

export default Tags;
