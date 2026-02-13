/**
 * vectorize.js — Converts freehand strokes into a planar truss (nodes + edges).
 *
 * Algorithm overview:
 *   1. Simplify each stroke using the Ramer-Douglas-Peucker algorithm to get
 *      a polyline that approximates the freehand curve.
 *   2. Break each simplified polyline into individual line segments.
 *   3. Detect intersections between all segment pairs and split segments
 *      at crossing points (so continuous chords get discretized by web members).
 *   4. Collect all segment endpoints.
 *   5. Cluster nearby endpoints within a snap radius into single nodes
 *      (using a simple greedy union-find approach).
 *   6. For every segment, map its two endpoints to the nearest cluster centroid,
 *      producing an edge between two nodes.
 *   7. Deduplicate edges.
 *   8. Return { nodes: [{id, x, y}], edges: [{id, n1, n2}] }.
 */

const Vectorizer = (() => {
  // ---- Ramer-Douglas-Peucker ------------------------------------------------

  function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex = point.x - lineStart.x;
      const ey = point.y - lineStart.y;
      return Math.sqrt(ex * ex + ey * ey);
    }
    const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq));
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;
    const ex = point.x - projX;
    const ey = point.y - projY;
    return Math.sqrt(ex * ex + ey * ey);
  }

  function rdp(points, epsilon) {
    if (points.length <= 2) return points.slice();

    let maxDist = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[0], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }

    if (maxDist > epsilon) {
      const left = rdp(points.slice(0, index + 1), epsilon);
      const right = rdp(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [points[0], points[end]];
  }

  // ---- Segment extraction ---------------------------------------------------

  function strokeToSegments(stroke, epsilon) {
    const simplified = rdp(stroke, epsilon);
    const segments = [];
    for (let i = 0; i < simplified.length - 1; i++) {
      segments.push([simplified[i], simplified[i + 1]]);
    }
    return segments;
  }

  // ---- Intersection detection & segment splitting ----------------------------

  function segmentIntersection(a1, a2, b1, b2) {
    const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
    const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-10) return null; // parallel
    const dx3 = b1.x - a1.x, dy3 = b1.y - a1.y;
    const t = (dx3 * dy2 - dy3 * dx2) / denom;
    const u = (dx3 * dy1 - dy3 * dx1) / denom;
    // Interior crossings only — endpoints are handled by snap clustering
    const EPS = 0.02;
    if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
    return { x: a1.x + t * dx1, y: a1.y + t * dy1, t, u };
  }

  function splitSegmentsAtIntersections(segments) {
    const splits = segments.map(() => []);
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const ix = segmentIntersection(
          segments[i][0], segments[i][1],
          segments[j][0], segments[j][1]
        );
        if (ix) {
          splits[i].push({ t: ix.t, x: ix.x, y: ix.y });
          splits[j].push({ t: ix.u, x: ix.x, y: ix.y });
        }
      }
    }
    const result = [];
    for (let i = 0; i < segments.length; i++) {
      if (splits[i].length === 0) {
        result.push(segments[i]);
        continue;
      }
      splits[i].sort((a, b) => a.t - b.t);
      let prev = segments[i][0];
      for (const sp of splits[i]) {
        result.push([prev, { x: sp.x, y: sp.y }]);
        prev = { x: sp.x, y: sp.y };
      }
      result.push([prev, segments[i][1]]);
    }
    return result;
  }

  // ---- Clustering (Union-Find on endpoints) ---------------------------------

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clusterPoints(points, snapRadius) {
    // Assign each point a cluster id; greedily merge within snapRadius.
    const n = points.length;
    const parent = Array.from({ length: n }, (_, i) => i);

    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }

    function union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }

    // O(n^2) but n is small (dozens of endpoints at most)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (dist(points[i], points[j]) < snapRadius) {
          union(i, j);
        }
      }
    }

    // Group by root and compute centroids
    const groups = {};
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groups[root]) groups[root] = [];
      groups[root].push(points[i]);
    }

    const centroids = {};
    for (const root of Object.keys(groups)) {
      const g = groups[root];
      const cx = g.reduce((s, p) => s + p.x, 0) / g.length;
      const cy = g.reduce((s, p) => s + p.y, 0) / g.length;
      centroids[root] = { x: cx, y: cy };
    }

    // Build a map: point index → centroid
    const mapping = new Array(n);
    for (let i = 0; i < n; i++) {
      mapping[i] = centroids[find(i)];
    }

    return { mapping, centroids };
  }

  // ---- Main vectorize function ----------------------------------------------

  /**
   * @param {Array<Array<{x:number, y:number}>>} strokes - array of freehand strokes
   * @param {object} opts
   * @param {number} opts.snapRadius  - pixel radius for clustering endpoints
   * @param {number} opts.simplifyEpsilon - RDP epsilon (auto-computed if not given)
   * @returns {{ nodes: Array<{id:number, x:number, y:number}>,
   *             edges: Array<{id:number, n1:number, n2:number}> }}
   */
  function vectorize(strokes, opts = {}) {
    const snapRadius = opts.snapRadius ?? 30;
    const epsilon = opts.simplifyEpsilon ?? snapRadius * 0.5;

    // 1. Extract all line segments from strokes
    const allSegments = [];
    for (const stroke of strokes) {
      if (stroke.length < 2) continue;
      const segs = strokeToSegments(stroke, epsilon);
      allSegments.push(...segs);
    }

    if (allSegments.length === 0) return { nodes: [], edges: [] };

    // 2. Split segments at interior crossings
    const splitSegs = splitSegmentsAtIntersections(allSegments);

    // 3. Collect all endpoints
    const allPoints = [];
    const segPointIndices = []; // for each segment, [startIdx, endIdx]
    for (const seg of splitSegs) {
      const si = allPoints.length;
      allPoints.push(seg[0]);
      allPoints.push(seg[1]);
      segPointIndices.push([si, si + 1]);
    }

    // 4. Cluster endpoints
    const { mapping } = clusterPoints(allPoints, snapRadius);

    // 5. Build unique node list
    const nodeMap = new Map(); // "x,y" → node id
    const nodes = [];

    function getNodeId(centroid) {
      const key = `${Math.round(centroid.x * 100)},${Math.round(centroid.y * 100)}`;
      if (nodeMap.has(key)) return nodeMap.get(key);
      const id = nodes.length;
      nodes.push({ id, x: centroid.x, y: centroid.y });
      nodeMap.set(key, id);
      return id;
    }

    // 6. Build edges
    const edgeSet = new Set();
    const edges = [];

    for (const [si, ei] of segPointIndices) {
      const n1 = getNodeId(mapping[si]);
      const n2 = getNodeId(mapping[ei]);
      if (n1 === n2) continue; // skip zero-length
      const edgeKey = n1 < n2 ? `${n1}-${n2}` : `${n2}-${n1}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);
      edges.push({ id: edges.length, n1, n2 });
    }

    return { nodes, edges };
  }

  return { vectorize, rdp };
})();
