// Minimal TopoJSON decoding + a local equirectangular projection (fine at Victoria's scale).

export function decodeTopo(topo, layer) {
  const t = topo.transform;
  const arcs = topo.arcs.map((a) => {
    let x = 0, y = 0;
    return a.map(([dx, dy]) => (t ? (x += dx, y += dy, [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]]) : [dx, dy]));
  });
  const arc = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (ids) => { const pts = []; ids.forEach((i, k) => { const a = arc(i); pts.push(...(k ? a.slice(1) : a)); }); return pts; };
  const obj = topo.objects[layer] || Object.values(topo.objects)[0];
  return obj.geometries.map((g) => ({
    props: g.properties || {},
    polys: g.type === "Polygon" ? [g.arcs.map(ring)] : g.type === "MultiPolygon" ? g.arcs.map((p) => p.map(ring)) : [],
  }));
}

export function projector(bbox, width, height, pad = 8) {
  const [x0, y0, x1, y1] = bbox;
  const lat0 = ((y0 + y1) / 2) * (Math.PI / 180);
  const kx = Math.cos(lat0);
  const w = (x1 - x0) * kx, h = y1 - y0;
  const k = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  const ox = (width - w * k) / 2, oy = (height - h * k) / 2;
  return ([lon, lat]) => [ox + (lon - x0) * kx * k, oy + (y1 - lat) * k];
}

export function bboxOf(features) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of features) for (const poly of f.polys) for (const [x, y] of poly[0]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function pathOf(f, proj) {
  let d = "";
  for (const poly of f.polys) for (const ring of poly) {
    let prev = "";
    ring.forEach((pt, i) => {
      const [x, y] = proj(pt);
      const s = `${x.toFixed(1)},${y.toFixed(1)}`;
      if (s !== prev) d += (i ? "L" : "M") + s;
      prev = s;
    });
    d += "Z";
  }
  return d;
}
