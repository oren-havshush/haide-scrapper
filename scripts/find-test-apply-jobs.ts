/**
 * find-test-apply-jobs.ts — shortlist EMAIL vs FORM apply jobs from prod.
 *
 * Read-only. Writes .scratch/test-apply-candidates.json for test-apply.ts.
 *
 * Usage:
 *   npx tsx scripts/find-test-apply-jobs.ts [--sample 6] [--per-type 5] [--out .scratch/test-apply-candidates.json]
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";

function arg(name: string, def?: string): string | undefined {
  const pre = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === pre)
      return process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
        ? process.argv[i + 1]
        : "true";
    if (a.startsWith(pre + "=")) return a.slice(pre.length + 1);
  }
  return def;
}

function token(): string {
  const t = fs
    .readFileSync(path.resolve(".claude", "scrap-token"), "utf8")
    .replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME"))
    throw new Error(".claude/scrap-token missing/placeholder");
  return t;
}

type FormField = {
  name: string;
  label: string;
  fieldType: string;
  required: boolean;
  tagName: string;
};

type FormSchema = {
  formSelector?: string;
  actionUrl?: string;
  method?: string;
  fields: FormField[];
};

export type ApplyCandidate = {
  kind: "EMAIL" | "FORM";
  score: number;
  jobId: string;
  siteId: string;
  siteUrl: string;
  title: string;
  detailUrl: string | null;
  applicationInfo: string | null;
  applyEmail?: string;
  form?: FormSchema;
  formSource?: "job._formData" | "job.applicationInfo" | "site.formCapture";
  reasons: string[];
};

function parseFormSchema(v: unknown): FormSchema | null {
  let obj: unknown = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s.startsWith("{")) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.fields) || o.fields.length < 2) return null;
  const fields = o.fields
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      name: String(f.name ?? ""),
      label: String(f.label ?? ""),
      fieldType: String(f.fieldType ?? "text"),
      required: Boolean(f.required),
      tagName: String(f.tagName ?? "input"),
    }));
  if (fields.length < 2) return null;
  return {
    formSelector: typeof o.formSelector === "string" ? o.formSelector : undefined,
    actionUrl: typeof o.actionUrl === "string" ? o.actionUrl : undefined,
    method: typeof o.method === "string" ? o.method : undefined,
    fields,
  };
}

function extractEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.startsWith("{")) return null; // form JSON
  const mailto = s.match(/mailto:([^\s?&,;"']+)/i);
  if (mailto) return decodeURIComponent(mailto[1]).trim();
  const m = s.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0] : null;
}

function formScore(form: FormSchema, hasDetailUrl: boolean): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 40;
  const types = new Set(form.fields.map((f) => f.fieldType.toLowerCase()));
  const names = form.fields.map((f) => `${f.name} ${f.label}`.toLowerCase());

  if (types.has("file")) {
    score += 25;
    reasons.push("has file/CV field");
  } else {
    score -= 15;
    reasons.push("no file field");
  }
  if (names.some((n) => /email|מייל|אימייל/.test(n))) {
    score += 10;
    reasons.push("has email field");
  }
  if (names.some((n) => /phone|tel|טלפון/.test(n))) {
    score += 8;
    reasons.push("has phone field");
  }
  if (names.some((n) => /name|שם/.test(n))) {
    score += 8;
    reasons.push("has name field");
  }
  if (form.actionUrl && /^https?:\/\//i.test(form.actionUrl)) {
    score += 10;
    reasons.push("has actionUrl");
  }
  if (hasDetailUrl) {
    score += 10;
    reasons.push("has detailUrl");
  } else {
    score -= 20;
    reasons.push("missing detailUrl");
  }
  if (form.fields.length >= 3 && form.fields.length <= 12) {
    score += 5;
    reasons.push(`compact form (${form.fields.length} fields)`);
  } else if (form.fields.length > 20) {
    score -= 10;
    reasons.push(`large form (${form.fields.length} fields)`);
  }
  return { score, reasons };
}

function emailScore(email: string, hasDetailUrl: boolean): { score: number; reasons: string[] } {
  const reasons: string[] = [`email ${email}`];
  let score = 50;
  if (/careers|jobs|hr|recruit|cv|resume|hire|מועמד|דרושים/i.test(email)) {
    score += 15;
    reasons.push("HR-style address");
  }
  if (hasDetailUrl) {
    score += 10;
    reasons.push("has detailUrl");
  }
  if (/noreply|no-reply|donotreply/i.test(email)) {
    score -= 30;
    reasons.push("noreply address");
  }
  return { score, reasons };
}

async function fetchAllActiveSites(
  headers: Record<string, string>,
): Promise<Array<{ id: string; siteUrl: string; status: string }>> {
  const PAGE_SIZE = 100;
  let page = 1;
  let total = Infinity;
  const sites: Array<{ id: string; siteUrl: string; status: string }> = [];
  while (sites.length < total) {
    const r = await fetch(`${BASE}/api/sites?pageSize=${PAGE_SIZE}&page=${page}`, {
      headers,
    });
    if (!r.ok) throw new Error(`GET /api/sites page ${page} → ${r.status}`);
    const j: any = await r.json();
    const data: any[] = j.data || [];
    if (j.meta && typeof j.meta.total === "number") total = j.meta.total;
    if (!data.length) break;
    for (const s of data) {
      if (s.status === "ACTIVE") {
        sites.push({ id: s.id, siteUrl: s.siteUrl || "", status: s.status });
      }
    }
    process.stderr.write(`\r[find] sites ${sites.length} ACTIVE (scanned page ${page})...`);
    page++;
    if (page > 100) break;
  }
  process.stderr.write("\n");
  return sites;
}

async function main() {
  const sample = parseInt(arg("sample", "6")!, 10);
  const perType = parseInt(arg("per-type", "5")!, 10);
  const outPath = path.resolve(arg("out", ".scratch/test-apply-candidates.json")!);
  const headers = {
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
  };

  const sites = await fetchAllActiveSites(headers);
  console.error(`[find] auditing ${sites.length} ACTIVE sites (sample=${sample})...`);

  const emailHits: ApplyCandidate[] = [];
  const formHits: ApplyCandidate[] = [];

  let done = 0;
  for (const site of sites) {
    done++;
    process.stderr.write(`\r[find] ${done}/${sites.length} ${site.siteUrl.slice(0, 40)}...        `);

    let formCapture: FormSchema | null = null;
    let applyRequiresLogin = false;
    try {
      const cr = await fetch(`${BASE}/api/sites/${encodeURIComponent(site.id)}/config`, {
        headers,
      });
      const cj: any = await cr.json();
      const cfg = cj.data || cj || {};
      const meta = cfg.fieldMappings?._meta || {};
      applyRequiresLogin = meta.applyRequiresLogin === true;
      formCapture = parseFormSchema(meta.formCapture ?? cfg.formCapture);
    } catch {
      /* ignore */
    }
    if (applyRequiresLogin) continue;

    const jr = await fetch(
      `${BASE}/api/jobs?siteId=${encodeURIComponent(site.id)}&pageSize=${sample}`,
      { headers },
    );
    if (!jr.ok) continue;
    const jj: any = await jr.json();
    const jobs: any[] = jj.data || [];

    for (const job of jobs) {
      const title = String(job.title || "").trim() || "(no title)";
      const detailUrl =
        (typeof job.detailUrl === "string" && job.detailUrl) ||
        (typeof job.rawData?.detailUrl === "string" && job.rawData.detailUrl) ||
        null;
      const applicationInfo =
        (typeof job.applicationInfo === "string" && job.applicationInfo) ||
        (typeof job.rawData?.applicationInfo === "string" && job.rawData.applicationInfo) ||
        null;

      const fromRaw = parseFormSchema(job.rawData?._formData);
      const fromApp = parseFormSchema(applicationInfo);
      const form = fromRaw || fromApp || formCapture;
      const formSource: ApplyCandidate["formSource"] | undefined = fromRaw
        ? "job._formData"
        : fromApp
          ? "job.applicationInfo"
          : formCapture
            ? "site.formCapture"
            : undefined;

      if (form) {
        const { score, reasons } = formScore(form, !!detailUrl);
        formHits.push({
          kind: "FORM",
          score,
          jobId: job.id,
          siteId: site.id,
          siteUrl: site.siteUrl,
          title,
          detailUrl,
          applicationInfo,
          form,
          formSource,
          reasons: [...reasons, `source=${formSource}`],
        });
        continue; // form wins over email for the same job
      }

      const email = extractEmail(applicationInfo);
      if (email) {
        const { score, reasons } = emailScore(email, !!detailUrl);
        emailHits.push({
          kind: "EMAIL",
          score,
          jobId: job.id,
          siteId: site.id,
          siteUrl: site.siteUrl,
          title,
          detailUrl,
          applicationInfo,
          applyEmail: email,
          reasons,
        });
      }
    }
  }
  process.stderr.write("\n");

  const dedupe = (list: ApplyCandidate[]) => {
    const seen = new Set<string>();
    const out: ApplyCandidate[] = [];
    for (const c of list.sort((a, b) => b.score - a.score)) {
      const key = `${c.siteId}|${c.kind === "EMAIL" ? c.applyEmail : c.formSource}`;
      // keep up to 1 per site for diversity, plus allow second if different job
      const siteKey = `${c.siteId}|${c.kind}`;
      if (seen.has(siteKey)) continue;
      seen.add(siteKey);
      out.push(c);
      if (out.length >= perType) break;
    }
    return out;
  };

  const emailTop = dedupe(emailHits);
  const formTop = dedupe(formHits);

  const payload = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    counts: {
      emailCandidates: emailHits.length,
      formCandidates: formHits.length,
      emailShortlist: emailTop.length,
      formShortlist: formTop.length,
    },
    email: emailTop,
    form: formTop,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  const printList = (label: string, list: ApplyCandidate[]) => {
    console.log(`\n=== ${label} (${list.length}) ===`);
    for (const c of list) {
      console.log(`\n[${c.score}] ${c.title}`);
      console.log(`  jobId:   ${c.jobId}`);
      console.log(`  site:    ${c.siteUrl}`);
      console.log(`  detail:  ${c.detailUrl || "(none)"}`);
      if (c.kind === "EMAIL") {
        console.log(`  email:   ${c.applyEmail}`);
      } else if (c.form) {
        console.log(
          `  form:    ${c.form.method || "?"} ${c.form.actionUrl || "(no action)"} (${c.form.fields.length} fields, ${c.formSource})`,
        );
        console.log(
          `  fields:  ${c.form.fields.map((f) => `${f.name || f.label}:${f.fieldType}`).join(", ")}`,
        );
      }
      console.log(`  why:     ${c.reasons.join("; ")}`);
    }
  };

  printList("EMAIL shortlist", emailTop);
  printList("FORM shortlist", formTop);
  console.log(`\nWrote ${outPath}`);
  console.log(
    "Pick one email + one form jobId, then run:\n  npx tsx scripts/test-apply.ts --job-id <id> --mode email|form --dry-run",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
