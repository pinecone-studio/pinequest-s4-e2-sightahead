"use client"

import { Logo } from "./Logo"

type DashboardHeaderProps = {
  query: string
  showEnglish: boolean
  onQueryChange: (value: string) => void
  onToggleEnglish: () => void
  onSubmit: () => void
  onBack: () => void
  onLogout?: () => void
}

export function DashboardHeader({
  query,
  showEnglish,
  onQueryChange,
  onToggleEnglish,
  onSubmit,
  onBack,
  onLogout,
}: DashboardHeaderProps) {
  return (
    <header
      style={{
        position: "relative",
        zIndex: 3,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "16px 38px",
        borderBottom: "1px solid rgba(128,144,118,0.14)",
      }}
    >
      <button
        type="button"
        onClick={onBack}
        title="Хайлт руу буцах"
        aria-label="Хайлт руу буцах"
        style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
      >
        <Logo />
      </button>
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div className="dashboard-search">
          <span className="dashboard-youtube-mark" aria-hidden="true">
            <svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true">
              <polygon points="0,0 9,5.5 0,11" fill="#F2ECD4" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit()
            }}
            placeholder="YouTube видео хайх эсвэл холбоос буулгах..."
            className="dashboard-search-input"
          />
          <button
            type="button"
            onClick={onSubmit}
            aria-label="Хайх"
            style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", display: "flex" }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5" stroke="#809076" strokeWidth="1.5" />
              <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="#809076" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <button
        onClick={onToggleEnglish}
        title="Англи хадмалыг асаах/унтраах"
        className={showEnglish ? "dashboard-language is-on" : "dashboard-language"}
      >
        {"EN -> MN"}
      </button>
      {onLogout && (
        <button
          onClick={onLogout}
          title="Гарах"
          aria-label="Гарах"
          className="dashboard-language"
        >
          Гарах
        </button>
      )}
    </header>
  )
}
