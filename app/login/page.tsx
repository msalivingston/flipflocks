"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMessage("Signing in...");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Signed in successfully.");
    window.location.href = "/dashboard";
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "420px" }}>
      <h1>Seller Login</h1>

      <form onSubmit={handleLogin}>
        <label>Email</label>
        <input
          style={{ display: "block", width: "100%", marginBottom: "1rem" }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
        />

        <label>Password</label>
        <input
          style={{ display: "block", width: "100%", marginBottom: "1rem" }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
        />

        <button type="submit">Log In</button>
      </form>

      {message && <p>{message}</p>}
    </main>
  );
}