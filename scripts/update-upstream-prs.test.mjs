import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchLedger, renderLedger, replaceLedger, updateLedger } from "./update-upstream-prs.mjs";

const original = "Keep my projects\n<!-- upstream-prs:start -->\nold\n<!-- upstream-prs:end -->\nKeep my SVG";
const pr = { number: 1, title: "<img> [title] | code", url: "https://github.com/vercel-labs/agent-browser/pull/1", state: "MERGED", isDraft: false, updatedAt: "2026-09-18T00:00:00Z" };
function payload() {
  return { data: {
    p0: { issueCount: 17, nodes: [pr] }, open0: { issueCount: 10 }, merged0: { issueCount: 3 },
    p1: { issueCount: 0, nodes: [] }, open1: { issueCount: 0 }, merged1: { issueCount: 0 },
  } };
}
const respond = data => async () => ({ ok: true, json: async () => data });

test("only replaces the delimited section and preserves CRLF", () => {
  const input = original.replaceAll("\n", "\r\n");
  assert.equal(replaceLedger(input, "new\nrows"),
    input.replace("\r\nold\r\n", "\r\nnew\r\nrows\r\n"));
  assert.throws(() => replaceLedger("no markers", "new"));
  assert.throws(() => replaceLedger(original + "<!-- upstream-prs:start -->", "new"));
  assert.throws(() => replaceLedger("<!-- upstream-prs:end --><!-- upstream-prs:start -->", "new"));
});

test("uses full search counts, escapes titles and distinguishes PR states", async () => {
  const records = await fetchLedger("test", respond(payload()));
  assert.equal(records[0].total, 17);
  const text = renderLedger(records);
  assert.ok(text.includes("17 pull requests (3 merged, 10 open, 2 carried over into a merged fix and 2 closed)"));
  assert.ok(text.includes("- No pull requests to [native]("));
  assert.ok(text.includes("&lt;img&gt; \\[title\\] \\| code"));
  assert.ok(text.includes("(merged)"));
  assert.ok(text.includes("Nothing here yet."));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text), "no dates, so an unchanged week makes no commit");
  for (const [state, isDraft, label] of [["CLOSED", true, "closed"], ["OPEN", true, "draft"], ["OPEN", false, "open"]]) {
    records[0].prs = [{ ...pr, state, isDraft }];
    assert.ok(renderLedger(records).includes("(" + label + ")"));
  }
  records[0] = { ...records[0], total: 7, open: 7, merged: 0, carried: 0 };
  assert.ok(renderLedger(records).includes("- 7 open pull requests to [agent-browser]("));
});

test("carried-over PRs are counted apart from closed ones and link the fix that merged them", async () => {
  const data = payload();
  data.data.p0 = { issueCount: 7, nodes: [
    { ...pr, number: 1573, url: "https://github.com/vercel-labs/agent-browser/pull/1573", state: "CLOSED" },
    { ...pr, number: 1655, url: "https://github.com/vercel-labs/agent-browser/pull/1655", state: "OPEN" },
  ] };
  data.data.open0 = { issueCount: 5 };
  data.data.merged0 = { issueCount: 0 };
  const records = await fetchLedger("test", respond(data));
  const text = renderLedger(records);
  assert.ok(text.includes("- 7 pull requests (5 open and 2 carried over into a merged fix) to [agent-browser]("));
  assert.ok(text.includes("(carried over into [#2212](https://github.com/vercel-labs/agent-browser/pull/2212), merged)"));
  assert.ok(text.includes("pull/1655) &lt;img&gt; \\[title\\] \\| code (open)"));
  records[0] = { ...records[0], open: 0, carried: 2, total: 2, carriedInto: { 1: 10, 2: 20 } };
  assert.ok(renderLedger(records).includes("- 2 pull requests (2 carried over into merged fixes) to"));
});

test("a carried-over PR that is not closed, or more carried than closed, is rejected", async () => {
  const reopened = payload();
  reopened.data.p0.nodes = [{ ...pr, number: 1574, url: "https://github.com/vercel-labs/agent-browser/pull/1574", state: "OPEN" }];
  await assert.rejects(fetchLedger("test", respond(reopened)), /carried over but is open/);
  const overcounted = payload();
  overcounted.data.p0.issueCount = 14;
  await assert.rejects(fetchLedger("test", respond(overcounted)));
});

test("partial API errors, missing counts and invalid PR URLs are rejected", async () => {
  await assert.rejects(fetchLedger("test", respond({ ...payload(), errors: [{ message: "rate limited" }] })));
  const missing = payload();
  delete missing.data.open1;
  await assert.rejects(fetchLedger("test", respond(missing)));
  const invalid = payload();
  invalid.data.p0.nodes = [{ ...pr, url: "https://example.com" }];
  await assert.rejects(fetchLedger("test", respond(invalid)));
});

test("API failure leaves README untouched; success preserves surrounding content and is idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "profile-ledger-test-"));
  const readmePath = join(directory, "README.md");
  try {
    await writeFile(readmePath, original);
    await assert.rejects(updateLedger({ readmePath, token: "test", fetcher: respond({ errors: [{ message: "unavailable" }] }) }));
    assert.equal(await readFile(readmePath, "utf8"), original);
    const options = { readmePath, token: "test", fetcher: respond(payload()) };
    await updateLedger(options);
    const first = await readFile(readmePath, "utf8");
    assert.ok(first.startsWith("Keep my projects\n"));
    assert.ok(first.endsWith("\nKeep my SVG"));
    await updateLedger(options);
    assert.equal(await readFile(readmePath, "utf8"), first);
  } finally {
    await rm(readmePath);
    await rmdir(directory);
  }
});
