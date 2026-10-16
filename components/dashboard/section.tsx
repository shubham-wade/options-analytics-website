"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function Section({
  title,
  defaultOpen = true,
  aside,
  children,
  contentClassName,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  aside?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
          <span className="text-sm font-medium">{title}</span>
        </button>
        {open ? aside : null}
      </CardHeader>
      {open ? <CardContent className={contentClassName}>{children}</CardContent> : null}
    </Card>
  );
}
