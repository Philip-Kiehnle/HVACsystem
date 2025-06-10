// Example:
// Pipe diameter (D) = 10 mm = 0.01 m
// Pipe length (L) = 10 m
// Pump pressure (P) = 10 mbar = 1000 Pa
// Fluid = Water (assume 20°C, ρ = 998 kg/m³, μ ≈ 1.002 × 10⁻³ Pa·s)
//
// Use Darcy-Weisbach Equation (steady, incompressible, fully developed flow)
// ΔP = f * L/D * (ρ*v²)/2
//
// ΔP = pressure drop
// f = friction factor (depends on flow regime; initially guess turbulent/laminar)
// L = pipe length
// D = diameter
// ρ = density of water (998 kg/m³)
// v = average velocity (m/s)

// Assume Laminar Flow (Re < 2300)
// Laminar flow friction factor:
// f = 64/Re
// Reynolds number:
// Re = (ρ*v*D) / μ
// Substitute into Darcy-Weisbach:
// ΔP = (64 * µ / (ρ*v*D)) * L/D * (ρ*v²)/2
// Simplify:
// ΔP = (64*µ*L*v)/(2*D²)
// Solve for v:
// v = 2*D²*ΔP / (64*µ*L)
// v = 0.312m/s
// flow = A * v = π*(D/2)² * v = 0.0245 l/s = 88.2 l/h
// In this script the flow is determined by the reference power of the radiators and the pressure loss is calculated.

function calculatePressureLoss(svgRoot, sys, nodes, edges, sourceNode) {

  // [PUMP] → supply network → radiators(GND) → return network → [PUMP]
  // return network is modely by doubling pressure drop of supply network.

  // Construct node index
  const nodeIndex = {};
  Object.keys(nodes).forEach((key, i) => {
    nodeIndex[key] = i;
  });

  edges.forEach(({ from, to }) => {
    if (!(from in nodeIndex)) console.warn('Missing from-node', from);
    if (!(to in nodeIndex)) console.warn('Missing to-node', to);
  });

  console.log('propagateFlow');
  propagateFlow(nodes, edges, sourceNode);
  console.log('edges', edges);

  propagatePressure(sys, nodes, edges, sourceNode);  // now, nodes have pressure value
}


function findOrCreateNode(pt, nodes, layer, tolerance = 0.6) {
  for (const key in nodes) {
    const [x1, y1] = key.split('_')[1].split(',').map(Number);
    if (Math.abs(x1 - pt.x) <= tolerance && Math.abs(y1 - pt.y) <= tolerance
        && nodes[key].layer === layer
    ) {
      return key; // Reuse nearby node
    }
  }
  const key = `${layer}_${roundCoord(pt.x)},${roundCoord(pt.y)}`;
  nodes[key] = {pressure: null, layer: layer, edges: [] }; // Save actual coords for tolerance check
  return key;
}


function roundCoord(pt) {
  const precision = 2; // match visually joined paths within ~0.01 units
  return pt.toFixed(precision);
}


// Chat GPT with custom fix from pathLen
function countDirectionChanges(path)
{
  const d = path.getAttribute('d');
  if (!d) return 0;

  const tokens = [];
  const regex = /([a-zA-Z])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  let match;
  while ((match = regex.exec(d)) !== null) {
    tokens.push(isNaN(match[0]) ? match[0] : parseFloat(match[0]));
  }

  let i = 0;
  let cmd = '';
  let curr = { x: 0, y: 0 };
  let prevPoint = null;
  let prevAngle = null;
  let directionChanges = 0;

  function nextNum() {
    return tokens[++i];
  }

  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === 'string') {
      cmd = token;
      i++;
    }

    let next = { ...curr };
    switch (cmd) {
      case 'M': {
        const x = tokens[i++];
        const y = tokens[i++];
        curr = { x, y };
        start = { ...curr };
        break;
      }
      case 'm': {
        const dx = tokens[i++];
        const dy = tokens[i++];
        curr = { x: curr.x + dx, y: curr.y + dy };
        start = { ...curr };
        break;
      }
      case 'L': {
        const x = tokens[i++];
        const y = tokens[i++];
        next = { x, y };
        break;
      }
      case 'l': {
        const dx = tokens[i++];
        const dy = tokens[i++];
        next = { x: curr.x + dx, y: curr.y + dy };
        break;
      }
      case 'H': {
        const x = tokens[i++];
        next = { x, y: curr.y };
        break;
      }
      case 'h': {
        const dx = tokens[i++];
        next = { x: curr.x + dx, y: curr.y };
        break;
      }
      case 'V': {
        const y = tokens[i++];
        next = { x: curr.x, y };
        break;
      }
      case 'v': {
        const dy = tokens[i++];
        next = { x: curr.x, y: curr.y + dy };
        break;
      }
      case 'Z':
      case 'z': {
        break;
      }
    }

    if (next && (next.x !== curr.x || next.y !== curr.y)) {
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const angle = Math.atan2(dy, dx);
      if (prevAngle !== null) {
        const delta = Math.abs(angle - prevAngle);
        if (delta > 0.26) { // ~15 degrees
          directionChanges++;
        }
      }
      prevAngle = angle;
      curr = next;
    }
  }

  return directionChanges-1;
}


// Chat GPT
// Find path from radiator edge to sourceNode (pump) and update flow for the used edges
function propagateFlow(nodes, edges, sourceNode) {
    // Build a map from node -> incoming/outgoing edges for quick lookup
    const outgoing = new Map();
    const incoming = new Map();

    for (const edge of edges) {
        if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
        if (!incoming.has(edge.to)) incoming.set(edge.to, []);
        outgoing.get(edge.from).push(edge);
        incoming.get(edge.to).push(edge);
    }

    // Initialize all pipe flows to zero
    for (const edge of edges) {
        if (edge.type === 'pipe') {
            edge.flow = 0;
        }
    }

    // For each radiator, trace the path to the source node using the route object
    for (const radiatorEdge of edges) {
        if (radiatorEdge.type !== 'radiator') continue;
        const flow = radiatorEdge.flow;

        // Trace path back to source node
        for (const edge of radiatorEdge.route) {
            // Accumulate the flow into the pipe
            if (edge.type === 'pipe') {
                edge.flow = (edge.flow || 0) + flow;
            }
        }
    }

    // Update pressure loss in pipes
    for (const edge of edges) {
        if (edge.type === 'pipe') {
            // 1.1m pipe length extension is used as an equivalent for direction_changes / elbows
            // 1.2m equivalent according to https://www.youtube.com/watch?v=-uayGzi1YAc
            const l = edge.len + 1.1*edge.directionChanges;
            const d_i = edge.d_inner;
            const v = edge.flow / rho_water / (Math.PI*(d_i/2)**2);
            edge.loss = 64*mu*l*v/(2*d_i**2);  // Pa
        }
    }
}


function propagatePressure(sys, nodes, edges, sourceNode) {
  // Reset pressures except source node
  Object.keys(nodes).forEach(key => {
    if (key !== sourceNode) {
      nodes[key].pressure = null;
    }
  });

  const visited = new Set();
  const queue = [{ node: sourceNode, pressure: nodes[sourceNode].pressure }];

  while (queue.length > 0) {
    const { node, pressure } = queue.shift();
    visited.add(node);

    for (const edge of nodes[node].edges) {
      const otherNode = edge.from === node ? edge.to : edge.from;
      if (visited.has(otherNode)) continue;

      const pressureDrop = edge.loss;
      const nextPressure = pressure - pressureDrop;

      if (nodes[otherNode].pressure === null || nextPressure > nodes[otherNode].pressure) {
        nodes[otherNode].pressure = nextPressure;
        queue.push({ node: otherNode, pressure: nextPressure });
      }
    }
  }

  // Annotate paths with pressures (optional)
  edges.forEach(edge => {
    if (edge.type === 'pipe' || edge.type === 'radiator') {
      const p1 = nodes[edge.from]?.pressure;
      const p2 = nodes[edge.to]?.pressure;
      // annotatePath(edge.path, `Δp=${(p1 - p2).toFixed(1)}mBar`);
    }
  });

  console.log("Pressure values at nodes:", nodes);

  // === Total Water Volume Calculation ===
  let totalVolume = 0;
  const visitedEdgeIds = new Set();

  for (const edge of edges) {
    if (edge.type === 'radiator' && edge.flow > 0 && Array.isArray(edge.route)) {
      totalVolume += edge.volume;  // radiator water content
      for (const routeEdge of edge.route) {  // pipe water content
        const id1 = `${routeEdge.from}-${routeEdge.to}`;
        const id2 = `${routeEdge.to}-${routeEdge.from}`;
        if (!visitedEdgeIds.has(id1) && !visitedEdgeIds.has(id2)) {
          totalVolume += 2*routeEdge.volume || 0;  // factor 2 for return pipe
          visitedEdgeIds.add(id1);
        }
      }
    }
  }

  sys.water_volume = totalVolume;
}

