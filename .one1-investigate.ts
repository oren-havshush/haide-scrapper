import dotenv from "dotenv";
dotenv.config({ path: ".env.worker" });

async function main() {
  const { prisma } = await import("./src/lib/prisma");

  const sites = await prisma.site.findMany({
    where: { siteUrl: { contains: "one1", mode: "insensitive" } },
    select: {
      id: true,
      siteUrl: true,
      status: true,
      createdAt: true,
      activeAt: true,
      fieldMappings: true,
      pageFlow: true,
    },
  });

  console.log("=== SITES ===");
  console.log(
    JSON.stringify(
      sites.map((s) => ({
        id: s.id,
        siteUrl: s.siteUrl,
        status: s.status,
        createdAt: s.createdAt,
        activeAt: s.activeAt,
      })),
      null,
      2,
    ),
  );

  for (const s of sites) {
    const run = await prisma.scrapeRun.findFirst({
      where: { siteId: s.id },
      orderBy: { createdAt: "desc" },
    });
    console.log("\n=== LATEST SCRAPE RUN ===", s.siteUrl);
    console.log(JSON.stringify(run, null, 2));

    const wj = await prisma.workerJob.findFirst({
      where: { siteId: s.id, type: "SCRAPE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        error: true,
        result: true,
        payload: true,
        createdAt: true,
        completedAt: true,
      },
    });
    console.log("\n=== LATEST WORKER JOB ===");
    console.log(JSON.stringify(wj, null, 2));

    if (!run) continue;

    const jobs = await prisma.job.findMany({
      where: { siteId: s.id, scrapeRunId: run.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        description: true,
        requirements: true,
        location: true,
        department: true,
        externalJobId: true,
        validationStatus: true,
        rawData: true,
      },
    });

    const total = await prisma.job.count({
      where: { siteId: s.id, scrapeRunId: run.id },
    });
    const emptyDesc = await prisma.job.count({
      where: {
        siteId: s.id,
        scrapeRunId: run.id,
        OR: [{ description: null }, { description: "" }],
      },
    });
    const unknownLoc = await prisma.job.count({
      where: {
        siteId: s.id,
        scrapeRunId: run.id,
        location: "Unknown",
      },
    });
    const emptyReq = await prisma.job.count({
      where: {
        siteId: s.id,
        scrapeRunId: run.id,
        OR: [{ requirements: null }, { requirements: "" }],
      },
    });

    console.log("\n=== JOB COUNTS ===");
    console.log({ total, emptyDesc, unknownLoc, emptyReq });

    console.log("\n=== SAMPLE JOBS (debug slice) ===");
    for (const j of jobs) {
      const raw = (j.rawData ?? {}) as Record<string, string>;
      console.log(
        JSON.stringify(
          {
            title: j.title,
            descriptionLen: j.description?.length ?? 0,
            requirementsLen: j.requirements?.length ?? 0,
            location: j.location,
            validationStatus: j.validationStatus,
            raw_descriptionLen: raw.description?.length ?? 0,
            raw_requirementsLen: raw.requirements?.length ?? 0,
            raw_location: raw.location ?? null,
            _debugDescription: raw._debugDescription ?? null,
            _detailNavStatus: raw._detailNavStatus ?? null,
            _cssRejected_description: raw._cssRejected_description ?? null,
            _enrichedFromDescription_location:
              raw._enrichedFromDescription_location ?? null,
            _enrichedFromDescription_requirements:
              raw._enrichedFromDescription_requirements ?? null,
            _detailUrl: raw._detailUrl ?? null,
          },
          null,
          2,
        ),
      );
    }

    const fm = s.fieldMappings as Record<string, unknown> | null;
    const meta = fm?._meta as Record<string, unknown> | undefined;
    const pageFlow = s.pageFlow;
    console.log("\n=== CONFIG SUMMARY ===");
    if (fm) {
      const fields = [
        "title",
        "description",
        "requirements",
        "location",
        "department",
        "externalJobId",
      ];
      const fieldSummary: Record<string, unknown> = {};
      for (const f of fields) {
        const entry = fm[f] as Record<string, unknown> | undefined;
        if (entry) {
          fieldSummary[f] = {
            selector: entry.selector,
            extractAttr: entry.extractAttr ?? null,
            capturedOnUrl: entry.capturedOnUrl ?? null,
            sampleLen:
              typeof entry.sample === "string" ? entry.sample.length : null,
          };
        }
      }
      console.log("fieldMappings:", JSON.stringify(fieldSummary, null, 2));
      console.log("_meta:", JSON.stringify(meta ?? null, null, 2));
    }
    console.log("pageFlow:", JSON.stringify(pageFlow, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
