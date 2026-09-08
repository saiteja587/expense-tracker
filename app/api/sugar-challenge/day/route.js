import { NextResponse } from "next/server";
import { upsertDay } from "@/lib/sugarChallenge";

export async function POST(request) {
  try {
    const body = await request.json();
    const { date, completed, note } = body;

    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }
    if (typeof completed !== "boolean") {
      return NextResponse.json({ error: "Completed must be true or false" }, { status: 400 });
    }

    const day = await upsertDay(date, completed, note || "");
    return NextResponse.json({ day }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save that day" }, { status: 500 });
  }
}
