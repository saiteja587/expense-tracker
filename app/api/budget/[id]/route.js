import { NextResponse } from "next/server";
import { deleteBudgetRule } from "@/lib/budget";

export async function DELETE(request, { params }) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await deleteBudgetRule(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
