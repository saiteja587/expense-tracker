import { NextResponse } from "next/server";
import { deleteExpense, updateExpense } from "@/lib/db";

export async function PUT(request, { params }) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await request.json();
    const amount = parseFloat(body.amount);
    const { category, note, date, affectsBalance } = body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 });
    }
    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }

    const expense = await updateExpense(id, { amount, category, note, date, affectsBalance });
    return NextResponse.json({ expense });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update expense" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await deleteExpense(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete expense" }, { status: 500 });
  }
}
