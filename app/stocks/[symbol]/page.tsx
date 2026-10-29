import { StockFileView } from "@/components/stocks/stock-file";

export const dynamic = "force-dynamic";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <StockFileView symbol={symbol.toUpperCase()} />;
}
