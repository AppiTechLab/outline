import * as React from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import Empty from "~/components/Empty";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";
import Icon from "./Icon";

type TaggedLine = {
  text: string;
  anchor: string;
  /** Document path with the anchor appended. */
  url: string;
};

type TaggedDocument = {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
  lines: TaggedLine[];
};

/**
 * Lists every line mentioning one tag, grouped by document.
 *
 * Reached at `/tags/<tag>`, including nested tags as path segments — the route
 * uses `:tag+`, so `/tags/pm/assign/antoine` arrives here intact.
 */
function TagScene() {
  const { t } = useTranslation();
  // `:tag+` yields the remaining path as one string, slashes included.
  const { tag } = useParams<{ tag: string }>();

  const [documents, setDocuments] = React.useState<TaggedDocument[]>([]);
  const [approved, setApproved] = React.useState(true);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const res = await client.post("/tags.documents", { tag });
        if (!cancelled) {
          setDocuments(res.data.documents);
          setApproved(res.data.approved !== false);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(errToString(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tag]);

  const lineCount = documents.reduce(
    (total, document) => total + (document.lines?.length ?? 0),
    0
  );

  return (
    <Scene icon={<Icon />} title={`#${tag}`}>
      <Heading>#{tag}</Heading>

      {!approved && (
        <Text as="p" type="secondary">
          This tag is not in the vocabulary — it may be a typo, or worth adding.
        </Text>
      )}

      {loading ? (
        <Text as="p" type="secondary">
          {t("Loading")}…
        </Text>
      ) : documents.length === 0 ? (
        <Empty>Nothing uses this tag.</Empty>
      ) : (
        <>
          <Text as="p" type="secondary">
            {lineCount} {lineCount === 1 ? "mention" : "mentions"} across{" "}
            {documents.length}{" "}
            {documents.length === 1 ? "document" : "documents"}
          </Text>

          <Flex column gap={20}>
            {documents.map((document) => (
              <div key={document.id}>
                <DocumentTitle href={document.url}>
                  {document.title}
                </DocumentTitle>
                {document.lines?.length ? (
                  <LineList>
                    {document.lines.map((line) => (
                      // Links to the anchor the editor renders beside this
                      // occurrence, so the document opens scrolled to it.
                      <li key={line.anchor}>
                        <LineLink href={line.url}>{line.text}</LineLink>
                      </li>
                    ))}
                  </LineList>
                ) : null}
              </div>
            ))}
          </Flex>
        </>
      )}
    </Scene>
  );
}

const DocumentTitle = styled.a`
  font-weight: 600;
`;

const LineList = styled.ul`
  margin: 6px 0 0;
  padding: 0 0 0 12px;
  list-style: none;
  border-left: 2px solid ${(props) => props.theme.divider};
`;

const LineLink = styled.a`
  display: block;
  padding: 3px 0;
  color: ${(props) => props.theme.textSecondary};

  &:hover {
    color: ${(props) => props.theme.text};
  }
`;

export default TagScene;
