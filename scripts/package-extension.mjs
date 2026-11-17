import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const extDir = path.join(rootDir, "apps", "extension");
const outZip = path.join(rootDir, "apps", "web", "public", "extension.zip");

if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${extDir}\\*' -DestinationPath '${outZip}' -Force`,
    ],
    { stdio: "inherit" }
  );
} else {
  execFileSync("zip", ["-r", "-FS", outZip, "."], { cwd: extDir, stdio: "inherit" });
}

console.log(`Packaged extension -> ${outZip}`);
