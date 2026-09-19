import * as THREE from 'three'
import { CELL, ENTRANCE, EXIT, LEVEL, MAIN_COLUMNS, NEWSROOM, type Enemy, type Game } from './simulation'
import { createNewsroom } from './newsroom-renderer'
import { SPRITE_FRAME_COUNT, spriteFrame, spriteFrameOffset } from './sprite-animation'

function canvasTexture(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas graphics are unavailable.')
  paint(context)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  return texture
}
function spriteTexture(path: string, frameCount = 1) {
  const texture = new THREE.TextureLoader().load(path)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.repeat.set(1 / frameCount, 1)
  return texture
}

export function createRenderer(host: HTMLElement, { hideKonamiHint = false }: { hideKonamiHint?: boolean } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor('#b5a357')
  host.appendChild(renderer.domElement)
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog('#b5a357', 13, 38)
  const camera = new THREE.PerspectiveCamera(76, 1, .035, 55)
  camera.rotation.order = 'YXZ'
  scene.add(camera)
  scene.add(new THREE.HemisphereLight('#fff6c7', '#92713c', 2.7))
  const light = new THREE.DirectionalLight('#fffad5', 1.2); light.position.set(3, 8, 5); scene.add(light)
  const textures: THREE.Texture[] = []
  const wallpaper = canvasTexture(128, 128, c => {
    c.fillStyle = '#c8b66a'; c.fillRect(0, 0, 128, 128)
    c.strokeStyle = '#b5a15b'; c.lineWidth = 2
    for (let x = 0; x < 128; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 128); c.stroke() }
    c.fillStyle = '#d5c584'
    for (let x = 8; x < 128; x += 32) for (let y = 14; y < 128; y += 32) { c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 4, y); c.lineTo(x, y + 5); c.lineTo(x - 4, y); c.fill() }
    c.fillStyle = '#8d7941'; c.fillRect(0, 114, 128, 14)
  }); textures.push(wallpaper)
  const carpet = canvasTexture(64, 64, c => {
    c.fillStyle = '#938050'; c.fillRect(0, 0, 64, 64)
    for (let y = 0; y < 64; y += 2) for (let x = 0; x < 64; x += 2) { c.fillStyle = (x * 7 + y * 11) % 5 ? '#9e8c58' : '#756440'; c.fillRect(x, y, 1, 2) }
  }); carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping; carpet.repeat.set(22, 20); textures.push(carpet)
  const width = MAIN_COLUMNS * CELL, depth = LEVEL.length * CELL
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshLambertMaterial({ map: carpet })); floor.rotation.x = -Math.PI / 2; floor.position.set(width / 2, 0, depth / 2); scene.add(floor)
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshLambertMaterial({ color: '#c9c4a8', side: THREE.DoubleSide })); ceiling.rotation.x = Math.PI / 2; ceiling.position.set(width / 2, 3, depth / 2); scene.add(ceiling)
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 3, CELL), new THREE.MeshLambertMaterial({ map: wallpaper }), LEVEL.join('').split('#').length - 1)
  const matrix = new THREE.Matrix4(); let count = 0
  for (let z = 0; z < LEVEL.length; z++) for (let x = 0; x < LEVEL[z]!.length; x++) if (LEVEL[z]![x] === '#') walls.setMatrixAt(count++, matrix.makeTranslation((x + .5) * CELL, 1.5, (z + .5) * CELL))
  scene.add(walls)
  // Match the perimeter wallpaper. Only a fine recessed seam and recording
  // light distinguish this panel from the rest of the corridor.
  const newsroomDoor = new THREE.Group(); newsroomDoor.position.set(NEWSROOM.door.x, 0, NEWSROOM.door.z); scene.add(newsroomDoor)
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(CELL, 3, CELL), walls.material)
  doorPanel.position.y = 1.5; newsroomDoor.add(doorPanel)
  const seamMaterial = new THREE.MeshBasicMaterial({ color: '#9b894d' })
  for (const z of [-1.46, 1.46]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(.012, 2.85, .017), seamMaterial)
    seam.position.set(-CELL / 2 - .007, 1.5, z); newsroomDoor.add(seam)
  }
  const recordingLed = new THREE.Mesh(new THREE.BoxGeometry(.016, .055, .055), new THREE.MeshBasicMaterial({ color: '#b6352c' }))
  recordingLed.position.set(-CELL / 2 - .012, 2.36, 1.27); newsroomDoor.add(recordingLed)
  // A small brass escutcheon and dark keyhole mark the otherwise concealed panel.
  const brass = new THREE.MeshBasicMaterial({ color: '#b9974b' })
  const keyholeBlack = new THREE.MeshBasicMaterial({ color: '#151813' })
  const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(.045, .34, .23), brass)
  lockPlate.position.set(-1.522, 1.35, 0); newsroomDoor.add(lockPlate)
  const lockEye = new THREE.Mesh(new THREE.CircleGeometry(.052, 10), keyholeBlack)
  lockEye.rotation.y = -Math.PI / 2; lockEye.position.set(-1.55, 1.395, 0); newsroomDoor.add(lockEye)
  const lockSlot = new THREE.Mesh(new THREE.BoxGeometry(.006, .105, .041), keyholeBlack)
  lockSlot.position.set(-1.552, 1.325, 0); newsroomDoor.add(lockSlot)
  const droppedKey = new THREE.Group(); droppedKey.visible = false; scene.add(droppedKey)
  const gold = new THREE.MeshBasicMaterial({ color: '#ffda62' })
  const keyBow = new THREE.Mesh(new THREE.TorusGeometry(.16, .045, 4, 8), gold)
  keyBow.position.x = -.22; droppedKey.add(keyBow)
  const keyShaft = new THREE.Mesh(new THREE.BoxGeometry(.5, .065, .065), gold)
  keyShaft.position.x = .15; droppedKey.add(keyShaft)
  for (const x of [.22, .36]) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(.065, .16, .065), gold)
    tooth.position.set(x, -.07, 0); droppedKey.add(tooth)
  }
  let newsroom: ReturnType<typeof createNewsroom> | undefined
  const lampGeometry = new THREE.BoxGeometry(1.15, .035, .42), lampMaterial = new THREE.MeshBasicMaterial({ color: '#fffbd7' })
  for (let z = 1; z < LEVEL.length; z += 2) for (let x = 1; x < MAIN_COLUMNS; x += 2) if (LEVEL[z]![x] === '.') {
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial); lamp.position.set((x + .5) * CELL, 2.94, (z + .5) * CELL); scene.add(lamp)
  }
  function sign(text: string, color: string, x: number, z: number, rotation = 0) {
    const texture = canvasTexture(256, 80, c => { c.fillStyle = color; c.fillRect(0, 0, 256, 80); c.strokeStyle = '#fff6cc'; c.lineWidth = 6; c.strokeRect(4, 4, 248, 72); c.fillStyle = '#fff6cc'; c.font = 'bold 29px monospace'; c.textAlign = 'center'; c.fillText(text, 128, 50) }); textures.push(texture)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, .625), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })); mesh.position.set(x, 2.1, z); mesh.rotation.y = rotation; scene.add(mesh)
  }
  sign('↑ UPSTAIRS', '#73522b', ENTRANCE.x, CELL + .02)
  sign('EXIT ↑', '#177553', EXIT.x, EXIT.z + 1.45, Math.PI)
  // Black lettering directly on the final wall, beside the exit portal.
  const farewellTexture = canvasTexture(1024, 512, c => {
    c.fillStyle = '#000000'
    c.textAlign = 'center'
    c.font = 'bold 62px monospace'
    c.fillText('THANKS FOR PLAYING!', 512, 100)
    c.font = '44px monospace'
    for (const [i, line] of [
      "Hope you're done with",
      'your hackathon tasks.',
      'Otherwise, you just',
      'wasted your time.',
    ].entries()) c.fillText(line, 512, 200 + i * 68)
  }); textures.push(farewellTexture)
  const farewell = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 2.1),
    new THREE.MeshBasicMaterial({ map: farewellTexture, transparent: true, depthWrite: false }),
  )
  farewell.position.set(EXIT.x - 3.5, 1.65, EXIT.z + CELL / 2 - .02)
  farewell.rotation.y = Math.PI
  scene.add(farewell)
  // The player who already unlocked the arcade no longer needs this clue.
  if (!hideKonamiHint) {
    const konamiHintTexture = canvasTexture(512, 256, c => {
      c.fillStyle = '#000000'; c.textAlign = 'center'
      c.font = 'bold 44px monospace'; c.fillText('Konami Code', 256, 64)
      c.font = '36px monospace'
      c.fillText('while in the', 256, 132)
      c.fillText('game room will...', 256, 190)
    }); textures.push(konamiHintTexture)
    const konamiHint = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.6),
      new THREE.MeshBasicMaterial({ map: konamiHintTexture, transparent: true, depthWrite: false }),
    )
    konamiHint.position.set(EXIT.x + CELL / 2 - .02, 1.65, EXIT.z - 2)
    konamiHint.rotation.y = -Math.PI / 2
    scene.add(konamiHint)
  }
  const ladderMaterial = new THREE.MeshLambertMaterial({ color: '#655a49' })
  for (const x of [-.42, .42]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(.1, 2.95, .12), ladderMaterial); rail.position.set(ENTRANCE.x + x, 1.5, CELL + .2); scene.add(rail) }
  for (let y = .2; y < 3; y += .35) { const rung = new THREE.Mesh(new THREE.BoxGeometry(.9, .08, .12), ladderMaterial); rung.position.set(ENTRANCE.x, y, CELL + .2); scene.add(rung) }
  const exit = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), new THREE.MeshBasicMaterial({ color: '#65efb1', transparent: true, opacity: .45, side: THREE.DoubleSide })); exit.position.set(EXIT.x, 1.25, EXIT.z + 1.35); scene.add(exit)
  // Direction marks on the carpet and a small map make the level readable.
  const arrowTexture = canvasTexture(64, 64, c => { c.fillStyle = '#e9d977'; c.beginPath(); c.moveTo(32, 3); c.lineTo(58, 31); c.lineTo(41, 31); c.lineTo(41, 61); c.lineTo(23, 61); c.lineTo(23, 31); c.lineTo(6, 31); c.fill() }); textures.push(arrowTexture)
  const arrowGeometry = new THREE.PlaneGeometry(.7, .7), arrowMaterial = new THREE.MeshBasicMaterial({ map: arrowTexture, transparent: true, side: THREE.DoubleSide })
  for (const [x, z, turn] of [[4, 1, -Math.PI / 2], [8, 1, -Math.PI / 2], [12, 1, -Math.PI / 2], [13, 3, Math.PI], [13, 7, Math.PI], [13, 9, Math.PI]] as const) { const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial); arrow.rotation.set(-Math.PI / 2, 0, turn); arrow.position.set((x + .5) * CELL, .015, (z + .5) * CELL); scene.add(arrow) }
  const creatureVisuals = Object.fromEntries((['puff', 'hopper', 'prism'] as const).map(kind => {
    const texture = spriteTexture(`/assets/backrooms/sprites/${kind}-sheet.png`, SPRITE_FRAME_COUNT)
    textures.push(texture)
    return [kind, { texture, material: new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: .1 }) }]
  })) as Record<Enemy['kind'], { texture: THREE.Texture; material: THREE.SpriteMaterial }>
  const sprites = new Map<number, THREE.Sprite>()
  const bubbleGeometry = new THREE.IcosahedronGeometry(.18, 1), bubbleMaterial = new THREE.MeshBasicMaterial({ color: '#ccacff', wireframe: true })
  const bubbles = Array.from({ length: 24 }, () => { const mesh = new THREE.Mesh(bubbleGeometry, bubbleMaterial); mesh.visible = false; scene.add(mesh); return mesh })
  const handTexture = spriteTexture('/assets/backrooms/sprites/laser-hand.png'); textures.push(handTexture)
  const hand = new THREE.Sprite(new THREE.SpriteMaterial({ map: handTexture, transparent: true, depthTest: false, depthWrite: false, fog: false }))
  hand.center.set(.58, .2); hand.position.set(.12, -.44, -.8); hand.scale.set(1.35, .9, 1); camera.add(hand)
  const laser = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff2747', transparent: true, opacity: .88 })); laser.frustumCulled = false; laser.visible = false; scene.add(laser)
  const boltTexture = canvasTexture(32, 32, c => { const glow = c.createRadialGradient(16, 16, 0, 16, 16, 16); glow.addColorStop(0, '#fff7c4'); glow.addColorStop(.23, '#ff4b45'); glow.addColorStop(.62, '#ef1736'); glow.addColorStop(1, 'rgba(255, 0, 32, 0)'); c.fillStyle = glow; c.fillRect(0, 0, 32, 32) }); textures.push(boltTexture)
  const laserBolt = new THREE.Sprite(new THREE.SpriteMaterial({ map: boltTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  laserBolt.visible = false; scene.add(laserBolt)
  const laserOrigin = new THREE.Vector3(), laserTarget = new THREE.Vector3(), laserDirection = new THREE.Vector3()
  let laserLife = 0
  const particleCount = 240, particleDummy = new THREE.Object3D()
  const particles = new THREE.InstancedMesh(new THREE.PlaneGeometry(.09, .13), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), particleCount)
  particles.frustumCulled = false; scene.add(particles)
  const bits = Array.from({ length: particleCount }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, angle: 0 }))
  const palette = ['#ff9bcc', '#81f4af', '#af9dff', '#fff28a', '#77eafa']; let nextBit = 0
  for (let i = 0; i < particleCount; i++) particles.setColorAt(i, new THREE.Color(palette[i % palette.length]))
  function resize() { const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
  const observer = new ResizeObserver(resize); observer.observe(host); resize()
  function render(game: Game, dt: number) {
    if (game.newsroom.open && !newsroom) newsroom = createNewsroom(scene)
    newsroomDoor.visible = !game.newsroom.open
    const keyPosition = game.newsroom.key.position
    droppedKey.visible = !!keyPosition && !game.newsroom.key.collected
    if (keyPosition) {
      droppedKey.position.set(keyPosition.x, .65 + Math.sin(game.time * 3) * .1, keyPosition.z)
      droppedKey.rotation.y = game.time * 1.7
    }
    newsroom?.update(game, dt)
    camera.position.set(game.player.x, 1.5, game.player.z); camera.rotation.set(game.player.pitch, game.player.yaw + Math.PI, 0)
    hand.position.y = -.44 + Math.sin(game.time * 6) * .012; hand.position.z = game.shotCooldown > .13 ? -.68 : -.8
    for (const event of game.events.splice(0)) {
      if (event.type === 'shot') {
        camera.getWorldPosition(laserOrigin); camera.getWorldDirection(laserDirection)
        laserOrigin.addScaledVector(laserDirection, .55); laserTarget.set(event.x, event.y, event.z)
        laser.geometry.dispose(); laser.geometry = new THREE.BufferGeometry().setFromPoints([laserOrigin, laserTarget])
        laserLife = .11
      }
      if (event.type === 'pop') for (let j = 0; j < 32; j++) { const bit = bits[nextBit++ % particleCount]!; Object.assign(bit, { x: event.x, y: .9, z: event.z, vx: (Math.random() - .5) * 4, vy: 1.5 + Math.random() * 3, vz: (Math.random() - .5) * 4, life: 1 + Math.random() * .7, angle: Math.random() * 6 }) }
    }
    laserLife -= dt; laser.visible = laserLife > 0; laserBolt.visible = laserLife > 0
    if (laserLife > 0) {
      const progress = 1 - laserLife / .11
      laserBolt.position.lerpVectors(laserOrigin, laserTarget, progress)
      laserBolt.scale.setScalar(.22 + Math.sin(game.time * 42) * .035)
    }
    creatureVisuals.puff.texture.offset.x = spriteFrameOffset(spriteFrame(game.time, 4))
    creatureVisuals.hopper.texture.offset.x = spriteFrameOffset(spriteFrame(game.time, 6, 1))
    creatureVisuals.prism.texture.offset.x = spriteFrameOffset(spriteFrame(game.time, 3, 2))
    for (const enemy of game.enemies) {
      let sprite = sprites.get(enemy.id)
      if (!sprite) { sprite = new THREE.Sprite(creatureVisuals[enemy.kind].material); sprite.scale.set(1.65, 2.06, 1); sprites.set(enemy.id, sprite); scene.add(sprite) }
      sprite.position.set(enemy.x, 1.04 + Math.sin(game.time * 3 + enemy.id) * .06, enemy.z)
      const windup = enemy.kind === 'hopper' && enemy.phase > .55
      sprite.scale.set(windup ? 1.9 : 1.65, windup ? 1.65 : 2.06, 1)
    }
    for (const [id, sprite] of sprites) if (!game.enemies.some(enemy => enemy.id === id)) { scene.remove(sprite); sprites.delete(id) }
    bubbles.forEach((bubble, i) => { const projectile = game.projectiles[i]; bubble.visible = !!projectile; if (projectile) { bubble.position.set(projectile.x, 1.2, projectile.z); bubble.rotation.y += dt * 2 } })
    for (let i = 0; i < particleCount; i++) { const bit = bits[i]!; bit.life -= dt; if (bit.life > 0) { bit.x += bit.vx * dt; bit.y += bit.vy * dt; bit.z += bit.vz * dt; bit.vy -= dt * 5; particleDummy.position.set(bit.x, Math.max(.03, bit.y), bit.z); particleDummy.rotation.set(bit.angle + game.time * 5, bit.angle, 0); particleDummy.scale.setScalar(Math.min(1, bit.life * 3)) } else particleDummy.scale.setScalar(0); particleDummy.updateMatrix(); particles.setMatrixAt(i, particleDummy.matrix) }
    particles.instanceMatrix.needsUpdate = true
    renderer.render(scene, camera)
  }
  return {
    canvas: renderer.domElement, render,
    dispose() {
      observer.disconnect()
      // The child removes its group before the shared scene disposal traversal.
      newsroom?.dispose()
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
      scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) { if ('geometry' in object) geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material)) } })
      // Defeated sprites may have left the scene; all shared materials still need disposing.
      Object.values(creatureVisuals).forEach(({ material }) => materials.add(material))
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose())
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); scene.clear()
    },
  }
}
