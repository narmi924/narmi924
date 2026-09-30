// The paper every image on the profile is printed on: cream stock with brown
// letterpress ink for light mode, black card with copper foil for dark mode.

export const stocks = {
  light: {
    suffix: "",
    paper: ["#FCFAF5", "#F0E9DD"],
    ink: "#8B4513",
    text: "#3B2A1D",
    quiet: "#8B6B3D",
    tooth: { shade: [0.3, 0.22, 0.14], k: 0.13, shine: 0.1 },
    wall: { shade: [0.24, 0.14, 0.07], k: 0.9, shine: 0.9 },
    mottle: true,
  },
  dark: {
    suffix: "-dark",
    paper: ["#221E1A", "#171411"],
    ink: "#C98F5B",
    text: "#D8C2A4",
    quiet: "#94785A",
    tooth: { shade: [0, 0, 0], k: 0.3, shine: 0.06 },
    wall: { shade: [0, 0, 0], k: 1.3, shine: 0.25 },
    mottle: false,
  },
};

export const serif = `font-family="Georgia, 'Times New Roman', serif"`;

// Grey lighting (0..1, 0.5 = flat) → a translucent shadow layer and a
// translucent highlight layer, so flat paper stays untouched.
export const shadeMatrix = ([r, g, b], k) => `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${-k} 0 0 0 ${k / 2}`;
export const shineMatrix = k => `0 0 0 0 1 0 0 0 0 1 0 0 0 0 .98 ${k} 0 0 0 ${-k / 2}`;

const region = (W, H) => `x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`;

function walls(stock, blur, depth) {
  return `<feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="bump"/>
  <feDiffuseLighting in="bump" surfaceScale="${-depth}" lighting-color="#fff" result="lit"><feDistantLight azimuth="225" elevation="30"/></feDiffuseLighting>
  <feColorMatrix in="lit" values="${shadeMatrix(stock.wall.shade, stock.wall.k)}" result="wallShade"/>
  <feColorMatrix in="lit" values="${shineMatrix(stock.wall.shine)}" result="wallShine"/>`;
}

export function inkLayer(stock) {
  return stock.mottle
    ? `<feTurbulence type="fractalNoise" baseFrequency=".035 .05" numOctaves="3" seed="11" result="mottle"/>
  <feColorMatrix in="mottle" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -.42 1.17" result="cover"/>
  <feComposite in="SourceGraphic" in2="cover" operator="in" result="ink"/>`
    : `<feComposite in="SourceGraphic" in2="SourceAlpha" operator="in" result="ink"/>`;
}

// Shared filters: `press` prints inked shapes into the paper, `blind` leaves
// only the impression, `tooth` is the paper's surface.
export function filters(W, H, stock) {
  return `<filter id="tooth" ${region(W, H)}>
  <feTurbulence type="fractalNoise" baseFrequency=".9 .75" numOctaves="3" seed="4" result="noise"/>
  <feDiffuseLighting in="noise" surfaceScale="1.4" lighting-color="#fff" result="lit"><feDistantLight azimuth="225" elevation="30"/></feDiffuseLighting>
  <feColorMatrix in="lit" values="${shadeMatrix(stock.tooth.shade, stock.tooth.k)}" result="shade"/>
  <feColorMatrix in="lit" values="${shineMatrix(stock.tooth.shine)}" result="shine"/>
  <feMerge><feMergeNode in="shade"/><feMergeNode in="shine"/></feMerge>
</filter>
<filter id="press" ${region(W, H)}>
  ${walls(stock, 0.6, 1.1)}
  ${inkLayer(stock)}
  <feMerge><feMergeNode in="wallShade"/><feMergeNode in="wallShine"/><feMergeNode in="ink"/></feMerge>
</filter>
<filter id="blind" ${region(W, H)}>
  ${walls(stock, 0.7, 1.3)}
  <feMerge><feMergeNode in="wallShade"/><feMergeNode in="wallShine"/></feMerge>
</filter>`;
}

// A sheet of stock with rounded corners; `defs` and `body` are printed on it.
export function sheet({ W, H, stock, title, defs = "", style = "", body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title">
<title id="title">${title}</title>
<defs>
<linearGradient id="paper" x2="0" y2="1"><stop stop-color="${stock.paper[0]}"/><stop offset="1" stop-color="${stock.paper[1]}"/></linearGradient>
<clipPath id="sheet"><rect width="${W}" height="${H}" rx="14"/></clipPath>
${filters(W, H, stock)}
${defs}
${style ? `<style>${style}</style>` : ""}
</defs>
<g clip-path="url(#sheet)">
<rect width="${W}" height="${H}" fill="url(#paper)"/>
<rect width="${W}" height="${H}" filter="url(#tooth)"/>
${body}
</g>
</svg>
`;
}
