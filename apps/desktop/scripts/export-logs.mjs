import { copyFile, mkdir, access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const source = path.resolve(packageRoot, ".logs/desktop.jsonl");
const outputDir = path.resolve(packageRoot, ".logs/exports");
const outputFile = path.join(outputDir, `desktop-logs-${Date.now()}.jsonl`);

await mkdir(outputDir, { recursive: true });

try {
  await access(source, constants.F_OK);
} catch {
  await mkdir(path.dirname(source), { recursive: true });
  const bootstrapEntry = JSON.stringify({
    app: "desktop",
    level: "info",
    message: "bootstrap log entry",
    timestamp: new Date().toISOString()
  });
  await writeFile(source, `${bootstrapEntry}\n`, "utf8");
}

await copyFile(source, outputFile);
console.log(`desktop logs exported to ${outputFile}`);
