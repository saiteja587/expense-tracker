import { NextResponse } from "next/server";
import { listBudgetRules, upsertBudgetRule } from "@/lib/budget";

export async function GET() {
  try {
    const rules = await listBudgetRules();
    return NextResponse.json({ rules });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load money rules" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const amount = parseFloat(body.amount);
    const { ruleType, category } = body;

    if (!["overall", "category", "savings"].includes(ruleType)) {
      return NextResponse.json({ error: "Invalid rule type" }, { status: 400 });
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Enter an amount greater than 0" }, { status: 400 });
    }
    if (ruleType === "category" && !category) {
      return NextResponse.json({ error: "Pick a category" }, { status: 400 });
    }

    const rule = await upsertBudgetRule({ ruleType, category, amount });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save rule" }, { status: 500 });
  }
}
