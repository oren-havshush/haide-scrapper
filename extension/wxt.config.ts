import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function detectMode(): string {
  const idx = process.argv.indexOf("--mode");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.NODE_ENV === "production") return "production";
  return "development";
}

function loadEnv(mode: string): Record<string, string> {
  const files = [`.env.${mode}`, ".env"];
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const file of files) {
    try {
      const content = readFileSync(resolve(__dirname, file), "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (env[key] !== undefined) continue;
        env[key] = rawValue.replace(/^['"]|['"]$/g, "").trim();
      }
    } catch {
      // File missing is fine
    }
  }
  return env;
}

function apiHostPermission(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return "http://127.0.0.1:3000/*";
  }
}

const mode = detectMode();
const env = loadEnv(mode);
const apiUrl = env.VITE_API_URL || "http://127.0.0.1:3000";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "scrapnew",
    description: "Review and correct field mappings on target sites",
    permissions: ["storage", "activeTab", "sidePanel", "tabs"],
    host_permissions: [
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
      apiHostPermission(apiUrl),
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
    },
  }),
});
