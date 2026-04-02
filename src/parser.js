const fs = require("fs");
const { execFileSync } = require("child_process");
const pdfParse = require("pdf-parse");

const REQUIREMENT_PATTERN = /^(?:\d+(?:\s*-\s*\d+)*|-)$/;

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
    upper.includes("MINISTERIO") ||
    upper.includes("ANEXO") ||
    upper.includes("ORDENANZA") ||
    upper.includes("RÉGIMEN") ||
    upper.includes("REGIMEN") ||
    upper.includes("Nº") ||
    upper.includes("N°") ||
    upper.includes("UNIVERSIDAD TECNOLOGICA NACIONAL") ||
    upper.includes("RECTORADO") ||
    upper.includes("APOYO AL CONSEJO SUPERIOR")
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
      upper.startsWith("MINISTERIO DE EDUCACION") ||
      upper.startsWith("UNIVERSIDAD TECNOLOGICA NACIONAL") ||
      upper.startsWith("RECTORADO") ||
      upper.startsWith("NIVEL") ||
      upper.startsWith("ASIGNATURA") ||
      upper.startsWith("PARA CURSAR Y RENDIR") ||
      upper.startsWith("PARA CURSAR") ||
      upper.startsWith("PARA RENDIR") ||
      upper.startsWith("Y RENDIR") ||
      upper.startsWith("CURSADAS") ||
      upper.startsWith("APROBADAS") ||
      upper.startsWith("CURSADA") ||
      upper.startsWith("APROBADA") ||
      upper.startsWith("ORDENANZA") ||
      upper.startsWith("MALVINAS SON ARGENTINAS") ||
      upper.startsWith("PLAN 2023") ||
      upper.startsWith("PLAN 2025") ||
      upper.startsWith("REGIMEN DE CORRELATIVIDADES") ||
      upper.startsWith("RÉGIMEN DE CORRELATIVIDADES") ||
      upper.startsWith("ANEXO II") ||
      upper.startsWith("ANEXO III") ||
      upper.startsWith("ANEXO IV") ||
      upper.startsWith("PABLO A. HUEL") ||
      upper.startsWith("JEFE DE DEPARTAMENTO") ||
      upper.startsWith("APOYO AL CONSEJO SUPERIOR") ||
      upper.startsWith("ARTICULO")
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
      .split(/(?=\b\d{1,2}\s+[^^\d-])/)
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

async function extractPdfTextCandidates(filePath) {
  const candidates = [];

  try {
    const text = execFileSync("pdftotext", [filePath, "-"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    candidates.push({ source: "pdftotext", text });
  } catch (_error) {
    // Ignore pdftotext failures and fall back to pdf-parse.
  }

  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  candidates.push({ source: "pdf-parse", text: data.text || "" });

  return candidates;
}

function pickBestCandidate(candidates) {
  let bestCandidate = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    try {
      const lines = cleanTableLines(candidate.text);
      const subjects = parseSubjectsFromLines(lines);
      const edges = buildEdges(subjects);
      const score = subjects.length * 1000 + edges.length;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = {
          source: candidate.source,
          text: candidate.text,
          subjects,
          edges,
        };
      }
    } catch (_error) {
      // Skip non-parsable extractions.
    }
  }

  return bestCandidate;
}

async function parseStudyPlanFromPdf(filePath) {
  const candidates = await extractPdfTextCandidates(filePath);
  const bestCandidate = pickBestCandidate(candidates);

  if (!bestCandidate) {
    throw new Error("No se pudo extraer una tabla de correlatividades válida del PDF.");
  }

  if (bestCandidate.subjects.length === 0) {
    throw new Error("No se detectaron materias en el PDF. Revisar formato o reglas del parser.");
  }

  return {
    sourceFile: filePath,
    source: bestCandidate.source,
    importedAt: new Date().toISOString(),
    stats: {
      subjectCount: bestCandidate.subjects.length,
      edgeCount: bestCandidate.edges.length,
    },
    subjects: bestCandidate.subjects,
    edges: bestCandidate.edges,
  };
}

module.exports = {
  parseStudyPlanFromPdf,
};
