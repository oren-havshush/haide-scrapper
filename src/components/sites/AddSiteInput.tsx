"use client";

import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateSite } from "@/hooks/useSites";

const urlSchema = z.url();

export function AddSiteInput() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createSite = useCreateSite();

  const handleSubmit = () => {
    setError(null);

    const result = urlSchema.safeParse(url.trim());
    if (!result.success) {
      setError("Please enter a valid URL (e.g. https://example.co.il/jobs)");
      return;
    }

    createSite.mutate(result.data, {
      onSuccess: () => {
        setUrl("");
        toast.success("Site submitted. Analyzing...");
      },
      onError: (err: Error & { code?: string; status?: number }) => {
        if (err.code === "DUPLICATE_SITE" || err.status === 409) {
          toast.error("This site already exists");
        } else {
          toast.error(err.message ?? "Failed to create site");
        }
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="mb-6">
      <div className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://example.co.il/jobs"
          className="font-mono text-[13px] flex-1"
          disabled={createSite.isPending}
        />
        <Button
          onClick={handleSubmit}
          disabled={createSite.isPending || !url.trim()}
        >
          {createSite.isPending ? "Submitting..." : "Submit"}
        </Button>
      </div>
      {error && (
        <p className="text-xs mt-1" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}
    </div>
  );
}
