#!/usr/bin/env node
// Draws the profile header: the name pressed into the sheet, with a lamp
// passing over it every few seconds.
import { writeFile } from "node:fs/promises";
import { stocks, sheet, serif, shadeMatrix, shineMatrix, inkLayer } from "./stock.mjs";

const W = 1080, H = 320;

const finish = {
  light: {
    ink: `<linearGradient id="ink" x2="1"><stop stop-color="#8B4513"/><stop offset="1" stop-color="#7A3C12"/></linearGradient>`,
    lamp: { color: "#FFE7CC", ks: 0.6, exp: 14 },
  },
  dark: {
    ink: `<linearGradient id="ink" x2="1" y2=".35"><stop stop-color="#9C5E30"/><stop offset=".38" stop-color="#C98F5B"/><stop offset=".62" stop-color="#A5683A"/><stop offset="1" stop-color="#83491F"/></linearGradient>`,
    lamp: { color: "#FFE0BD", ks: 1.1, exp: 22 },
  },
};

// Waits off the left edge, crosses in ~2.7 s, rests off the right for 2 s.
const lampMotion = `<animate attributeName="x" values="-420;-420;1500;1500" keyTimes="0;.06;.6;1" dur="5s" calcMode="spline" keySplines="0 0 1 1;.42 0 .3 1;0 0 1 1" repeatCount="indefinite"/>`;

function nameFilter(id, stock, lamp, animated) {
  const light = animated ? `<fePointLight x="-420" y="150" z="260">${lampMotion}</fePointLight>` : `<fePointLight x="330" y="150" z="260"/>`;
  return `<filter id="${id}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceAlpha" stdDeviation=".9" result="bump"/>
  <feDiffuseLighting in="bump" surfaceScale="-1.8" lighting-color="#fff" result="lit"><feDistantLight azimuth="225" elevation="30"/></feDiffuseLighting>
  <feColorMatrix in="lit" values="${shadeMatrix(stock.wall.shade, stock.wall.k)}" result="wallShade"/>
  <feColorMatrix in="lit" values="${shineMatrix(stock.wall.shine)}" result="wallShine"/>
  ${inkLayer(stock)}
  <feSpecularLighting in="SourceAlpha" surfaceScale="0" specularConstant="${lamp.ks}" specularExponent="${lamp.exp}" lighting-color="${lamp.color}" result="spec">${light}</feSpecularLighting>
  <feComposite in="spec" in2="SourceAlpha" operator="in" result="sheen"/>
  <feMerge><feMergeNode in="wallShade"/><feMergeNode in="wallShine"/><feMergeNode in="ink"/><feMergeNode in="sheen"/></feMerge>
</filter>`;
}

for (const [key, stock] of Object.entries(stocks)) {
  const { ink, lamp } = finish[key];
  const name = `<text x="${W / 2}" y="214" text-anchor="middle" textLength="774" lengthAdjust="spacing" ${serif} font-style="italic" font-size="178" fill="url(#ink)">Imranjan</text>`;
  const svg = sheet({
    W, H, stock, title: "Imranjan",
    defs: `${ink}\n${nameFilter("name-live", stock, lamp, true)}\n${nameFilter("name-still", stock, lamp, false)}`,
    style: ".still{display:none}@media (prefers-reduced-motion:reduce){.live{display:none}.still{display:inline}}",
    body: `<g class="live" filter="url(#name-live)">${name}</g>\n<g class="still" filter="url(#name-still)">${name}</g>`,
  });
  const file = `assets/profile-header${stock.suffix}.svg`;
  await writeFile(file, svg);
  console.log("wrote", file);
}
