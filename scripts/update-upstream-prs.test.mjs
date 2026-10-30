import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchLedger, renderLedger, replaceLedger, updateLedger } from "./update-upstream-prs.mjs";

const original = "Keep my projects\n<!-- upstream-prs:start -->\nold\n<!-- upstream-prs:end -->\nKeep my SVG";
const ab = "https://github.com/vercel-labs/agent-browser";
const list = [
  { repo: "vercel-labs/agent-browser", focus: ", on things",
    carriedInto: { 10: 100, 11: 100, 12: 200 },
    fixes: [{ pr: 100, title: "Lost state", story: "Story one." }, { pr: 200, title: "`flag` ignored", story: "Story two." }] },
  { repo: "vercel-labs/native", focus: ", mostly Windows" },
];
const pr = (number, state, extra = {}) => ({ number, title: "fix: thing " + number, url: ab + "/pull/" + number, state, isDraft: false, ...extra });
const trailer = { commits: { nodes: [{ commit: { message: "fix\n\nCo-Authored-By: Someone <1+narmi924@users.noreply.github.com>" } }] } };
function payload() {
  return { data: {
    p0: { issueCount: 5, nodes: [pr(13, "OPEN", { title: "<img> [title] | code" }), pr(12, "OPEN"), pr(11, "CLOSED"), pr(10, "CLOSED"), pr(9, "OPEN")] },
    open0: { issueCount: 3 }, merged0: { issueCount: 0 },
    r0: { pr10: pr(10, "CLOSED"), pr11: pr(11, "CLOSED"), pr12: pr(12, "OPEN"),
      pr100: pr(100, "MERGED", { mergeCommit: { message: "Lost state (#100)" }, commits: { nodes: [] } }),
      pr200: pr(200, "OPEN", { mergeCommit: null, ...trailer }) },
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

test("fixes that took up my PRs lead, with live state and co-authorship read from commit trailers", async () => {
  const text = renderLedger(await fetchLedger("test", respond(payload()), list));
  assert.ok(text.includes(`- **Lost state**, agent-browser [#100](${ab}/pull/100), merged  \n  Story one. Carried over from my [#10](${ab}/pull/10) and [#11](${ab}/pull/11).`));
  assert.ok(text.includes(`- **\`flag\` ignored**, agent-browser [#200](${ab}/pull/200), in review with me as co-author  \n  Story two. Carried over from my [#12](${ab}/pull/12).`));
  assert.ok(text.includes("\nTwo more pull requests are open on [agent-browser](" + ab + "/pulls?q=is%3Apr+author%3Anarmi924), on things.\n"));
  assert.ok(!text.includes("open on [native]"));
  assert.ok(text.includes("Nothing here yet."));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text), "no dates, so an unchanged week makes no commit");
});

test("the ledger lists PRs newest first and says where carried-over ones went", async () => {
  const text = renderLedger(await fetchLedger("test", respond(payload()), list));
  const rows = text.split("\n").filter(line => line.startsWith("- [#"));
  assert.deepEqual(rows.map(row => row.match(/^- \[#(\d+)\]/)[1]), ["13", "12", "11", "10", "9"]);
  assert.ok(rows[0].endsWith("&lt;img&gt; \\[title\\] \\| code (open)"));
  assert.ok(rows[1].endsWith(`(carried over into [#200](${ab}/pull/200), in review, co-authored)`));
  assert.ok(rows[3].endsWith(`(carried over into [#100](${ab}/pull/100), merged)`));
});

test("state changes on GitHub change the wording without touching the config", async () => {
  const merged = payload();
  merged.data.r0.pr200.state = "MERGED";
  merged.data.r0.pr12.state = "CLOSED";
  merged.data.open0.issueCount = 2;
  merged.data.p0.nodes[1].state = "CLOSED";
  let text = renderLedger(await fetchLedger("test", respond(merged), list));
  assert.ok(text.includes(`[#200](${ab}/pull/200), merged with me as co-author  `));
  assert.ok(text.includes("(carried over into [#200](" + ab + "/pull/200), merged, co-authored)"));
  assert.ok(text.includes("\nTwo more pull requests are open on [agent-browser]("));

  const native = payload();
  native.data.r0.pr200.isDraft = true;
  native.data.p0.nodes.push(pr(8, "MERGED"));
  native.data.p0.issueCount = 6;
  native.data.merged0.issueCount = 1;
  native.data.p1 = { issueCount: 1, nodes: [{ ...pr(5, "OPEN"), url: "https://github.com/vercel-labs/native/pull/5" }] };
  native.data.open1.issueCount = 1;
  text = renderLedger(await fetchLedger("test", respond(native), list));
  assert.ok(text.includes(`[#200](${ab}/pull/200), in progress with me as co-author`));
  assert.ok(text.includes(`- **fix: thing 8**, agent-browser [#8](${ab}/pull/8), merged\n`), "a PR merged as it was still shows up");
  assert.ok(text.includes("on things. One is open on [native](https://github.com/vercel-labs/native/pulls?q=is%3Apr+author%3Anarmi924), mostly Windows."));
});

test("a closed PR nobody accounted for, or a broken carried-over map, stops the refresh", async () => {
  const closed = payload();
  closed.data.p0.nodes.push(pr(7, "CLOSED"));
  closed.data.p0.issueCount = 6;
  await assert.rejects(fetchLedger("test", respond(closed), list), /#7 closed without a carriedInto entry/);
  const mergedItself = payload();
  mergedItself.data.r0.pr11.state = "MERGED";
  await assert.rejects(fetchLedger("test", respond(mergedItself), list), /#11 was merged itself/);
  const abandoned = payload();
  abandoned.data.r0.pr200.state = "CLOSED";
  await assert.rejects(fetchLedger("test", respond(abandoned), list), /#200 was closed without merging/);
  await assert.rejects(fetchLedger("test", respond(payload()), [{ ...list[0], carriedInto: { 10: 300 } }]), /#300 is in carriedInto but has no entry in fixes/);
});

test("partial API errors, missing counts and invalid PR URLs are rejected", async () => {
  await assert.rejects(fetchLedger("test", respond({ ...payload(), errors: [{ message: "rate limited" }] }), list));
  const missing = payload();
  delete missing.data.open1;
  await assert.rejects(fetchLedger("test", respond(missing), list));
  const invalid = payload();
  invalid.data.p0.nodes = [{ ...pr(1, "OPEN"), url: "https://example.com" }];
  await assert.rejects(fetchLedger("test", respond(invalid), list));
  const unread = payload();
  delete unread.data.r0.pr100;
  await assert.rejects(fetchLedger("test", respond(unread), list), /Could not read vercel-labs\/agent-browser#100/);
});

test("API failure leaves README untouched; success preserves surrounding content and is idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "profile-ledger-test-"));
  const readmePath = join(directory, "README.md");
  try {
    await writeFile(readmePath, original);
    await assert.rejects(updateLedger({ readmePath, token: "test", list, fetcher: respond({ errors: [{ message: "unavailable" }] }) }));
    assert.equal(await readFile(readmePath, "utf8"), original);
    const options = { readmePath, token: "test", list, fetcher: respond(payload()) };
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
