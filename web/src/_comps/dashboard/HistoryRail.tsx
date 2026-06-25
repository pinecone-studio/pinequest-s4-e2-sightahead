"use client"

import { type HistoryItem } from "./data"
import { HistoryCard } from "./HistoryCard"

type HistoryRailProps = {
  items: HistoryItem[]
  activeId: string
  onSelect: (item: HistoryItem) => void
}

export function HistoryRail({ items, activeId, onSelect }: HistoryRailProps) {
  return (
    <aside className="dashboard-history-rail">
      <div className="dashboard-section-label">
        <span>ҮЗСЭН ТҮҮХ</span>
        <span />
      </div>
      <div className="dashboard-history-list dashboard-scroll">
        {items.map((item) => (
          <HistoryCard key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  )
}
