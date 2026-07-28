type MobileLiveBirdsArtworkName = "hen" | "price" | "ready" | "nest";

const artworkPosition: Record<MobileLiveBirdsArtworkName, string> = {
  hen: "35.5% 25%",
  price: "6% 72.5%",
  ready: "35% 72.5%",
  nest: "88% 52%",
};

export function MobileLiveBirdsArtwork({
  className = "",
  name,
}: {
  className?: string;
  name: MobileLiveBirdsArtworkName;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 overflow-hidden bg-white bg-no-repeat mix-blend-multiply ${className}`}
      style={{
        backgroundImage: "url('/illustrations/live-birds-mobile-artwork.png')",
        backgroundPosition: artworkPosition[name],
        backgroundSize: name === "nest" ? "235% auto" : "510% auto",
      }}
    />
  );
}
