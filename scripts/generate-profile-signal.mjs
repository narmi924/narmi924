#!/usr/bin/env node

/**
 * Builds a warm, editorial contribution record from GitHub's authenticated
 * GraphQL API. The card intentionally aggregates private work without ever
 * identifying a private repository.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const login = "narmi924";
const token = process.env.PROFILE_GITHUB_TOKEN;
const outputPath = resolve(process.cwd(), "assets", "contribution-signal.svg");

if (!token) {
  throw new Error(
    "PROFILE_GITHUB_TOKEN is required to read the authenticated contribution record.",
  );
}

const today = new Date();
today.setUTCHours(0, 0, 0, 0);

const from = new Date(today);
from.setUTCDate(from.getUTCDate() - 364);

const to = new Date(today);
to.setUTCHours(23, 59, 59, 999);

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchContributionRecord() {
  const query = `
    query ProfileContributionRecord($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                weekday
              }
            }
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
    body: JSON.stringify({
      query,
      variables: {
        login,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join("; ");
    throw new Error(message || "GitHub GraphQL request failed with status " + response.status);
  }

  const collection = payload.data?.user?.contributionsCollection;
  if (!collection) {
    throw new Error("GitHub did not return a contribution collection for " + login + ".");
  }

  return collection;
}

function contributionColor(count) {
  if (count === 0) return "#E7DED2";
  if (count <= 2) return "#D7BDA1";
  if (count <= 5) return "#B9845C";
  if (count <= 9) return "#8B5D3C";
  return "#5D321B";
}

function heatmapCell(day, weekIndex) {
  const x = 182 + weekIndex * 13.15;
  const y = 202 + day.weekday * 13;
  const label = day.date + ": " + day.contributionCount + " contributions";

  return (
    '<rect x="' +
    x.toFixed(2) +
    '" y="' +
    y +
    '" width="9.2" height="9.2" rx="2" fill="' +
    contributionColor(day.contributionCount) +
    '"><title>' +
    escapeXml(label) +
    "</title></rect>"
  );
}

function heatmapColumn(week, weekIndex) {
  const delay = (weekIndex * 0.055).toFixed(3);
  const cells = week.map((day) => heatmapCell(day, weekIndex)).join("");

  return '<g class="heat-column" style="animation-delay:' + delay + 's">' + cells + "</g>";
}

const collection = await fetchContributionRecord();
const calendar = collection.contributionCalendar;
const startDate = isoDate(from);
const endDate = isoDate(today);

const weeks = calendar.weeks.map((week) =>
  week.contributionDays.filter((day) => day.date >= startDate && day.date <= endDate),
);

const days = weeks.flat();
const totalContributions = calendar.totalContributions;
const privateContributions = collection.restrictedContributionsCount;
const activeDays = days.filter((day) => day.contributionCount > 0).length;
const columns = weeks.map((week, weekIndex) => heatmapColumn(week, weekIndex)).join("");

const displayTotal = formatNumber(totalContributions);
const displayPrivate = formatNumber(privateContributions);
const generatedAt = isoDate(today);

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 342" role="img" aria-labelledby="title description">' +
  '<title id="title">Contribution record for narmi924</title>' +
  '<desc id="description">' +
  escapeXml(
    displayTotal +
      " contributions over the last 365 days, including " +
      displayPrivate +
      " private contributions.",
  ) +
  "</desc>" +
  "<defs>" +
  '<pattern id="paper-grain" width="17" height="17" patternUnits="userSpaceOnUse"><path d="M2 3h1M11 7h1M6 13h1M15 15h1" stroke="#171511" stroke-linecap="square" stroke-opacity=".035"/></pattern>' +
  '<style>.heat-column { animation: column-print 10.8s cubic-bezier(.16, 1, .3, 1) infinite both; } @keyframes column-print { 0%, 6% { opacity: 0; transform: translateY(8px); } 15%, 84% { opacity: 1; transform: translateY(0); } 93%, 100% { opacity: .18; transform: translateY(-3px); } } @media (prefers-reduced-motion: reduce) { .heat-column { animation: none; } }</style>' +
  "</defs>" +
  '<rect width="1080" height="342" rx="32" fill="#F3F0E8"/>' +
  '<rect x="16" y="16" width="1048" height="310" rx="25" fill="#FCFBFA" stroke="#171511" stroke-opacity=".15"/>' +
  '<rect x="17" y="17" width="1046" height="308" rx="24" fill="url(#paper-grain)"/>' +
  '<g font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">' +
  '<rect x="44" y="42" width="20" height="2" fill="#8B4513"/>' +
  '<text x="76" y="47" fill="#8B4513" font-size="13" font-weight="750" letter-spacing="2.05">CONTRIBUTION RECORD</text>' +
  '<text x="44" y="75" fill="#6A5D50" font-size="12.5" font-weight="500">LAST 365 DAYS · REFRESHED ' +
  generatedAt +
  "</text>" +
  '<path d="M44 91H1036" stroke="#171511" stroke-opacity=".14"/>' +
  '<text x="44" y="145" fill="#171511" font-size="41" font-weight="800" letter-spacing="-1.8">' +
  displayTotal +
  "</text>" +
  '<text x="44" y="165" fill="#6A5D50" font-size="11.5" font-weight="750" letter-spacing="1.15">TOTAL CONTRIBUTIONS</text>' +
  '<text x="288" y="145" fill="#171511" font-size="41" font-weight="800" letter-spacing="-1.8">' +
  displayPrivate +
  "</text>" +
  '<text x="288" y="165" fill="#6A5D50" font-size="11.5" font-weight="750" letter-spacing="1.15">PRIVATE CONTRIBUTIONS</text>' +
  '<text x="579" y="145" fill="#171511" font-size="41" font-weight="800" letter-spacing="-1.8">' +
  activeDays +
  "</text>" +
  '<text x="579" y="165" fill="#6A5D50" font-size="11.5" font-weight="750" letter-spacing="1.15">ACTIVE DAYS</text>' +
  '<g aria-label="Contribution heatmap">' +
  '<text x="132" y="211" fill="#8B6B3D" font-size="10.5" font-weight="700">SUN</text>' +
  '<text x="132" y="237" fill="#8B6B3D" font-size="10.5" font-weight="700">TUE</text>' +
  '<text x="132" y="263" fill="#8B6B3D" font-size="10.5" font-weight="700">THU</text>' +
  '<text x="132" y="289" fill="#8B6B3D" font-size="10.5" font-weight="700">SAT</text>' +
  columns +
  "</g>" +
  '<g transform="translate(900 208)">' +
  '<text x="0" y="-8" fill="#8B6B3D" font-size="10.5" font-weight="700" letter-spacing="1">LESS</text>' +
  '<rect x="0" y="2" width="11" height="11" rx="2" fill="#E7DED2"/>' +
  '<rect x="16" y="2" width="11" height="11" rx="2" fill="#D7BDA1"/>' +
  '<rect x="32" y="2" width="11" height="11" rx="2" fill="#B9845C"/>' +
  '<rect x="48" y="2" width="11" height="11" rx="2" fill="#8B5D3C"/>' +
  '<rect x="64" y="2" width="11" height="11" rx="2" fill="#5D321B"/>' +
  '<text x="0" y="31" fill="#8B6B3D" font-size="10.5" font-weight="700" letter-spacing="1">MORE</text>' +
  "</g>" +
  '<text x="44" y="314" fill="#6A5D50" font-size="11.5" font-weight="500">Includes private-repository contributions.</text>' +
  "</g>" +
  "</svg>";

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg, "utf8");

console.log(
  "Generated " +
    outputPath +
    " with " +
    displayTotal +
    " total contributions, including " +
    displayPrivate +
    " private contributions.",
);
