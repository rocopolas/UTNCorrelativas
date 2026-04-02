let graph = null;
let graphData = null;
let selectedId = null;
let lastToggleMeta = { id: null, at: 0 };

const DOUBLE_EVENT_GUARD_MS = 300;

const statusEl = document.getElementById("status");
const detailEl = document.getElementById("subject-detail");
const uploadForm = document.getElementById("upload-form");
const onboardingSection = document.getElementById("onboarding-section");
const resetTemplateBtn = document.getElementById("reset-template-btn");
const zoomFeedbackEl = document.getElementById("zoom-feedback");
const searchInputEl = document.getElementById("search-input");
const stateFilterEl = document.getElementById("state-filter");
const toggleViewEl = document.getElementById("toggle-view");
const tableViewEl = document.getElementById("table-view");
const graphViewEl = document.getElementById("graph");
const layoutSectionEl = document.getElementById("layout-section");
const tableBodyEl = document.getElementById("table-body");
const themeToggleEl = document.getElementById("theme-toggle");
const exportToggleEl = document.getElementById("export-toggle");
const exportMenuEl = document.getElementById("export-menu");
const exportJsonEl = document.getElementById("export-json");
const exportCsvEl = document.getElementById("export-csv");
const exportPngEl = document.getElementById("export-png");
const statsBarEl = document.getElementById("stats-bar");
const tooltipEl = document.getElementById("graph-tooltip");
const templateListEl = document.getElementById("template-list");
const detailPanelEl = document.getElementById("detail-panel");
const core = window.correlativasCore;

let zoomFeedbackTimer = null;
let currentView = "graph";
let templates = [];
let templatesYear = 2026;

const THEME_KEY = "correlativas-theme";

const uiFilters = {
  query: "",
  state: "unlocked",
};

function isMobileViewport() {
  return window.matchMedia("(max-width: 700px)").matches;
}

function revealDetailPanelOnMobile() {
  if (!isMobileViewport() || !detailPanelEl) {
    return;
  }

  detailPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#8b1e1e" : "#123128";
}

function stateClass(state) {
  if (state === "approved") {
    return "state-approved";
  }
  if (state === "unlocked") {
    return "state-unlocked";
  }
  return "state-locked";
}

function stateLabel(state) {
  if (state === "approved") {
    return "Aprobada";
  }
  if (state === "unlocked") {
    return "Desbloqueada";
  }
  return "Bloqueada";
}

function colorForSubject(subjectId) {
  const hue = Math.floor((Number(subjectId) * 137.508) % 360);
  return `hsl(${hue}, 88%, 38%)`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function subjectState(data, subjectId) {
  return data.states[String(subjectId)] || data.states[subjectId] || "locked";
}

function subjectMatchesFilters(subject, state) {
  const isUnlockedViewMatch = uiFilters.state === "unlocked"
    && (state === "unlocked" || state === "approved");

  if (uiFilters.state !== "all" && !isUnlockedViewMatch && uiFilters.state !== state) {
    return false;
  }

  if (!uiFilters.query) {
    return true;
  }

  const normalizedQuery = uiFilters.query.toLowerCase();
  return (
    String(subject.id).includes(normalizedQuery)
    || subject.name.toLowerCase().includes(normalizedQuery)
  );
}

function getDisplayedSubjects(data) {
  return data.plan.subjects.filter((subject) => {
    const state = subjectState(data, subject.id);
    return subjectMatchesFilters(subject, state);
  });
}

function getDisplayedSubjectIds(data) {
  return new Set(getDisplayedSubjects(data).map((subject) => subject.id));
}

function completionStats(data) {
  const total = data.plan.subjects.length;
  const approved = data.plan.subjects.filter(
    (subject) => subjectState(data, subject.id) === "approved"
  ).length;
  const remaining = Math.max(total - approved, 0);
  const estimatePerTerm = 4;
  const estimateTerms = Math.ceil(remaining / estimatePerTerm);

  return { total, approved, remaining, estimateTerms };
}

function renderStats(data) {
  if (!statsBarEl || !data?.plan?.subjects?.length) {
    statsBarEl.textContent = "Sin datos cargados.";
    return;
  }

  const displayed = getDisplayedSubjects(data).length;
  const { total, approved, estimateTerms } = completionStats(data);
  const progress = total > 0 ? Math.round((approved / total) * 100) : 0;

  statsBarEl.textContent = `Mostrando ${displayed}/${total} | Aprobadas: ${approved}/${total} (${progress}%) | Estimacion: ${estimateTerms} cuatrimestres`;
}

function onboardingWarning(year) {
  return `Estas plantillas son del ${year}. Si cursás en otro año, se recomienda importar PDFs nuevos y actualizados.`;
}

function renderTemplateList() {
  if (!templateListEl) {
    return;
  }

  if (!templates.length) {
    templateListEl.textContent = "No hay plantillas precargadas en la carpeta pdf/";
    return;
  }

  templateListEl.innerHTML = templates
    .map((template) => `
      <div class="template-item">
        <strong>${escapeHtml(template.label)}</strong>
        <span class="template-meta">Plan ${template.year} · Archivo ${escapeHtml(template.fileName)}</span>
        <button type="button" data-template-file="${escapeHtml(template.fileName)}">
          Usar plantilla
        </button>
      </div>
    `)
    .join("");

  templateListEl.querySelectorAll("button[data-template-file]").forEach((button) => {
    button.addEventListener("click", async () => {
      const fileName = button.getAttribute("data-template-file");
      const template = templates.find((item) => item.fileName === fileName);
      if (!template) {
        return;
      }

      const message = onboardingWarning(template.year);
      if (!window.confirm(`${message}\n\n¿Querés importar esta plantilla ahora?`)) {
        return;
      }

      try {
        setStatus(`Importando plantilla ${template.label}...`);
        const payload = await core.importTemplateByFileName(template.fileName);

        setStatus(`Plantilla importada: ${payload.template.fileName}. ${message}`);
        await loadGraph();
      } catch (error) {
        setStatus(error.message || "No se pudo importar la plantilla.", true);
      }
    });
  });
}

async function loadTemplates() {
  if (!templateListEl) {
    return;
  }

  try {
    const payload = await core.loadTemplatesManifest();
    templates = Array.isArray(payload.templates) ? payload.templates : [];
    templatesYear = payload.year || 2026;

    for (const template of templates) {
      template.year = template.year || templatesYear;
    }

    if (!templates.length) {
      templateListEl.textContent = payload.reason || "No hay plantillas precargadas en la carpeta pdf/";
      return;
    }

    renderTemplateList();
  } catch (_error) {
    templateListEl.textContent = "No se pudieron cargar las plantillas precargadas.";
  }
}

function subjectLabel(subject, state) {
  const approvedMark = state === "approved" ? " ✓" : "";
  return `${subject.id} - ${subject.name}${approvedMark}`;
}

function shouldSkipRapidRepeat(subjectId) {
  const now = Date.now();
  if (
    lastToggleMeta.id === subjectId
    && now - lastToggleMeta.at < DOUBLE_EVENT_GUARD_MS
  ) {
    return true;
  }

  lastToggleMeta = { id: subjectId, at: now };
  return false;
}

async function toggleSubjectFromNode(subjectId) {
  if (shouldSkipRapidRepeat(subjectId)) {
    return;
  }

  const state = subjectState(graphData, subjectId);
  if (state === "locked") {
    setStatus("No podes marcar una materia bloqueada.", true);
    return;
  }

  selectedId = subjectId;
  renderDetail();

  try {
    await toggleSubject(subjectId);
  } catch (error) {
    setStatus(error.message || "No se pudo actualizar el progreso.", true);
  }
}

function renderDetail() {
  if (!graphData || !selectedId) {
    detailEl.innerHTML = "Seleccioná un nodo para ver su información.";
    return;
  }

  const subject = graphData.plan.subjects.find((item) => item.id === selectedId);
  if (!subject) {
    detailEl.innerHTML = "Materia no encontrada.";
    return;
  }

  const prereq = [
    ...new Set([...subject.prerequisites.cursadas, ...subject.prerequisites.aprobadas]),
  ];

  const state = subjectState(graphData, subject.id);
  const dependent = graphData.plan.edges
    .filter((edge) => edge.source === subject.id)
    .map((edge) => edge.target);
  const canToggle = state !== "locked";
  const actionLabel = state === "approved" ? "Quitar aprobada" : "Marcar aprobada";

  detailEl.innerHTML = `
    <h3>${subject.id}. ${escapeHtml(subject.name)}</h3>
    <span class="state-chip ${stateClass(state)}">${stateLabel(state)}</span>
    <p><strong>Correlativas:</strong> ${prereq.length ? prereq.join(", ") : "Ninguna"}</p>
    <p><strong>Desbloquea:</strong> ${dependent.length ? dependent.join(", ") : "Ninguna"}</p>
    <div class="detail-actions">
      <button id="toggle-approved" ${canToggle ? "" : "disabled"}>${actionLabel}</button>
    </div>
  `;

  if (canToggle) {
    document.getElementById("toggle-approved").addEventListener("click", async () => {
      await toggleSubject(subject.id);
    });
  }
}

function edgeId(edge) {
  return `e-${edge.source}-${edge.target}-${edge.type}`;
}

function toElements(data) {
  const visibleSubjectIds = getDisplayedSubjectIds(data);
  const colorsBySubject = new Map(
    data.plan.subjects.map((subject) => [subject.id, colorForSubject(subject.id)])
  );

  const nodes = data.plan.subjects
    .filter((subject) => visibleSubjectIds.has(subject.id))
    .map((subject) => ({
    data: {
      id: String(subject.id),
      state: data.states[String(subject.id)] || data.states[subject.id],
      label: subjectLabel(
        subject,
        data.states[String(subject.id)] || data.states[subject.id]
      ),
      baseColor: colorsBySubject.get(subject.id),
    },
    }));

  const edges = data.plan.edges
    .filter(
      (edge) => visibleSubjectIds.has(edge.source) && visibleSubjectIds.has(edge.target)
    )
    .map((edge) => ({
    data: {
      id: edgeId(edge),
      source: String(edge.source),
      target: String(edge.target),
      kind: edge.type,
      color: colorsBySubject.get(edge.source) || "#33584a",
    },
    }));

  return [...nodes, ...edges];
}

function preferredLayout(animate = true) {
  return {
    name: "dagre",
    rankDir: "LR",
    nodeSep: 80,
    rankSep: 140,
    edgeSep: 30,
    fit: true,
    padding: 40,
    animate,
    animationDuration: 300,
  };
}

function fallbackLayout(animate = true) {
  return {
    name: "breadthfirst",
    directed: true,
    spacingFactor: 1.8,
    fit: true,
    padding: 40,
    animate,
    animationDuration: 300,
  };
}

function runReadableLayout(cy, animate = true) {
  try {
    cy.layout(preferredLayout(animate)).run();
  } catch (_error) {
    cy.layout(fallbackLayout(animate)).run();
  }
}

function updateZoomFeedback(zoomLevel, emphasize = false) {
  if (!zoomFeedbackEl) {
    return;
  }

  const zoomPercent = Math.round(zoomLevel * 100);
  zoomFeedbackEl.textContent = `Zoom: ${zoomPercent}%`;

  if (!emphasize) {
    return;
  }

  zoomFeedbackEl.classList.add("is-active");
  if (zoomFeedbackTimer) {
    window.clearTimeout(zoomFeedbackTimer);
  }

  zoomFeedbackTimer = window.setTimeout(() => {
    zoomFeedbackEl.classList.remove("is-active");
    zoomFeedbackTimer = null;
  }, 520);
}

function moveTooltip(renderedPosition) {
  if (!tooltipEl || !graphViewEl) {
    return;
  }

  const maxLeft = graphViewEl.clientWidth - 290;
  const nextLeft = Math.min(Math.max(renderedPosition.x + 16, 8), Math.max(maxLeft, 8));
  const nextTop = Math.max(renderedPosition.y + 16, 8);

  tooltipEl.style.left = `${nextLeft}px`;
  tooltipEl.style.top = `${nextTop}px`;
}

function showTooltip(subject, state, renderedPosition) {
  if (!tooltipEl || !subject) {
    return;
  }

  const prereq = [
    ...new Set([
      ...subject.prerequisites.cursadas,
      ...subject.prerequisites.aprobadas,
    ]),
  ];

  tooltipEl.innerHTML = `<strong>${subject.id}. ${escapeHtml(subject.name)}</strong><br/>Estado: ${stateLabel(state)}<br/>Correlativas: ${prereq.length ? prereq.join(", ") : "Ninguna"}`;
  moveTooltip(renderedPosition);
  tooltipEl.classList.add("is-visible");
}

function hideTooltip() {
  tooltipEl?.classList.remove("is-visible");
}

function renderTable(data) {
  if (!tableBodyEl) {
    return;
  }

  const subjects = getDisplayedSubjects(data);
  tableBodyEl.innerHTML = "";

  for (const subject of subjects) {
    const state = subjectState(data, subject.id);
    const prereq = [
      ...new Set([
        ...subject.prerequisites.cursadas,
        ...subject.prerequisites.aprobadas,
      ]),
    ];

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${subject.id}</td>
      <td>${escapeHtml(subject.name)}</td>
      <td><span class="state-chip ${stateClass(state)}">${stateLabel(state)}</span></td>
      <td>${prereq.length ? prereq.join(", ") : "Ninguna"}</td>
      <td><button class="table-action" ${state === "locked" ? "disabled" : ""}>${state === "approved" ? "Quitar" : "Marcar"}</button></td>
    `;

    row.addEventListener("click", () => {
      selectedId = subject.id;
      renderDetail();
      revealDetailPanelOnMobile();
    });

    const actionButton = row.querySelector("button");
    if (actionButton && state !== "locked") {
      actionButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await toggleSubject(subject.id);
      });
    }

    tableBodyEl.appendChild(row);
  }
}

function applyViewMode(mode) {
  currentView = mode;
  const isGraph = mode === "graph";

  graphViewEl.classList.toggle("is-hidden", !isGraph);
  tableViewEl.classList.toggle("is-hidden", isGraph);
  toggleViewEl.textContent = isGraph ? "Ver tabla" : "Ver grafo";

  if (isGraph) {
    graph?.resize();
    graph?.fit(undefined, 30);
  }
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  themeToggleEl.textContent = theme === "dark" ? "Modo claro" : "Modo oscuro";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") {
    setTheme(saved);
    return;
  }

  setTheme("light");
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename, dataUrl) {
  const anchor = document.createElement("a");

  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

function exportProgressAsJson() {
  if (!graphData) {
    setStatus("No hay datos para exportar.", true);
    setExportMenuOpen(false);
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    planStats: graphData.plan.stats,
    progress: graphData.progress,
    states: graphData.states,
  };

  downloadFile("progreso-correlativas.json", JSON.stringify(payload, null, 2), "application/json");
  setStatus("Progreso exportado en JSON.");
  setExportMenuOpen(false);
}

function exportProgressAsCsv() {
  if (!graphData) {
    setStatus("No hay datos para exportar.", true);
    setExportMenuOpen(false);
    return;
  }

  const header = ["id", "materia", "estado", "correlativas"];
  const rows = graphData.plan.subjects.map((subject) => {
    const state = subjectState(graphData, subject.id);
    const prereq = [
      ...new Set([
        ...subject.prerequisites.cursadas,
        ...subject.prerequisites.aprobadas,
      ]),
    ];

    const cells = [
      String(subject.id),
      `"${subject.name.replaceAll('"', '""')}"`,
      state,
      `"${prereq.join(", ")}"`,
    ];

    return cells.join(",");
  });

  const csv = [header.join(","), ...rows].join("\n");
  downloadFile("progreso-correlativas.csv", csv, "text/csv;charset=utf-8");
  setStatus("Progreso exportado en CSV.");
  setExportMenuOpen(false);
}

function exportGraphAsPng() {
  if (!graph) {
    setStatus("No hay grafo disponible para exportar.", true);
    setExportMenuOpen(false);
    return;
  }

  const dataUrl = graph.png({
    full: true,
    bg: document.body.dataset.theme === "dark" ? "#16201d" : "#f2efe8",
    scale: 2,
  });

  downloadDataUrl("mapa-correlativas.png", dataUrl);
  setStatus("Grafo exportado en PNG.");
  setExportMenuOpen(false);
}

function setExportMenuOpen(isOpen) {
  exportMenuEl.classList.toggle("is-hidden", !isOpen);
  exportToggleEl.setAttribute("aria-expanded", String(isOpen));
}

function toggleExportMenu() {
  const isOpen = exportMenuEl.classList.contains("is-hidden");
  setExportMenuOpen(isOpen);
}

function syncGraphInPlace(cy, data) {
  const visibleSubjectIds = getDisplayedSubjectIds(data);
  const visibleNodeIds = new Set([...visibleSubjectIds].map((id) => String(id)));
  const colorsBySubject = new Map(
    data.plan.subjects.map((subject) => [subject.id, colorForSubject(subject.id)])
  );

  let topologyChanged = false;

  const removableNodes = cy
    .nodes()
    .filter((node) => !visibleNodeIds.has(node.id()));
  if (removableNodes.length > 0) {
    topologyChanged = true;
    cy.remove(removableNodes);
  }

  for (const subject of data.plan.subjects) {
    if (!visibleSubjectIds.has(subject.id)) {
      continue;
    }

    const id = String(subject.id);
    const state = data.states[String(subject.id)] || data.states[subject.id];
    const label = subjectLabel(subject, state);
    const baseColor = colorsBySubject.get(subject.id);
    const node = cy.getElementById(id);

    if (node.empty()) {
      topologyChanged = true;
      cy.add({
        data: {
          id,
          state,
          label,
          baseColor,
        },
      });
      continue;
    }

    node.data({ state, label, baseColor });
  }

  const nextEdges = data.plan.edges
    .filter(
      (edge) => visibleSubjectIds.has(edge.source) && visibleSubjectIds.has(edge.target)
    )
    .map((edge) => ({
      data: {
        id: edgeId(edge),
        source: String(edge.source),
        target: String(edge.target),
        kind: edge.type,
        color: colorsBySubject.get(edge.source) || "#33584a",
      },
    }));

  const nextEdgeIds = new Set(nextEdges.map((edge) => edge.data.id));
  const removableEdges = cy
    .edges()
    .filter((edge) => !nextEdgeIds.has(edge.id()));
  if (removableEdges.length > 0) {
    topologyChanged = true;
    cy.remove(removableEdges);
  }

  for (const edge of nextEdges) {
    const current = cy.getElementById(edge.data.id);
    if (current.empty()) {
      topologyChanged = true;
      cy.add(edge);
      continue;
    }

    current.data({
      kind: edge.data.kind,
      color: edge.data.color,
    });
  }

  if (topologyChanged) {
    runReadableLayout(cy, false);
  }
}

function renderGraph(data) {
  const elements = toElements(data);

  if (!graph) {
    graph = cytoscape({
      container: document.getElementById("graph"),
      elements,
      minZoom: 0.35,
      maxZoom: 2.2,
      wheelSensitivity: 0.14,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(baseColor)",
            "background-opacity": 1,
            label: "data(label)",
            "font-size": 12,
            color: "#ffffff",
            "font-weight": 700,
            "text-wrap": "wrap",
            "text-max-width": 170,
            shape: "round-rectangle",
            width: "label",
            height: "label",
            padding: "10px",
            "border-width": (ele) => (ele.data("state") === "approved" ? 4 : 2),
            "border-color": (ele) => (ele.data("state") === "approved" ? "#f8fff2" : "#0a0f0d"),
            "text-valign": "center",
            "text-halign": "center",
            "text-outline-width": 1.5,
            "text-outline-color": "#0f1d19",
            "shadow-color": "rgba(0, 0, 0, 0.25)",
            "shadow-blur": 8,
            "shadow-offset-x": 0,
            "shadow-offset-y": 2,
            "z-index-compare": "manual",
            "z-index": 20,
            "underlay-color": "#f2efe8",
            "underlay-opacity": 1,
            "underlay-padding": 4,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-color": "#ffffff",
            "border-width": 5,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "data(color)",
            "target-arrow-color": "data(color)",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.95,
            "curve-style": "taxi",
            "taxi-direction": "horizontal",
            "taxi-turn": 42,
            "taxi-turn-min-distance": 8,
            opacity: 0.9,
            "z-index-compare": "manual",
            "z-index": 5,
          },
        },
        {
          selector: 'edge[kind = "aprobada"]',
          style: {
            "line-style": "dashed",
            width: 3,
          },
        },
      ],
      layout: { name: "preset" },
    });

    runReadableLayout(graph, true);
    updateZoomFeedback(graph.zoom());

    graph.on("tap", "node", (event) => {
      selectedId = Number.parseInt(event.target.id(), 10);
      renderDetail();
      revealDetailPanelOnMobile();
    });

    graph.on("dblclick dbltap", "node", (event) => {
      const subjectId = Number.parseInt(event.target.id(), 10);
      void toggleSubjectFromNode(subjectId);
    });

    graph.on("mouseover", "node", (event) => {
      const subjectId = Number.parseInt(event.target.id(), 10);
      const subject = graphData.plan.subjects.find((item) => item.id === subjectId);
      const state = subjectState(graphData, subjectId);
      showTooltip(subject, state, event.renderedPosition);
    });

    graph.on("mousemove", "node", (event) => {
      moveTooltip(event.renderedPosition);
    });

    graph.on("mouseout", "node", () => {
      hideTooltip();
    });

    graph.on("zoom", () => {
      updateZoomFeedback(graph.zoom(), true);
    });
  } else {
    syncGraphInPlace(graph, data);
    updateZoomFeedback(graph.zoom());
  }

  renderTable(data);
  renderStats(data);
}

function setAppLoaded(isLoaded) {
  if (isLoaded) {
    onboardingSection.classList.add("is-hidden");
    uploadForm.classList.add("is-hidden");
    resetTemplateBtn.classList.remove("is-hidden");
    layoutSectionEl?.classList.remove("is-hidden");
  } else {
    onboardingSection.classList.remove("is-hidden");
    uploadForm.classList.remove("is-hidden");
    resetTemplateBtn.classList.add("is-hidden");
    layoutSectionEl?.classList.add("is-hidden");
  }
}

async function loadGraph() {
  try {
    graphData = await core.getGraphData();
  } catch (_error) {
    setAppLoaded(false);
    throw new Error("No hay plan importado todavía.");
  }
  const visibleSubjectIds = getDisplayedSubjectIds(graphData);
  if (selectedId && !visibleSubjectIds.has(selectedId)) {
    selectedId = null;
  }

  setAppLoaded(true);

  renderGraph(graphData);

  if (selectedId) {
    renderDetail();
  } else {
    detailEl.innerHTML = "Seleccioná un nodo para ver su información.";
  }

  setStatus(
    `Plan cargado: ${visibleSubjectIds.size}/${graphData.plan.stats.subjectCount} materias visibles.`
  );
}

async function toggleSubject(subjectId) {
  const payload = await core.toggleSubject(subjectId);

  graphData.progress = payload.progress;
  graphData.states = payload.states;

  const visibleSubjectIds = getDisplayedSubjectIds(graphData);
  if (selectedId && !visibleSubjectIds.has(selectedId)) {
    selectedId = null;
  }

  renderGraph(graphData);
  if (selectedId) {
    renderDetail();
  } else {
    detailEl.innerHTML = "Seleccioná un nodo para ver su información.";
  }

  setStatus(
    `Progreso actualizado: ${visibleSubjectIds.size}/${graphData.plan.stats.subjectCount} materias visibles.`
  );
}

function applyFiltersAndRefresh() {
  if (!graphData) {
    return;
  }

  const visibleSubjectIds = getDisplayedSubjectIds(graphData);
  if (selectedId && !visibleSubjectIds.has(selectedId)) {
    selectedId = null;
  }

  renderGraph(graphData);
  if (selectedId) {
    renderDetail();
  } else {
    detailEl.innerHTML = "Seleccioná un nodo para ver su información.";
  }

  setStatus(`Filtro aplicado: ${visibleSubjectIds.size} materias mostradas.`);
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fileInput = document.getElementById("pdf-input");
  if (!fileInput.files.length) {
    setStatus("Seleccioná un PDF para importar.", true);
    return;
  }

  try {
    setStatus("Importando PDF...");
    const plan = await core.importPlanFromPdfFile(fileInput.files[0]);

    setStatus(`Importación exitosa: ${plan.stats.subjectCount} materias detectadas.`);
    await loadGraph();
  } catch (error) {
    setStatus(error.message || "Error desconocido al importar.", true);
  }
});

searchInputEl.addEventListener("input", () => {
  uiFilters.query = searchInputEl.value.trim();
  applyFiltersAndRefresh();
});

stateFilterEl.addEventListener("change", () => {
  uiFilters.state = stateFilterEl.value;
  applyFiltersAndRefresh();
});

toggleViewEl.addEventListener("click", () => {
  applyViewMode(currentView === "graph" ? "table" : "graph");
});

themeToggleEl.addEventListener("click", () => {
  setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});

exportJsonEl.addEventListener("click", exportProgressAsJson);
exportCsvEl.addEventListener("click", exportProgressAsCsv);
exportPngEl.addEventListener("click", exportGraphAsPng);

resetTemplateBtn.addEventListener("click", async () => {
  if (confirm("¿Estás seguro que querés reiniciar la plantilla? Se perderá el avance cargado actual.")) {
    try {
      core.resetStore();
      window.location.reload();
    } catch (err) {
      setStatus("Error al reiniciar la plantilla", true);
    }
  }
});

exportToggleEl.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleExportMenu();
});

exportMenuEl.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", () => {
  setExportMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setExportMenuOpen(false);
  }
});

initTheme();
applyViewMode(isMobileViewport() ? "table" : "graph");
loadTemplates();
loadGraph().catch(() => {
  setStatus("Todavía no hay un plan cargado. Subí tu PDF para empezar.");
});
