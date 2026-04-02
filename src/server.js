const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { parseStudyPlanFromPdf } = require("./parser");
const { readStore, writeStore } = require("./storage");
const { computeSubjectStates } = require("./unlock");

const app = express();
const port = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "..", "data", "uploads");
const templatesDir = path.join(__dirname, "..", "pdf");
const onboardingYear = 2026;
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(templatesDir, { recursive: true });

const upload = multer({ dest: uploadDir });

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
  res.json({ ok: true });
});

app.get("/api/templates", (_req, res) => {
  try {
    return res.json({
      year: onboardingYear,
      templates: listPdfTemplates(),
    });
  } catch (error) {
    return res.status(500).json({
      error: "No se pudieron leer las plantillas",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.post("/api/import", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Debes subir un PDF en el campo 'pdf'" });
    }

    const plan = await importPdfPlan(req.file.path);

    return res.json({
      message: "PDF importado correctamente",
      stats: plan.stats,
    });
  } catch (error) {
    return res.status(400).json({
      error: "No se pudo importar el PDF",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.post("/api/import-template", async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName || typeof fileName !== "string") {
      return res.status(400).json({ error: "Debes indicar una plantilla válida" });
    }

    const safeFileName = path.basename(fileName);
    const templatePath = path.join(templatesDir, safeFileName);

    if (!safeFileName.toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({ error: "La plantilla debe ser un PDF" });
    }

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: "La plantilla no existe" });
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
    return res.status(400).json({
      error: "No se pudo importar la plantilla",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.get("/api/graph", (_req, res) => {
  const store = readStore();

  if (!store.plan) {
    return res.status(404).json({ error: "No hay un plan importado todavía" });
  }

  const states = computeSubjectStates(store.plan, store.progress.approvedIds);

  return res.json({
    plan: store.plan,
    progress: store.progress,
    states,
  });
});

app.delete("/api/reset", (_req, res) => {
  try {
    const { writeStore } = require("./storage");
    writeStore({ plan: null, progress: { approvedIds: [] } });
    return res.json({ message: "Planes borrados correctamente" });
  } catch (error) {
    return res.status(500).json({ error: "Error al borrar el plan" });
  }
});

app.post("/api/progress/toggle", (req, res) => {
  const { subjectId } = req.body;
  const numericId = Number.parseInt(subjectId, 10);

  const store = readStore();

  if (!store.plan) {
    return res.status(404).json({ error: "No hay un plan importado todavía" });
  }

  if (!Number.isInteger(numericId)) {
    return res.status(400).json({ error: "subjectId inválido" });
  }

  const exists = store.plan.subjects.some((subject) => subject.id === numericId);
  if (!exists) {
    return res.status(404).json({ error: "Materia no encontrada en el plan" });
  }

  const approved = new Set(store.progress.approvedIds);
  if (approved.has(numericId)) {
    approved.delete(numericId);
  } else {
    approved.add(numericId);
  }

  store.progress.approvedIds = Array.from(approved).sort((a, b) => a - b);
  writeStore(store);

  const states = computeSubjectStates(store.plan, store.progress.approvedIds);

  return res.json({ progress: store.progress, states });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor en http://localhost:${port}`);
});
