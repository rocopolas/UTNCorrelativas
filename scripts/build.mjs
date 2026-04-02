import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const pdfDir = path.join(rootDir, "pdf");
const distDir = path.join(rootDir, "dist");
const distPdfDir = path.join(distDir, "pdf");
const onboardingYear = 2026;

function cleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
}

function copyPublic() {
  fs.cpSync(publicDir, distDir, { recursive: true });
}

function buildTemplatesManifest() {
  const templates = [];

  if (fs.existsSync(pdfDir)) {
    fs.mkdirSync(distPdfDir, { recursive: true });

    const pdfFiles = fs
      .readdirSync(pdfDir)
      .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => a.localeCompare(b, "es"));

    for (const fileName of pdfFiles) {
      fs.copyFileSync(path.join(pdfDir, fileName), path.join(distPdfDir, fileName));
      templates.push({
        fileName,
        label: fileName.replace(/\.pdf$/i, ""),
        year: onboardingYear,
      });
    }
  }

  fs.writeFileSync(
    path.join(distDir, "templates.json"),
    `${JSON.stringify({ year: onboardingYear, templates }, null, 2)}\n`,
    "utf8"
  );
}

cleanDist();
copyPublic();
buildTemplatesManifest();
