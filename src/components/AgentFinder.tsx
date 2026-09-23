import { useState, useRef, useEffect } from "react"
import { effectiveStatus, type Agent } from "~/lib/agents"

interface AgentFinderProps {
  agents: readonly Agent[]
  value: string | null
  onChange: (agentId: string | null) => void
  placeholder?: string
}

export function AgentFinder({ agents, value, onChange, placeholder = "Find an agent..." }: AgentFinderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = value !== null ? agents.find((agent) => agent.id === value) ?? null : null

  const filtered = query.trim()
    ? agents.filter((agent) => agent.name.toLowerCase().includes(query.toLowerCase()))
    : agents

  useEffect(() => {
    setHighlightedIdx(0)
  }, [query])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  const handleSelect = (agentId: string) => {
    onChange(agentId)
    setQuery("")
    setIsOpen(false)
    inputRef.current?.blur()
  }

  const handleClear = () => {
    onChange(null)
    setQuery("")
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIdx((i) => (i + 1) % filtered.length)
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIdx((i) => (i - 1 + filtered.length) % filtered.length)
        break
      case "Enter":
        e.preventDefault()
        if (filtered[highlightedIdx]) {
          handleSelect(filtered[highlightedIdx]!.id)
        }
        break
      case "Escape":
        setIsOpen(false)
        inputRef.current?.blur()
        break
    }
  }

  const displayValue = selected && !isOpen ? selected.name : query

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: `2px solid ${isOpen ? "var(--color-neon)" : "var(--color-blue)"}`,
          background: "var(--color-ink)",
          boxShadow: isOpen ? "0 0 12px var(--color-neon)" : "4px 4px 0 #000",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
            if (selected) onChange(null)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            padding: "10px 14px",
            fontFamily: "var(--font-body)",
            fontSize: 18,
            color: "var(--color-neon)",
            minWidth: 0,
          }}
        />
        {selected && (
          <button
            onClick={handleClear}
            style={{
              padding: "8px 12px",
              background: "transparent",
              border: "none",
              borderLeft: "2px solid var(--color-blue)",
              color: "var(--color-danger)",
              fontFamily: "var(--font-display)",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            maxHeight: 240,
            overflowY: "auto",
            border: "2px solid var(--color-neon)",
            background: "#000",
            boxShadow: "4px 4px 0 #000",
            zIndex: 100,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "12px 14px",
                fontFamily: "var(--font-body)",
                fontSize: 16,
                color: "#5D6699",
              }}
            >
              No agents found
            </div>
          ) : (
            filtered.map((agent, idx) => {
              const isHighlighted = idx === highlightedIdx
              return (
                <button
                  key={agent.id}
                  onClick={() => handleSelect(agent.id)}
                  onMouseEnter={() => setHighlightedIdx(idx)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    borderLeft: `3px solid ${isHighlighted ? "var(--color-neon)" : "transparent"}`,
                    background: isHighlighted ? "var(--color-card)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 18,
                      color: isHighlighted ? "#FFF" : "#A0B8FF",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {agent.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 8,
                      color: "#5D6699",
                      letterSpacing: "0.06em",
                      flexShrink: 0,
                    }}
                  >
                    {effectiveStatus(agent, agents).toUpperCase()}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
