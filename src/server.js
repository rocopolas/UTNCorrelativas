const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { parseStudyPlanFromPdf } = require("./parser");
const { readStore, writeStore } = require("./storage");
const { computeSubjectStates } = require("./unlock");

const app = express();
const port = process.env.PORT || 3000;
const serverStartedAt = Date.now();

const uploadDir = path.join(__dirname, "..", "data", "uploads");
const templatesDir = path.join(__dirname, "..", "pdf");
const onboardingYear = 2026;
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(templatesDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.originalname || !file.originalname.toLowerCase().endsWith(".pdf")) {
      callback(new Error("Solo se permiten archivos PDF"));
      return;
    }

    callback(null, true);
  },
});

function sendError(res, status, error, detail) {
  return res.status(status).json({
    error,
    ...(detail ? { detail } : {}),
  });
}

function parseSubjectId(rawValue) {
  const numericId = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(numericId)) {
    return null;
  }
  return numericId;
}

function removeFileSafe(filePath) {
  if (!filePath) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // Ignore temp file cleanup errors.
  }
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

function listPdfTemplates() {
  return fs
    .readdirSync(templatesDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((fileName) => ({
      fileName,
      label: fileName.replace(/\.pdf$/i, ""),
      year: onboardingYear,
    }));
}

async function importPdfPlan(pdfPath) {
  const plan = await parseStudyPlanFromPdf(pdfPath);
  const store = readStore();

  store.plan = plan;
  store.progress = { approvedIds: [] };

  writeStore(store);

  return plan;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
    pid: process.pid,
    platform: os.platform(),
  });
});

app.get("/api/templates", (_req, res) => {
  try {
    return res.json({
      year: onboardingYear,
      templates: listPdfTemplates(),
    });
  } catch (error) {
    return sendError(
      res,
      500,
      "No se pudieron leer las plantillas",
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.post("/api/import", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 400, "Debes subir un PDF en el campo 'pdf'");
    }

    const plan = await importPdfPlan(req.file.path);
    removeFileSafe(req.file.path);

    return res.json({
      message: "PDF importado correctamente",
      stats: plan.stats,
    });
  } catch (error) {
    if (req.file?.path) {
      removeFileSafe(req.file.path);
    }

    return sendError(
      res,
      400,
      "No se pudo importar el PDF",
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.post("/api/import-template", async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName || typeof fileName !== "string") {
      return sendError(res, 400, "Debes indicar una plantilla válida");
    }

    const safeFileName = path.basename(fileName);
    const templatePath = path.join(templatesDir, safeFileName);

    if (!safeFileName.toLowerCase().endsWith(".pdf")) {
      return sendError(res, 400, "La plantilla debe ser un PDF");
    }

    if (!fs.existsSync(templatePath)) {
      return sendError(res, 404, "La plantilla no existe");
    }

    const plan = await importPdfPlan(templatePath);

    return res.json({
      message: "Plantilla importada correctamente",
      stats: plan.stats,
      template: {
        fileName: safeFileName,
        year: onboardingYear,
      },
    });
  } catch (error) {
    return sendError(
      res,
      400,
      "No se pudo importar la plantilla",
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.get("/api/graph", (_req, res) => {
  try {
    const store = readStore();
    const payload = buildProgressPayload(store);

    return res.json({
      plan: store.plan,
      ...payload,
    });
  } catch (error) {
    return sendError(
      res,
      error.status || 500,
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.delete("/api/reset", (_req, res) => {
  try {
    writeStore({ plan: null, progress: { approvedIds: [] } });
    return res.json({ message: "Planes borrados correctamente" });
  } catch (error) {
    return sendError(
      res,
      500,
      "Error al borrar el plan",
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.get("/api/progress", (_req, res) => {
  try {
    const store = readStore();
    return res.json(buildProgressPayload(store));
  } catch (error) {
    return sendError(
      res,
      error.status || 500,
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.put("/api/progress", (req, res) => {
  try {
    const store = readStore();
    assertPlanLoaded(store);

    const approvedIds = validateApprovedIds(store, req.body?.approvedIds);
    store.progress.approvedIds = approvedIds;
    writeStore(store);

    return res.json(buildProgressPayload(store));
  } catch (error) {
    return sendError(
      res,
      error.status || 500,
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.get("/api/subjects/:subjectId", (req, res) => {
  try {
    const store = readStore();
    assertPlanLoaded(store);

    const subjectId = parseSubjectId(req.params.subjectId);
    if (!subjectId) {
      return sendError(res, 400, "subjectId inválido");
    }

    const subject = store.plan.subjects.find((item) => item.id === subjectId);
    if (!subject) {
      return sendError(res, 404, "Materia no encontrada en el plan");
    }

    const states = computeSubjectStates(store.plan, store.progress.approvedIds);
    const dependent = store.plan.edges
      .filter((edge) => edge.source === subjectId)
      .map((edge) => ({ target: edge.target, type: edge.type }));

    return res.json({
      subject,
      state: states[String(subjectId)] || states[subjectId] || "locked",
      dependent,
    });
  } catch (error) {
    return sendError(
      res,
      error.status || 500,
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.post("/api/progress/toggle", (req, res) => {
  try {
    const { subjectId } = req.body;
    const numericId = parseSubjectId(subjectId);

    const store = readStore();
    assertPlanLoaded(store);

    if (!numericId) {
      return sendError(res, 400, "subjectId inválido");
    }

    const exists = store.plan.subjects.some((subject) => subject.id === numericId);
    if (!exists) {
      return sendError(res, 404, "Materia no encontrada en el plan");
    }

    const approved = new Set(store.progress.approvedIds);
    if (approved.has(numericId)) {
      approved.delete(numericId);
    } else {
      approved.add(numericId);
    }

    store.progress.approvedIds = Array.from(approved).sort((a, b) => a - b);
    writeStore(store);

    return res.json(buildProgressPayload(store));
  } catch (error) {
    return sendError(
      res,
      error.status || 500,
      error instanceof Error ? error.message : "Error desconocido"
    );
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return sendError(
        res,
        413,
        `El PDF supera el máximo permitido (${Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))}MB)`
      );
    }

    return sendError(res, 400, "Error al procesar el archivo", error.message);
  }

  if (error instanceof SyntaxError && "body" in error) {
    return sendError(res, 400, "JSON inválido en el body");
  }

  return sendError(
    res,
    500,
    "Error interno del servidor",
    error instanceof Error ? error.message : "Error desconocido"
  );
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor en http://localhost:${port}`);
});
