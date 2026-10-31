#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const login = "narmi924";
const agentBrowser = "https://github.com/vercel-labs/agent-browser";

export const projects = [
  { repo: "vercel-labs/agent-browser", focus: ", for init scripts in new tabs, JSON output for startup errors and CDP sessions that vanish during setup",
    // My PRs a maintainer carried over into a PR of their own. GitHub only
    // records these as closed, so they are listed by hand.
    carriedInto: { 1573: 2212, 1574: 2212, 1654: 2253, 1590: 2271 },
    // The PRs that took up my work, in the order the README tells them.
    fixes: [
      { pr: 2212, title: "Saved browser state lost to a login redirect",
        story: `Restoring a saved session seemed to drop large \`sessionStorage\` values ([#1505](${agentBrowser}/issues/1505)). I found the size didn't matter: the app's auth guard redirected to login before storage was written, so the value landed under the login page's origin.` },
      { pr: 2253, title: "`errors --clear` that never cleared",
        story: "The CLI and the MCP server passed the flag on, but the daemon ignored it and kept returning the same errors." },
      { pr: 2271, title: "HAR captures lost to a failed export",
        story: "`network har stop` cleared the recording before writing the file, so a bad output path lost the capture and a retry saved an empty HAR." },
    ] },
  { repo: "vercel-labs/native", focus: ", mostly to keep it building and running on Windows",
    // PRs I closed myself after main moved on; they are left out of the README.
    withdrawn: [158, 171] },
];
const start = "<!-- upstream-prs:start -->";
const end = "<!-- upstream-prs:end -->";
const coAuthor = new RegExp("^co-authored-by:.*\\b" + login + "\\b", "im");
const words = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function replaceLedger(readme, content) {
  if (readme.split(start).length !== 2 || readme.split(end).length !== 2) {
    throw new Error("README must contain exactly one upstream-prs marker pair.");
  }
  const first = readme.indexOf(start) + start.length;
  const last = readme.indexOf(end);
  if (last < first) throw new Error("Upstream PR markers are out of order.");
  const newline = readme.includes("\r\n") ? "\r\n" : "\n";
  return readme.slice(0, first) + newline + content.replace(/\r?\n/g, newline) + newline + readme.slice(last);
}

function safeText(value) {
  return String(value).replace(/\s+/g, " ").replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}|]/g, (char) => "\\" + char);
}

const linkedNumbers = ({ carriedInto = {}, fixes = [], withdrawn = [] }) =>
  [...Object.keys(carriedInto).map(Number), ...fixes.map(fix => fix.pr), ...withdrawn];

export async function fetchLedger(token, fetcher = fetch, list = projects) {
  if (!token) throw new Error("GITHUB_TOKEN or PROFILE_GITHUB_TOKEN is required.");
  for (const { repo, carriedInto = {}, fixes = [] } of list) {
    for (const into of new Set(Object.values(carriedInto))) {
      if (!fixes.some(fix => fix.pr === into)) throw new Error(repo + "#" + into + " is in carriedInto but has no entry in fixes");
    }
  }
  const queries = list.flatMap((project, index) => {
    const base = "repo:" + project.repo + " author:" + login + " is:pr";
    const [owner, name] = project.repo.split("/");
    const linked = linkedNumbers(project).map(n => `pr${n}: pullRequest(number: ${n}) {
          number url state isDraft mergeCommit { message } commits(last: 100) { nodes { commit { message } } }
        }`);
    return [
      `p${index}: search(type: ISSUE, first: 8, query: ${JSON.stringify(base + " sort:created-desc")}) {
        issueCount nodes { ... on PullRequest { number title url state isDraft } }
      }`,
      `open${index}: search(type: ISSUE, first: 1, query: ${JSON.stringify(base + " is:open")}) { issueCount }`,
      `merged${index}: search(type: ISSUE, first: 1, query: ${JSON.stringify(base + " is:merged")}) { issueCount }`,
      ...(linked.length ? [`r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${linked.join("\n")} }`] : []),
    ];
  }).join("\n");
  const response = await fetcher("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "User-Agent": "narmi924-profile" },
    body: JSON.stringify({ query: "{ " + queries + " }" }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error("PR query failed: " + (payload.errors?.map(e => e.message).join("; ") || response.status));
  }
  return list.map((project, index) => {
    const result = payload.data?.["p" + index];
    const open = payload.data?.["open" + index]?.issueCount;
    const merged = payload.data?.["merged" + index]?.issueCount;
    if (!result || !Array.isArray(result.nodes) ||
        ![result.issueCount, open, merged].every(n => Number.isInteger(n) && n >= 0) ||
        open + merged > result.issueCount || (result.issueCount > 0 && result.nodes.length === 0)) {
      throw new Error("Incomplete PR data for " + project.repo);
    }
    const valid = (pr, number = pr?.number) => pr && Number.isInteger(number) && pr.number === number &&
      pr.url === "https://github.com/" + project.repo + "/pull/" + number && ["OPEN", "CLOSED", "MERGED"].includes(pr.state);
    for (const pr of result.nodes) {
      if (!valid(pr) || typeof pr.title !== "string") throw new Error("Invalid PR data for " + project.repo);
    }
    const linked = {};
    for (const n of linkedNumbers(project)) {
      linked[n] = payload.data?.["r" + index]?.["pr" + n];
      if (!valid(linked[n], n)) throw new Error("Could not read " + project.repo + "#" + n);
    }

    const carried = Object.entries(project.carriedInto ?? {}).map(([from, into]) => ({ from: Number(from), into, state: linked[from].state }));
    for (const { from } of carried.filter(c => c.state === "MERGED")) {
      throw new Error(project.repo + "#" + from + " was merged itself, so it should not be in carriedInto");
    }
    const withdrawn = project.withdrawn ?? [];
    for (const n of withdrawn.filter(n => linked[n].state !== "CLOSED")) {
      throw new Error(project.repo + "#" + n + " is in withdrawn but is " + linked[n].state.toLowerCase());
    }
    const closed = result.issueCount - open - merged;
    const accounted = carried.filter(c => c.state === "CLOSED").length + withdrawn.length;
    if (closed > accounted) {
      const unknown = result.nodes.filter(pr => pr.state === "CLOSED" && !project.carriedInto?.[pr.number] && !withdrawn.includes(pr.number))
        .map(pr => "#" + pr.number);
      throw new Error(project.repo + (unknown.length ? " " + unknown.join(", ") : "") + " closed without a carriedInto or withdrawn entry. " +
        "If a maintainer carried it over into a PR of their own, add it to carriedInto; if I closed it myself, add it to withdrawn.");
    }
    const ownOpen = open - carried.filter(c => c.state === "OPEN").length;
    if (closed < accounted || ownOpen < 0) throw new Error("Incomplete PR data for " + project.repo);

    const fixes = (project.fixes ?? []).map(fix => {
      const pr = linked[fix.pr];
      if (pr.state === "CLOSED") throw new Error(project.repo + "#" + fix.pr + " was closed without merging");
      const messages = [pr.mergeCommit?.message, ...(pr.commits?.nodes ?? []).map(node => node?.commit?.message)].join("\n");
      return { ...fix, url: pr.url, state: pr.state, isDraft: pr.isDraft, coAuthored: coAuthor.test(messages),
        from: carried.filter(c => c.into === fix.pr).map(c => c.from).sort((a, b) => a - b) };
    });
    return { ...project, total: result.issueCount, open, merged, ownOpen, fixes, prs: result.nodes.filter(pr => !withdrawn.includes(pr.number)) };
  });
}

const fixState = fix => fix.state === "MERGED" ? "merged" : fix.isDraft ? "in progress" : "in review";
const and = items => items.length > 1 ? items.slice(0, -1).join(", ") + " and " + items.at(-1) : items.join("");

export function renderLedger(records) {
  const lines = [""];
  for (const record of records) {
    const name = record.repo.split("/")[1];
    const pull = n => `[#${n}](https://github.com/${record.repo}/pull/${n})`;
    for (const fix of record.fixes) {
      const credit = fix.coAuthored ? " with me as co-author" : "";
      const from = fix.from.length ? " Carried over from my " + and(fix.from.map(pull)) + "." : "";
      lines.push(`- **${fix.title}**, ${name} ${pull(fix.pr)}, ${fixState(fix)}${credit}  `, `  ${fix.story}${from}`);
    }
    // A PR of mine merged as it was; it shows up here until it gets its own entry in fixes.
    for (const pr of record.prs.filter(pr => pr.state === "MERGED" && !record.fixes.some(fix => fix.pr === pr.number))) {
      lines.push(`- **${safeText(pr.title)}**, ${name} ${pull(pr.number)}, merged`);
    }
  }
  const stillOpen = records.filter(record => record.ownOpen > 0).map((record, index) => {
    const count = words[record.ownOpen] ?? String(record.ownOpen);
    const more = record.fixes.length || record.merged ? " more" : "";
    const noun = index ? "" : record.ownOpen === 1 ? " pull request" : " pull requests";
    const link = `[${record.repo.split("/")[1]}](https://github.com/${record.repo}/pulls?q=is%3Apr+author%3A${login})`;
    return `${count}${more}${noun} ${record.ownOpen === 1 ? "is" : "are"} open on ${link}${record.focus ?? ""}.`;
  });
  if (stillOpen.length) lines.push("", stillOpen.join(" "));

  lines.push("", "<details>", "<summary>Recent pull requests</summary>", "");
  for (const record of records) {
    lines.push("**" + record.repo.split("/")[1] + "**", "");
    for (const pr of [...record.prs].sort((a, b) => b.number - a.number)) {
      const fix = record.fixes.find(fix => fix.pr === record.carriedInto?.[pr.number]);
      const state = pr.state === "MERGED" ? "merged"
        : fix ? `carried over into [#${fix.pr}](${fix.url}), ${fixState(fix)}${fix.coAuthored ? ", co-authored" : ""}`
        : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";
      lines.push(`- [#${pr.number}](${pr.url}) ${safeText(pr.title)} (${state})`);
    }
    if (!record.prs.length) lines.push("Nothing here yet.");
    lines.push("");
  }
  lines.push("</details>", "");
  return lines.join("\n");
}

export async function updateLedger({ readmePath = resolve("README.md"), token = process.env.GITHUB_TOKEN || process.env.PROFILE_GITHUB_TOKEN, fetcher = fetch, list = projects } = {}) {
  const readme = await readFile(readmePath, "utf8");
  replaceLedger(readme, ""); // Validate the edit boundary before making requests.
  const records = await fetchLedger(token, fetcher, list);
  const updated = replaceLedger(readme, renderLedger(records));
  if (updated !== readme) await writeFile(readmePath, updated, "utf8");
  console.log(records.map(r => `${r.repo}: ${r.open} open, ${r.merged} merged, ${r.fixes.length} carried-over fixes, ${r.total} total`).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await updateLedger();
}
