import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { marketBriefFrom } from "@/lib/report/brief";
import { latestReportDate } from "@/lib/report/sessions";
import type { MarketReport } from "@/lib/report/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const latest = latestReportDate(new Date());
  const file = await newestReport(latest);
  if (!file) return NextResponse.json({ brief: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    const report = JSON.parse(file) as MarketReport;
    return NextResponse.json({ brief: marketBriefFrom(report) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ brief: null }, { headers: { "Cache-Control": "no-store" } });
  }
}

async function newestReport(latest: string): Promise<string | null> {
  const dir = path.join(process.cwd(), "data", "reports");
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const dates = names
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((date): date is string => Boolean(date && date <= latest))
    .sort()
    .reverse();
  const chosen = dates.find((date) => date === latest) ?? dates[0];
  if (!chosen) return null;
  return readFile(path.join(dir, `${chosen}.json`), "utf8");
}
