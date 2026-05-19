import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        padding: "32px",
        fontFamily: "Arial",
        backgroundColor: "#f4f0e8",
        minHeight: "100vh",
        display: "grid",
        alignItems: "center",
        gap: "32px",
      }}
    >
      <section style={{ maxWidth: "720px" }}>
        <p style={{ marginBottom: "12px", color: "#5f6f52", fontWeight: 700 }}>
          Poultry-first local storefronts
        </p>

        <h1 style={{ fontSize: "clamp(42px, 9vw, 72px)", lineHeight: 1 }}>
          FlipFlocks
        </h1>

        <p style={{ fontSize: "20px", marginTop: "20px", maxWidth: "560px" }}>
          Independent poultry storefronts for small farms and backyard flocks,
          organized around real hatch dates, availability dates, and local pickup.
        </p>

        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            marginTop: "28px",
          }}
        >
          <Link
            href="/store/demo"
            style={{
              color: "#ffffff",
              background: "#31422b",
              padding: "12px 18px",
              borderRadius: "6px",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            View a Storefront
          </Link>
          <Link
            href="/login"
            style={{
              color: "#31422b",
              border: "1px solid #31422b",
              padding: "12px 18px",
              borderRadius: "6px",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Seller Login
          </Link>
        </div>
      </section>

      <Image
        src="/Minorca.JPG"
        alt="Black Minorca chicken standing outdoors"
        width={1280}
        height={1280}
        priority
        style={{
          width: "min(100%, 520px)",
          height: "auto",
          borderRadius: "8px",
          objectFit: "cover",
        }}
      />
    </main>
  );
}
