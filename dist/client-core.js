(() => {
  const STORE_KEY = "correlativas-store-v1";
  const REQUIREMENT_PATTERN = /^(?:\d+(?:\s*-\s*\d+)*|-)$/;
  const MAX_PDF_BYTES = 20 * 1024 * 1024;
  const templatesByFileName = new Map();

  function createEmptyStore() {
    return { plan: null, progress: { approvedIds: [] } };
  }

  function normalizeStore(rawStore) {
    if (!rawStore || typeof rawStore !== "object") {
      return createEmptyStore();
    }

    const approvedIds = Array.isArray(rawStore.progress?.approvedIds)
      ? rawStore.progress.approvedIds.filter((id) => Number.isInteger(id))
      : [];

    return {
      plan: rawStore.plan || null,
      progress: { approvedIds },
    };
  }

  function readStore() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) {
        return createEmptyStore();
      }
      return normalizeStore(JSON.parse(raw));
    } catch (_error) {
      return createEmptyStore();
    }
  }

  function writeStore(store) {
    const normalized = normalizeStore(store);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function resetStore() {
    writeStore(createEmptyStore());
  }

  function computeSubjectStates(plan, approvedIds) {
    const approvedSet = new Set(approvedIds);
    const states = {};

    for (const subject of plan.subjects) {
      if (approvedSet.has(subject.id)) {
        states[subject.id] = "approved";
        continue;
      }

      const required = new Set([
        ...subject.prerequisites.cursadas,
        ...subject.prerequisites.aprobadas,
      ]);

      const unlocked = Array.from(required).every((reqId) => approvedSet.has(reqId));
      states[subject.id] = unlocked ? "unlocked" : "locked";
    }

    return states;
  }

  function assertPlanLoaded(store) {
    if (!store.plan) {
      const error = new Error("No hay un plan importado todavía");
      error.status = 404;
      throw error;
    }
  }

  function buildProgressPayload(store) {
    assertPlanLoaded(store);
    const states = computeSubjectStates(store.plan, store.progress.approvedIds);
    return { progress: store.progress, states };
  }

  function parseSubjectId(rawValue) {
    const numericId = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(numericId)) {
      return null;
    }
    return numericId;
  }

  function validateApprovedIds(store, approvedIds) {
    if (!Array.isArray(approvedIds)) {
      const error = new Error("approvedIds debe ser un array de números");
      error.status = 400;
      throw error;
    }

    const planSubjectIds = new Set(store.plan.subjects.map((subject) => subject.id));
    const normalized = [];

    for (const value of approvedIds) {
      const numericId = parseSubjectId(value);
      if (!numericId || !planSubjectIds.has(numericId)) {
        const error = new Error(`Materia inválida en approvedIds: ${value}`);
        error.status = 400;
        throw error;
      }

      if (!normalized.includes(numericId)) {
        normalized.push(numericId);
      }
    }

    return normalized.sort((a, b) => a - b);
  }

  function normalizeLine(line) {
    return line.replace(/\s+/g, " ").trim();
  }

  function isRequirementLine(line) {
    return REQUIREMENT_PATTERN.test(line.trim());
  }

  function parseRequirementIds(text) {
    if (!text || text === "-") {
      return [];
    }

    return text
      .split("-")
      .map((token) => Number.parseInt(token.trim(), 10))
      .filter((value) => Number.isInteger(value));
  }

  function isNoisySubjectText(text) {
    const upper = text.toUpperCase();
    return (
      upper.includes("MINISTERIO")
      || upper.includes("ANEXO")
      || upper.includes("ORDENANZA")
      || upper.includes("RÉGIMEN")
      || upper.includes("REGIMEN")
      || upper.includes("Nº")
      || upper.includes("N°")
      || upper.includes("UNIVERSIDAD TECNOLOGICA NACIONAL")
      || upper.includes("RECTORADO")
      || upper.includes("APOYO AL CONSEJO SUPERIOR")
    );
  }

  function cleanTableLines(text) {
    const lines = text.split("\n").map(normalizeLine).filter(Boolean);

    const start = lines.findIndex((line) => line.toUpperCase() === "ANEXO I");
    if (start < 0) {
      throw new Error("No se pudo ubicar el bloque de correlatividades (ANEXO I)");
    }

    const endMarkers = ["ANEXO II", "ANEXO III", "ANEXO IV"];
    const end = lines.findIndex((line, index) => {
      if (index <= start) {
        return false;
      }

      const upper = line.toUpperCase();
      return endMarkers.some((marker) => upper.includes(marker));
    });

    const raw = lines.slice(start, end > start ? end : lines.length);

    const headerMarkers = [
      "CURSADA APROBADA",
      "PARA CURSAR Y RENDIR",
      "PARA CURSAR",
      "PARA RENDIR",
      "RINDIR",
      "APROBADA",
      "CURSADA",
      "NIVEL",
      "NUMERO",
      "NÚMERO",
      "ASIGNATURA",
    ];

    let bodyStart = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const upper = raw[index].toUpperCase();
      if (/^\d+(?:\s+|$)/.test(raw[index])) {
        break;
      }
      if (headerMarkers.some((marker) => upper === marker || upper.includes(marker))) {
        bodyStart = index + 1;
      }
    }

    return raw.slice(bodyStart).filter((line) => {
      const upper = line.toUpperCase();
      const folded = upper.normalize("NFD").replace(/\p{Diacritic}/gu, "");

      if (
        /(MALVINAS SON ARGENTINAS|MINISTERIO DE EDUCACION|UNIVERSIDAD TECNOLOGICA NACIONAL|RECTORADO|PABLO A\. HUEL|JEFE DE DEPARTAMENTO|APOYO AL CONSEJO SUPERIOR)/.test(
          folded
        )
      ) {
        return false;
      }

      if (
        upper.startsWith("MINISTERIO DE EDUCACION")
        || upper.startsWith("UNIVERSIDAD TECNOLOGICA NACIONAL")
        || upper.startsWith("RECTORADO")
        || upper.startsWith("NIVEL")
        || upper.startsWith("ASIGNATURA")
        || upper.startsWith("PARA CURSAR Y RENDIR")
        || upper.startsWith("PARA CURSAR")
        || upper.startsWith("PARA RENDIR")
        || upper.startsWith("Y RENDIR")
        || upper.startsWith("CURSADAS")
        || upper.startsWith("APROBADAS")
        || upper.startsWith("CURSADA")
        || upper.startsWith("APROBADA")
        || upper.startsWith("ORDENANZA")
        || upper.startsWith("MALVINAS SON ARGENTINAS")
        || upper.startsWith("PLAN 2023")
        || upper.startsWith("PLAN 2025")
        || upper.startsWith("REGIMEN DE CORRELATIVIDADES")
        || upper.startsWith("RÉGIMEN DE CORRELATIVIDADES")
        || upper.startsWith("ANEXO II")
        || upper.startsWith("ANEXO III")
        || upper.startsWith("ANEXO IV")
        || upper.startsWith("PABLO A. HUEL")
        || upper.startsWith("JEFE DE DEPARTAMENTO")
        || upper.startsWith("APOYO AL CONSEJO SUPERIOR")
        || upper.startsWith("ARTICULO")
      ) {
        return false;
      }

      if (/^[IVX]+$/.test(upper)) {
        return false;
      }

      if (/^\d+$/.test(line) && Number.parseInt(line, 10) > 150) {
        return false;
      }

      return true;
    });
  }

  function parseSubjectsFromLines(lines) {
    const subjects = [];
    const tokens = [];

    for (const line of lines) {
      const pieces = line
        .split(/(?=\b\d{1,2}\s+[^\d-])/)
        .map((piece) => piece.trim())
        .filter(Boolean);

      tokens.push(...pieces);
    }

    let i = 0;
    let lastId = 0;

    while (i < tokens.length) {
      const line = tokens[i];

      const inlineMatch = line.match(
        /^(\d{1,2})\s+(.+?)\s+((?:\d+(?:\s*-\s*\d+)*)|-)\s+((?:\d+(?:\s*-\s*\d+)*)|-)$/
      );
      if (inlineMatch) {
        const id = Number.parseInt(inlineMatch[1], 10);
        const name = inlineMatch[2].trim();

        if (id > lastId && !isNoisySubjectText(name)) {
          subjects.push({
            id,
            name,
            prerequisites: {
              cursadas: parseRequirementIds(inlineMatch[3].trim()),
              aprobadas: parseRequirementIds(inlineMatch[4].trim()),
            },
          });
          lastId = id;
        }

        i += 1;
        continue;
      }

      const idAndNameMatch = line.match(/^(\d{1,2})\s+(.+)$/);
      if (idAndNameMatch) {
        const id = Number.parseInt(idAndNameMatch[1], 10);
        const name = idAndNameMatch[2].trim();
        if (id <= lastId || isNoisySubjectText(name)) {
          i += 1;
          continue;
        }

        const nameParts = [name];
        i += 1;

        while (i < tokens.length && !isRequirementLine(tokens[i])) {
          const nextLine = tokens[i];
          const reqAtEndMatch = nextLine.match(
            /^(.+?)\s+((?:\d+(?:\s*-\s*\d+)*)|-)\s+((?:\d+(?:\s*-\s*\d+)*)|-)$/
          );

          if (reqAtEndMatch) {
            const subjectName = `${nameParts.join(" ")} ${reqAtEndMatch[1]}`.trim();
            if (isNoisySubjectText(subjectName)) {
              i += 1;
              break;
            }

            subjects.push({
              id,
              name: subjectName,
              prerequisites: {
                cursadas: parseRequirementIds(reqAtEndMatch[2].trim()),
                aprobadas: parseRequirementIds(reqAtEndMatch[3].trim()),
              },
            });
            lastId = id;
            i += 1;
            break;
          }

          if (/^\d{1,2}$/.test(nextLine) || /^\d{1,2}\s+/.test(nextLine)) {
            break;
          }

          const lower = nextLine.toLowerCase();
          if (lower !== "para cursar" && lower !== "proyecto final") {
            nameParts.push(nextLine);
          }
          i += 1;
        }

        if (subjects.length > 0 && subjects[subjects.length - 1].id === id) {
          continue;
        }

        const cursadasRaw = i < tokens.length && isRequirementLine(tokens[i]) ? tokens[i] : "-";
        if (i < tokens.length && isRequirementLine(tokens[i])) {
          i += 1;
        }

        const aprobadasRaw = i < tokens.length && isRequirementLine(tokens[i]) ? tokens[i] : "-";
        if (i < tokens.length && isRequirementLine(tokens[i])) {
          i += 1;
        }

        subjects.push({
          id,
          name: nameParts.join(" "),
          prerequisites: {
            cursadas: parseRequirementIds(cursadasRaw),
            aprobadas: parseRequirementIds(aprobadasRaw),
          },
        });
        lastId = id;
        continue;
      }

      if (/^\d{1,2}$/.test(line)) {
        const id = Number.parseInt(line, 10);
        if (id <= lastId) {
          i += 1;
          continue;
        }

        i += 1;
        const nameParts = [];

        while (i < tokens.length && !isRequirementLine(tokens[i])) {
          const nextLine = tokens[i];
          const reqAtEndMatch = nextLine.match(
            /^(.+?)\s+((?:\d+(?:\s*-\s*\d+)*)|-)\s+((?:\d+(?:\s*-\s*\d+)*)|-)$/
          );

          if (reqAtEndMatch) {
            const subjectName = `${nameParts.join(" ")} ${reqAtEndMatch[1]}`.trim();
            if (isNoisySubjectText(subjectName)) {
              i += 1;
              break;
            }

            subjects.push({
              id,
              name: subjectName,
              prerequisites: {
                cursadas: parseRequirementIds(reqAtEndMatch[2].trim()),
                aprobadas: parseRequirementIds(reqAtEndMatch[3].trim()),
              },
            });
            lastId = id;
            i += 1;
            break;
          }

          if (/^\d{1,2}$/.test(nextLine)) {
            break;
          }

          const lower = nextLine.toLowerCase();
          if (lower !== "para cursar" && lower !== "proyecto final") {
            nameParts.push(nextLine);
          }
          i += 1;
        }

        if (subjects.length > 0 && subjects[subjects.length - 1].id === id) {
          continue;
        }

        const cursadasRaw = i < tokens.length && isRequirementLine(tokens[i]) ? tokens[i] : "-";
        if (i < tokens.length && isRequirementLine(tokens[i])) {
          i += 1;
        }

        const aprobadasRaw = i < tokens.length && isRequirementLine(tokens[i]) ? tokens[i] : "-";
        if (i < tokens.length && isRequirementLine(tokens[i])) {
          i += 1;
        }

        if (nameParts.length === 0) {
          continue;
        }

        subjects.push({
          id,
          name: nameParts.join(" "),
          prerequisites: {
            cursadas: parseRequirementIds(cursadasRaw),
            aprobadas: parseRequirementIds(aprobadasRaw),
          },
        });
        lastId = id;
        continue;
      }

      i += 1;
    }

    return subjects;
  }

  function buildEdges(subjects) {
    const edges = [];

    for (const subject of subjects) {
      for (const sourceId of subject.prerequisites.cursadas) {
        edges.push({ source: sourceId, target: subject.id, type: "cursada" });
      }

      for (const sourceId of subject.prerequisites.aprobadas) {
        edges.push({ source: sourceId, target: subject.id, type: "aprobada" });
      }
    }

    return edges;
  }

  async function extractPdfText(file) {
    if (!window.pdfjsLib) {
      throw new Error("No se pudo inicializar el parser de PDF en el navegador");
    }

    if (file.size > MAX_PDF_BYTES) {
      throw new Error("El PDF excede el tamaño máximo permitido (20 MB)");
    }

    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

    const lines = [];
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const content = await page.getTextContent();
      const rows = new Map();

      for (const item of content.items) {
        const text = String(item.str || "").trim();
        if (!text) {
          continue;
        }

        const y = Math.round(item.transform[5]);
        if (!rows.has(y)) {
          rows.set(y, []);
        }

        rows.get(y).push({ x: item.transform[4], text });
      }

      const sortedY = Array.from(rows.keys()).sort((a, b) => b - a);
      for (const y of sortedY) {
        const rowText = rows
          .get(y)
          .sort((a, b) => a.x - b.x)
          .map((entry) => entry.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (rowText) {
          lines.push(rowText);
        }
      }
    }

    return lines.join("\n");
  }

  async function parseStudyPlanFromPdfFile(file) {
    const text = await extractPdfText(file);
    const lines = cleanTableLines(text);
    const subjects = parseSubjectsFromLines(lines);
    const edges = buildEdges(subjects);

    if (subjects.length === 0) {
      throw new Error("No se detectaron materias en el PDF. Revisar formato o reglas del parser.");
    }

    return {
      sourceFile: file.name,
      source: "pdfjs",
      importedAt: new Date().toISOString(),
      stats: {
        subjectCount: subjects.length,
        edgeCount: edges.length,
      },
      subjects,
      edges,
    };
  }

  async function importPlanFromPdfFile(file) {
    const plan = await parseStudyPlanFromPdfFile(file);
    const store = readStore();
    store.plan = plan;
    store.progress = { approvedIds: [] };
    writeStore(store);
    return plan;
  }

  function importPlanObject(plan) {
    const store = readStore();
    store.plan = plan;
    store.progress = { approvedIds: [] };
    writeStore(store);
    return plan;
  }

  async function getGraphData() {
    const store = readStore();
    assertPlanLoaded(store);

    return {
      plan: store.plan,
      ...buildProgressPayload(store),
    };
  }

  async function toggleSubject(subjectId) {
    const store = readStore();
    assertPlanLoaded(store);

    const numericSubjectId = parseSubjectId(subjectId);
    if (!numericSubjectId) {
      throw new Error("subjectId inválido");
    }

    const subject = store.plan.subjects.find((item) => item.id === numericSubjectId);
    if (!subject) {
      throw new Error("Materia no encontrada");
    }

    const states = computeSubjectStates(store.plan, store.progress.approvedIds);
    const currentState = states[numericSubjectId] || "locked";

    if (currentState === "locked") {
      throw new Error("No podes marcar una materia bloqueada");
    }

    const approved = new Set(store.progress.approvedIds);
    if (approved.has(numericSubjectId)) {
      approved.delete(numericSubjectId);
    } else {
      approved.add(numericSubjectId);
    }

    store.progress.approvedIds = validateApprovedIds(store, Array.from(approved));
    writeStore(store);

    return buildProgressPayload(store);
  }

  async function loadTemplatesManifest() {
    const runningFromFileProtocol = window.location.protocol === "file:";

    try {
      const response = await fetch("./templates.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("No se pudieron cargar las plantillas");
      }

      const payload = await response.json();
      const templates = Array.isArray(payload.templates) ? payload.templates : [];
      const year = Number.isInteger(payload.year) ? payload.year : 2026;

      const normalizedTemplates = templates.map((template) => ({
        fileName: String(template.fileName),
        label: template.label ? String(template.label) : String(template.fileName).replace(/\.pdf$/i, ""),
        year: Number.isInteger(template.year) ? template.year : year,
        planFileName:
          typeof template.planFileName === "string" && template.planFileName.trim().length > 0
            ? template.planFileName
            : null,
      }));

      templatesByFileName.clear();
      for (const template of normalizedTemplates) {
        templatesByFileName.set(template.fileName, template);
      }

      return {
        year,
        templates: normalizedTemplates,
        reason: null,
      };
    } catch (_error) {
      if (runningFromFileProtocol) {
        return {
          year: 2026,
          templates: [],
          reason: "Estás abriendo la app con file://. El navegador no permite resolver esta carga de plantillas desde el sistema de archivos. Ejecutá npm run build y abrí dist en un servidor HTTP.",
        };
      }

      return {
        year: 2026,
        templates: [],
        reason: "No se encontró templates.json. Ejecutá npm run build para generar plantillas estáticas en dist.",
      };
    }
  }

  async function importTemplateByFileName(fileName) {
    const templateMeta = templatesByFileName.get(fileName);

    if (templateMeta?.planFileName) {
      const planResponse = await fetch(
        `./template-plans/${encodeURIComponent(templateMeta.planFileName)}`,
        { cache: "no-store" }
      );

      if (planResponse.ok) {
        const plan = await planResponse.json();
        importPlanObject(plan);
        return {
          message: "Plantilla importada correctamente",
          stats: plan.stats,
          template: { fileName },
        };
      }
    }

    const response = await fetch(`./pdf/${encodeURIComponent(fileName)}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("La plantilla no existe");
    }

    const blob = await response.blob();
    const file = new File([blob], fileName, { type: "application/pdf" });
    const plan = await importPlanFromPdfFile(file);

    return {
      message: "Plantilla importada correctamente",
      stats: plan.stats,
      template: { fileName },
    };
  }

  window.correlativasCore = {
    getGraphData,
    toggleSubject,
    importPlanFromPdfFile,
    importTemplateByFileName,
    loadTemplatesManifest,
    resetStore,
  };
})();
