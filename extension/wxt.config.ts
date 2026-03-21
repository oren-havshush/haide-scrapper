import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "scrapnew",
    description: "Review and correct field mappings on target sites",
    permissions: ["storage", "activeTab", "sidePanel"],
    host_permissions: [
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
      "https://ec2-16-16-218-228.eu-north-1.compute.amazonaws.com/*",
      "https://*.compute.amazonaws.com/*",
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
