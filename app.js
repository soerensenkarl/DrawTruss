(() => {
  // ---- DOM refs -------------------------------------------------------------
  const canvas = document.getElementById('draw-canvas');
  const ctx = canvas.getContext('2d');
  const svg = document.getElementById('truss-svg');
  const hint = document.getElementById('hint');

  const btnUndo = document.getElementById('btn-undo');
  const btnClear = document.getElementById('btn-clear');
  const btnVectorize = document.getElementById('btn-vectorize');
  const btnReset = document.getElementById('btn-reset-truss');
  const btnExportSVG = document.getElementById('btn-export-svg');
  const btnExportJSON = document.getElementById('btn-export-json');
  const snapSlider = document.getElementById('snap-radius');
  const snapValue = document.getElementById('snap-value');

  const infoNodes = document.getElementById('info-nodes');
  const infoEdges = document.getElementById('info-edges');
  const infoStatus = document.getElementById('info-status');

  // ---- State ----------------------------------------------------------------
  let strokes = [];        // Array of stroke arrays [{x, y}, ...]
  let currentStroke = null;
  let truss = null;        // { nodes, edges } or null
  let isDrawing = false;

  // ---- Canvas sizing --------------------------------------------------------
  function resizeCanvas() {
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    redrawStrokes();
    if (truss) renderTruss(truss);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ---- Drawing --------------------------------------------------------------
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startStroke(e) {
    if (truss) return; // locked while showing truss
    e.preventDefault();
    isDrawing = true;
    currentStroke = [getPos(e)];
    hint.style.opacity = '0';
  }

  function moveStroke(e) {
    if (!isDrawing || !currentStroke) return;
    e.preventDefault();
    const pos = getPos(e);
    currentStroke.push(pos);
    drawSegment(currentStroke[currentStroke.length - 2], pos);
  }

  function endStroke(e) {
    if (!isDrawing || !currentStroke) return;
    e.preventDefault();
    isDrawing = false;
    if (currentStroke.length >= 2) {
      strokes.push(currentStroke);
    }
    currentStroke = null;
    updateStatus();
  }

  // Mouse events
  canvas.addEventListener('mousedown', startStroke);
  canvas.addEventListener('mousemove', moveStroke);
  canvas.addEventListener('mouseup', endStroke);
  canvas.addEventListener('mouseleave', endStroke);

  // Touch events
  canvas.addEventListener('touchstart', startStroke, { passive: false });
  canvas.addEventListener('touchmove', moveStroke, { passive: false });
  canvas.addEventListener('touchend', endStroke, { passive: false });
  canvas.addEventListener('touchcancel', endStroke, { passive: false });

  // ---- Canvas rendering -----------------------------------------------------
  function drawSegment(a, b) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function redrawStrokes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      for (let i = 0; i < stroke.length - 1; i++) {
        drawSegment(stroke[i], stroke[i + 1]);
      }
    }
  }

  // ---- SVG truss rendering --------------------------------------------------
  function clearTrussSVG() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function renderTruss(t) {
    clearTrussSVG();
    const ns = 'http://www.w3.org/2000/svg';

    // Draw edges
    for (const edge of t.edges) {
      const a = t.nodes[edge.n1];
      const b = t.nodes[edge.n2];
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('stroke', '#e94560');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    }

    // Draw nodes
    for (const node of t.nodes) {
      // Outer ring
      const outer = document.createElementNS(ns, 'circle');
      outer.setAttribute('cx', node.x);
      outer.setAttribute('cy', node.y);
      outer.setAttribute('r', '8');
      outer.setAttribute('fill', 'none');
      outer.setAttribute('stroke', '#00d2ff');
      outer.setAttribute('stroke-width', '2');
      svg.appendChild(outer);

      // Inner dot
      const inner = document.createElementNS(ns, 'circle');
      inner.setAttribute('cx', node.x);
      inner.setAttribute('cy', node.y);
      inner.setAttribute('r', '3');
      inner.setAttribute('fill', '#00d2ff');
      svg.appendChild(inner);

      // Label
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', node.x);
      label.setAttribute('y', node.y - 14);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#00d2ff');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'system-ui, sans-serif');
      label.textContent = node.id;
      svg.appendChild(label);
    }
  }

  // ---- Vectorize action -----------------------------------------------------
  function doVectorize() {
    if (strokes.length === 0) return;
    const snapRadius = parseInt(snapSlider.value, 10);
    truss = Vectorizer.vectorize(strokes, { snapRadius });

    // Dim the freehand drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.15;
    for (const stroke of strokes) {
      for (let i = 0; i < stroke.length - 1; i++) {
        drawSegment(stroke[i], stroke[i + 1]);
      }
    }
    ctx.globalAlpha = 1;

    renderTruss(truss);
    updateStatus();
    updateButtons();
  }

  // ---- Export functions ------------------------------------------------------
  function exportSVG() {
    if (!truss) return;
    const w = canvas.width;
    const h = canvas.height;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
    out += `  <rect width="100%" height="100%" fill="#1a1a2e"/>\n`;

    for (const edge of truss.edges) {
      const a = truss.nodes[edge.n1];
      const b = truss.nodes[edge.n2];
      out += `  <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#e94560" stroke-width="3" stroke-linecap="round"/>\n`;
    }

    for (const node of truss.nodes) {
      out += `  <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="8" fill="none" stroke="#00d2ff" stroke-width="2"/>\n`;
      out += `  <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="3" fill="#00d2ff"/>\n`;
      out += `  <text x="${node.x.toFixed(1)}" y="${(node.y - 14).toFixed(1)}" text-anchor="middle" fill="#00d2ff" font-size="11" font-family="system-ui, sans-serif">${node.id}</text>\n`;
    }

    out += `</svg>`;
    download('truss.svg', 'image/svg+xml', out);
  }

  function exportJSON() {
    if (!truss) return;
    const data = {
      nodes: truss.nodes.map(n => ({ id: n.id, x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10 })),
      edges: truss.edges.map(e => ({ id: e.id, from: e.n1, to: e.n2 })),
    };
    download('truss.json', 'application/json', JSON.stringify(data, null, 2));
  }

  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- Button actions -------------------------------------------------------
  btnUndo.addEventListener('click', () => {
    if (truss) return;
    strokes.pop();
    redrawStrokes();
    updateStatus();
  });

  btnClear.addEventListener('click', () => {
    strokes = [];
    truss = null;
    currentStroke = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clearTrussSVG();
    hint.style.opacity = '1';
    updateStatus();
    updateButtons();
  });

  btnVectorize.addEventListener('click', doVectorize);

  btnReset.addEventListener('click', () => {
    truss = null;
    clearTrussSVG();
    ctx.globalAlpha = 1;
    redrawStrokes();
    updateStatus();
    updateButtons();
  });

  btnExportSVG.addEventListener('click', exportSVG);
  btnExportJSON.addEventListener('click', exportJSON);

  snapSlider.addEventListener('input', () => {
    snapValue.textContent = snapSlider.value;
    // Live re-vectorize if truss already shown
    if (truss) doVectorize();
  });

  // Keyboard shortcut: Ctrl+Z for undo
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (!truss) {
        strokes.pop();
        redrawStrokes();
        updateStatus();
      }
    }
  });

  // ---- Status updates -------------------------------------------------------
  function updateStatus() {
    if (truss) {
      infoNodes.textContent = `Nodes: ${truss.nodes.length}`;
      infoEdges.textContent = `Edges: ${truss.edges.length}`;
      infoStatus.textContent = 'Truss vectorized';
    } else {
      infoNodes.textContent = 'Nodes: 0';
      infoEdges.textContent = 'Edges: 0';
      infoStatus.textContent = strokes.length > 0
        ? `${strokes.length} stroke${strokes.length > 1 ? 's' : ''} — click Vectorize`
        : 'Ready to draw';
    }
  }

  function updateButtons() {
    const hasTruss = !!truss;
    btnReset.disabled = !hasTruss;
    btnExportSVG.disabled = !hasTruss;
    btnExportJSON.disabled = !hasTruss;
    btnUndo.disabled = hasTruss;
    btnVectorize.disabled = hasTruss;
  }

  updateButtons();
})();
