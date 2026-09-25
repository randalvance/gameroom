// HD-2D ("Octopath Traveller"-style) renderer for the game room.
// Real 3D diorama — perspective camera, warm point-light pools, fog,
// vignette and grain — with the existing pixel-art character sheets
// billboarded inside it. Layout comes from the shared 2D room plan: table
// positions (PARTICIPANT_TABLES, px-space) mapped into world units (1 unit =
// 1 tile = 16 px).
//
// The parts that are built once and left alone live under ./scene/ (the
// shell, the furniture, the lights, the wall screen, the textures). This file
// is what shares state with the frame loop: the characters and agents, the
// local player's input, the camera, and the handle the room is driven by.
import { logger } from "~/lib/logger"
import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { AGENT_TABLE_IDXS, CW, CH, PARTICIPANT_TABLES, SEATS_PER_TABLE, TILE, WALL_Y } from "../gameRoom/constants"
import { CHAR_COUNT, characterSheetUrl } from "../gameRoom/assets"
import {
    characterIdForPlayer,
    resolveSprite,
    sheetFormatFor,
    type SheetFormat,
    type WalkDir,
} from "../gameRoom/spriteIndex"
import {
    buildStaticColliders,
    facingForInput,
    movePlayer,
    nearestFreePoint,
    PLAYER_SPEED_PX_PER_STEP,
    type ProbeCandidate,
} from "../../lib/gameRoomNet/collision"
import { bubbleTextFor, hashAgentId, type AgentStatus, type FollowSlot, type ResolvedStatusStyle } from "../../lib/agents"
import { seedWander, stepWander, WALK_SPEED } from "../../lib/gameRoomNet/wander"
import { OBJECT_IDX_BASE, ROOM_OBJECTS, roomObjectByIdx } from "../../lib/gameRoomNet/objects"
import { resolveRoomInteract, type RoomInteractTarget } from "../../lib/gameRoomNet/tables"
import { PRIMEY_IDX, PRIMEY_POINT, PRIMEY_STRIP, primeyFrameOffset } from "./primey-npc"
import { BIG_SCREEN_IDX, BIG_SCREEN_POINT, type RoomBoard } from "./wall"
import { localMinutes, parseTimeOverride, skyPalette } from "./time-of-day"
import type { RoomSelection } from "./selection"
import {
    CHARACTER_SCALE,
    characterGroundY,
    characterPlaneSize,
    characterShadowLocalY,
    characterTopY,
    NOMINAL_CHARACTER_TOP_Y,
} from "./character-scale"
import { createBackdrop } from "./backdrop"
import { createBackroomsHatch, maskHatchOpening } from "./backrooms-hatch"
import { ARCADE_IDX, ARCADE_POINT, createArcadeCabinet } from "./arcade-cabinet"
import { createArcadeReveal, REVEAL, type ArcadeReveal } from "./arcade-reveal"
import { advanceSimClock } from "./sim-clock"
import {
    clampRoomCameraPan,
    followRoomCameraPan,
    isDragPan,
    panFromDrag,
    type RoomCameraPan,
} from "./camera-pan"
import {
    advanceScreenFocus,
    blendCameraPose,
    screenFocusHidesRoom,
    screenFocusKeyAction,
    screenFocusPose,
    type CameraPose,
    type ScreenFocusKeyAction,
} from "./screen-focus"
import { pickNearestToPoint, pinchZoom } from "./touch-controls"
import { FACING_CAMERA, walkPos } from "./walk-path"
import { roleHaloColor, type RoomRole } from "./role-colors"
import { createRoomLocalInput, type RoomMoveDirection } from "./local-input"
import { parseNoclipOverride } from "./noclip"
import { chooseSnapped, createSnapDissolve, type SnapDissolve } from "./thanos-snap"
import {
    createFrameBudgetWatcher,
    detectQualitySignals,
    nextTierDown,
    parseQualityOverride,
    pinnedGraphicsTier,
    qualitySettings,
    resolveQualityTier,
    type FrameBudgetWatcher,
    type GraphicsPreference,
    type QualitySettings,
    type QualityTier,
} from "./quality-tier"
import type { CreateRoomOptions, RoomAgentInput, RoomSceneHandle, RoomSelfState } from "./scene/types"
import { NORTH_APRON, ROOM_D, ROOM_W, toX, toZ } from "./scene/layout"
import { loadTexture, makeNameTagTexture, makeSparkTexture, makeSpeechTexture } from "./scene/textures"
import { ROOM_EXPOSURE, RoomGradeShader } from "./scene/post-fx"
import { buildRoomShell } from "./scene/room-shell"
import { buildBigScreen } from "./scene/big-screen"
import { buildPrimey } from "./scene/primey"
import { buildLighting } from "./scene/lighting"
import { buildFurniture } from "./scene/furniture"

export type { CreateRoomOptions, RoomAgentInput, RoomNetState, RoomSceneHandle, RoomSelfState } from "./scene/types"

// ---------------------------------------------------------------- helpers

// What floats over a character, measured from the top of its head so the whole
// stack rises together when the cast is resized.
const MARKER_RISE = 0.54
const HOVER_TAG_RISE = 0.89
const SEL_TAG_RISE = 1.24


// WALK_SPEED now lives in lib/gameRoomNet/wander.ts, shared with the
// multiplayer hub so the server-side wander walks the same gait.
/** Simulation steps per sprite frame: the walk cycle at WALK_SPEED = 1. */
const WALK_FRAME_STEPS = 6
/** Peak of the hop a character makes when it moves between two seats. */
const TRANSITION_HOP = 0.7

/** The sheet column every stock sheet keeps its hurt pose in. */
const HURT_FRAME = 5
/** How long a new agent takes to reach its desk from the aisle. */
const AGENT_WALK_IN_MS = 1_400
/** How long a departing agent takes to fade out. */
const AGENT_FADE_OUT_MS = 700
/** Where the private character indexes for agents start: clear of the hub's
 * visitor indexes (small) and below the room objects (100 000). */
const AGENT_IDX_BASE = 50_000
/** How far behind the one in front each follower walks, in world units. */
const FOLLOW_GAP = 1.5
/** How much of a follower's gap to its spot survives one sim step. */
const FOLLOW_KEEP_PER_STEP = 0.82
/** A trail point is dropped every time the leader moves this far. */
const TRAIL_STEP = 0.05
/** How much trail a leader keeps: enough for a long line at FOLLOW_GAP. */
const TRAIL_MAX_POINTS = 1_200


/**
 * Baseline for measuring how far the floor moves per pixel of pointer travel.
 * Wide enough that the two sample rays are not fighting float precision, and
 * the reading stays good for the whole drag: sliding the camera parallel to
 * the floor changes neither its height nor its angle, so the scale holds.
 */
const PAN_PROBE_PX = 100

/** A bubble that stays up: the agent's status line over its head. */
interface StatusBubble {
    sprite: THREE.Sprite
    material: THREE.SpriteMaterial
    texture: THREE.CanvasTexture
}

interface AgentState {
    id: string
    style: ResolvedStatusStyle
    bubbleText: string | null
    bubble: StatusBubble | null
    /** The desk and orbit slot it holds, or null when it stands in the aisle. */
    seat: { table: number; seat: number } | null
    /** A fade-out in progress, after which the character is removed. */
    leaving: { startedAt: number } | null
    /** The sheet it was drawn from, as the host asked for it. */
    sprite: number | string | undefined
    /** Whose trail it walks, and how far back — null for a root. */
    follow: FollowSlot | null
    /** Which way it last walked while following. */
    followDir: WalkDir
    /** Where it has been, oldest first, for its followers to walk. */
    trail: Array<{ x: number; z: number }>
}

interface CharState {
    mesh: THREE.Mesh
    /** Set for an agent's character; null for a visitor's. */
    agent: AgentState | null
    material: THREE.MeshLambertMaterial
    texture: THREE.Texture
    /** Cell size, direction rows and walk cycle, read off this sheet's image. */
    format: SheetFormat
    phase: number
    speed: number
    pauseLeft: number
    rng: number
    teamIdx: number | null
    playerIdx: number
    name: string
    role: RoomRole
    presenceHalo: THREE.Mesh
    x: number
    z: number
    transition: {
        fromX: number
        fromZ: number
        startedAt: number
        duration: number
    } | null
    /** Hub-driven target (world units); set = this character is remote-synced. */
    net: { x: number; z: number; dir: WalkDir; moving: boolean; live: boolean } | null
}

export async function createRoomScene(container: HTMLElement, opts: CreateRoomOptions): Promise<RoomSceneHandle> {
    const cleanupCallbacks: Array<() => void> = []
    let cleanedUp = false
    const runCleanup = (cleanup: () => void) => {
        try {
            cleanup()
        } catch (error) {
            logger.error("room3d.cleanup_failed", error)
        }
    }
    const registerCleanup = (cleanup: () => void) => {
        if (cleanedUp) {
            runCleanup(cleanup)
            return
        }
        cleanupCallbacks.push(cleanup)
    }
    const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        for (let i = cleanupCallbacks.length - 1; i >= 0; i--) {
            runCleanup(cleanupCallbacks[i]!)
        }
    }
    const track = <T extends { dispose(): void }>(disposable: T): T => {
        registerCleanup(() => disposable.dispose())
        return disposable
    }

    // One plane per distinct cell size, shared by every character drawn with it:
    // every sheet uses the same 32×48 cell, so this is effectively one geometry —
    // it stays keyed by cell size so a mis-sized sheet still gets a plane that
    // matches its art. Cached (and tracked once) rather than built per character
    // — 50 hackers would otherwise mean 50 identical geometries to dispose.
    const charGeoCache = new Map<string, THREE.PlaneGeometry>()
    const planeForSheet = (f: SheetFormat): THREE.PlaneGeometry => {
        const key = `${f.cellW}x${f.cellH}`
        let geo = charGeoCache.get(key)
        if (!geo) {
            const { width, height } = characterPlaneSize(f)
            geo = track(new THREE.PlaneGeometry(width, height))
            charGeoCache.set(key, geo)
        }
        return geo
    }

    try {
        const loader = new THREE.TextureLoader()
        const charSheets = await Promise.all(
            // CHAR_COUNT, not a literal: characterIdForPlayer hashes into that range,
            // so a short list here would silently wrap several seats onto one sheet.
            Array.from({ length: CHAR_COUNT }, (_, i) =>
                loadTexture(loader, characterSheetUrl(i)).then(track),
            ),
        )
        // Only the corner plants are left: the paintings, whiteboard and clock hung
        // on a wall that no longer exists, and the two SMALL_PAINTINGs were being
        // decoded for nobody long before that.
        const decorNames = ["LARGE_PLANT"] as const
        const decorTex: Record<string, THREE.Texture> = {}
        await Promise.all(
            decorNames.map(async (n) => {
                decorTex[n] = track(await loadTexture(loader, `/assets/room/furniture/${n}/${n}.png`))
            }),
        )

        // ------------------------------------------------------------ quality

        // How much of the diorama this device can afford. Highest authority first:
        // the URL param (a rehearsal or screenshot override), then the caller, then
        // whatever the player set in OPTIONS → GRAPHICS. Any of those is an
        // instruction and switches the frame-budget watcher off — a setting that
        // quietly moved itself would read as broken. Only with all three absent
        // (GRAPHICS on AUTO) is the device measured and re-judged as it runs.
        const pinnedTier =
            parseQualityOverride(window.location.search) ?? opts.quality ?? pinnedGraphicsTier()
        let tier: QualityTier = pinnedTier ?? resolveQualityTier(detectQualitySignals())
        let q: QualitySettings = qualitySettings(tier)
        const pixelRatioFor = (settings: QualitySettings) =>
            Math.min(window.devicePixelRatio * settings.renderScale, settings.maxPixelRatio)

        // ------------------------------------------------------------ renderer

        const renderer = track(new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" }))
        renderer.setPixelRatio(pixelRatioFor(q))
        renderer.shadowMap.enabled = q.shadows
        renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
        // Nothing that casts a shadow in this room ever moves — the furniture is
        // static and the characters use blob decals rather than real shadows — so
        // the depth pass is rendered on demand instead of 60 times a second.
        renderer.shadowMap.autoUpdate = false
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = ROOM_EXPOSURE
        renderer.domElement.style.width = "100%"
        renderer.domElement.style.height = "100%"
        renderer.domElement.style.display = "block"
        registerCleanup(() => {
            if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement)
        })
        container.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        // Both start black and are retinted from the time-of-day palette below —
        // the background doubles as the last line of haze wherever the frame looks
        // past the backdrop's shell.
        scene.background = new THREE.Color(0x05070f)
        // The fog brackets scale off the room depth, so the far wall reads as
        // city haze rather than a smoky far half.
        scene.fog = new THREE.Fog(0x05070f, ROOM_D * 2, ROOM_D * 3.7)

        // Fixed, front-facing camera. The far plane clears the backdrop's haze
        // shell (r=520), not just the room: 200 would cull the city outside.
        const camera = new THREE.PerspectiveCamera(45, CW / CH, 0.1, 1400)
        // High and a touch back, so the far rows clear the near ones.
        camera.position.set(0, 34, ROOM_D + 24)
        camera.lookAt(0, 0.6, ROOM_D * 0.4)
        const cameraHomePosition = camera.position.clone()
        const cameraHomeTarget = new THREE.Vector3(0, 0.6, ROOM_D * 0.4)

        // ---- the city outside ----------------------------------------------------
        // Rings of skyline below the room, centred on the camera's home so a pan
        // slides the camera INSIDE them — that offset is the parallax. The palette
        // retints backdrop, fog, background and the room lights together, from the
        // Singapore clock (or a ?tod= override for rehearsals and screenshots).
        const backdrop = await createBackdrop(
            scene,
            { x: cameraHomePosition.x, z: cameraHomePosition.z },
            track,
            {
                // The rings must wrap outside the far corner of the floor slab, or the
                // room's far end disappears behind a silhouette tower.
                clearRadius: Math.hypot(
                    Math.abs(cameraHomePosition.x) + ROOM_W / 2,
                    cameraHomePosition.z + NORTH_APRON,
                ) + 8,
                lightsScale: q.backdropLightsScale,
            },
        )
        const todOverride = parseTimeOverride(window.location.search)
        const clockMinute = () => todOverride ?? localMinutes(new Date())
        let paletteMinute = -1
        // The palette in force, so the lights can be retuned to it.
        let palette: ReturnType<typeof skyPalette> | null = null
        const applyTimeOfDay = () => {
            const minute = clockMinute()
            if (minute === paletteMinute) return
            paletteMinute = minute
            const p = skyPalette(minute)
            palette = p
            backdrop.applyPalette(p)
                ; (scene.background as THREE.Color).setHex(p.haze)
            scene.fog!.color.setHex(p.haze)
            hemi.color.setHex(p.hemiSky)
            hemi.groundColor.setHex(p.hemiGround)
            key.color.setHex(p.keyColor)
            rim.color.setHex(p.rimColor)
            applyLightLevel()
        }

        // ------------------------------------------------------------ room shell

        /**
         * A lit surface — floor, walls, furniture. Standard pays for a full
         * metalness/roughness BRDF against every point light in the room, which is
         * exactly the term that makes twenty pools expensive; the cheap tier swaps
         * in Lambert, which is a dot product, and drops the two parameters Lambert
         * has no use for. Everything else about the material carries over, so the
         * room keeps its colours and maps and only loses its speculars.
         */
        const surfaceMaterial = (
            params: THREE.MeshStandardMaterialParameters,
        ): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial => {
            if (!q.cheapFurniture) return new THREE.MeshStandardMaterial(params)
            const { roughness: _roughness, metalness: _metalness, ...rest } = params
            return new THREE.MeshLambertMaterial(rest)
        }

        const { floor, hatchOpeningMaterials } = buildRoomShell(scene, { track, surfaceMaterial })

        // ------------------------------------------------------------ big screen

        const { SCREEN_W, SCREEN_H, SCREEN_CY, screen, screenGlowLights, draw: drawScreen } = buildBigScreen(scene, { track, surfaceMaterial })
        /** The wall's resting page, or null for the room's title alone. */
        let board: RoomBoard | null = null
        /** The bulletin up on the wall, or null while it shows the board. */
        let bulletinText: string | null = null
        // Whether the auto-frame on the wall was OURS to release. A player who
        // presses Escape mid-bulletin has taken the camera back, and the bulletin
        // coming down must not yank it away from wherever they went.
        let bulletinFocusHeld = false
        const redrawScreen = () => drawScreen(board, bulletinText)

        // ------------------------------------------------------------ wall decor

        // corner plants (billboards)
        const plantTex = decorTex["LARGE_PLANT"]!
        const plantImg = plantTex.image as HTMLImageElement
        const plantAspect = plantImg.width / plantImg.height
        const plantGeo = track(new THREE.PlaneGeometry(3.4 * plantAspect, 3.4))
        const plantMat = track(new THREE.MeshLambertMaterial({ map: plantTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }))
        let secretPlant: THREE.Mesh | null = null
        let backroomsUnlocked = false
        let renderPaused = false
        // Drawn from the shared object list rather than a second copy of the same
        // coordinates: these billboards ARE the talkable plants, so a plant you can
        // see and a plant you can talk to cannot end up in different places.
        for (const obj of ROOM_OBJECTS) {
            if (!obj.id.startsWith("plant-")) continue
            const plant = new THREE.Mesh(plantGeo, plantMat)
            plant.position.set(toX(obj.x), 1.7, toZ(obj.y))
            scene.add(plant)
            if (obj.id === "plant-se") secretPlant = plant
        }

        // This small piece of scenery belongs upstairs. The mini-game itself is
        // behind a separate dynamic import in the route, never a scene dependency.
        const secretObject = ROOM_OBJECTS.find((obj) => obj.id === "plant-se")!
        let hatch: THREE.Group | null = null
        const hatchOpen = { value: 0 }
        const revealHatch = () => {
            hatch = createBackroomsHatch(track)
            hatch.position.set(toX(secretObject.x), 0, toZ(secretObject.y))
            scene.add(hatch)
            for (const material of hatchOpeningMaterials) maskHatchOpening(material, hatch.position.x, hatch.position.z, hatchOpen)
            const hatchLabel = document.createElement("canvas")
            hatchLabel.width = 512
            hatchLabel.height = 96
            const hatchCtx = hatchLabel.getContext("2d")!
            hatchCtx.fillStyle = "#17160d"
            hatchCtx.fillRect(0, 0, 512, 96)
            hatchCtx.fillStyle = "#ffe493"
            hatchCtx.font = "bold 25px monospace"
            hatchCtx.textAlign = "center"
            hatchCtx.fillText("↓ THE BACKROOMS", 256, 37)
            hatchCtx.font = "20px monospace"
            hatchCtx.fillText("SPACE / E / A · CLIMB DOWN", 256, 73)
            const hatchTex = track(new THREE.CanvasTexture(hatchLabel))
            const hatchSign = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: hatchTex, depthTest: false })))
            hatchSign.scale.set(5.4, 1.02, 1)
            hatchSign.position.set(-1.5, 3.8, 0)
            hatch.add(hatchSign)
        }

        // The Konami code's cabinet, beside Primey. Private to this client and
        // built the first time it is revealed; the fighter it opens is behind a
        // dynamic import in the route, never a scene dependency.
        let arcade: THREE.Group | null = null
        let arcadeVisible = false
        /** The entrance in progress (camera move, drop, dust), or null. */
        let arcadeReveal: ArcadeReveal | null = null
        /** Whether the follow-cam was driving before the entrance took the camera. */
        let followBeforeReveal = false
        /** 0 = the room's view, 1 = framed on the cabinet; and the impact jitter. */
        let arcadeFocusT = 0
        const arcadeShake = { x: 0, z: 0 }
        // The landing's dust: one Points buffer the reveal timeline is copied into,
        // and a ground ring that spreads and fades under it.
        const dustPositions = new Float32Array(REVEAL.dustCount * 3)
        const dustGeo = track(new THREE.BufferGeometry())
        dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage))
        dustGeo.setDrawRange(0, 0)
        const dustMat = track(new THREE.PointsMaterial({
            size: 1.6,
            color: 0xcfc3ad,
            map: track(makeSparkTexture()),
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            fog: false,
        }))
        const dustPoints = new THREE.Points(dustGeo, dustMat)
        dustPoints.frustumCulled = false
        dustPoints.visible = false
        scene.add(dustPoints)
        const dustRing = new THREE.Mesh(
            track(new THREE.RingGeometry(0.7, 1, 40)),
            track(new THREE.MeshBasicMaterial({ color: 0xd8ccb4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })),
        )
        dustRing.rotation.x = -Math.PI / 2
        dustRing.visible = false
        scene.add(dustRing)
        const revealArcade = (entrance: boolean) => {
            arcade = createArcadeCabinet(track)
            const x = toX(ARCADE_POINT.x)
            const z = toZ(ARCADE_POINT.y)
            if (!entrance) {
                // Unlocked on an earlier visit: it is simply standing there.
                arcade.position.set(x, 0, z)
                scene.add(arcade)
                return
            }
            arcade.position.set(x, REVEAL.dropHeight, z)
            // The sign waits for the landing; a floating label over a falling
            // cabinet reads as two things.
            const sign = arcade.getObjectByName("arcade-sign")
            if (sign) sign.visible = false
            scene.add(arcade)
            dustPoints.position.set(x, 0.05, z)
            dustRing.position.set(x, 0.04, z)
            // The entrance: move to the spot, drop, dust, move back. The follow-cam
            // and the framed screen both stand down for it, and the local character
            // is held still so the camera is not chasing anyone while it is away.
            setScreenFocus(false)
            followBeforeReveal = cameraFollowSuspended
            cameraFollowSuspended = true
            arcadeReveal = createArcadeReveal()
            localInput.releaseMovement()
            localMoving = false
            inputFrozenUntil = Math.max(inputFrozenUntil, performance.now() + arcadeReveal.totalMs)
        }
        /** One frame of the cabinet's entrance. */
        const stepArcadeReveal = (frameMs: number) => {
            if (!arcadeReveal || !arcade) return
            const frame = arcadeReveal.advance(frameMs)
            arcadeFocusT = frame.focus
            arcadeShake.x = frame.shake.x
            arcadeShake.z = frame.shake.z
            syncCamera()
            arcade.position.y = frame.cabinetY
            arcade.scale.y = frame.squash
            if (frame.landedNow) {
                const sign = arcade.getObjectByName("arcade-sign")
                if (sign) sign.visible = true
                opts.onArcadeLanded?.()
            }
            const showDust = frame.dust.length > 0
            dustPoints.visible = showDust
            dustRing.visible = frame.ring.opacity > 0
            if (showDust) {
                frame.dust.forEach((d, i) => {
                    dustPositions[i * 3] = d.x
                    dustPositions[i * 3 + 1] = d.y
                    dustPositions[i * 3 + 2] = d.z
                })
                dustGeo.setDrawRange(0, frame.dust.length)
                    ; (dustGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true
                dustMat.opacity = 0.85 * Math.max(...frame.dust.map((d) => d.alpha))
                const s = frame.ring.radius
                dustRing.scale.set(s, s, 1)
                    ; (dustRing.material as THREE.MeshBasicMaterial).opacity = frame.ring.opacity
            }
            if (frame.done) {
                arcadeReveal = null
                arcadeFocusT = 0
                arcadeShake.x = arcadeShake.z = 0
                syncCamera()
                dustPoints.visible = false
                dustRing.visible = false
                cameraFollowSuspended = followBeforeReveal
            }
        }

        // ------------------------------------------------------------ Primey

        const { primeyMesh, primeyTex } = await buildPrimey(scene, loader, { track, surfaceMaterial })
        let primeyVisible = true

        // ------------------------------------------------------------ lighting

        const { hemi, key, rim, deskLights, buildDeskLights, applyLightLevel } = buildLighting(scene, {
            shadowMapSize: q.shadowMapSize,
            getPalette: () => palette,
            registerCleanup,
        })
        buildDeskLights(q.deskLightsPerRow)

        // ------------------------------------------------------------ tables

        const { tableHitboxes, screenOccluders, highlight, interactHighlight, contactShadowTex } = buildFurniture(scene, { track, surfaceMaterial })

        // ------------------------------------------------------------ characters

        // Footprint grows with the cast — a shadow narrower than the feet above it
        // reads as a character hovering.
        const blobGeo = track(new THREE.PlaneGeometry(1.1 * CHARACTER_SCALE, 0.6 * CHARACTER_SCALE))
        const blobMat = track(new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false, opacity: 0.9 }))
        const haloGeo = track(new THREE.RingGeometry(0.55, 0.82, 24))
        const makePresenceHalo = (color: number) => {
            const halo = new THREE.Mesh(
                haloGeo,
                track(new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.8,
                    depthWrite: false,
                    toneMapped: false,
                })),
            )
            halo.rotation.x = -Math.PI / 2
            halo.position.y = 0.03
            halo.visible = false
            scene.add(halo)
            return halo
        }

        // Generated and custom sheets (data URLs and URLs), decoded once each; a
        // sheet that fails to decode leaves its character on the built-in fallback.
        const customTex = new Map<string, THREE.Texture>()
        const loadCustomSheet = async (url: string): Promise<THREE.Texture | null> => {
            const cached = customTex.get(url)
            if (cached) return cached
            try {
                const texture = track(await loadTexture(loader, url))
                customTex.set(url, texture)
                return texture
            } catch (err) {
                logger.warn("room3d.sprite_decode_failed", err)
                return null
            }
        }

        // The cast is entirely dynamic: agents arrive through upsertAgent and
        // visitors through upsertGuest, so nothing is baked in at build time and
        // nobody's arrival rebuilds the WebGL scene.
        const chars: CharState[] = []
        const charByPlayerIdx = new Map<number, CharState>()

        /** Build a character from its sheet and put it in the room. */
        const createCharacter = (input: {
            playerIdx: number
            name: string
            role: RoomRole
            haloColor: number
            source: THREE.Texture
            teamIdx: number | null
            seatIdx: number
            x: number
            z: number
        }): CharState => {
            const img = input.source.image as HTMLImageElement
            const format = sheetFormatFor(img.width, img.height)
            const tex = input.source.clone()
            tex.repeat.set(1 / format.cols, 1 / format.rows)
            const material = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
            const mesh = new THREE.Mesh(planeForSheet(format), material)
            mesh.userData.playerIdx = input.playerIdx
            const blob = new THREE.Mesh(blobGeo, blobMat)
            blob.rotation.x = -Math.PI / 2
            blob.position.y = characterShadowLocalY(format)
            mesh.add(blob)
            const presenceHalo = makePresenceHalo(input.haloColor)
            scene.add(mesh)
            const wander = seedWander(input.playerIdx, input.teamIdx ?? 0, input.seatIdx)
            const c: CharState = {
                mesh,
                agent: null,
                material,
                texture: tex,
                format,
                phase: wander.phase,
                speed: wander.speed,
                pauseLeft: wander.pauseLeft,
                rng: wander.rng,
                teamIdx: input.teamIdx,
                playerIdx: input.playerIdx,
                name: input.name,
                role: input.role,
                presenceHalo,
                x: input.x,
                z: input.z,
                transition: null,
                net: null,
            }
            c.mesh.position.set(c.x, characterGroundY(format), c.z)
            chars.push(c)
            charByPlayerIdx.set(c.playerIdx, c)
            return c
        }

        // ------------------------------------------------------------ the snap
        // Who has been dusted (hidden, unpickable, uninteractable) and the fade
        // in progress. The motes share one Points buffer, built to the size of
        // each snap and thrown away when it settles. The set is never written to
        // anything, so a reload brings everyone back.
        const snapped = new Set<CharState>()
        let snapDissolve: SnapDissolve | null = null
        let snapDust: { points: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.PointsMaterial; positions: Float32Array } | null = null
        const snapDustTexture = track(makeSparkTexture())
        const clearSnapDust = () => {
            if (!snapDust) return
            scene.remove(snapDust.points)
            snapDust.geo.dispose()
            snapDust.mat.dispose()
            snapDust = null
        }
        registerCleanup(clearSnapDust)
        /** The characters still standing that a snap can take: not you. */
        const standing = () => chars.filter((c) => c !== localChar && !snapped.has(c))
        const snapHalfTheRoom = () => {
            // A snap over a snap: whoever is mid-fade counts as taken already.
            if (snapDissolve) return
            const taken = new Set(chooseSnapped(standing().map((c) => c.playerIdx), Math.random))
            const targets = chars.filter((c) => taken.has(c.playerIdx))
            if (targets.length === 0) return
            for (const c of targets) {
                snapped.add(c)
                // The sprite is cut out with alphaTest, which turns opacity into a
                // cliff at 0.5; lowering it lets the fade run all the way down.
                c.material.alphaTest = 0.02
                c.material.depthWrite = false
                c.material.needsUpdate = true
                c.presenceHalo.visible = false
                if (hoverPlayerIdx === c.playerIdx) setHoveredPlayer(null)
            }
            snapDissolve = createSnapDissolve(
                targets.map((c) => {
                    const { width, height } = characterPlaneSize(c.format)
                    return { id: c.playerIdx, x: c.x, y: c.mesh.position.y, z: c.z, w: width, h: height }
                }),
                Math.random,
            )
            clearSnapDust()
            const positions = new Float32Array(snapDissolve.dustCapacity * 3)
            const geo = new THREE.BufferGeometry()
            geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
            geo.setDrawRange(0, 0)
            // Sized for the room's usual camera distance: any smaller and the cloud
            // is a shimmer nobody notices from the default view.
            const mat = new THREE.PointsMaterial({
                size: 1.1,
                color: 0xe6dcc6,
                map: snapDustTexture,
                transparent: true,
                opacity: 0.95,
                depthWrite: false,
                fog: false,
            })
            const points = new THREE.Points(geo, mat)
            points.frustumCulled = false
            points.renderOrder = 21
            scene.add(points)
            snapDust = { points, geo, mat, positions }
        }
        /** One frame of the fade, AFTER the characters have been placed: it
         * lifts and fades the taken ones over wherever they are this frame. */
        const stepSnap = (frameMs: number) => {
            if (!snapDissolve) return
            const frame = snapDissolve.advance(frameMs)
            for (const f of frame.chars) {
                const c = charByPlayerIdx.get(f.id)
                if (!c) continue
                c.material.opacity = f.alpha
                c.mesh.position.y += f.lift
                c.mesh.visible = !f.gone
            }
            if (snapDust) {
                const { positions, geo, mat, points } = snapDust
                frame.dust.forEach((d, i) => {
                    positions[i * 3] = d.x
                    positions[i * 3 + 1] = d.y
                    positions[i * 3 + 2] = d.z
                })
                geo.setDrawRange(0, frame.dust.length)
                    ; (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true
                points.visible = frame.dust.length > 0
                if (frame.dust.length > 0) {
                    mat.opacity = 0.95 * frame.dust.reduce((sum, d) => sum + d.alpha, 0) / frame.dust.length
                }
            }
            if (frame.done) {
                snapDissolve = null
                clearSnapDust()
            }
        }

        /**
         * Where a follower should be: `rank` gaps back along its leader's trail,
         * or, with no trail yet, lined up behind the leader against its facing.
         */
        const followSpot = (leader: CharState, rank: number): { x: number; z: number } => {
            const trail = leader.agent?.trail ?? []
            let remaining = rank * FOLLOW_GAP
            let x = leader.x
            let z = leader.z
            for (let i = trail.length - 1; i >= 0; i--) {
                const point = trail[i]!
                const dx = x - point.x
                const dz = z - point.z
                const segment = Math.hypot(dx, dz)
                if (segment >= remaining) {
                    const t = segment === 0 ? 0 : remaining / segment
                    return { x: x - dx * t, z: z - dz * t }
                }
                remaining -= segment
                x = point.x
                z = point.z
            }
            // Ran out of trail: extend the line straight back from its last leg,
            // or behind the leader's facing when it has not walked at all.
            let bx = 0
            let bz = 1
            const first = trail[0]
            if (first && (first.x !== leader.x || first.z !== leader.z) && trail.length > 1) {
                const last = trail[1]!
                const dx = first.x - last.x
                const dz = first.z - last.z
                const len = Math.hypot(dx, dz)
                if (len > 0) {
                    bx = dx / len
                    bz = dz / len
                }
            } else {
                const facing = leader.agent?.follow ? leader.agent.followDir : (leader.teamIdx !== null ? walkPos(leader.phase, PARTICIPANT_TABLES[leader.teamIdx]!, leader.speed).dir : FACING_CAMERA)
                const [vx, vy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][facing]!
                bx = -vx!
                bz = -vy!
            }
            return { x: x + bx * remaining, z: z + bz * remaining }
        }

        const authoritativePosition = (c: CharState) => {
            // A follower walks its leader's trail. It eases onto its spot rather than
            // sitting on it, so a line ripples when its leader turns.
            if (c.agent?.follow) {
                const leader = agentChars.get(c.agent.follow.root)
                if (!leader || leader === c) return { x: c.x, z: c.z, dir: c.agent.followDir }
                const spot = followSpot(leader, c.agent.follow.rank)
                const closeness = 1 - FOLLOW_KEEP_PER_STEP
                const x = c.x + (spot.x - c.x) * closeness
                const z = c.z + (spot.z - c.z) * closeness
                const dx = x - c.x
                const dz = z - c.z
                if (Math.hypot(dx, dz) > 0.004) {
                    c.agent.followDir = facingForInput(dx, dz, c.agent.followDir)
                }
                return { x, z, dir: c.agent.followDir }
            }
            // A character who is standing rather than walking a lap faces the camera:
            // these all used to pin dir 0, which is the row drawn from BEHIND.
            if (c.teamIdx === null) {
                return { x: c.x, z: c.z, dir: FACING_CAMERA }
            }
            const tbl = PARTICIPANT_TABLES[c.teamIdx]
            if (!tbl) return { x: c.x, z: c.z, dir: FACING_CAMERA }
            // c.speed carries the direction of the orbit, so an anticlockwise walker
            // faces the way it is actually going rather than moonwalking its lap.
            const pos = walkPos(c.phase, tbl, c.speed)
            return { x: toX(pos.x), z: toZ(pos.y), dir: pos.dir }
        }

        // ---------------------------------------------------- multiplayer: local control

        // Movement runs in the 2D room plan's px space (where the shared collision
        // geometry lives) and is projected into world units for rendering.
        const toPxX = (x: number) => (x + ROOM_W / 2) * TILE
        const toPxY = (z: number) => z * TILE + WALL_Y
        const colliders = buildStaticColliders()
        /** `?noclip=1`: walk through the furniture and out through the walls.
         * Local only — the hub still validates what we report, so nobody else
         * sees the room leak. See ./noclip.ts. */
        const noclip = parseNoclipOverride(window.location.search)

        let localChar: CharState | null = null
        const localInput = createRoomLocalInput()
        const localPx = { x: 0, y: 0 }
        let localDir: WalkDir = FACING_CAMERA
        let localMoving = false
        let lastSelfSentAt = 0
        let lastSelfSent: RoomSelfState | null = null
        /** A floor drag looks away from the character; the next movement key hands
         * the camera back to the follow-cam. */
        let cameraFollowSuspended = false
        /** Mid-conversation: movement and interact are locked until this passes.
         * The hub enforces the same freeze; this keeps the local prediction from
         * drifting away from it. */
        let inputFrozenUntil = 0

        /** How much of the gap to a remote character's hub position survives one sim
         * step — snapshots land at 10 Hz, so this closes most of a gap between two
         * of them without the jitter of hard snapping. */
        const NET_KEEP_PER_STEP = 0.86
        /** Beyond this (world units), stop gliding and teleport — a reconnect or a
         * disconnect hand-back, not ordinary movement. */
        const NET_SNAP_DIST = 7

        const stepLocalControl = () => {
            if (!localInput.canInteract() || performance.now() < inputFrozenUntil) {
                localMoving = false
                return
            }
            const { dx, dy } = localInput.movement()
            const active = dx !== 0 || dy !== 0
            localMoving = active
            if (!active) return
            cameraFollowSuspended = false
            const norm = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1
            const step = PLAYER_SPEED_PX_PER_STEP * norm
            if (noclip) {
                // Integrate the raw input: no colliders, and no ROOM_BOUNDS either
                // (that clamp lives inside pointBlocked, so going through
                // movePlayer with an empty collider list would still fence us
                // into the carpet).
                localPx.x += dx * step
                localPx.y += dy * step
            } else {
                const moved = movePlayer(localPx.x, localPx.y, dx * step, dy * step, colliders)
                localPx.x = moved.x
                localPx.y = moved.y
            }
            localDir = facingForInput(dx, dy, localDir)
        }

        /** Everything the point-probe tier can hit: the other characters, the room's
         * objects, and the wall screen. Shared by the interact button and the
         * proximity outline, so the two always ask the same question. */
        const probeCandidates = (): ProbeCandidate[] => {
            const candidates: ProbeCandidate[] = []
            for (const c of standing()) {
                candidates.push({ key: c.playerIdx, x: toPxX(c.x), y: toPxY(c.z) })
            }
            // Objects share the probe with characters, keyed into their own idx range.
            ROOM_OBJECTS.forEach((obj, i) => {
                candidates.push({ key: OBJECT_IDX_BASE + i, x: obj.x, y: obj.y })
            })
            // The wall screen is a target too, but a private one.
            candidates.push({ key: BIG_SCREEN_IDX, x: BIG_SCREEN_POINT.x, y: BIG_SCREEN_POINT.y })
            // So is Primey — same private treatment, for the same reason.
            if (primeyVisible) candidates.push({ key: PRIMEY_IDX, x: PRIMEY_POINT.x, y: PRIMEY_POINT.y })
            // And the arcade cabinet, only while this client can see it.
            if (arcadeVisible) candidates.push({ key: ARCADE_IDX, x: ARCADE_POINT.x, y: ARCADE_POINT.y })
            return candidates
        }

        /** What the interact button would answer right now, or null. */
        const currentInteractTarget = (): RoomInteractTarget | null => {
            if (!localChar) return null
            return resolveRoomInteract(
                { x: localPx.x, y: localPx.y, dir: localDir },
                probeCandidates(),
            )
        }

        const fireInteract = () => {
            // No onInteract gate here: the wall screen's page turns locally, so a
            // press is worth taking even with nobody listening on the hub side.
            if (!localChar) return
            if (!localInput.canInteract()) return
            if (performance.now() < inputFrozenUntil) return
            const hit = currentInteractTarget()
            if (!hit) return
            if (backroomsUnlocked && hit.kind !== "table" && roomObjectByIdx(hit.key)?.id === "plant-se") {
                localInput.releaseMovement()
                localMoving = false
                opts.onBackroomsEnter?.()
                return
            }
            // A desk opens local UI. Like the screen's page turn, it never reaches
            // the hub's interact wire.
            if (hit.kind === "table") {
                opts.onTableInteract?.(hit.tableIdx)
                return
            }
            // The screen answers interact by framing itself, and everything that
            // follows — the page turns, backing out again — is local too, so none of
            // it goes near the hub's interact wire.
            if (hit.key === BIG_SCREEN_IDX) {
                setScreenFocus(!screenFocused)
                return
            }
            // Primey answers by opening its chat panel over the room. Also local: the
            // conversation is this visitor's, not the room's.
            if (hit.key === PRIMEY_IDX) {
                opts.onPrimeyInteract?.()
                return
            }
            // The cabinet opens the fighter over the room. Local, like Primey.
            if (hit.key === ARCADE_IDX) {
                localInput.releaseMovement()
                localMoving = false
                opts.onArcadeInteract?.()
                return
            }
            // An agent answers through the host, not the hub: what a conversation
            // with one is depends on the app the agents belong to.
            const target = charByPlayerIdx.get(hit.key)
            if (target?.agent) {
                if (!target.agent.leaving) opts.onAgentInteract?.(target.agent.id)
                return
            }
            opts.onInteract?.(hit.key)
        }

        /** Move the outline onto the current interact target, or hide it. Called
         * every frame — the probe is a handful of squared distances. */
        const updateInteractHighlight = () => {
            const target = currentInteractTarget()
            if (!target) {
                interactHighlight.visible = false
                return
            }
            if (target.kind === "table") {
                const tbl = PARTICIPANT_TABLES[target.tableIdx]
                if (!tbl) {
                    interactHighlight.visible = false
                    return
                }
                interactHighlight.scale.set(tbl.w / TILE + 1.4, tbl.h / TILE + 1.4, 1)
                interactHighlight.position.set(toX(tbl.x + tbl.w / 2), 0.03, toZ(tbl.y + tbl.h / 2))
                interactHighlight.visible = true
                return
            }
            // Primey is not in the hub's object list, so it needs its own answer here
            // — without one the outline would go dark on the one target in the room
            // that opens a whole panel.
            if (target.key === PRIMEY_IDX) {
                interactHighlight.scale.set(2.4, 2.4, 1)
                interactHighlight.position.set(toX(PRIMEY_POINT.x), 0.03, toZ(PRIMEY_POINT.y))
                interactHighlight.visible = true
                return
            }
            if (target.key === ARCADE_IDX) {
                interactHighlight.scale.set(2.4, 2.4, 1)
                interactHighlight.position.set(toX(ARCADE_POINT.x), 0.03, toZ(ARCADE_POINT.y))
                interactHighlight.visible = true
                return
            }
            const obj = roomObjectByIdx(target.key)
            if (!obj) {
                interactHighlight.visible = false
                return
            }
            interactHighlight.scale.set(2.4, 2.4, 1)
            interactHighlight.position.set(toX(obj.x), 0.03, toZ(obj.y))
            interactHighlight.visible = true
        }

        const isTextEntryTarget = (e: KeyboardEvent) => {
            const t = e.target
            return (
                t instanceof HTMLInputElement ||
                t instanceof HTMLTextAreaElement ||
                (t instanceof HTMLElement && t.isContentEditable)
            )
        }
        const MOVE_KEY: Record<string, RoomMoveDirection> = {
            w: "up", arrowup: "up",
            s: "down", arrowdown: "down",
            a: "left", arrowleft: "left",
            d: "right", arrowright: "right",
        }
        const onControlKeyDown = (e: KeyboardEvent) => {
            if (renderPaused) return
            if (!localChar || e.altKey || e.ctrlKey || e.metaKey || isTextEntryTarget(e)) return
            const key = e.key.toLowerCase()
            // While the screen is framed the walk keys read it instead of walking it:
            // left and right turn pages, down backs out AND walks away in the one
            // press, up has nothing but wall behind it.
            const framed = screenFocusKeyAction(key, screenFocused)
            if (framed) {
                e.preventDefault()
                applyFramedAction(framed)
                if (framed === "exit-and-move") localInput.setMoveInput("down", true)
                return
            }
            const move = MOVE_KEY[key]
            if (move) {
                localInput.setMoveInput(move, true)
                e.preventDefault()
                return
            }
            if (key === " " || key === "e") {
                // Space is the interact button (E stays as an alias; Enter belongs to
                // the chat box); preventDefault also keeps space from scrolling the page.
                e.preventDefault()
                if (e.repeat) return
                // Shift+Space is the snap's mic chord (useSnapMic), not an interact.
                if (e.shiftKey) return
                fireInteract()
            }
        }
        const onControlKeyUp = (e: KeyboardEvent) => {
            const move = MOVE_KEY[e.key.toLowerCase()]
            if (move) localInput.setMoveInput(move, false)
        }
        window.addEventListener("keydown", onControlKeyDown)
        window.addEventListener("keyup", onControlKeyUp)
        window.addEventListener("blur", localInput.releaseMovement)
        registerCleanup(() => {
            window.removeEventListener("keydown", onControlKeyDown)
            window.removeEventListener("keyup", onControlKeyUp)
            window.removeEventListener("blur", localInput.releaseMovement)
        })

        // Presence halos mark every character currently controlled by a connected
        // player; the local character uses the same role-coloured mesh as remotes.
        /** setLocalPlayer aimed at a guest character that has not finished
         * materializing; the guest creation path completes the hand-over. */
        let pendingLocal: { playerIdx: number; start?: { x: number; y: number } } | null = null

        const activateLocalControl = (next: CharState, start?: { x: number; y: number }) => {
            setScreenFocus(false)
            if (localChar) {
                // Hand the old character back to the hub/wander path from where it
                // stands; the net glide (or the next wander snap) takes it from here.
                localChar.net = null
            }
            localChar = next
            localInput.releaseMovement()
            localMoving = false
            lastSelfSent = null
            cameraFollowSuspended = false
            next.net = null
            next.transition = null
            // Start where the hub says the character is; fall back to its local
            // authoritative position.
            if (start) {
                localPx.x = start.x
                localPx.y = start.y
            } else {
                const home = authoritativePosition(next)
                localPx.x = toPxX(home.x)
                localPx.y = toPxY(home.z)
            }
            next.x = toX(localPx.x)
            next.z = toZ(localPx.y)
            localDir = FACING_CAMERA
            next.presenceHalo.visible = true
        }

        const releaseLocalControl = () => {
            setScreenFocus(false)
            if (localChar) {
                localChar.net = null
                localChar.presenceHalo.visible = false
            }
            localChar = null
            localInput.releaseMovement()
            localMoving = false
            lastSelfSent = null
        }

        // ------------------------------------------------------- multiplayer: speech

        const SPEECH_MS = 4_000
        const SPEECH_RISE = 1.34
        const speechBubbles = new Map<number, {
            sprite: THREE.Sprite
            material: THREE.SpriteMaterial
            texture: THREE.CanvasTexture
            expiresAt: number
        }>()
        const clearSpeech = (playerIdx: number) => {
            const bubble = speechBubbles.get(playerIdx)
            if (!bubble) return
            scene.remove(bubble.sprite)
            bubble.material.dispose()
            bubble.texture.dispose()
            speechBubbles.delete(playerIdx)
        }
        const showSpeechFor = (playerIdx: number, text: string, ms = SPEECH_MS) => {
            if (!charByPlayerIdx.has(playerIdx)) return
            clearSpeech(playerIdx)
            const texture = makeSpeechTexture(text)
            const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
            const sprite = new THREE.Sprite(material)
            sprite.scale.set(4.6, 1.34, 1)
            sprite.renderOrder = 22
            scene.add(sprite)
            speechBubbles.set(playerIdx, { sprite, material, texture, expiresAt: performance.now() + ms })
        }
        /** A bubble over an interactable object (they share the bubble map — object
         * idxs live far above any playerIdx). Objects don't move, so the bubble is
         * placed once. */
        const showObjectSpeechFor = (objectIdx: number, text: string) => {
            const obj = roomObjectByIdx(objectIdx)
            if (!obj) return
            clearSpeech(objectIdx)
            const texture = makeSpeechTexture(text)
            const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
            const sprite = new THREE.Sprite(material)
            sprite.scale.set(4.6, 1.34, 1)
            sprite.renderOrder = 22
            // above the corner plants' 3.4-unit billboards
            sprite.position.set(toX(obj.x), 4.15, toZ(obj.y))
            scene.add(sprite)
            speechBubbles.set(objectIdx, { sprite, material, texture, expiresAt: performance.now() + SPEECH_MS })
        }
        registerCleanup(() => {
            for (const playerIdx of [...speechBubbles.keys()]) clearSpeech(playerIdx)
        })

        /** Take a character out of the room and release what was its own. */
        const destroyChar = (c: CharState) => {
            if (localChar === c) releaseLocalControl()
            clearSpeech(c.playerIdx)
            snapped.delete(c)
            scene.remove(c.mesh)
            scene.remove(c.presenceHalo)
            // The plane geometry and shadow blob are shared with the whole cast; only
            // this character's cloned texture and material are its own.
            c.texture.dispose()
            c.material.dispose()
            const at = chars.indexOf(c)
            if (at >= 0) chars.splice(at, 1)
            charByPlayerIdx.delete(c.playerIdx)
            nameTagCache.get(c.playerIdx)?.dispose()
            nameTagCache.delete(c.playerIdx)
            if (hoverPlayerIdx === c.playerIdx) setHoveredPlayer(null)
            if (selectedChar() === c) {
                selection = null
                applySelection()
            }
        }

        // ------------------------------------------------------- multiplayer: guests

        // Visitors get transient characters that exist only while they are
        // connected — created at runtime, because rebuilding the WebGL scene per
        // join would black-flash the room.
        const guestPlayerIdxs = new Set<number>()

        const spawnGuestChar = (guest: {
            playerIdx: number
            name: string
            role?: RoomRole
            spriteId?: number | null
            spriteSheet?: string | null
            start?: { x: number; y: number }
        }) => {
            if (guestPlayerIdxs.has(guest.playerIdx) || charByPlayerIdx.has(guest.playerIdx)) return
            guestPlayerIdxs.add(guest.playerIdx)
            void (async () => {
                const resolved = resolveSprite(guest.spriteId, guest.spriteSheet, guest.playerIdx, 0)
                let source: THREE.Texture | null = null
                if (resolved.kind === "custom") source = await loadCustomSheet(resolved.sheetDataUrl)
                if (!source) {
                    const sheetIdx =
                        resolved.kind === "builtin"
                            ? resolved.charIdx
                            : characterIdForPlayer(guest.playerIdx, 0)
                    source = charSheets[sheetIdx % charSheets.length]!
                }
                // Departed (or the scene died) while the sheet was decoding.
                if (cleanedUp || !guestPlayerIdxs.has(guest.playerIdx) || charByPlayerIdx.has(guest.playerIdx)) return

                const role = guest.role ?? "visitor"
                const c = createCharacter({
                    playerIdx: guest.playerIdx,
                    name: guest.name,
                    role,
                    haloColor: roleHaloColor(role),
                    source,
                    teamIdx: null,
                    seatIdx: 0,
                    x: guest.start ? toX(guest.start.x) : 0,
                    z: guest.start ? toZ(guest.start.y) : ROOM_D - 2,
                })
                if (pendingLocal?.playerIdx === guest.playerIdx) {
                    const start = pendingLocal.start ?? guest.start
                    pendingLocal = null
                    activateLocalControl(c, start)
                }
            })()
        }

        const removeGuestChar = (playerIdx: number) => {
            guestPlayerIdxs.delete(playerIdx)
            if (pendingLocal?.playerIdx === playerIdx) pendingLocal = null
            const c = charByPlayerIdx.get(playerIdx)
            if (c) destroyChar(c)
        }
        registerCleanup(() => {
            for (const playerIdx of [...guestPlayerIdxs]) removeGuestChar(playerIdx)
        })

        // ------------------------------------------------------------- agents

        let nextAgentIdx = AGENT_IDX_BASE
        const agentChars = new Map<string, CharState>()
        /** Agents whose sheet is still decoding, with the latest input to apply
         * when it lands. */
        const pendingAgents = new Map<string, RoomAgentInput>()
        /** Which orbit slots each desk has taken. */
        const seatsTaken = new Map<number, Set<number>>()

        /** The emptiest desk's lowest free slot, or null once every desk is full. */
        const allocateSeat = (): { table: number; seat: number } | null => {
            let best: number | null = null
            let bestCount = Number.POSITIVE_INFINITY
            for (const table of AGENT_TABLE_IDXS) {
                const taken = seatsTaken.get(table)?.size ?? 0
                if (taken < SEATS_PER_TABLE && taken < bestCount) {
                    best = table
                    bestCount = taken
                }
            }
            if (best === null) return null
            const taken = seatsTaken.get(best) ?? new Set<number>()
            seatsTaken.set(best, taken)
            let seat = 0
            while (taken.has(seat)) seat++
            taken.add(seat)
            return { table: best, seat }
        }
        const releaseSeat = (seat: { table: number; seat: number }) => {
            seatsTaken.get(seat.table)?.delete(seat.seat)
        }

        /** Where a new agent appears: the open aisle south of the desks. */
        const AISLE_Y = Math.max(...PARTICIPANT_TABLES.map((tbl) => tbl.y + tbl.h)) + 48
        const aisleSpot = (n: number) =>
            nearestFreePoint(340 + ((n * 53) % 140), AISLE_Y + ((n * 29) % 36), colliders)

        const cssColor = (css: string): number => new THREE.Color(css).getHex()

        const sourceForAgent = async (agent: RoomAgentInput): Promise<THREE.Texture> => {
            if (typeof agent.sprite === "string") {
                const custom = await loadCustomSheet(agent.sprite)
                if (custom) return custom
            }
            const idx = typeof agent.sprite === "number" && Number.isInteger(agent.sprite)
                ? agent.sprite
                : hashAgentId(agent.id)
            return charSheets[((idx % charSheets.length) + charSheets.length) % charSheets.length]!
        }

        /** Redraw a character from another sheet, keeping everything else. */
        const applyCharSheet = (c: CharState, source: THREE.Texture) => {
            const img = source.image as HTMLImageElement
            const format = sheetFormatFor(img.width, img.height)
            const tex = source.clone()
            tex.repeat.set(1 / format.cols, 1 / format.rows)
            c.texture.dispose()
            c.texture = tex
            c.material.map = tex
            c.material.needsUpdate = true
            if (format.cellW !== c.format.cellW || format.cellH !== c.format.cellH) {
                c.mesh.geometry = planeForSheet(format)
                for (const child of c.mesh.children) {
                    if ((child as THREE.Mesh).geometry === blobGeo) child.position.y = characterShadowLocalY(format)
                }
            }
            c.format = format
        }

        /** The host changed an agent's sprite: decode it and swap the sheet,
         * unless the agent has changed again (or gone) by the time it lands. */
        const refreshAgentSheet = (c: CharState, agent: RoomAgentInput) => {
            const state = c.agent!
            if (state.sprite === agent.sprite) return
            state.sprite = agent.sprite
            void sourceForAgent(agent).then((source) => {
                if (cleanedUp || agentChars.get(agent.id) !== c || c.agent?.sprite !== agent.sprite) return
                applyCharSheet(c, source)
            })
        }

        const clearStatusBubble = (c: CharState) => {
            const bubble = c.agent?.bubble
            if (!c.agent || !bubble) return
            scene.remove(bubble.sprite)
            bubble.material.dispose()
            bubble.texture.dispose()
            c.agent.bubble = null
            c.agent.bubbleText = null
        }

        /** Seat an agent at a desk, or take it out of one to follow its family. */
        const applyAgentSeat = (c: CharState, agent: RoomAgentInput) => {
            const state = c.agent!
            const follow = agent.follow ?? null
            const wasFollowing = state.follow !== null
            state.follow = follow
            if (follow && state.seat) {
                // Called away from its desk: the seat frees for the next arrival.
                releaseSeat(state.seat)
                state.seat = null
                c.teamIdx = null
                c.transition = null
            } else if (!follow && wasFollowing && !state.seat) {
                // Back on its own: the emptiest desk, walked to from where it stands.
                const seat = allocateSeat()
                state.seat = seat
                if (seat) {
                    const wander = seedWander(c.playerIdx, seat.table, seat.seat)
                    c.phase = wander.phase
                    c.speed = wander.speed
                    c.pauseLeft = wander.pauseLeft
                    c.rng = wander.rng
                    c.teamIdx = seat.table
                    c.transition = { fromX: c.x, fromZ: c.z, startedAt: performance.now(), duration: AGENT_WALK_IN_MS }
                }
            }
        }

        /** Give a character the look its agent's status asks for. */
        const applyAgentLook = (c: CharState, agent: RoomAgentInput) => {
            const state = c.agent!
            state.style = agent.style
            applyAgentSeat(c, agent)
            if (c.name !== agent.name) {
                c.name = agent.name
                nameTagCache.get(c.playerIdx)?.dispose()
                nameTagCache.delete(c.playerIdx)
                if (selectedChar() === c) applySelection()
            }
            const halo = agent.color ?? agent.style.halo
            if (halo) {
                ;(c.presenceHalo.material as THREE.MeshBasicMaterial).color.setHex(cssColor(halo))
                c.presenceHalo.visible = !state.leaving
            } else {
                c.presenceHalo.visible = false
            }
            const text = state.leaving ? null : bubbleTextFor(agent, agent.style)
            if (text === state.bubbleText) return
            clearStatusBubble(c)
            if (!text) return
            const texture = makeSpeechTexture(text)
            const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
            const sprite = new THREE.Sprite(material)
            sprite.scale.set(4.6, 1.34, 1)
            sprite.renderOrder = 22
            scene.add(sprite)
            state.bubble = { sprite, material, texture }
            state.bubbleText = text
        }

        const upsertAgentChar = (agent: RoomAgentInput) => {
            const existing = agentChars.get(agent.id)
            if (existing?.agent) {
                if (existing.agent.leaving) {
                    // Back before its fade finished: it stays, and the fade is
                    // undone — the seat was never freed, so it is still its own.
                    existing.agent.leaving = null
                    existing.material.alphaTest = 0.5
                    existing.material.depthWrite = true
                    existing.material.needsUpdate = true
                }
                refreshAgentSheet(existing, agent)
                applyAgentLook(existing, agent)
                return
            }
            const decoding = pendingAgents.has(agent.id)
            pendingAgents.set(agent.id, agent)
            if (decoding) return
            void (async () => {
                const source = await sourceForAgent(agent)
                const latest = pendingAgents.get(agent.id)
                // Removed (or the scene died) while the sheet was decoding.
                if (cleanedUp || !latest) return
                pendingAgents.delete(agent.id)
                const playerIdx = nextAgentIdx++
                // A follower takes no desk: it walks behind its family instead.
                const seat = latest.follow ? null : allocateSeat()
                const spawn = aisleSpot(playerIdx - AGENT_IDX_BASE)
                const c = createCharacter({
                    playerIdx,
                    name: latest.name,
                    role: "visitor",
                    haloColor: 0x40ff88,
                    source,
                    teamIdx: seat?.table ?? null,
                    seatIdx: seat?.seat ?? 0,
                    x: toX(spawn.x),
                    z: toZ(spawn.y),
                })
                c.agent = {
                    id: latest.id,
                    style: latest.style,
                    bubbleText: null,
                    bubble: null,
                    seat,
                    leaving: null,
                    // The sheet decoded is the one first asked for; a sprite that
                    // changed while it was decoding is picked up just below.
                    sprite: agent.sprite,
                    follow: null,
                    followDir: FACING_CAMERA,
                    trail: [],
                }
                agentChars.set(latest.id, c)
                // Walk in from the aisle to the desk's orbit (or the family's
                // line) over a beat.
                if (seat || latest.follow) c.transition = { fromX: c.x, fromZ: c.z, startedAt: performance.now(), duration: AGENT_WALK_IN_MS }
                refreshAgentSheet(c, latest)
                applyAgentLook(c, latest)
            })()
        }

        const removeAgentChar = (agentId: string) => {
            pendingAgents.delete(agentId)
            const c = agentChars.get(agentId)
            if (!c?.agent || c.agent.leaving) return
            c.agent.leaving = { startedAt: performance.now() }
            // The sprite is cut out with alphaTest, which turns opacity into a
            // cliff at 0.5; lowering it lets the fade run all the way down.
            c.material.alphaTest = 0.02
            c.material.depthWrite = false
            c.material.needsUpdate = true
            c.presenceHalo.visible = false
            clearStatusBubble(c)
            if (hoverPlayerIdx === c.playerIdx) setHoveredPlayer(null)
        }

        /** The fade is over: the character leaves the room and frees its seat. */
        const finishAgentRemoval = (c: CharState) => {
            const state = c.agent
            if (!state) return
            if (state.seat) releaseSeat(state.seat)
            agentChars.delete(state.id)
            destroyChar(c)
        }
        registerCleanup(() => {
            pendingAgents.clear()
            for (const c of [...agentChars.values()]) {
                clearStatusBubble(c)
                finishAgentRemoval(c)
            }
        })

        // selected-player marker (bobbing gold diamond) + name tags
        const marker = new THREE.Mesh(
            track(new THREE.OctahedronGeometry(0.26)),
            track(new THREE.MeshBasicMaterial({ color: 0xffd040, toneMapped: false })),
        )
        marker.visible = false
        scene.add(marker)

        const selTagMat = track(new THREE.SpriteMaterial({ map: null, depthTest: false }))
        const selTag = new THREE.Sprite(selTagMat)
        selTag.scale.set(2.9, 0.72, 1)
        selTag.renderOrder = 21
        selTag.visible = false
        scene.add(selTag)

        const hoverTagMat = track(new THREE.SpriteMaterial({ map: null, depthTest: false }))
        const hoverTag = new THREE.Sprite(hoverTagMat)
        hoverTag.scale.set(2.9, 0.72, 1)
        hoverTag.renderOrder = 21
        hoverTag.visible = false
        scene.add(hoverTag)

        const nameTagCache = new Map<number, THREE.CanvasTexture>()
        const nameTagFor = (c: CharState): THREE.CanvasTexture => {
            let tex = nameTagCache.get(c.playerIdx)
            if (!tex) {
                tex = track(makeNameTagTexture(c.name))
                nameTagCache.set(c.playerIdx, tex)
            }
            return tex
        }

        // ------------------------------------------------------------ post fx

        // The grade pass is a screen pass and a render target of its own, and
        // EffectComposer sizes every target at the device pixel ratio, so on a
        // dense display the post chain can outweigh the room. The bottom tier drops
        // the composer entirely and draws straight to the canvas —
        // `renderer.toneMapping` and the output colour space still apply, so what
        // is lost is the vignette, not the whole look.
        //
        // There is no bloom pass. It haloed anything pale under a desk pool — the
        // exhibition desks' white tops most of all — and was removed outright.
        //
        // The grade is built whatever the tier and toggled through `enabled`,
        // because the frame-budget watcher has to be able to switch it off
        // mid-session without rebuilding the scene.
        let composer: EffectComposer | null = null
        let grade: ShaderPass | null = null
        if (q.grade) {
            composer = track(new EffectComposer(renderer))
            composer.addPass(track(new RenderPass(scene, camera)))
            composer.addPass(track(new OutputPass()))
            grade = track(new ShaderPass(RoomGradeShader))
            grade.enabled = q.grade
            composer.addPass(grade)
        }

        // ------------------------------------------------------------ input

        const raycaster = new THREE.Raycaster()
        const pointerNdc = new THREE.Vector2()
        const dragFloor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const dragPoint = new THREE.Vector3()

        // Where the camera has been slid to. The viewport drives this from the
        // keyboard through setCameraPan, a floor drag drives it from down here, and
        // both land in the same place.
        let cameraPan: RoomCameraPan = { x: 0, z: 0 }
        // Framing the wall screen. Pressing interact under it — or clicking it from
        // anywhere in the room — lifts the camera off the room and puts it square on
        // the glass, where the walk keys turn pages instead of walking. It rides ON
        // TOP of the pan rather than replacing it, so backing out eases straight
        // into wherever the follow-cam had got to.
        let screenFocused = false
        /** 0 = the room's own raked view, 1 = the screen filling the frame. */
        let screenFocusT = 0
        /** Measured fresh every time rather than cached: it depends on the aspect
         * AND the zoom, both of which a resize, a pinch or a +/− press can move
         * under it, and it is a handful of tangents. */
        const framedPose = (): CameraPose =>
            screenFocusPose({
                width: SCREEN_W,
                height: SCREEN_H,
                centreY: SCREEN_CY,
                z: screen.position.z,
                fovDeg: camera.fov,
                aspect: camera.aspect,
                zoom: camera.zoom,
            })

        /** A close view of the cabinet for its entrance: over Primey's shoulder
         * from the south, aimed a little above the cabinet so the frame holds the
         * floor it lands on AND the height it falls from. */
        const arcadeFramedPose = (): CameraPose => {
            const x = toX(ARCADE_POINT.x)
            const z = toZ(ARCADE_POINT.y)
            return {
                position: { x: x - 1.5, y: 12, z: z + 15 },
                target: { x: x - 0.5, y: 4.6, z },
            }
        }

        /** Put the camera where the pan and the screen focus between them say it
         * goes. Every mover of the camera ends up here. */
        const syncCamera = () => {
            const room: CameraPose = {
                position: {
                    x: cameraHomePosition.x + cameraPan.x,
                    y: cameraHomePosition.y,
                    z: cameraHomePosition.z + cameraPan.z,
                },
                target: {
                    x: cameraHomeTarget.x + cameraPan.x,
                    y: cameraHomeTarget.y,
                    z: cameraHomeTarget.z + cameraPan.z,
                },
            }
            let pose = screenFocusT > 0 ? blendCameraPose(room, framedPose(), screenFocusT) : room
            // The cabinet's entrance rides on top of everything else, shake and all.
            if (arcadeFocusT > 0) pose = blendCameraPose(pose, arcadeFramedPose(), arcadeFocusT)
            camera.position.set(pose.position.x + arcadeShake.x, pose.position.y, pose.position.z + arcadeShake.z)
            camera.lookAt(pose.target.x + arcadeShake.x, pose.target.y, pose.target.z + arcadeShake.z)
        }

        const applyCameraPan = (pan: RoomCameraPan) => {
            cameraPan = clampRoomCameraPan(pan)
            syncCamera()
        }

        /** Carry out what a framed-screen key (or its touch-pad equivalent) means. */
        const applyFramedAction = (action: ScreenFocusKeyAction) => {
            if (action === "swallow") return
            setScreenFocus(false)
        }

        /** Whether the room's furniture is currently stood down for the screen. */
        let occludersHidden = false
        /** Show or hide the furniture in front of the screen, if the blend has just
         * crossed the point where that changes. */
        const applyScreenOccluders = () => {
            const hide = screenFocusHidesRoom(screenFocusT)
            if (hide === occludersHidden) return
            occludersHidden = hide
            for (const object of screenOccluders) object.visible = !hide
        }

        const setScreenFocus = (next: boolean) => {
            if (screenFocused === next) return
            // Somebody stepping out of the framed view has taken the camera back: the
            // bulletin no longer holds it, so its coming down will not move them.
            if (!next) bulletinFocusHeld = false
            screenFocused = next
            // The follow-cam and the framed pose would otherwise fight over the camera
            // every frame; suspending it is the same "somebody else is driving" flag a
            // floor drag sets, and letting it go hands the view back to the character.
            cameraFollowSuspended = next
            if (next) localInput.releaseMovement()
        }

        /** Where a screen point lands on the floor, or null if it misses entirely. */
        const groundAt = (clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 | null => {
            const rect = renderer.domElement.getBoundingClientRect()
            pointerNdc.set(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            )
            raycaster.setFromCamera(pointerNdc, camera)
            return raycaster.ray.intersectPlane(dragFloor, out) ? out : null
        }

        // A press that has not yet travelled far enough to be a pan is still a click,
        // so the basis is measured up front and the camera only starts moving once
        // the pointer clears DRAG_PAN_THRESHOLD_PX.
        let activePanDrag: {
            pointerId: number
            startClientX: number
            startClientY: number
            panAtStart: RoomCameraPan
            /** Floor movement per pixel of pointer travel, along each screen axis. */
            worldPerPxX: THREE.Vector3
            worldPerPxY: THREE.Vector3
            panning: boolean
        } | null = null
        /** A drag ends in a click event too; that one must not select anything. */
        let suppressNextClick = false
        const panProbeOrigin = new THREE.Vector3()
        const panProbeX = new THREE.Vector3()
        const panProbeY = new THREE.Vector3()
        const interactProbe = new THREE.Vector3()

        let pointerDirty = false
        let hoverPlayerIdx: number | null = null

        const setHoveredPlayer = (playerIdx: number | null) => {
            if (playerIdx === hoverPlayerIdx) return
            hoverPlayerIdx = playerIdx
            if (playerIdx !== null && charByPlayerIdx.get(playerIdx) !== selectedChar()) {
                const c = charByPlayerIdx.get(playerIdx)
                if (c) {
                    hoverTagMat.map = nameTagFor(c)
                    hoverTagMat.needsUpdate = true
                    hoverTag.visible = true
                    return
                }
            }
            hoverTag.visible = false
        }

        const updatePointer = (e: PointerEvent | MouseEvent) => {
            const r = renderer.domElement.getBoundingClientRect()
            pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
            pointerDirty = true
        }

        const pickAt = (): RoomSelection => {
            raycaster.setFromCamera(pointerNdc, camera)
            const charHits = raycaster.intersectObjects(pickableCharMeshes(), false)
            if (charHits.length > 0) {
                return selectionFor(charByPlayerIdx.get(charHits[0]!.object.userData.playerIdx as number))
            }
            // A table that has been stood down for the screen is not standing there to
            // be clicked: its hitbox is still in the list, but nothing is drawn at it.
            const tblHits = occludersHidden ? [] : raycaster.intersectObjects(tableHitboxes, false)
            if (tblHits.length > 0) {
                return { type: "desk", idx: tblHits[0]!.object.userData.tableIdx as number }
            }
            return null
        }

        /** Is the pointer over the wall screen? */
        const screenHitAt = (): boolean => {
            raycaster.setFromCamera(pointerNdc, camera)
            return raycaster.intersectObject(screen, false).length > 0
        }

        /** Is the pointer over the (visible) arcade cabinet? */
        const arcadeHitAt = (): boolean => {
            if (!arcade || !arcadeVisible) return false
            raycaster.setFromCamera(pointerNdc, camera)
            return raycaster.intersectObject(arcade, true).length > 0
        }

        /** The raycaster does not honour `visible`; a dusted (or departing)
         * character has to be left out of the list or the pointer keeps finding
         * a ghost. */
        const pickableCharMeshes = () => chars.filter((c) => !snapped.has(c) && !c.agent?.leaving).map((c) => c.mesh)

        /** What a character is, as a pick: the agent, or the visitor's index. */
        const selectionFor = (c: CharState | undefined): RoomSelection => {
            if (!c) return null
            return c.agent ? { type: "agent", id: c.agent.id } : { type: "player", idx: c.playerIdx }
        }

        const pickCharacterAt = (): CharState | null => {
            raycaster.setFromCamera(pointerNdc, camera)
            const hits = raycaster.intersectObjects(pickableCharMeshes(), false)
            if (hits.length === 0) return null
            return charByPlayerIdx.get(hits[0]!.object.userData.playerIdx as number) ?? null
        }


        const onClick = (e: MouseEvent) => {
            // The click that ends a floor drag would otherwise land as a selection.
            if (suppressNextClick) {
                suppressNextClick = false
                return
            }
            updatePointer(e)
            // Clicking the screen frames it, the same as pressing interact under it.
            // No proximity probe on this path: a click has already singled out the
            // thing it means, so it works from wherever the player is standing.
            if (localChar && screenHitAt()) {
                setScreenFocus(!screenFocused)
                return
            }
            // The cabinet answers a click from anywhere, so a spectator with no
            // character to walk up can still play.
            if (performance.now() >= inputFrozenUntil && arcadeHitAt()) {
                localInput.releaseMovement()
                localMoving = false
                opts.onArcadeInteract?.()
                return
            }
            opts.onPick?.(pickAt())
        }

        // Touch takes the same drag-pan as the mouse: the canvas is touch-action
        // none (the page beneath never scrolls from it), so a finger on the floor
        // can safely grab the room.
        const beginPanDrag = (e: PointerEvent) => {
            const origin = groundAt(e.clientX, e.clientY, panProbeOrigin)
            const alongX = groundAt(e.clientX + PAN_PROBE_PX, e.clientY, panProbeX)
            const alongY = groundAt(e.clientX, e.clientY + PAN_PROBE_PX, panProbeY)
            // A press aimed past the horizon has no floor under it to grab.
            if (!origin || !alongX || !alongY) return
            activePanDrag = {
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                panAtStart: { ...cameraPan },
                worldPerPxX: alongX.clone().sub(origin).divideScalar(PAN_PROBE_PX),
                worldPerPxY: alongY.clone().sub(origin).divideScalar(PAN_PROBE_PX),
                panning: false,
            }
        }

        const updatePanDrag = (e: PointerEvent) => {
            const drag = activePanDrag
            if (!drag || drag.pointerId !== e.pointerId) return
            const dx = e.clientX - drag.startClientX
            const dy = e.clientY - drag.startClientY
            if (!drag.panning) {
                if (!isDragPan(dx, dy)) return
                drag.panning = true
                // Dragging the room is a deliberate look elsewhere; the screen lets go —
                // before the suspension below, which un-framing would otherwise clear.
                setScreenFocus(false)
                cameraFollowSuspended = true
                renderer.domElement.setPointerCapture(e.pointerId)
                renderer.domElement.style.cursor = "grabbing"
                setHoveredPlayer(null)
            }
            const next = panFromDrag(drag.panAtStart, {
                x: drag.worldPerPxX.x * dx + drag.worldPerPxY.x * dy,
                z: drag.worldPerPxX.z * dx + drag.worldPerPxY.z * dy,
            })
            applyCameraPan(next)
            opts.onCameraPan?.(next)
        }

        const finishPanDrag = (e: PointerEvent) => {
            const drag = activePanDrag
            if (!drag || drag.pointerId !== e.pointerId) return
            activePanDrag = null
            if (!drag.panning) return
            suppressNextClick = true
            renderer.domElement.style.cursor = "default"
            if (renderer.domElement.hasPointerCapture(e.pointerId)) {
                renderer.domElement.releasePointerCapture(e.pointerId)
            }
        }

        // Two fingers on the canvas pinch-zoom the camera. The gesture takes over
        // from any pan the first finger had started, and — like a drag — must not
        // end in a selection.
        const touchPoints = new Map<number, { x: number; y: number }>()
        let activePinch: { startDist: number; zoomAtStart: number } | null = null
        const touchSpread = (): number => {
            const [a, b] = [...touchPoints.values()]
            return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
        }
        const beginPinch = () => {
            if (activePanDrag) {
                const pointerId = activePanDrag.pointerId
                activePanDrag = null
                renderer.domElement.style.cursor = "default"
                if (renderer.domElement.hasPointerCapture(pointerId)) {
                    renderer.domElement.releasePointerCapture(pointerId)
                }
            }
            activePinch = { startDist: touchSpread(), zoomAtStart: camera.zoom }
            suppressNextClick = true
        }
        const updatePinch = (): void => {
            if (!activePinch) return
            const zoom = pinchZoom(activePinch.zoomAtStart, activePinch.startDist, touchSpread())
            camera.zoom = zoom
            camera.updateProjectionMatrix()
            // A framed screen is framed AT a zoom; changing it re-measures the pose.
            if (screenFocusT > 0) syncCamera()
            opts.onCameraZoom?.(zoom)
        }
        const endTouchPoint = (e: PointerEvent) => {
            if (e.pointerType !== "touch") return
            touchPoints.delete(e.pointerId)
            // Lifting either finger ends the pinch; the survivor must press again to
            // start a pan, so a stale drag basis can never take over mid-gesture.
            if (activePinch && touchPoints.size < 2) activePinch = null
        }

        const onPointerDown = (e: PointerEvent) => {
            // A gesture's click (if any) always lands before the next press, so a
            // suppression that was never consumed — a pinch usually ends with no
            // click at all — must not survive to eat this new tap.
            if (!activePanDrag && !activePinch && touchPoints.size === 0) {
                suppressNextClick = false
            }
            if (e.pointerType === "touch") {
                touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
                // A second finger starts the pinch. Third and later fingers do nothing.
                if (touchPoints.size === 2) {
                    beginPinch()
                    return
                }
                if (touchPoints.size > 2) return
            }
            if (activePanDrag || activePinch || (e.pointerType === "mouse" && e.button !== 0)) return
            updatePointer(e)
            beginPanDrag(e)
        }

        const onMove = (e: PointerEvent) => {
            if (e.pointerType === "touch" && touchPoints.has(e.pointerId)) {
                touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY })
                if (activePinch) {
                    updatePinch()
                    e.preventDefault()
                    return
                }
            }
            if (activePanDrag?.pointerId === e.pointerId) {
                updatePanDrag(e)
                if (activePanDrag?.panning) {
                    e.preventDefault()
                    return
                }
            }
            updatePointer(e)
        }
        const onPointerUp = (e: PointerEvent) => {
            endTouchPoint(e)
            finishPanDrag(e)
        }
        const onPointerCancel = (e: PointerEvent) => {
            endTouchPoint(e)
            finishPanDrag(e)
        }
        const onLostPointerCapture = (e: PointerEvent) => {
            finishPanDrag(e)
        }
        const onPointerLeave = () => {
            if (activePanDrag) return
            pointerDirty = false
            setHoveredPlayer(null)
            renderer.domElement.style.cursor = "default"
        }

        // Every press on the floor drags the room; a click picks.
        renderer.domElement.addEventListener("pointerdown", onPointerDown)
        renderer.domElement.addEventListener("pointermove", onMove)
        renderer.domElement.addEventListener("pointerup", onPointerUp)
        renderer.domElement.addEventListener("pointercancel", onPointerCancel)
        renderer.domElement.addEventListener("lostpointercapture", onLostPointerCapture)
        renderer.domElement.addEventListener("pointerleave", onPointerLeave)
        // Raw touches are handled here (drag-pan and pinch-zoom), so the browser
        // gets none of them.
        renderer.domElement.style.touchAction = "none"
        renderer.domElement.addEventListener("click", onClick)
        registerCleanup(() => {
            renderer.domElement.removeEventListener("click", onClick)
            renderer.domElement.removeEventListener("pointerdown", onPointerDown)
            renderer.domElement.removeEventListener("pointermove", onMove)
            renderer.domElement.removeEventListener("pointerup", onPointerUp)
            renderer.domElement.removeEventListener("pointercancel", onPointerCancel)
            renderer.domElement.removeEventListener("lostpointercapture", onLostPointerCapture)
            renderer.domElement.removeEventListener("pointerleave", onPointerLeave)
        })

        // ------------------------------------------------------------ selection

        let selection: RoomSelection = null

        /** The character the selection points at, if it is one. */
        const selectedChar = (): CharState | null => {
            if (!selection) return null
            if (selection.type === "agent") return agentChars.get(selection.id) ?? null
            if (selection.type === "player") return charByPlayerIdx.get(selection.idx) ?? null
            return null
        }

        const applySelection = () => {
            const desk = selection?.type === "desk" ? PARTICIPANT_TABLES[selection.idx] : undefined
            highlight.visible = desk !== undefined
            if (desk) highlight.position.set(toX(desk.x + desk.w / 2), 0.02, toZ(desk.y + desk.h / 2))
            const selChar = selectedChar()
            marker.visible = selChar !== null
            selTag.visible = selChar !== null
            if (selChar) {
                selTagMat.map = nameTagFor(selChar)
                selTagMat.needsUpdate = true
            }
        }

        // ------------------------------------------------------------ main loop

        // Simulation time, NOT rAF ticks — see sim-clock.ts. `simFrame` counts fixed
        // 60 Hz steps, so the walk cadence and wander below run at the same speed on
        // a 60, 120 or 144 Hz display.
        let simFrame = 0
        let simCarryMs = 0
        let raf = 0
        registerCleanup(() => cancelAnimationFrame(raf))
        let lastTimeOfDayCheck = 0
        const clockStart = performance.now()
        let lastFrameAt = clockStart

        // The aimless orbit itself lives in lib/gameRoomNet/wander.ts (shared with
        // the multiplayer hub); CharState carries its fields inline, so stepWander
        // mutates the character directly.

        const tick = () => {
            if (renderPaused) return
            raf = requestAnimationFrame(tick)
            const now = performance.now()
            const frameMs = now - lastFrameAt
            const advance = advanceSimClock(simCarryMs, frameMs)
            lastFrameAt = now
            simCarryMs = advance.carryMs
            simFrame += advance.steps
            const t = (now - clockStart) / 1000


            // A playing broadcast is not the canvas's business: its picture is a
            // VideoTexture on its own quad, and the browser refreshes that on the
            // clip's frames — see the broadcast picture above.

            // time of day — the palette only moves once a real minute, so polling the
            // clock every few seconds is already 20× oversampled
            if (t - lastTimeOfDayCheck > 5) {
                lastTimeOfDayCheck = t
                applyTimeOfDay()
            }

            // Primey's idle loop. Driven by wall-clock ms, not the sim frame: it is
            // scenery, and should breathe at the same pace as the DOM sprite on every
            // other page whatever the room's frame budget is doing.
            primeyTex.offset.x = primeyFrameOffset(now - clockStart)



            // characters
            const walkFrame = Math.floor((simFrame * WALK_SPEED) / WALK_FRAME_STEPS)
            if (localChar) {
                for (let step = 0; step < advance.steps; step++) stepLocalControl()
            }
            /** Agents whose fade-out finished this frame; removed after the loop. */
            const departed: CharState[] = []
            for (const c of chars) {
                const isLocal = c === localChar
                let dir: WalkDir
                let standing: boolean
                if (isLocal) {
                    // The player's own character: keyboard-driven, collision-checked,
                    // zero-latency — the hub only relays it to everyone else.
                    c.transition = null
                    c.x = toX(localPx.x)
                    c.z = toZ(localPx.y)
                    c.mesh.position.set(c.x, characterGroundY(c.format), c.z)
                    dir = localDir
                    standing = !localMoving
                } else if (c.net) {
                    // Remote-synced (another visitor, streamed by the hub):
                    // glide toward the 10 Hz target rather than stepping to it.
                    c.transition = null
                    const dx = c.net.x - c.x
                    const dz = c.net.z - c.z
                    if (dx * dx + dz * dz > NET_SNAP_DIST * NET_SNAP_DIST) {
                        c.x = c.net.x
                        c.z = c.net.z
                    } else {
                        const closeness = 1 - Math.pow(NET_KEEP_PER_STEP, advance.steps)
                        c.x += dx * closeness
                        c.z += dz * closeness
                    }
                    c.mesh.position.set(c.x, characterGroundY(c.format), c.z)
                    dir = c.net.dir
                    standing = !c.net.moving
                } else {
                    // An agent walks laps only while its status says so; standing
                    // still it holds its place on the orbit, marching on the spot.
                    const style = c.agent?.style ?? null
                    const laps = c.teamIdx !== null && (style === null || style.motion === "laps")
                    if (laps) {
                        for (let step = 0; step < advance.steps; step++) stepWander(c)
                    }
                    const home = authoritativePosition(c)
                    let y = characterGroundY(c.format)
                    if (c.transition) {
                        const progress = Math.min(1, (performance.now() - c.transition.startedAt) / c.transition.duration)
                        const eased = 1 - (1 - progress) * (1 - progress)
                        c.x = THREE.MathUtils.lerp(c.transition.fromX, home.x, eased)
                        c.z = THREE.MathUtils.lerp(c.transition.fromZ, home.z, eased)
                        y += Math.sin(progress * Math.PI) * TRANSITION_HOP
                        if (progress === 1) c.transition = null
                    } else {
                        c.x = home.x
                        c.z = home.z
                    }
                    c.mesh.position.set(c.x, y, c.z)
                    dir = home.dir
                    standing = style
                        ? (c.transition === null && laps && c.pauseLeft > 0)
                        : (c.teamIdx === null || c.pauseLeft > 0)
                }
                const row = c.format.dirRow[dir]
                let animFrame = standing ? c.format.standFrame : c.format.walkFrame(walkFrame)
                if (c.agent && c.agent.style.frame === "hurt" && c.transition === null) animFrame = HURT_FRAME
                c.texture.offset.set(animFrame / c.format.cols, 1 - (row + 1) / c.format.rows)
                const dim = selection?.type === "desk" && c.teamIdx !== selection.idx
                c.material.color.setHex(dim ? 0x3c4256 : 0xffffff)
                // Keep opacity above alphaTest (0.5) so dimmed sprites stay visible.
                let opacity = dim ? 0.65 : 1
                if (c.agent) {
                    opacity *= c.agent.style.opacity
                    if (c.agent.leaving) {
                        const progress = Math.min(1, (now - c.agent.leaving.startedAt) / AGENT_FADE_OUT_MS)
                        opacity *= 1 - progress
                        if (progress >= 1) departed.push(c)
                    }
                    if (c.agent.style.pulse) {
                        ;(c.presenceHalo.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 4) * 0.3
                    }
                }
                c.material.opacity = opacity
                // Keep the halo in world space, centred on the character's ground
                // position. Attaching it to the billboard makes it inherit sprite-facing
                // transforms and can pull the projected ring away from the feet.
                c.presenceHalo.position.set(c.x, 0.03, c.z)
            }
            for (const c of departed) finishAgentRemoval(c)
            // Leaders leave a trail behind them for their followers to walk.
            for (const c of chars) {
                const state = c.agent
                if (!state) continue
                const last = state.trail[state.trail.length - 1]
                if (last && Math.hypot(c.x - last.x, c.z - last.z) < TRAIL_STEP) continue
                state.trail.push({ x: c.x, z: c.z })
                if (state.trail.length > TRAIL_MAX_POINTS) state.trail.splice(0, state.trail.length - TRAIL_MAX_POINTS)
            }
            // The snap's fade overrides the opacity and height just set.
            stepSnap(frameMs)


            // The cabinet's entrance owns the camera while it runs.
            stepArcadeReveal(frameMs)

            // follow-cam: keep the local character centred, video-game style. Eased
            // per sim step, clamped to the room, and paused while the player is
            // deliberately dragging the view elsewhere (movement re-engages it).
            if (localChar && !cameraFollowSuspended && !activePanDrag?.panning && advance.steps > 0) {
                const next = followRoomCameraPan(
                    cameraPan,
                    { x: localChar.x - cameraHomeTarget.x, z: localChar.z - cameraHomeTarget.z },
                    advance.steps,
                    { unclamped: noclip },
                )
                if (Math.abs(next.x - cameraPan.x) > 1e-4 || Math.abs(next.z - cameraPan.z) > 1e-4) {
                    applyCameraPan(next)
                }
            }

            // The framed view rides on top of whatever the pan just did, so it eases
            // last.
            const focusT = advanceScreenFocus(screenFocusT, screenFocused, advance.steps)
            if (focusT !== screenFocusT) {
                screenFocusT = focusT
                syncCamera()
                applyScreenOccluders()
            }

            // throttled self-report to the hub
            if (localChar) {
                if (opts.onSelfState) {
                    const cur: RoomSelfState = { x: localPx.x, y: localPx.y, dir: localDir, moving: localMoving }
                    const changed =
                        !lastSelfSent ||
                        cur.x !== lastSelfSent.x ||
                        cur.y !== lastSelfSent.y ||
                        cur.dir !== lastSelfSent.dir ||
                        cur.moving !== lastSelfSent.moving
                    if (changed && now - lastSelfSentAt >= 90) {
                        lastSelfSentAt = now
                        lastSelfSent = cur
                        opts.onSelfState(cur)
                    }
                }
            }

            // status bubbles follow their agents; a spoken line takes their place
            for (const c of chars) {
                const bubble = c.agent?.bubble
                if (!bubble) continue
                bubble.sprite.visible = c.mesh.visible && !speechBubbles.has(c.playerIdx)
                bubble.sprite.position.set(c.x, characterTopY(c.format) + SPEECH_RISE, c.z)
            }

            // speech bubbles follow their speakers, then expire
            if (speechBubbles.size > 0) {
                const nowMs = performance.now()
                for (const [playerIdx, bubble] of [...speechBubbles]) {
                    if (nowMs >= bubble.expiresAt) {
                        clearSpeech(playerIdx)
                        continue
                    }
                    const c = charByPlayerIdx.get(playerIdx)
                    if (c) bubble.sprite.position.set(c.x, characterTopY(c.format) + SPEECH_RISE, c.z)
                }
            }



            // selection marker + tag follow their character
            {
                const c = selectedChar()
                if (c) {
                    const top = characterTopY(c.format)
                    marker.position.set(c.x, top + MARKER_RISE + Math.sin(t * 4) * 0.14, c.z)
                    marker.rotation.y = t * 2.2
                    selTag.position.set(c.x, top + SEL_TAG_RISE, c.z)
                }
            }

            // hover raycast (only when the pointer moved)
            if (pointerDirty && !activePanDrag?.panning) {
                const pick = pickAt()
                const newHover = pick?.type === "player" ? pick.idx : null
                renderer.domElement.style.cursor = pick ? "pointer" : "default"
                if (newHover !== hoverPlayerIdx) {
                    setHoveredPlayer(newHover)
                }
                pointerDirty = false
            } else if (activePanDrag?.panning) {
                hoverTag.visible = false
            }
            if (hoverPlayerIdx !== null && hoverTag.visible) {
                const c = charByPlayerIdx.get(hoverPlayerIdx)
                if (c) hoverTag.position.set(c.x, characterTopY(c.format) + HOVER_TAG_RISE, c.z)
            }

            // highlight pulse + dust drift
            updateInteractHighlight()
            if (interactHighlight.visible) {
                const m = interactHighlight.material as THREE.MeshBasicMaterial
                m.opacity = 0.5 + Math.sin(t * 6) * 0.35
            }
            if (highlight.visible) {
                const m = highlight.material as THREE.MeshBasicMaterial
                m.opacity = 0.65 + Math.sin(t * 5) * 0.3
            }

            if (grade) grade.uniforms.uTime!.value = t
            if (composer) composer.render()
            else renderer.render(scene, camera)

            // The rAF interval, not this callback's own duration: a GPU that cannot
            // keep up shows as a stretched gap between frames, which is exactly what
            // the player experiences and what a JS-side stopwatch would miss.
            if (frameBudget?.sample(frameMs)) downgradeQuality()
        }

        // ------------------------------------------------------------ sizing

        const resize = () => {
            const w = container.clientWidth || 1
            const h = container.clientHeight || 1
            renderer.setSize(w, h, false)
            composer?.setSize(w, h)
            camera.aspect = w / h
            camera.updateProjectionMatrix()
            // How far back the screen has to be read from depends on the shape of the
            // viewport reading it.
            if (screenFocusT > 0) syncCamera()
        }
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(container)
        registerCleanup(() => ro.disconnect())

        // ------------------------------------------------------------ quality, live

        /**
         * Draw the shadow depth pass once. Cheap to ask for, wasteful to leave on.
         *
         * Not optional: with `autoUpdate` off and no pass ever requested, the depth
         * target stays null and three.js resolves every lit surface as fully
         * shadowed — the room goes black and the unlit backdrop shows straight
         * through it. So every path that invalidates the map has to come back here.
         */
        const refreshShadows = () => {
            if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true
        }

        // A lost-and-restored context drops every GPU resource, the depth target
        // included, and nothing else would ever ask for it again.
        const onContextRestored = () => refreshShadows()
        renderer.domElement.addEventListener("webglcontextrestored", onContextRestored)
        registerCleanup(() =>
            renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored),
        )

        /**
         * Move the live scene to a tier. Only the settings that can be changed
         * without rebuilding are honoured — pixel ratio, the post passes, shadows,
         * the point-light rig and the mote count, which between them are all of the
         * per-frame cost. `cheapFurniture` and `backdropLightsScale` are baked in at
         * build time and deliberately left alone: swapping every material in the
         * room mid-session would stall harder than the frames it saved.
         */
        const applyQuality = (next: QualityTier) => {
            tier = next
            q = qualitySettings(next)

            renderer.setPixelRatio(pixelRatioFor(q))
            if (grade) grade.enabled = q.grade

            const nextShadowType = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
            // The filter kernel is compiled into the shader, so a change here needs
            // the same rebuild that toggling shadows off and on does.
            const shadowsToggled =
                renderer.shadowMap.enabled !== q.shadows || renderer.shadowMap.type !== nextShadowType
            renderer.shadowMap.type = nextShadowType
            if (shadowsToggled || key.shadow.mapSize.x !== q.shadowMapSize) {
                renderer.shadowMap.enabled = q.shadows
                key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
                // The existing depth target is the old size; it has to go before the
                // next pass can allocate one at the new one.
                key.shadow.map?.dispose()
                key.shadow.map = null
            }
            if (shadowsToggled) {
                // Whether a material samples a shadow map is compiled into its shader,
                // so every one of them needs rebuilding. This is a one-off stutter, and
                // it only ever happens on a device that is already stuttering.
                scene.traverse((object) => {
                    if (object instanceof THREE.Mesh) {
                        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                            material.needsUpdate = true
                        }
                    }
                })
            }

            buildDeskLights(q.deskLightsPerRow)
            for (const light of screenGlowLights) light.visible = q.screenGlowLight

            resize()
            refreshShadows()
            opts.onQualityChange?.(next)
        }

        // A pinned tier is an instruction, not a guess, so it is never second-
        // guessed by measurement. Everything else gets watched: the signals in
        // `detectQualitySignals` are coarse, and the honest test of whether a device
        // can render this room is whether it is rendering this room.
        let frameBudget: FrameBudgetWatcher | null = pinnedTier ? null : createFrameBudgetWatcher()

        // The menu's GRAPHICS row lands here. A fresh watcher rather than a kept one
        // when returning to AUTO: its grace period has to start again, because the
        // frames right after a tier change are shader recompiles, not the steady
        // state it is meant to judge.
        const applyQualityPreference = (preference: GraphicsPreference) => {
            if (preference === "auto") {
                frameBudget = createFrameBudgetWatcher()
                applyQuality(resolveQualityTier(detectQualitySignals()))
            } else {
                frameBudget = null
                applyQuality(preference)
            }
        }
        const downgradeQuality = () => {
            const next = nextTierDown(tier)
            if (!next) return
            logger.info("room3d.quality_reduced", { quality: next })
            applyQuality(next)
        }

        for (const light of screenGlowLights) light.visible = q.screenGlowLight
        opts.onQualityChange?.(tier)

        applySelection()
        applyTimeOfDay()
        // The depth pass is on demand (see shadowMap.autoUpdate above), so it has to
        // be asked for once now that every caster is in the scene. Nothing here
        // moves afterwards — not even the key light, which the palette only ever
        // recolours — so this is the only time the shadow map is ever drawn.
        refreshShadows()
        tick()

        return {
            setCameraPan(x, z) {
                applyCameraPan({ x, z })
            },
            setCameraZoom(zoom) {
                camera.zoom = Math.min(2.4, Math.max(1, zoom))
                camera.updateProjectionMatrix()
                if (screenFocusT > 0) syncCamera()
            },
            setSelection(next) {
                selection = next
                applySelection()
            },
            upsertAgent(agent) {
                upsertAgentChar(agent)
            },
            removeAgent(agentId) {
                removeAgentChar(agentId)
            },
            say(agentId, text, ms) {
                const c = agentChars.get(agentId)
                if (c) showSpeechFor(c.playerIdx, text, ms)
            },
            setMoveInput(direction, active) {
                // Releases always land (a hold must never stick past losing control);
                // presses only mean something while a character is being walked.
                if (active && !localChar) return
                // The touch pad meets the same rebinding the arrow keys do while the
                // screen is framed — otherwise a player on a phone could walk their
                // character off out of sight while the camera stayed on the wall.
                const framed = active ? screenFocusKeyAction(`arrow${direction}`, screenFocused) : null
                if (framed) {
                    applyFramedAction(framed)
                    // Down is the way out on the pad too, and it walks as it goes.
                    if (framed !== "exit-and-move") return
                }
                localInput.setMoveInput(direction, active)
            },
            setLocalInputDisabled(disabled) {
                localInput.setDisabled(disabled)
                if (disabled) localMoving = false
            },
            setBackroomsUnlocked(unlocked) {
                backroomsUnlocked = unlocked
                if (unlocked && !hatch) revealHatch()
                hatchOpen.value = unlocked ? 1 : 0
                if (hatch) hatch.visible = unlocked
                if (secretPlant) secretPlant.position.x = toX(secretObject.x) - (unlocked ? 2 : 0)
            },
            setArcadeVisible(visible, entrance = true) {
                arcadeVisible = visible
                if (visible && !arcade) revealArcade(entrance)
                if (arcade) arcade.visible = visible
            },
            setPrimeyVisible(visible) {
                primeyVisible = visible
                primeyMesh.visible = visible
            },
            thanosSnap() {
                snapHalfTheRoom()
            },
            setRenderPaused(paused) {
                if (renderPaused === paused) return
                renderPaused = paused
                cancelAnimationFrame(raf)
                if (paused) {
                    localInput.releaseMovement()
                    localMoving = false
                    if (localChar) opts.onSelfState?.({ x: localPx.x, y: localPx.y, dir: localDir, moving: false })
                } else {
                    lastFrameAt = performance.now()
                    simCarryMs = 0
                    tick()
                }
            },
            interact() {
                fireInteract()
            },
            setQualityPreference(preference) {
                applyQualityPreference(preference)
            },
            pickNearCenter() {
                const rect = renderer.domElement.getBoundingClientRect()
                const centre = groundAt(rect.left + rect.width / 2, rect.top + rect.height / 2, interactProbe)
                if (!centre) return null
                return pickNearestToPoint({ x: centre.x, z: centre.z }, {
                    chars: chars
                        .filter((c) => !snapped.has(c) && !c.agent?.leaving)
                        .map((c) => ({ selection: selectionFor(c), x: c.x, z: c.z })),
                    tables: PARTICIPANT_TABLES.map((tbl, tableIdx) => ({
                        tableIdx,
                        x: toX(tbl.x + tbl.w / 2),
                        z: toZ(tbl.y + tbl.h / 2),
                    })),
                })
            },
            setNetStates(states) {
                for (const s of states) {
                    const c = charByPlayerIdx.get(s.playerIdx)
                    if (!c || c === localChar) continue
                    c.net = { x: toX(s.x), z: toZ(s.y), dir: s.dir, moving: s.moving, live: s.live }
                    c.presenceHalo.visible = s.live
                }
            },
            setLocalPlayer(playerIdx, start) {
                pendingLocal = null
                if (playerIdx !== null && !charByPlayerIdx.has(playerIdx)) {
                    // A guest character still materializing (sprite decode in flight) —
                    // remember the intent; the creation path completes the hand-over.
                    pendingLocal = { playerIdx, start }
                    releaseLocalControl()
                    return
                }
                const next = playerIdx === null ? null : charByPlayerIdx.get(playerIdx) ?? null
                if (next === localChar) return
                if (next) activateLocalControl(next, start)
                else releaseLocalControl()
            },
            upsertGuest(guest) {
                spawnGuestChar(guest)
            },
            removeGuest(playerIdx) {
                removeGuestChar(playerIdx)
            },
            showSpeech(playerIdx, text) {
                showSpeechFor(playerIdx, text)
            },
            showObjectSpeech(objectIdx, text) {
                showObjectSpeechFor(objectIdx, text)
            },
            setBoard(next) {
                board = next
                redrawScreen()
            },
            setBulletin(text) {
                bulletinText = text
                redrawScreen()
                // A bulletin takes the room's attention: the wall lights up behind
                // whatever the player happened to be looking at, and the room's
                // furniture hides the bottom of the screen from a normal camera,
                // which is where a three-line bulletin's last line sits.
                if (text && !bulletinFocusHeld && !screenFocused) {
                    bulletinFocusHeld = true
                    setScreenFocus(true)
                } else if (!text && bulletinFocusHeld) {
                    bulletinFocusHeld = false
                    setScreenFocus(false)
                }
            },
            freezeLocalInput(ms, faceDir) {
                inputFrozenUntil = performance.now() + ms
                localMoving = false
                if (faceDir !== undefined) localDir = faceDir
            },
            dispose() {
                cleanup()
            },
        }
    } catch (error) {
        cleanup()
        throw error
    }
}
