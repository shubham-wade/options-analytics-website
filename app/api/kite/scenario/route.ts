import { NextResponse } from "next/server";
import { portfolioForRequest } from "@/lib/kite/guard";
import { valueSnapshot } from "@/lib/kite/portfolio";
import { DEFAULT_DIVIDEND_YIELD, DEFAULT_RISK_FREE_RATE, DEFAULT_SPOT_MOVES } from "@/lib/time";
import { ScenarioInputError, type IvMode } from "@/lib/scenario/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScenarioBody {
  includeFlat: boolean;
  spot: number | null;
  moves: number[];
  horizonDays: number;
  ivMode: IvMode;
  ivPoints: number;
  rate: number;
  dividendYield: number;
}

function readBody(body: unknown): ScenarioBody {
  if (!body || typeof body !== "object") throw new ScenarioInputError("Scenario body must be an object.");
  const record = body as Record<string, unknown>;
  const ivMode = record.ivMode;
  if (ivMode !== "constant" && ivMode !== "up" && ivMode !== "down") {
    throw new ScenarioInputError("IV mode must be constant, up or down.");
  }
  if (!Array.isArray(record.moves) || record.moves.some((move) => typeof move !== "number" || !Number.isFinite(move))) {
    throw new ScenarioInputError("Moves must be an array of finite numbers.");
  }
  const spotValue = record.spot;
  const spot =
    spotValue === null || spotValue === undefined || spotValue === ""
      ? null
      : typeof spotValue === "number"
        ? spotValue
        : Number.NaN;
  if (spot !== null && !Number.isFinite(spot)) throw new ScenarioInputError("Starting spot must be a number.");
  return {
    includeFlat: record.includeFlat === true,
    spot,
    moves: record.moves.length > 0 ? (record.moves as number[]) : [...DEFAULT_SPOT_MOVES],
    horizonDays: Number(record.horizonDays ?? 0),
    ivMode,
    ivPoints: Number(record.ivPoints ?? 0),
    rate: Number(record.rate ?? DEFAULT_RISK_FREE_RATE),
    dividendYield: Number(record.dividendYield ?? DEFAULT_DIVIDEND_YIELD),
  };
}

export async function POST(request: Request) {
  let body: ScenarioBody;
  try {
    body = readBody(await request.json());
  } catch (error) {
    const message = error instanceof ScenarioInputError ? error.message : "Scenario request could not be read.";
    return NextResponse.json({ error: message, code: "BAD_REQUEST" }, { status: 400 });
  }

  const result = await portfolioForRequest(request, body.includeFlat);
  if ("response" in result) return result.response;

  try {
    const scenario = valueSnapshot(result.snapshot, body);
    return NextResponse.json(scenario, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ScenarioInputError) {
      return NextResponse.json({ error: error.message, code: "BAD_REQUEST" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Scenario calculation failed.", code: "KITE_ERROR" },
      { status: 500 },
    );
  }
}
