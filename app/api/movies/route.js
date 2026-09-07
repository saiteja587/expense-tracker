import { NextResponse } from "next/server";
import { listMovies, createMovie } from "@/lib/movies";

export async function GET() {
  try {
    const movies = await listMovies();
    return NextResponse.json({ movies });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load movies" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const ticketPrice = parseFloat(body.ticketPrice) || 0;
    const canteenPrice = parseFloat(body.canteenPrice) || 0;
    const { title, date, companions, myTake, publicTake, note } = body;

    if (!title || !title.trim()) {
      return NextResponse.json({ error: "Movie title is required" }, { status: 400 });
    }
    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }
    if (ticketPrice < 0 || canteenPrice < 0) {
      return NextResponse.json({ error: "Prices can't be negative" }, { status: 400 });
    }
    if (!myTake) {
      return NextResponse.json({ error: "Pick what you thought of it" }, { status: 400 });
    }
    if (!publicTake) {
      return NextResponse.json({ error: "Pick how the public received it" }, { status: 400 });
    }

    const movie = await createMovie({
      title: title.trim(),
      date,
      ticketPrice,
      canteenPrice,
      companions: (companions || "").trim(),
      myTake,
      publicTake,
      note: (note || "").trim(),
    });
    return NextResponse.json({ movie }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save movie" }, { status: 500 });
  }
}
