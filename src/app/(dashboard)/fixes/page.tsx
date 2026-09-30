"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FixQueueTable } from "@/components/fixes/FixQueueTable";
import { LogFixDialog } from "@/components/fixes/LogFixDialog";
import { useCreateFixItem, useFixQueue, useUpdateFixItem } from "@/hooks/useFixQueue";

/**
 * The fix queue (addsite2 phase two, step 1a): every open post-ACTIVE fix, by
 * site then field, with each site's 14-day score. The nightly email shows the
 * ten sites with the most open items; this page shows them all.
 */
export default function FixesPage() {
  const { data, isLoading } = useFixQueue({ open: true });
  const create = useCreateFixItem();
  const update = useUpdateFixItem();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold" style={{ color: "#fafafa" }}>
          Fix Queue {data ? `(${data.meta.total})` : ""}
        </h2>
        <Button onClick={() => { create.reset(); setDialogOpen(true); }}>Log fix</Button>
      </div>
      <FixQueueTable
        items={data?.data ?? []}
        scores={data?.meta.scores ?? []}
        isLoading={isLoading}
        resolvingId={resolvingId}
        onResolve={(id) => {
          setResolvingId(id);
          update.mutate({ id, resolved: true }, { onSettled: () => setResolvingId(null) });
        }}
      />
      <LogFixDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        isSaving={create.isPending}
        error={create.error ? create.error.message : null}
        onSave={(body) => create.mutate(body, { onSuccess: () => setDialogOpen(false) })}
      />
    </div>
  );
}
