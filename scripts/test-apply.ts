/**
 * test-apply.ts — one-off real application to a scraped job (email or form).
 *
 * Prerequisites:
 *   1. Run scripts/find-test-apply-jobs.ts and pick a jobId from the shortlist
 *   2. Copy scripts/test-apply-profile.example.json → .scratch/test-apply-profile.json
 *      and fill your real details + cvPath
 *   3. For --mode email, set SMTP_* env vars (see below)
 *
 * Usage:
 *   npx tsx scripts/test-apply.ts --job-id <id> --mode email [--dry-run]
 *   npx tsx scripts/test-apply.ts --job-id <id> --mode form [--dry-run] [--headed]
 *
 * SMTP env (email mode):
 *   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  SMTP_FROM
 */
import * as fs from "fs";
import * as path from "path";
import type { ApplyCandidate } from "./find-test-apply-jobs";

const BASE = "https://scrapper.haide-jobs.co.il";
const CANDIDATES_PATH = path.resolve(".scratch/test-apply-candidates.json");
const PROFILE_PATH = path.resolve(".scratch/test-apply-profile.json");
const RESULTS_PATH = path.resolve(".scratch/test-apply-results.json");

type Profile = {
  fullName: string;
  email: string;
  phone: string;
  location?: string;
  cvPath: string;
  coverNote?: string;
  extraFields?: Record<string, string>;
};

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

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Escape a value for use inside a CSS attribute selector "..." */
function cssAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function token(): string {
  const t = fs
    .readFileSync(path.resolve(".claude", "scrap-token"), "utf8")
    .replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME"))
    throw new Error(".claude/scrap-token missing/placeholder");
  return t;
}

function loadProfile(): Profile {
  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error(
      `Missing ${PROFILE_PATH}\nCopy scripts/test-apply-profile.example.json and fill real details.`,
    );
  }
  const p = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8")) as Profile;
  if (!p.fullName || p.fullName.includes("Your Full")) {
    throw new Error("Fill fullName in .scratch/test-apply-profile.json");
  }
  if (!p.email || p.email.includes("example.com")) {
    throw new Error("Fill email in .scratch/test-apply-profile.json");
  }
  if (!p.phone) throw new Error("Fill phone in .scratch/test-apply-profile.json");
  const cv = path.resolve(p.cvPath);
  if (!fs.existsSync(cv)) {
    throw new Error(`CV not found at ${cv} (cvPath in profile)`);
  }
  p.cvPath = cv;
  return p;
}

function loadCandidate(jobId: string): ApplyCandidate {
  if (!fs.existsSync(CANDIDATES_PATH)) {
    throw new Error(
      `Missing ${CANDIDATES_PATH} — run: npx tsx scripts/find-test-apply-jobs.ts`,
    );
  }
  const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8")) as {
    email: ApplyCandidate[];
    form: ApplyCandidate[];
  };
  const all = [...(data.email || []), ...(data.form || [])];
  const hit = all.find((c) => c.jobId === jobId);
  if (!hit) {
    throw new Error(
      `jobId ${jobId} not in candidates file. Re-run finder or pick an id from the shortlist.`,
    );
  }
  return hit;
}

function appendResult(entry: Record<string, unknown>) {
  let prev: unknown[] = [];
  if (fs.existsSync(RESULTS_PATH)) {
    try {
      prev = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
      if (!Array.isArray(prev)) prev = [];
    } catch {
      prev = [];
    }
  }
  prev.push({ ...entry, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(prev, null, 2), "utf8");
}

function pickFieldValue(
  field: { name: string; label: string; fieldType: string },
  profile: Profile,
): string | null {
  const key = `${field.name} ${field.label}`.toLowerCase();
  const type = field.fieldType.toLowerCase();
  const extra = profile.extraFields || {};

  if (field.name && extra[field.name] != null) return extra[field.name];
  if (type === "file") return null; // handled separately
  if (type === "hidden") return null;
  if (type === "email" || /email|מייל|אימייל|e-mail/.test(key)) return profile.email;
  if (type === "tel" || /phone|tel|נייד|טלפון|mobile/.test(key)) return profile.phone;
  // first/last before generic "name" — "firstname" contains the substring "fullname"
  if (/first.?name|שם פרטי|fname/.test(key))
    return profile.fullName.split(/\s+/)[0] || profile.fullName;
  if (/last.?name|שם משפחה|family|lname|surname/.test(key)) {
    const parts = profile.fullName.trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : profile.fullName;
  }
  if (/full.?name|שם מלא|fullname|fullname/.test(key)) return profile.fullName;
  if (/(^|\s)name(\s|$)|שם(?!\s*משפחה)/.test(key) && !/file|company|job|user/.test(key))
    return profile.fullName;
  if (/location|city|עיר|מיקום|address|כתובת/.test(key) && profile.location)
    return profile.location;
  if (/message|cover|הערות|הודעה|notes|comment|תיאור/.test(key) && profile.coverNote)
    return profile.coverNote;
  return null;
}

async function applyEmail(candidate: ApplyCandidate, profile: Profile, dryRun: boolean) {
  const to = candidate.applyEmail;
  if (!to) throw new Error("Candidate has no applyEmail");

  const subject = `Job application: ${candidate.title}`;
  const body = [
    profile.coverNote || "Please find my CV attached.",
    "",
    `Applicant: ${profile.fullName}`,
    `Email: ${profile.email}`,
    `Phone: ${profile.phone}`,
    "",
    `Position: ${candidate.title}`,
    `Site: ${candidate.siteUrl}`,
    candidate.detailUrl ? `Job URL: ${candidate.detailUrl}` : "",
    `Job id: ${candidate.jobId}`,
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    to,
    subject,
    body,
    attachment: profile.cvPath,
  };

  if (dryRun) {
    console.log("[dry-run] Would send email:");
    console.log(JSON.stringify(payload, null, 2));
    appendResult({ mode: "email", dryRun: true, jobId: candidate.jobId, payload });
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) {
    throw new Error(
      "SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM (or USER) are required for live email send",
    );
  }

  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new Error("nodemailer not installed — run: pnpm add nodemailer && pnpm add -D @types/nodemailer");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from,
    to,
    replyTo: profile.email,
    subject,
    text: body,
    attachments: [
      {
        filename: path.basename(profile.cvPath),
        path: profile.cvPath,
      },
    ],
  });

  console.log("[email] sent:", info.messageId, "→", to);
  appendResult({
    mode: "email",
    dryRun: false,
    jobId: candidate.jobId,
    to,
    messageId: info.messageId,
    response: info.response,
  });
}

async function applyForm(
  candidate: ApplyCandidate,
  profile: Profile,
  dryRun: boolean,
  headed: boolean,
) {
  if (!candidate.form) throw new Error("Candidate has no form schema");
  if (!candidate.detailUrl) {
    throw new Error("FORM apply needs detailUrl — pick another candidate");
  }

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("playwright unavailable");
  }

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("[form] opening", candidate.detailUrl);
    await page.goto(candidate.detailUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);

    const selector = candidate.form.formSelector;
    let formHandle = selector ? await page.$(selector) : null;
    if (!formHandle) {
      // Prefer a form that contains a file input
      const forms = await page.$$("form");
      for (const f of forms) {
        if (await f.$('input[type="file"]')) {
          formHandle = f;
          break;
        }
      }
      if (!formHandle && forms.length) formHandle = forms[0];
    }
    if (!formHandle) {
      throw new Error("No <form> found on detail page — may need a click to open modal");
    }

    const filled: string[] = [];
    const skipped: string[] = [];

    for (const field of candidate.form.fields) {
      const type = field.fieldType.toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") {
        skipped.push(`${field.name || field.label}:hidden`);
        continue;
      }

      if (type === "file") {
        const fileInput =
          (field.name &&
            (await formHandle.$(`input[type="file"][name="${cssAttr(field.name)}"]`))) ||
          (await formHandle.$('input[type="file"]'));
        if (!fileInput) {
          skipped.push(`${field.name || field.label}:file-missing`);
          continue;
        }
        await fileInput.setInputFiles(profile.cvPath);
        filled.push(`${field.name || field.label}:file`);
        continue;
      }

      const value = pickFieldValue(field, profile);
      if (value == null) {
        skipped.push(`${field.name || field.label}:unmapped`);
        continue;
      }

      const nameSel = field.name
        ? `input[name="${cssAttr(field.name)}"], textarea[name="${cssAttr(field.name)}"], select[name="${cssAttr(field.name)}"]`
        : null;

      let el = nameSel ? await formHandle.$(nameSel) : null;
      if (!el && type === "email") el = await formHandle.$('input[type="email"]');
      if (!el && type === "tel") el = await formHandle.$('input[type="tel"]');
      if (!el) {
        skipped.push(`${field.name || field.label}:not-in-dom`);
        continue;
      }

      const tag = await el.evaluate((n) => n.tagName.toLowerCase());
      if (tag === "select") {
        await el.selectOption({ label: value }).catch(async () => {
          await el!.selectOption({ value }).catch(() => undefined);
        });
      } else {
        await el.fill(value);
      }
      filled.push(`${field.name || field.label}=${value}`);
    }

    console.log("[form] filled:", filled.join(", ") || "(none)");
    if (skipped.length) console.log("[form] skipped:", skipped.join(", "));

    if (dryRun) {
      console.log("[dry-run] Stopping before submit");
      const screenshot = path.resolve(".scratch/test-apply-form-dryrun.png");
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log("[dry-run] screenshot:", screenshot);
      appendResult({
        mode: "form",
        dryRun: true,
        jobId: candidate.jobId,
        detailUrl: candidate.detailUrl,
        filled,
        skipped,
        screenshot,
      });
      return;
    }

    const submit =
      (await formHandle.$('button[type="submit"], input[type="submit"]')) ||
      (await formHandle.$("button"));
    if (!submit) throw new Error("No submit button found on form");

    const screenshot = path.resolve(".scratch/test-apply-form-result.png");
    let finalUrl = page.url();
    let bodyText = "";
    let submitNote = "clicked";

    try {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 })
          .catch(() => null),
        submit.click({ timeout: 10_000 }),
      ]);
    } catch (e) {
      submitNote = `click error: ${e instanceof Error ? e.message : String(e)}`;
      console.warn("[form]", submitNote);
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => null);
      await page.waitForTimeout(1500);
      finalUrl = page.url();
      bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 800);
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => null);
    } catch (e) {
      submitNote += `; post-submit: ${e instanceof Error ? e.message : String(e)}`;
    }

    const successHint =
      /תודה|success|נשלח|received|thank|התקבל|successfully|בהצלחה/i.test(bodyText) ||
      /thank|success|sent|complete/i.test(finalUrl);

    console.log("[form] finalUrl:", finalUrl);
    console.log("[form] successHint:", successHint);
    console.log("[form] body snippet:", bodyText.replace(/\s+/g, " ").slice(0, 240));
    console.log("[form] screenshot:", screenshot);

    appendResult({
      mode: "form",
      dryRun: false,
      jobId: candidate.jobId,
      detailUrl: candidate.detailUrl,
      finalUrl,
      bodySnippet: bodyText,
      filled,
      skipped,
      screenshot,
      submitNote,
      successHint,
    });
  } finally {
    await browser.close().catch(() => null);
  }
}

async function main() {
  const jobId = arg("job-id");
  const mode = (arg("mode") || "").toLowerCase();
  const dryRun = hasFlag("dry-run");
  const headed = hasFlag("headed");

  if (!jobId || (mode !== "email" && mode !== "form")) {
    console.error(
      "Usage: npx tsx scripts/test-apply.ts --job-id <id> --mode email|form [--dry-run] [--headed]",
    );
    process.exit(1);
  }

  const candidate = loadCandidate(jobId);
  if (candidate.kind.toLowerCase() !== mode && !(mode === "form" && candidate.form)) {
    console.warn(
      `[warn] candidate kind is ${candidate.kind} but --mode ${mode} was requested — continuing anyway`,
    );
  }

  const profile = loadProfile();
  console.log(`[test-apply] ${mode} job=${jobId} dryRun=${dryRun}`);
  console.log(`  title: ${candidate.title}`);
  console.log(`  site:  ${candidate.siteUrl}`);

  if (mode === "email") {
    if (!candidate.applyEmail) {
      // try extract from applicationInfo
      const m = String(candidate.applicationInfo || "").match(/[\w.+-]+@[\w.-]+\.\w+/);
      if (m) candidate.applyEmail = m[0];
    }
    await applyEmail(candidate, profile, dryRun);
  } else {
    await applyForm(candidate, profile, dryRun, headed);
  }

  console.log(`Results appended to ${RESULTS_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
