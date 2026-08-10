import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Notice from "~/components/Notice";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";
import Icon from "./Icon";

type Status = {
  configured: boolean;
  url?: string;
  tagPrefix?: string;
  syncedTag?: string;
  fallbackProject?: string;
  account?: string;
  error?: string;
};

type SyncResult = {
  documentId: string;
  documentTitle: string;
  title: string;
  status: "created" | "completed" | "skipped" | "failed";
  detail?: string;
  issueUrl?: string;
  issueIid?: number;
};

type Run = {
  action: "push" | "pull";
  dryRun: boolean;
  results: SyncResult[];
};

/** Order and labels for the result groups. */
const groups: {
  status: SyncResult["status"];
  label: (dryRun: boolean) => string;
  tone: "good" | "bad" | "quiet";
}[] = [
  {
    status: "created",
    label: (dry) => (dry ? "Would create" : "Created"),
    tone: "good",
  },
  {
    status: "completed",
    label: (dry) => (dry ? "Would tick" : "Ticked"),
    tone: "good",
  },
  { status: "failed", label: () => "Failed", tone: "bad" },
  { status: "skipped", label: () => "Skipped", tone: "quiet" },
];

function GitLabTasks() {
  const { t } = useTranslation();

  const [status, setStatus] = React.useState<Status | undefined>();
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState<string | undefined>();
  const [run, setRun] = React.useState<Run | undefined>();

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await client.post("/gitlabTasks.status", {});
        if (!cancelled) {
          setStatus(res.data);
        }
      } catch (_err) {
        // A 404 means the plugin isn't registered, which the notice below
        // explains better than a toast would.
        if (!cancelled) {
          setStatus({ configured: false });
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
  }, []);

  const sync = React.useCallback(
    async (action: "push" | "pull", dryRun: boolean) => {
      setRunning(`${action}:${dryRun}`);
      setRun(undefined);

      try {
        const res = await client.post(`/gitlabTasks.${action}`, { dryRun });
        setRun({ action, dryRun, results: res.data.results ?? [] });

        const created = res.data.results.filter(
          (r: SyncResult) => r.status === "created" || r.status === "completed"
        ).length;

        if (!dryRun) {
          toast.success(
            created === 0
              ? "Nothing to do"
              : `${created} task${created === 1 ? "" : "s"} synced`
          );
        }
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setRunning(undefined);
      }
    },
    []
  );

  const busy = Boolean(running);

  return (
    <Scene title="GitLab Tasks" icon={<Icon />}>
      <Heading>GitLab Tasks</Heading>

      {loading ? (
        <Text as="p" type="secondary">
          {t("Loading")}…
        </Text>
      ) : !status?.configured ? (
        <Notice>
          Not configured. Set <code>GITLAB_TASKS_URL</code> and{" "}
          <code>GITLAB_TASKS_TOKEN</code> in <code>deploy/.env</code>, then
          rebuild. The token needs the <code>api</code> scope.
        </Notice>
      ) : (
        <>
          {status.error ? (
            <Notice>
              Connected to <strong>{status.url}</strong>, but the token was
              rejected: {status.error}
            </Notice>
          ) : (
            <Text as="p" type="secondary">
              Connected to <strong>{status.url}</strong> as{" "}
              <strong>{status.account}</strong>. Tasks tagged{" "}
              <code>#{status.tagPrefix}/gitlab/&lt;repo&gt;</code> are synced;
              pushed tasks are stamped <code>{status.syncedTag}</code>.
            </Text>
          )}

          <Section column gap={8}>
            <Heading as="h2">Push</Heading>
            <Text as="p" type="secondary">
              Creates a GitLab issue for every tagged task that doesn't have
              one, then stamps the task with a link to it. Tasks already
              stamped are skipped.
            </Text>
            <Flex gap={8}>
              <Button
                neutral
                disabled={busy}
                onClick={() => void sync("push", true)}
              >
                {running === "push:true" ? "Checking…" : "Preview"}
              </Button>
              <Button disabled={busy} onClick={() => void sync("push", false)}>
                {running === "push:false" ? "Pushing…" : "Push"}
              </Button>
            </Flex>
          </Section>

          <Section column gap={8}>
            <Heading as="h2">Pull</Heading>
            <Text as="p" type="secondary">
              Ticks tasks whose linked issue has been closed in GitLab. Only
              closes — reopening an issue does not untick a task.
            </Text>
            <Flex gap={8}>
              <Button
                neutral
                disabled={busy}
                onClick={() => void sync("pull", true)}
              >
                {running === "pull:true" ? "Checking…" : "Preview"}
              </Button>
              <Button disabled={busy} onClick={() => void sync("pull", false)}>
                {running === "pull:false" ? "Pulling…" : "Pull"}
              </Button>
            </Flex>
          </Section>

          {run && (
            <Section column gap={8}>
              <Heading as="h2">
                {run.dryRun ? "Preview" : "Result"}
              </Heading>

              {run.results.length === 0 ? (
                <Text as="p" type="secondary">
                  Nothing to do.
                </Text>
              ) : (
                groups.map((group) => {
                  const items = run.results.filter(
                    (r) => r.status === group.status
                  );
                  if (!items.length) {
                    return null;
                  }

                  return (
                    <div key={group.status}>
                      <GroupHeading $tone={group.tone}>
                        {group.label(run.dryRun)} ({items.length})
                      </GroupHeading>
                      <ResultList>
                        {items.map((item, index) => (
                          <li key={`${item.documentId}-${index}`}>
                            {item.issueUrl ? (
                              <a
                                href={item.issueUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {item.title}
                              </a>
                            ) : (
                              item.title
                            )}
                            {item.issueIid ? (
                              <Muted> · GL-#{item.issueIid}</Muted>
                            ) : null}
                            <Muted> · {item.documentTitle}</Muted>
                            {item.detail ? <Detail>{item.detail}</Detail> : null}
                          </li>
                        ))}
                      </ResultList>
                    </div>
                  );
                })
              )}
            </Section>
          )}
        </>
      )}
    </Scene>
  );
}

const Section = styled(Flex)`
  margin-top: 28px;
`;

const GroupHeading = styled.h3<{ $tone: "good" | "bad" | "quiet" }>`
  margin: 12px 0 4px;
  font-size: 14px;
  color: ${(props) =>
    props.$tone === "bad"
      ? props.theme.danger
      : props.$tone === "quiet"
        ? props.theme.textSecondary
        : props.theme.text};
`;

const ResultList = styled.ul`
  margin: 0;
  padding: 0 0 0 12px;
  list-style: none;
  border-left: 2px solid ${(props) => props.theme.divider};

  li {
    padding: 3px 0;
  }
`;

const Muted = styled.span`
  color: ${(props) => props.theme.textSecondary};
  font-size: 13px;
`;

const Detail = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 13px;
`;

export default GitLabTasks;
