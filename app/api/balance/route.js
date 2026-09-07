import { NextResponse } from "next/server";
import { listTopups, createTopup } from "@/lib/balance";

export async function GET() {
  try {
    const topups = await listTopups();
    return NextResponse.json({ topups });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load balance" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const amount = parseFloat(body.amount);
    const { note, date } = body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Enter an amount greater than 0" }, { status: 400 });
    }
    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }

    const topup = await createTopup({ amount, note: note || "", date });
    return NextResponse.json({ topup }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add money" }, { status: 500 });
  }
}
