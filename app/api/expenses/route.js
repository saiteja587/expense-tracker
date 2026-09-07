import { NextResponse } from "next/server";
import { listExpenses, createExpense } from "@/lib/db";

export async function GET() {
  try {
    const expenses = await listExpenses();
    return NextResponse.json({ expenses });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load expenses" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const amount = parseFloat(body.amount);
    const { category, note, date } = body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 });
    }
    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }

    const expense = await createExpense({ amount, category, note, date });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
