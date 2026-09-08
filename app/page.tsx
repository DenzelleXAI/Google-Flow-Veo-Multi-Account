const projects = [
  { name: "Scar Day Cream", status: "Active" },
  { name: "Hair Growth Tonic", status: "Draft" },
  { name: "Age Defying Gel", status: "Draft" },
];

const generations = [
  { clip: "Approach 1 · Clip 1", status: "Completed", detail: "9:16 · Veo 3.1" },
  { clip: "Approach 1 · Clip 2", status: "Pending", detail: "Waiting for provider" },
  { clip: "Approach 2 · Clip 1", status: "Draft", detail: "Not generated" },
];

export default function Home() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">▶</div>
          <div>
            <h1>Persistent AI Video Studio</h1>
            <p>Your projects stay yours, even when the API profile changes.</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="ghost-button">Local media: Home PC</button>
          <button className="profile-button"><span className="status-dot" /> Google Profile A⌄</button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel sidebar">
          <div className="panel-heading">
            <div><span className="eyebrow">Workspace</span><h2>Projects</h2></div>
            <button className="icon-button">＋</button>
          </div>
          <div className="project-list">
            {projects.map((project, index) => (
              <button className={`project-card ${index === 0 ? "active" : ""}`} key={project.name}>
                <span className="project-icon">▣</span>
                <span><strong>{project.name}</strong><small>{project.status}</small></span>
              </button>
            ))}
          </div>
          <div className="storage-card">
            <div className="storage-top"><span>Local storage</span><strong>428 GB free</strong></div>
            <div className="meter"><span /></div>
            <small>D:\AI Video Studio</small>
          </div>
        </aside>

        <section className="panel canvas-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Scar Day Cream</span><h2>Approach 1 · Clip 2</h2></div>
            <span className="saved-pill">● Saved</span>
          </div>

          <div className="preview-card">
            <div className="preview-placeholder">
              <div className="play-ring">▶</div>
              <span>9:16 Preview</span>
            </div>
            <div className="reference-strip">
              <div className="reference-thumb">IMG</div>
              <div><strong>Reference image</strong><small>woman_a · verified locally</small></div>
              <button className="tiny-button">Replace</button>
            </div>
          </div>

          <div className="prompt-editor">
            <div className="field-label"><span>Video prompt</span><span>Prompt v3</span></div>
            <textarea defaultValue="Same Filipina woman from Clip 1, now standing outside a modest home while holding the exact Scar Day Cream product. Natural handheld testimonial framing, believable skin texture, warm daylight, realistic neighborhood background." />
            <div className="settings-row">
              <button className="setting-chip">Veo 3.1⌄</button>
              <button className="setting-chip">9:16⌄</button>
              <button className="setting-chip">8 sec⌄</button>
              <button className="setting-chip">1080p⌄</button>
              <button className="generate-button">▶ Generate</button>
            </div>
          </div>

          <div className="generations-block">
            <div className="section-title"><h3>Generation history</h3><button>View all</button></div>
            <div className="generation-list">
              {generations.map((item) => (
                <div className="generation-row" key={item.clip}>
                  <span className={`job-dot ${item.status.toLowerCase()}`} />
                  <div><strong>{item.clip}</strong><small>{item.detail}</small></div>
                  <span className={`job-status ${item.status.toLowerCase()}`}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="panel agent-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Project-aware</span><h2>Agent</h2></div>
            <span className="agent-badge">Gemini</span>
          </div>

          <div className="chat-stream">
            <div className="message user-message">Make Clip 2 using the same woman, but move her outside the house.</div>
            <div className="message agent-message">
              <strong>Ready.</strong>
              <p>I kept the selected woman_a reference and updated Scene 2 for an outdoor testimonial.</p>
              <div className="tool-list"><span>✓ Read project</span><span>✓ Loaded reference</span><span>✓ Saved prompt v3</span></div>
            </div>
          </div>

          <div className="agent-input">
            <textarea placeholder="Ask the project agent…" />
            <div><button className="tiny-button">＋ Asset</button><button className="send-button">↑</button></div>
          </div>

          <div className="relay-card">
            <span className="relay-icon">☁</span>
            <div><strong>Cloud relay ready</strong><small>R2 safely holds completed outputs until your target device verifies the local copy.</small></div>
          </div>
        </aside>
      </section>
    </main>
  );
}
