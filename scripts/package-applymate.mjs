import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".deploy", "applymate");
await mkdir(output, { recursive: true });
const server = JSON.parse(await readFile(join(root, "applymate", "server", "package.json"), "utf8"));
const manifest = {
  name: "applymate-private-pilot", private: true, version: "0.1.0", type: "module",
  engines: { node: "^22.12.0 || ^24.0.0" },
  scripts: { start: "node applymate/server/dist/index.js" },
  dependencies: { ...server.dependencies, "@applymate/contracts": "file:applymate/contracts" }
};
const manifestText = JSON.stringify(manifest, null, 2) + "\n";
let previous = "";
try { previous = await readFile(join(output, "package.json"), "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await writeFile(join(output, "package.json"), manifestText);
for (const workspace of ["contracts", "server", "client"]) {
  const source = join(root, "applymate", workspace);
  const target = join(output, "applymate", workspace);
  await mkdir(target, { recursive: true });
  await rm(join(target, "dist"), { recursive: true, force: true });
  await cp(join(source, "dist"), join(target, "dist"), {
    recursive: true,
    filter: (path) => !/(?:fixtures|test-server|.*\.test)\.(?:js|ts|mjs)$/.test(path)
  });
  if (workspace === "contracts") await cp(join(source, "package.json"), join(target, "package.json"));
}
await cp(join(root, "applymate", "Dockerfile"), join(output, "Dockerfile"));
let needsLock = previous !== manifestText;
try { await readFile(join(output, "package-lock.json")); }
catch (error) { if (error.code !== "ENOENT") throw error; needsLock = true; }
if (needsLock) execFileSync(process.platform === "win32" ? "npm.cmd" : "npm",
  ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: output, stdio: "inherit", shell: process.platform === "win32" });
console.log("Packaged only built ApplyMate assets and production manifests in .deploy/applymate.");
