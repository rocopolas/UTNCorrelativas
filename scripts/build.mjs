import fs from "fs";
import path from "path";
import { createRequire } from "module";

const rootDir = process.cwd();
const clientSrcDir = path.join(rootDir, "src", "client");
const pdfDir = path.join(rootDir, "pdf");
const distDir = path.join(rootDir, "dist");
const distPdfDir = path.join(distDir, "pdf");
const distTemplatePlansDir = path.join(distDir, "template-plans");
const onboardingYear = 2026;
const require = createRequire(import.meta.url);
const { parseStudyPlanFromPdf } = require("../src/parser");

function cleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
}

function copyClientSource() {
  fs.cpSync(clientSrcDir, distDir, { recursive: true });
}

async function buildTemplatesManifest() {
  const templates = [];

  if (fs.existsSync(pdfDir)) {
    fs.mkdirSync(distPdfDir, { recursive: true });
    fs.mkdirSync(distTemplatePlansDir, { recursive: true });

    const pdfFiles = fs
      .readdirSync(pdfDir)
      .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => a.localeCompare(b, "es"));

    for (const [index, fileName] of pdfFiles.entries()) {
      const sourcePdfPath = path.join(pdfDir, fileName);
      fs.copyFileSync(sourcePdfPath, path.join(distPdfDir, fileName));

      const template = {
        fileName,
        label: fileName.replace(/\.pdf$/i, ""),
        year: onboardingYear,
      };

      const planFileName = `template-${String(index + 1).padStart(2, "0")}.json`;
      try {
        const plan = await parseStudyPlanFromPdf(sourcePdfPath);
        fs.writeFileSync(
          path.join(distTemplatePlansDir, planFileName),
          `${JSON.stringify(plan, null, 2)}\n`,
          "utf8"
        );
        template.planFileName = planFileName;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Error desconocido";
        console.warn(`No se pudo preprocesar plantilla ${fileName}: ${detail}`);
      }

      templates.push(template);
    }
  }

  fs.writeFileSync(
    path.join(distDir, "templates.json"),
    `${JSON.stringify({ year: onboardingYear, templates }, null, 2)}\n`,
    "utf8"
  );
}

async function main() {
  cleanDist();
  copyClientSource();
  await buildTemplatesManifest();
}

main();
