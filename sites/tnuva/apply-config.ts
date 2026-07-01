import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";
const SITE_ID = "cmqyh9j7k002n01nzpb7145ri";
const TOKEN = fs
  .readFileSync(path.resolve(".claude", "scrap-token"), "utf8")
  .trim();

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json; charset=utf-8",
};

async function api(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${urlPath}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const base = JSON.parse(
    fs.readFileSync(path.resolve("sites/tnuva/config-base.json"), "utf8"),
  );
  const setupScript = fs.readFileSync(
    path.resolve("sites/tnuva/setup-script.js"),
    "utf8",
  );
  const payload = { ...base, setupScript };
  console.log("setupScript length:", setupScript.length);

  const put = await api("PUT", `/api/sites/${SITE_ID}/config`, payload);
  console.log("PUT status:", put.data?.status ?? put);

  const run = await api("POST", `/api/sites/${SITE_ID}/scrape`);
  console.log("scrape runId:", run.data.id);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const s = await api("GET", `/api/sites/${SITE_ID}/scrape`);
    console.log(`tick ${i} status=${s.data.status} jobs=${s.data.jobCount}`);
    if (["COMPLETED", "FAILED", "PARTIAL"].includes(s.data.status)) break;
  }

  const jobs = await api(
    "GET",
    `/api/jobs?siteId=${SITE_ID}&pageSize=100`,
  );
  console.log("total jobs:", jobs.meta.total);
  const sample = jobs.data.find((j: { title: string }) =>
    j.title.includes("רכש"),
  );
  if (sample) {
    console.log("sample:", sample.title, "| location:", sample.location);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
