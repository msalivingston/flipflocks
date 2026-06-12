import Image from "next/image";

const glyphs = [
  "calendar.png",
  "camera.png",
  "cart.png",
  "chat.png",
  "checkmark.png",
  "chick.png",
  "chicken-leg.png",
  "clipboard.png",
  "customers.png",
  "duck.png",
  "egg-carton.png",
  "egg.png",
  "emu.png",
  "envelope.png",
  "farmhouse.png",
  "feed-sack.png",
  "goose.png",
  "heart.png",
  "hen.png",
  "incubator.png",
  "looking-glass.png",
  "map-pin.png",
  "pencil.png",
  "person.png",
  "pheasant.png",
  "phone.png",
  "quail.png",
  "rabbit.png",
  "reports.png",
  "rooster.png",
  "shield.png",
  "shopping-bag.png",
  "storefront.png",
  "trashcan.png",
  "truck.png",
  "turkey.png",
].sort();

export default function DevGlyphsPage() {
  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 sm:px-7">
          <p className="text-sm font-bold text-emerald-800">Development</p>
          <h1 className="text-3xl font-bold tracking-normal">Glyph Library</h1>
          <p className="max-w-2xl text-sm font-medium text-stone-600">
            Production glyphs from <code>/public/glyphs</code>.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-7">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {glyphs.map((glyph) => (
            <article
              className="rounded-md border border-stone-200 bg-white p-4 shadow-sm"
              key={glyph}
            >
              <div className="flex aspect-square items-center justify-center rounded bg-stone-100">
                <Image
                  alt=""
                  className="h-20 w-20 object-contain"
                  height={128}
                  src={`/glyphs/${glyph}`}
                  width={128}
                />
              </div>
              <p className="mt-3 break-words text-center text-xs font-bold text-stone-700">
                {glyph}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
