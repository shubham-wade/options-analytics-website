import type { Metadata } from "next";
import { ManualLab } from "@/components/manual/manual-lab";

export const metadata: Metadata = {
  title: "Manual book · NIFTY Risk Lab",
  description: "Price a hand-entered NIFTY option book without connecting to Zerodha.",
};

export default function ManualPage() {
  return <ManualLab />;
}
