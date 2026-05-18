export default function Home() {
  return (
    <main
      style={{
        padding: "60px",
        fontFamily: "Arial",
        backgroundColor: "#d9ead3",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "48px" }}>
        FlipFlocks
      </h1>

      <p style={{ fontSize: "20px" }}>
        Poultry listings that don’t suck.
      </p>
      <p>Built for small farms and backyard flocks.</p>
      <button>Browse Listings</button>
      <img
  src="/minorca.jpg"
  alt="Chicken"
  style={{ width: "400px", marginTop: "20px" }}
/>
    </main>
  );
}
