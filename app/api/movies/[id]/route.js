import { NextResponse } from "next/server";
import { deleteMovie, updateMovie } from "@/lib/movies";

export async function PUT(request, { params }) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await request.json();
    const ticketPrice = parseFloat(body.ticketPrice) || 0;
    const canteenPrice = parseFloat(body.canteenPrice) || 0;
    const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
    const { title, date, companions, myTake, publicTake, note, affectsBalance } = body;

    if (!title || !title.trim()) {
      return NextResponse.json({ error: "Movie title is required" }, { status: 400 });
    }
    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }
    if (ticketPrice < 0 || canteenPrice < 0) {
      return NextResponse.json({ error: "Prices can't be negative" }, { status: 400 });
    }

    const movie = await updateMovie(id, {
      title: title.trim(),
      date,
      ticketPrice,
      canteenPrice,
      companions: (companions || "").trim(),
      myTake,
      publicTake,
      note: (note || "").trim(),
      affectsBalance,
      quantity,
    });
    return NextResponse.json({ movie });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update movie" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await deleteMovie(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete movie" }, { status: 500 });
  }
}
