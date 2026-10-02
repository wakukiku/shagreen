import fs from "node:fs/promises";
import { build } from "esbuild";
await fs.mkdir("dist", { recursive: true });
await fs.cp("public", "dist", { recursive: true });
await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outdir: "dist",
  entryNames: "app",
  sourcemap: true,
});
console.log("Built ШАГРЕНЬ");
