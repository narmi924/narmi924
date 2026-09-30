#!/usr/bin/env node

/**
 * Prints the past year of contributions as a dial, on the same stock as the
 * header. Private work is counted in the total but no private repository is
 * named.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stocks, sheet, serif } from "./stock.mjs";

const login = "narmi924";
const token = process.env.PROFILE_GITHUB_TOKEN;
const assets = resolve(process.cwd(), "assets");

if (!token) {
  throw new Error("PROFILE_GITHUB_TOKEN is required to read the contribution calendar.");
}

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const from = new Date(today);
from.setUTCDate(from.getUTCDate() - 364);
const to = new Date(today);
to.setUTCHours(23, 59, 59, 999);

const isoDate = date => date.toISOString().slice(0, 10);
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function fetchCalendar() {
  const query = `
    query ($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount weekday } }
          }
        }
      }
    }
  `;
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "User-Agent": "narmi924-profile-contribution-record",
    },
    body: JSON.stringify({ query, variables: { login, from: from.toISOString(), to: to.toISOString() } }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map(error => error.message).join("; ");
    throw new Error(message || "GitHub GraphQL request failed with status " + response.status);
  }
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error("GitHub did not return a contribution calendar for " + login + ".");
  return calendar;
}

// The year as a dial: one ray per week, clockwise from a year ago to this
// week, Sunday nearest the centre. Dot size follows the day's count. A hand
// sweeps round like a clock and each week is inked as the hand passes it.
const S = 480, C = S / 2, R0 = 86, STEP = 16.5, SPAN = [10, 350];
const CYCLE = 9.4, SWEEP = [0.5, 4], FADE = [8.1, 8.7], HAND = [4, 356];

function radius(count) {
  if (count === 0) return 1.7;
  if (count <= 2) return 2.5;
  if (count <= 5) return 3.3;
  if (count <= 9) return 4.1;
  return 4.8;
}

const polar = (r, degrees) => {
  const a = (degrees * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
const f = n => n.toFixed(1);
const at = seconds => ((100 * seconds) / CYCLE).toFixed(2) + "%";

function motion() {
  const ring = 2 * Math.PI * 115, reach = (ring * (HAND[1] - HAND[0])) / 360;
  const ease = "animation-timing-function:cubic-bezier(.42,0,.35,1)";
  return `.pie{animation:pie ${CYCLE}s infinite}
@keyframes pie{0%,${at(SWEEP[0])}{stroke-dasharray:0 ${f(ring)};${ease}}${at(SWEEP[1])},100%{stroke-dasharray:${f(reach)} ${f(ring)}}}
.lit{animation:lit ${CYCLE}s infinite}
@keyframes lit{0%,${at(FADE[0])}{opacity:1}${at(FADE[1])},100%{opacity:0}}
.hand{opacity:0;transform-origin:${C}px ${C}px;animation:turn ${CYCLE}s infinite,show ${CYCLE}s infinite}
@keyframes turn{0%,${at(SWEEP[0])}{transform:rotate(${HAND[0]}deg);${ease}}${at(SWEEP[1])},100%{transform:rotate(${HAND[1]}deg)}}
@keyframes show{0%,${at(SWEEP[0] - 0.25)}{opacity:0}${at(SWEEP[0])},${at(FADE[0])}{opacity:1}${at(FADE[1])},100%{opacity:0}}
.trail{animation:trail ${CYCLE}s infinite}
@keyframes trail{0%,${at(SWEEP[0])}{opacity:0}${at(SWEEP[0] + 0.3)},${at(SWEEP[1] - 0.2)}{opacity:1}${at(SWEEP[1] + 0.4)},100%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
}

function hand(stock) {
  const wedges = Array.from({ length: 6 }, (_, k) => {
    const [x1, y1] = polar(196, -4 * (k + 1)), [x2, y2] = polar(196, -4 * k);
    return `<path d="M${C} ${C}L${f(x1)} ${f(y1)}A196 196 0 0 1 ${f(x2)} ${f(y2)}Z" fill-opacity="${(0.085 - k * 0.013).toFixed(3)}"/>`;
  }).join("");
  return `<g class="hand"><g class="trail" fill="${stock.ink}">${wedges}</g>
<path d="M${C} ${C - 74}V${C - 196}" stroke="${stock.ink}" stroke-width="1.4" stroke-linecap="round"/><circle cx="${C}" cy="${C - 196}" r="2.4" fill="${stock.ink}"/></g>`;
}

function render(stock, weeks, total) {
  const blind = [], inked = [], labels = [];
  const angle = i => SPAN[0] + ((SPAN[1] - SPAN[0]) * i) / (weeks.length - 1);
  weeks.forEach((week, i) => {
    for (const day of week) {
      const [x, y] = polar(R0 + day.weekday * STEP, angle(i));
      (day.contributionCount ? inked : blind).push(`<circle cx="${f(x)}" cy="${f(y)}" r="${radius(day.contributionCount)}"/>`);
    }
    const first = week.find(day => day.date.endsWith("-01"));
    if (first) {
      const [x, y] = polar(R0 + 6 * STEP + 24, angle(i));
      labels.push(`<text x="${f(x)}" y="${f(y + 4.5)}">${months[+first.date.slice(5, 7) - 1]}</text>`);
    }
  });
  const count = new Intl.NumberFormat("en-US").format(total);
  const [tx1, ty1] = polar(R0 - 10, 0), [tx2, ty2] = polar(R0 + 6 * STEP + 8, 0);
  const ring = 2 * Math.PI * 115;
  return sheet({
    W: S, H: S, stock,
    title: `${count} contributions in the past year, private repositories included`,
    defs: `<mask id="reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}"><circle class="pie" cx="${C}" cy="${C}" r="115" fill="none" stroke="#fff" stroke-width="230" transform="rotate(${HAND[0] - 90} ${C} ${C})" stroke-dasharray="${f((ring * (HAND[1] - HAND[0])) / 360)} ${f(ring)}"/></mask>`,
    style: motion(),
    body: `<path d="M${f(tx1)} ${f(ty1)}L${f(tx2)} ${f(ty2)}" stroke="${stock.quiet}" stroke-opacity=".45" stroke-dasharray="1 4" stroke-linecap="round"/>
<g filter="url(#blind)" opacity=".55">${blind.join("")}</g>
<g fill="${stock.ink}" opacity=".16">${inked.join("")}</g>
<g class="lit" mask="url(#reveal)" fill="${stock.ink}">${inked.join("")}</g>
<g ${serif} font-style="italic" font-size="13" fill="${stock.quiet}" text-anchor="middle">${labels.join("")}</g>
<g ${serif} text-anchor="middle">
<g filter="url(#press)"><text x="${C}" y="${C - 12}" font-style="italic" font-size="46" fill="${stock.ink}">${count}</text></g>
<text x="${C}" y="${C + 12}" font-size="15" fill="${stock.text}">contributions</text>
<text x="${C}" y="${C + 30}" font-size="15" fill="${stock.text}">in the past year</text>
<text x="${C}" y="${C + 50}" font-style="italic" font-size="12" fill="${stock.quiet}">private work included</text>
</g>
${hand(stock)}`,
  });
}

const calendar = await fetchCalendar();
const start = isoDate(from), end = isoDate(today);
const weeks = calendar.weeks
  .map(week => week.contributionDays.filter(day => day.date >= start && day.date <= end))
  .filter(week => week.length);

await mkdir(assets, { recursive: true });
for (const stock of Object.values(stocks)) {
  await writeFile(resolve(assets, `contribution-signal${stock.suffix}.svg`), render(stock, weeks, calendar.totalContributions), "utf8");
}
console.log("Printed " + calendar.totalContributions + " contributions into assets/contribution-signal*.svg");
