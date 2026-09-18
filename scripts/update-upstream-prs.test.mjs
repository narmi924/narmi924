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
    p0: { issueCount: 15, nodes: [pr] }, open0: { issueCount: 10 }, merged0: { issueCount: 3 },
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
  assert.equal(records[0].total, 15);
  const text = renderLedger(records, "2026-09-18");
  assert.ok(text.includes("| 10 | 3 | 15 |"));
  assert.ok(text.includes("&lt;img&gt; \\[title\\] \\| code"));
  assert.ok(text.includes("**Merged**"));
  assert.ok(text.includes("No public PRs yet."));
  for (const [state, isDraft, label] of [["CLOSED", true, "Closed"], ["OPEN", true, "Draft"], ["OPEN", false, "Open"]]) {
    records[0].prs = [{ ...pr, state, isDraft }];
    assert.ok(renderLedger(records).includes("**" + label + "**"));
  }
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
