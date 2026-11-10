// WGS 84 / NSIDC EASE-Grid 2.0 Global (EPSG:6933), ellipsoidal equal-area projection.
const rad = Math.PI / 180;
const e2 = 0.0066943799901413165;
const e = Math.sqrt(e2);
const parallel = 30 * rad;
const k0 = Math.cos(parallel) / Math.sqrt(1 - e2 * Math.sin(parallel) ** 2);
const semiMajor = 6378137;
const cellSize = 2000;

export function project({ lon, lat }) {
  const sinLat = Math.sin(lat * rad);
  const q = (1 - e2) * (sinLat / (1 - e2 * sinLat ** 2) + Math.atanh(e * sinLat) / e);
  return [semiMajor * k0 * lon * rad, semiMajor * q / (2 * k0)];
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function halfHull(sorted) {
  const hull = [];
  for (const point of sorted) {
    while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), point) <= 0) hull.pop();
    hull.push(point);
  }
  return hull;
}

function convexHull(points) {
  const unique = [...new Map(points.map((point) => [point.join(','), point])).values()];
  if (unique.length < 2) return unique;
  unique.sort(([x1, y1], [x2, y2]) => x1 - x2 || y1 - y2);
  const lower = halfHull(unique).slice(0, -1);
  const upper = halfHull(unique.reverse()).slice(0, -1);
  return [...lower, ...upper];
}

export function gridRange(points) {
  const placed = points.map((point) => ({ ...point, xy: project(point) }));
  const xy = placed.map((point) => point.xy);
  const hull = convexHull(xy);
  const hullArea = hull.slice(1, -1).reduce((sum, point, index) => sum + cross(hull[0], point, hull[index + 2]), 0) / 2e6;
  // Sample fixed alignments over one grid cell and retain the smallest point-based estimate.
  const offsets = [0, 500, 1000, 1500];
  const alignments = [];
  for (const x of offsets) {
    for (const y of offsets) {
      const cells = new Map();
      for (const [px, py] of xy) {
        const i = Math.floor((px - x) / cellSize);
        const j = Math.floor((py - y) / cellSize);
        cells.set(`${i},${j}`, [x + i * cellSize, y + j * cellSize]);
      }
      alignments.push({ originM: [x, y], cells: [...cells.values()] });
    }
  }
  const best = alignments.reduce((a, b) => b.cells.length < a.cells.length ? b : a);
  const aooKm2 = placed.length ? 4 * best.cells.length : null;
  const eooHullKm2 = hullArea > 1e-10 ? hullArea : null;
  return {
    metrics: {
      crs: 'EPSG:6933', cellSizeM: cellSize, alignmentOffsetsM: offsets, originM: best.originM,
      occupiedCells: best.cells.length, aooKm2, aooMaxSampledKm2: placed.length ? 4 * Math.max(...alignments.map((a) => a.cells.length)) : null,
      eooHullKm2, eooKm2: eooHullKm2 === null ? null : Math.max(eooHullKm2, aooKm2),
    },
    placed, hull, cells: best.cells,
  };
}

function polygonRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'FeatureCollection') return geometry.features.flatMap(polygonRings);
  if (geometry.type === 'Feature') return polygonRings(geometry.geometry);
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  throw new Error('底圖需是 WGS84 GeoJSON Polygon 或 MultiPolygon。');
}

function xml(text) {
  return String(text).replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

export function rangeSvg({ placed, hull, cells }, name, boundary, region) {
  const outlines = polygonRings(boundary).map((ring) => ring.map(([lon, lat]) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new Error('底圖座標需為 WGS84 經緯度。');
    }
    return project({ lon, lat });
  }));
  const landmarks = region?.mapLandmarks ?? [];
  const corners = (region?.searchAreas ?? []).flatMap(({ bounds: [west, south, east, north] }) => [
    project({ lon: west, lat: south }), project({ lon: east, lat: north }),
  ]);
  const bounds = [project({ lon: 117.9, lat: 21.7 }), project({ lon: 122.3, lat: 26.4 })];
  for (const [x, y] of [...corners, ...outlines.flat(), ...placed.map((point) => point.xy)]) {
    bounds[0][0] = Math.min(bounds[0][0], x);
    bounds[0][1] = Math.min(bounds[0][1], y);
    bounds[1][0] = Math.max(bounds[1][0], x);
    bounds[1][1] = Math.max(bounds[1][1], y);
  }
  const [[west, south], [east, north]] = bounds;
  const scale = Math.min(700 / (east - west), 470 / (north - south));
  const sx = (x) => (800 - (east - west) * scale) / 2 + (x - west) * scale;
  const sy = (y) => 65 + (north - y) * scale;
  const pairs = (points) => points.map(([x, y]) => `${sx(x).toFixed(2)},${sy(y).toFixed(2)}`).join(' ');
  const graticule = [];
  for (const lon of region ? [115, 117, 119, 121] : [118, 119, 120, 121, 122]) {
    const x = sx(project({ lon, lat: 0 })[0]);
    graticule.push(`<path d="M ${x} ${sy(north)} V ${sy(south)}"/><text x="${x + 2}" y="${sy(south) + 17}">${lon}°E</text>`);
  }
  for (const lat of region ? [12, 15, 18, 21, 24, 26] : [22, 23, 24, 25, 26]) {
    const y = sy(project({ lon: 0, lat })[1]);
    graticule.push(`<path d="M ${sx(west)} ${y} H ${sx(east)}"/><text x="${sx(east) + 3}" y="${y}">${lat}°N</text>`);
  }
  const landmarkMarks = landmarks.map((landmark) => {
    const [x, y] = project(landmark);
    return `<g transform="translate(${sx(x)} ${sy(y)})"><path d="M -3 0 H 3 M 0 -3 V 3"/><text x="7" y="4">${xml(landmark.name)}</text></g>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="610" viewBox="0 0 800 610" role="img">
<title>${xml(name)} 分布檢視圖</title>
<style>text{font:14px sans-serif;fill:#25352f} .title{font:bold 21px sans-serif} .grid path{stroke:#c9d7d2;stroke-width:1} .grid text,.landmarks text{font-size:11px} .landmarks path{stroke:#687d76;stroke-width:1.2}</style>
<rect width="800" height="610" fill="#f5faf8"/><text class="title" x="40" y="35">${xml(name)} · 分布檢視圖</text>
<g class="grid">${graticule.join('\n')}</g>
<path d="${outlines.map((ring) => `M ${pairs(ring)} Z`).join(' ')}" fill="#e0e9dc" fill-rule="evenodd" stroke="#859789"/>
${hull.length >= 3 ? `<polygon points="${pairs(hull)}" fill="#85b4ee" fill-opacity=".27" stroke="#3065a5" stroke-width="1.3"/>` : ''}
<g fill="#ffb666" stroke="#b75015" stroke-width=".7">${cells.map(([x, y]) => `<rect x="${sx(x)}" y="${sy(y + cellSize)}" width="${cellSize * scale}" height="${cellSize * scale}"/>`).join('\n')}</g>
<g class="landmarks">${landmarkMarks}</g>
<g fill="#214c3c" stroke="white" stroke-width=".7">${placed.map(({ xy: [x, y], id }) => `<circle cx="${sx(x)}" cy="${sy(y)}" r="3"><title>${xml(id)}</title></circle>`).join('\n')}</g>
<text x="40" y="581">綠點：納入紀錄　橙格：2 公里占有網格　藍面：凸包　${landmarks.length ? '灰十字：島嶼定位' : outlines.length ? '底圖僅供定位' : '經緯網供定位'}</text>
</svg>
`;
}
