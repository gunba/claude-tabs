import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CliKind } from "../../types/session";
import { ModalOverlay } from "../ModalOverlay/ModalOverlay";
import { IconClose } from "../Icons/Icons";
import type { ChangelogEntry, ChangelogRequest, CliChangelog } from "../../lib/changelog";
import "./ChangelogModal.css";

type ChangelogModalProps = {
  request: ChangelogRequest;
  currentVersions: Record<CliKind, string | null>;
  onClose: () => void;
};

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: CliChangelog }
  | { status: "error"; error: string };

const CLI_ORDER: CliKind[] = ["claude", "codex"];

function cliLabel(cli: CliKind): string {
  return cli === "codex" ? "Codex" : "Claude";
}

function renderBody(body: string) {
  const nodes: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length === 0) return;
    const current = bullets;
    bullets = [];
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="changelog-entry-list">
        {current.map((item, idx) => <li key={idx}>{item}</li>)}
      </ul>
    );
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) {
      nodes.push(<div key={`h-${nodes.length}`} className="changelog-entry-heading">{heading[1]}</div>);
    } else {
      nodes.push(<p key={`p-${nodes.length}`}>{line}</p>);
    }
  }
  flushBullets();
  return nodes;
}

function EntryView({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="changelog-entry">
      <div className="changelog-entry-top">
        <div className="changelog-entry-version">v{entry.version}</div>
        {entry.date && <div className="changelog-entry-date">{entry.date.slice(0, 10)}</div>}
      </div>
      <div className="changelog-entry-body">{renderBody(entry.body)}</div>
      {entry.url && (
        <button
          className="changelog-source-link"
          onClick={() => invoke("shell_open", { path: entry.url })}
        >
          Source
        </button>
      )}
    </article>
  );
}

export function ChangelogModal({ request, currentVersions, onClose }: ChangelogModalProps) {
  const [activeCli, setActiveCli] = useState<CliKind>(request.initialCli);
  const [states, setStates] = useState<Record<CliKind, LoadState>>({
    claude: { status: "idle" },
    codex: { status: "idle" },
  });

  const requestKey = useMemo(() => JSON.stringify({
    kind: request.kind,
    ranges: request.ranges,
    versions: currentVersions,
  }), [currentVersions, request.kind, request.ranges]);

  useEffect(() => {
    let cancelled = false;
    setStates({ claude: { status: "loading" }, codex: { status: "loading" } });
    for (const cli of CLI_ORDER) {
      const range = request.ranges[cli] ?? {};
      const toVersion = range.toVersion ?? currentVersions[cli];
      void invoke<CliChangelog>("fetch_cli_changelog", {
        cli,
        fromVersion: range.fromVersion ?? null,
        toVersion: toVersion ?? null,
      })
        .then((data) => {
          if (cancelled) return;
          setStates((prev) => ({ ...prev, [cli]: { status: "ready", data } }));
        })
        .catch((err) => {
          if (cancelled) return;
          setStates((prev) => ({ ...prev, [cli]: { status: "error", error: String(err) } }));
        });
    }
    return () => { cancelled = true; };
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeState = states[activeCli];
  const readyData = activeState.status === "ready" ? activeState.data : null;
  const updatedCount = CLI_ORDER.filter((cli) => request.ranges[cli]?.fromVersion).length;

  return (
    <ModalOverlay onClose={onClose} className={`changelog-modal changelog-modal-${activeCli}`}>
      <div className="changelog-header">
        <div>
          <div className="changelog-kicker">
            {request.kind === "startup" && updatedCount > 0 ? "CLI updates detected" : "Changelog"}
          </div>
          <div className="changelog-title">Codex and Claude changes</div>
        </div>
        <button className="changelog-close" onClick={onClose} title="Close">
          <IconClose size={14} />
        </button>
      </div>

      <div className="changelog-tabs" role="tablist">
        {CLI_ORDER.map((cli) => {
          const version = currentVersions[cli];
          const range = request.ranges[cli];
          return (
            <button
              key={cli}
              className={`changelog-tab changelog-tab-${cli}${activeCli === cli ? " changelog-tab-active" : ""}`}
              onClick={() => setActiveCli(cli)}
              role="tab"
              aria-selected={activeCli === cli}
            >
              <span>{cliLabel(cli)}</span>
              <span>{range?.fromVersion ? `${range.fromVersion} -> ${range.toVersion}` : (version ? `v${version}` : "not installed")}</span>
            </button>
          );
        })}
      </div>

      <div className="changelog-content">
        {activeState.status === "loading" || activeState.status === "idle" ? (
          <div className="changelog-loading">Loading {cliLabel(activeCli)} changelog...</div>
        ) : activeState.status === "error" ? (
          <div className="changelog-error">{activeState.error}</div>
        ) : readyData && readyData.entries.length === 0 ? (
          <div className="changelog-empty">No release notes found for this version.</div>
        ) : readyData ? (
          <>
            <div className="changelog-source-row">
              <span>{readyData.entries.length} release{readyData.entries.length === 1 ? "" : "s"}</span>
              <button onClick={() => invoke("shell_open", { path: readyData.sourceUrl })}>
                Open source
              </button>
            </div>
            {readyData.entries.map((entry) => (
              <EntryView key={`${activeCli}-${entry.version}`} entry={entry} />
            ))}
          </>
        ) : (
          <div className="changelog-empty">No release notes found for this version.</div>
        )}
      </div>
    </ModalOverlay>
  );
}
