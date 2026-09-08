"use client";

import { useEffect, useState } from "react";

type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

export default function AgentPanel({
  projectId,
  apiProfileId,
}: {
  projectId: string;
  apiProfileId?: string | null;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "sending" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    if (!projectId || projectId.startsWith("demo-")) {
      setMessages([]);
      return;
    }

    setState("loading");
    fetch(`/api/agent?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load agent history");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setState("idle");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function sendMessage() {
    const message = draft.trim();
    if (!message || !projectId || state === "sending") return;

    const optimistic: AgentMessage = {
      id: `local-${crypto.randomUUID()}`,
      role: "user",
      content: message,
    };

    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setState("sending");

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, message, apiProfileId: apiProfileId || null }),
      });
      const data = await response.json();
      if (!response.ok || !data.assistant) throw new Error(data.error ?? "Agent request failed");
      setMessages((current) => [...current, data.assistant as AgentMessage]);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <aside className="panel agent-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Project-aware</span><h2>Agent</h2></div>
        <span className="agent-badge">Gemini 3.8 Flash</span>
      </div>

      <div className="chat-stream agent-chat-scroll">
        {!messages.length && state !== "loading" ? (
          <div className="message agent-message">
            <strong>Project agent ready.</strong>
            <p>I can read this project, inspect scenes/assets, create scenes, and save prompt revisions. Paid Veo generation still requires the Generate button.</p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role === "user" ? "user-message" : "agent-message"}`}>
            {message.content}
          </div>
        ))}

        {state === "loading" ? <div className="message agent-message">Loading project history…</div> : null}
        {state === "sending" ? <div className="message agent-message">Thinking…</div> : null}
        {state === "error" ? <div className="message agent-message">Agent request failed. You can retry the message.</div> : null}
      </div>

      <div className="agent-input">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Ask the project agent…"
          disabled={!projectId || state === "sending"}
        />
        <div>
          <span className="agent-safety-note">No paid generation without Generate</span>
          <button className="send-button" onClick={() => void sendMessage()} disabled={!draft.trim() || state === "sending"}>↑</button>
        </div>
      </div>

      <div className="relay-card">
        <span className="relay-icon">◆</span>
        <div><strong>Persistent memory</strong><small>Conversation history is stored with this project in PostgreSQL, not in the Google profile.</small></div>
      </div>
    </aside>
  );
}
