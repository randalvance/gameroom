import { useCallback, useEffect, useState } from "react"
import { SiteAudioControls } from "~/components/SiteAudio"
import type { TeamDTO } from "~/lib/event-types"
import type { GameRoomMenuData, GameRoomMenuPerson } from "~/lib/game-room-menu"
import { teamRosterFor } from "~/lib/game-room-menu"
import { teamColor } from "~/lib/team-colors"
import { GameRoomMenuSprite } from "./GameRoomMenuSprite"
import {
  cycleGraphicsPreference,
  graphicsPreferenceHint,
  graphicsPreferenceLabel,
  loadGraphicsPreference,
  saveGraphicsPreference,
  type GraphicsPreference,
} from "./quality-tier"

const ITEMS = ["Profile", "Team", "Options"] as const
type GameRoomMenuItem = (typeof ITEMS)[number]

const ROOM_CONTROL_KEYS = new Set([
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "w",
  "a",
  "s",
  "d",
  "e",
  " ",
  "+",
  "=",
  "-",
  "_",
  "0",
  "f",
])

export interface GameRoomMenuProps {
  data: GameRoomMenuData
  open: boolean
  onOpenChange: (open: boolean) => void
  touchControlsVisible?: boolean
  showTrigger?: boolean
  /** The roster, for showing a team that isn't yours. */
  teams?: TeamDTO[]
  /** A desk the player walked up to: the Team section shows THAT team, and
   * opening the menu lands on it. Null means your own team, as before. */
  focusTeamIdx?: number | null
  /**
   * Push a GRAPHICS change into the live scene. Optional so the menu can be
   * rendered (and tested) without a room behind it; the choice is stored
   * either way, so it survives to the next visit regardless.
   */
  onGraphicsChange?: (preference: GraphicsPreference) => void
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function ProfileSection({ person }: { person: GameRoomMenuPerson }) {
  const affiliation = person.role === "student"
    ? `TEAM: ${person.teamName ?? "UNASSIGNED"}`
    : `ROLE: ${person.role.toUpperCase()}`
  return (
    <div className="game-room-menu-profile">
      <div className="game-room-menu-profile-sprite"><GameRoomMenuSprite person={person} scale={3} /></div>
      <p className="game-room-menu-person-name">{person.name}</p>
      <p className="game-room-menu-person-id">USER ID: {person.id}</p>
      <p className="game-room-menu-person-affiliation">{affiliation}</p>
    </div>
  )
}

function TeamSection({
  data,
  teams = [],
  focusTeamIdx = null,
}: {
  data: GameRoomMenuData
  teams?: TeamDTO[]
  focusTeamIdx?: number | null
}) {
  // A desk in focus shows THAT team — everyone on it, the player included,
  // because you are looking at the team rather than at your colleagues.
  const focused = focusTeamIdx === null ? null : teams[focusTeamIdx] ?? null
  const members = focused ? teamRosterFor(teams, focusTeamIdx!) : data.peers

  return (
    <div className="game-room-menu-team">
      {focused && (
        <p className="game-room-menu-team-name">
          <span
            className="game-room-menu-team-swatch"
            style={{ background: teamColor(focused.name) }}
            data-testid="team-swatch"
          />
          {focused.name}
        </p>
      )}
      <TeamMembers members={members} emptyLabel={data.me.role === "mentor" ? "NO OTHER MENTORS FOUND" : "NO TEAMMATES FOUND"} />
    </div>
  )
}

function OptionsSection({
  graphics,
  onStep,
}: {
  graphics: GraphicsPreference
  onStep: (direction: 1 | -1) => void
}) {
  return (
    <div className="game-room-menu-settings">
      <div className="game-room-menu-setting">
        <div className="game-room-menu-setting-head">
          <span className="game-room-menu-setting-label">GRAPHICS</span>
          <span className="game-room-menu-stepper">
            <button type="button" aria-label="Previous graphics setting" onClick={() => onStep(-1)}>◀</button>
            <span className="game-room-menu-setting-value" aria-live="polite">
              {graphicsPreferenceLabel(graphics)}
            </span>
            <button type="button" aria-label="Next graphics setting" onClick={() => onStep(1)}>▶</button>
          </span>
        </div>
        {/* Describes the value you are ON, so stepping through the list
            explains each one as you land on it. */}
        <p className="game-room-menu-setting-hint">{graphicsPreferenceHint(graphics)}</p>
        <p className="game-room-menu-setting-note">
          CHANGES APPLY TO THE ROOM BEHIND THIS MENU IMMEDIATELY
        </p>
      </div>
      <SiteAudioControls className="game-room-menu-audio" />
    </div>
  )
}

function TeamMembers({ members, emptyLabel }: { members: GameRoomMenuPerson[]; emptyLabel: string }) {
  if (members.length === 0) {
    return <div className="game-room-menu-empty">{emptyLabel}</div>
  }
  return (
    <div className="game-room-menu-team-list">
      {members.map((person) => (
        <div key={person.id} data-testid={`game-room-team-member-${person.id}`} className="game-room-menu-team-member">
          <div className="game-room-menu-team-sprite"><GameRoomMenuSprite person={person} scale={2} /></div>
          <div className="game-room-menu-team-copy">
            <p className="game-room-menu-person-name">{person.name}</p>
            <p className="game-room-menu-person-id">{person.id}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function GameRoomMenu({ data, open, onOpenChange, touchControlsVisible = false, showTrigger = true, teams, focusTeamIdx = null, onGraphicsChange }: GameRoomMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active: GameRoomMenuItem = ITEMS[activeIndex] ?? ITEMS[0]
  // Read after mount, not during render: this route is server-rendered, and
  // reading localStorage during the first render makes the two sides of
  // hydration disagree.
  const [graphics, setGraphics] = useState<GraphicsPreference>("auto")
  useEffect(() => { setGraphics(loadGraphicsPreference()) }, [])

  const stepGraphics = useCallback((direction: 1 | -1) => {
    setGraphics((current) => {
      const next = cycleGraphicsPreference(current, direction)
      saveGraphicsPreference(next)
      onGraphicsChange?.(next)
      return next
    })
  }, [onGraphicsChange])

  // Walking up to a desk asks for that team, so the menu opens on Team rather
  // than wherever the player left it. The route clears the focus on close, so
  // every desk press is a fresh null -> team transition and lands here again.
  useEffect(() => {
    if (focusTeamIdx === null) return
    setActiveIndex(ITEMS.indexOf("Team"))
  }, [focusTeamIdx])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === "Tab") {
        event.preventDefault()
        event.stopImmediatePropagation()
        onOpenChange(!open)
        return
      }
      if (open && event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        onOpenChange(false)
        return
      }
      if (isTextEntryTarget(event.target)) return
      if (!open) return
      if (event.key === "Enter" || event.key === " ") {
        const target = event.target
        if (target instanceof HTMLButtonElement && target.closest(".game-room-menu-root")) {
          event.preventDefault()
          event.stopImmediatePropagation()
          target.click()
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          event.stopImmediatePropagation()
          return
        }
      }
      const delta =
        event.key === "ArrowUp" || event.key.toLowerCase() === "w"
          ? -1
          : event.key === "ArrowDown" || event.key.toLowerCase() === "s"
            ? 1
            : 0
      if (delta !== 0) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setActiveIndex((current) => (current + delta + ITEMS.length) % ITEMS.length)
        return
      }
      // Horizontal keys belong to the section that is showing. Only OPTIONS
      // has anything to step; everywhere else they fall through to the
      // room-control swallow below rather than reaching the camera.
      const horizontal =
        event.key === "ArrowLeft" || event.key.toLowerCase() === "a"
          ? -1
          : event.key === "ArrowRight" || event.key.toLowerCase() === "d"
            ? 1
            : 0
      if (horizontal !== 0 && active === "Options") {
        event.preventDefault()
        event.stopImmediatePropagation()
        stepGraphics(horizontal === -1 ? -1 : 1)
        return
      }
      if (ROOM_CONTROL_KEYS.has(event.key.toLowerCase())) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [active, onOpenChange, open, stepGraphics])

  return (
    <div className="game-room-menu-root">
      {showTrigger && <button
        id="game-room-menu-trigger"
        type="button"
        className={`game-room-menu-trigger${touchControlsVisible ? " game-room-menu-trigger--touch-offset" : ""}`}
        aria-expanded={open}
        aria-controls="game-room-menu-overlay"
        onClick={() => onOpenChange(!open)}
      >
        MENU · TAB
      </button>}

      {open && (
        <>
        {/* Clicking off the menu closes it. The surface also swallows the click
            so dismissing does not double as a click into the room behind. */}
        <button
          type="button"
          className="game-room-menu-dismiss"
          tabIndex={-1}
          aria-label="Dismiss"
          onClick={() => onOpenChange(false)}
        />
        <div
          id="game-room-menu-overlay"
          className="game-room-menu-overlay"
          role="dialog"
          aria-label="Game room menu"
        >
          <aside className="game-room-menu-panel game-room-menu-sidebar">
            <p className="game-room-menu-kicker">GAME MENU</p>
            <div className="game-room-menu-items" role="menu" aria-label="Game room sections">
              {ITEMS.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  role="menuitem"
                  aria-current={activeIndex === index ? "page" : undefined}
                  className={`game-room-menu-item${activeIndex === index ? " game-room-menu-item--active" : ""}`}
                  onClick={() => setActiveIndex(index)}
                >
                  {item}
                </button>
              ))}
            </div>
          </aside>

          <section className="game-room-menu-panel game-room-menu-content" aria-live="polite">
            <p className="game-room-menu-kicker">SECTION</p>
            <h2>{active}</h2>
            {active === "Profile" && <ProfileSection person={data.me} />}
            {active === "Team" && <TeamSection data={data} teams={teams} focusTeamIdx={focusTeamIdx} />}
            {active === "Options" && <OptionsSection graphics={graphics} onStep={stepGraphics} />}
          </section>
        </div>
        </>
      )}
    </div>
  )
}
