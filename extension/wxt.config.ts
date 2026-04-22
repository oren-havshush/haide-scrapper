import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

const API_URL = process.env.VITE_API_URL || "http://127.0.0.1:3000";

// Build a host_permissions entry for the configured API URL at build time
function apiHostPermission(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return "http://127.0.0.1:3000/*";
  }
}

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
      apiHostPermission(API_URL),
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
