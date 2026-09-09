"use client";

import { FormEvent, useState } from "react";
import styles from "./login.module.css";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || state === "submitting") return;

    setState("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Login failed.");
      window.location.assign("/");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Login failed.");
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>Access password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
      </label>
      <button type="submit" disabled={!password || state === "submitting"}>
        {state === "submitting" ? "Opening studio…" : "Open studio"}
      </button>
      {message && <div className={styles.error}>{message}</div>}
    </form>
  );
}
