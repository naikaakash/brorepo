import { access, copyFile, cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = new URL("../api/", import.meta.url);
const target = new URL("../.deploy/api/", import.meta.url);
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this script with npm run package:api.");
await access(new URL("dist/functions/calculate.js", source));

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of ["host.json", "package.json", "package-lock.json"]) {
  await copyFile(new URL(file, source), new URL(file, target));
}
await cp(new URL("dist/", source), new URL("dist/", target), { recursive: true });

const install = spawnSync(process.execPath, [
  npm, "ci", "--prefix", fileURLToPath(target), "--workspaces=false",
  "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"
], { stdio: "inherit" });
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);
