"use client"

type NotesHeaderProps = {
  count: number
  mode: "write" | "review"
  onSetMode: (mode: "write" | "review") => void
  onOpenSummary: () => void
}

export function NotesHeader({ count, mode, onSetMode, onOpenSummary }: NotesHeaderProps) {
  const isWrite = mode === "write"

  return (
    <div style={{ flex: "none", padding: "22px 32px 0" }}>
      <div className="dashboard-notes-title-row">
        <div style={{ display: "flex", alignItems: "baseline", gap: 13 }}>
          <span className="dashboard-notes-title">Тэмдэглэл</span>
          <span className="dashboard-notes-count">{count} агшин</span>
        </div>
        <button onClick={onOpenSummary} className="dashboard-ask-button">
          <span aria-hidden="true" />
          Эрдэмтнээс асуух
        </button>
      </div>
      <div className="dashboard-notes-tabs">
        <button onClick={() => onSetMode("write")} className={isWrite ? "is-active" : ""}>
          Бичих
        </button>
        <button onClick={() => onSetMode("review")} className={!isWrite ? "is-active" : ""}>
          Эргэн харах
        </button>
      </div>
    </div>
  )
}
