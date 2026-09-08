import { NextResponse } from "next/server";
import { getMeta, setMeta, listDays } from "@/lib/sugarChallenge";

export async function GET() {
  try {
    const meta = await getMeta();
    const days = await listDays();
    return NextResponse.json({ meta, days });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load challenge" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { startDate } = body;
    const lengthDays = parseInt(body.lengthDays, 10) || 41;

    if (!startDate) {
      return NextResponse.json({ error: "Pick a start date" }, { status: 400 });
    }
    if (lengthDays < 1 || lengthDays > 365) {
      return NextResponse.json({ error: "Length must be between 1 and 365 days" }, { status: 400 });
    }

    const meta = await setMeta(startDate, lengthDays);
    return NextResponse.json({ meta }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to start challenge" }, { status: 500 });
  }
}
