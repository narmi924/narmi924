#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const projects = [
  { repo: "vercel-labs/agent-browser", focus: "CDP-session resilience, HAR capture, CLI error contracts, browser-state restoration" },
  { repo: "vercel-labs/native", focus: "Windows portability, image-cache test compilation, markup-server correctness, build validation" },
];
const start = "<!-- upstream-prs:start -->";
const end = "<!-- upstream-prs:end -->";

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

export async function fetchLedger(token, fetcher = fetch) {
  if (!token) throw new Error("GITHUB_TOKEN or PROFILE_GITHUB_TOKEN is required.");
  const queries = projects.flatMap(({ repo }, index) => {
    const base = "repo:" + repo + " author:narmi924 is:pr";
    return [
      `p${index}: search(type: ISSUE, first: 8, query: ${JSON.stringify(base + " sort:updated-desc")}) {
        issueCount nodes { ... on PullRequest {
          number title url state isDraft updatedAt
        } }
      }`,
      `open${index}: search(type: ISSUE, first: 1, query: ${JSON.stringify(base + " is:open")}) { issueCount }`,
      `merged${index}: search(type: ISSUE, first: 1, query: ${JSON.stringify(base + " is:merged")}) { issueCount }`,
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
  return projects.map((project, index) => {
    const result = payload.data?.["p" + index];
    const open = payload.data?.["open" + index]?.issueCount;
    const merged = payload.data?.["merged" + index]?.issueCount;
    if (!result || !Array.isArray(result.nodes) ||
        ![result.issueCount, open, merged].every(n => Number.isInteger(n) && n >= 0) ||
        open + merged > result.issueCount || (result.issueCount > 0 && result.nodes.length === 0)) {
      throw new Error("Incomplete PR data for " + project.repo);
    }
    for (const pr of result.nodes) {
      if (!pr || !Number.isInteger(pr.number) || typeof pr.title !== "string" ||
          pr.url !== "https://github.com/" + project.repo + "/pull/" + pr.number ||
          !["OPEN", "CLOSED", "MERGED"].includes(pr.state) ||
          !Number.isFinite(Date.parse(pr.updatedAt))) {
        throw new Error("Invalid PR data for " + project.repo);
      }
    }
    return { ...project, total: result.issueCount, open, merged, prs: result.nodes };
  });
}

export function renderLedger(records, date = new Date().toISOString().slice(0, 10)) {
  const lines = [
    "", "| Project | Open | Merged | Total | Focus |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const record of records) {
    const name = record.repo.split("/")[1];
    lines.push(`| [${name}](https://github.com/${record.repo}/pulls?q=is%3Apr+author%3Anarmi924) | ${record.open} | ${record.merged} | ${record.total} | ${record.focus} |`);
  }
  lines.push("", "<details>", `<summary><strong>Recent upstream PR ledger — updated: ${date}</strong></summary>`,
    "", "Eight most recently updated PRs per project · UTC dates.", "");
  for (const record of records) {
    lines.push("**" + record.repo.split("/")[1] + "**", "");
    for (const pr of record.prs) {
      const state = pr.state === "MERGED" ? "Merged" : pr.state === "CLOSED" ? "Closed" : pr.isDraft ? "Draft" : "Open";
      lines.push(`- [#${pr.number} — ${safeText(pr.title)}](${pr.url}) · **${state}** · ${pr.updatedAt.slice(0, 10)}`);
    }
    if (!record.prs.length) lines.push("No public PRs yet.");
    lines.push("");
  }
  lines.push("</details>", "");
  return lines.join("\n");
}

export async function updateLedger({ readmePath = resolve("README.md"), token = process.env.GITHUB_TOKEN || process.env.PROFILE_GITHUB_TOKEN, fetcher = fetch } = {}) {
  const readme = await readFile(readmePath, "utf8");
  replaceLedger(readme, ""); // Validate the edit boundary before making requests.
  const records = await fetchLedger(token, fetcher);
  const updated = replaceLedger(readme, renderLedger(records));
  if (updated !== readme) await writeFile(readmePath, updated, "utf8");
  console.log(records.map(r => `${r.repo}: ${r.open} open, ${r.merged} merged, ${r.total} total`).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await updateLedger();
}
