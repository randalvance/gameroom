import * as THREE from 'three'
import { NEWSROOM, bernardStandProgress, type Game } from './simulation'
import { SPRITE_FRAME_COUNT, spriteFrame, spriteFrameOffset } from './sprite-animation'

/** All studio resources belong to this lazy child, including the moving anchor. */
export function createNewsroom(scene: THREE.Scene) {
  let disposed = false
  const room = new THREE.Group()
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  scene.add(room)
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry }
  const ownMaterial = <T extends THREE.Material>(material: T) => { materials.add(material); return material }
  // The surrounding level has yellow distance fog. Screens and studio surfaces
  // stay blue without changing the fog or lighting in the original corridors.
  const basic = (color: string) => ownMaterial(new THREE.MeshBasicMaterial({ color, fog: false }))
  const navy = basic('#091b34'), blue = basic('#123963'), steel = basic('#496e91')
  const black = basic('#080f18'), silver = basic('#8daabc'), white = basic('#ddecfa')
  const cyan = basic('#42c9ff'), ice = basic('#ebfaff')
  const unitBox = ownGeometry(new THREE.BoxGeometry(1, 1, 1))
  function box(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(unitBox, material)
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh)
    return mesh
  }
  function canvasMap(width: number, height: number, paint: (c: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas graphics are unavailable.')
    paint(context)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter
    textures.add(texture)
    return texture
  }
  function panel(parent: THREE.Object3D, map: THREE.Texture, x: number, y: number, z: number, w: number, h: number, turn: number) {
    const mesh = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(w, h)), ownMaterial(new THREE.MeshBasicMaterial({ map, fog: false })))
    mesh.position.set(x, y, z); mesh.rotation.y = turn; parent.add(mesh)
    return mesh
  }

  // Surfaces sit just inside the walkable bounds; there are no decorative
  // columns or furniture blocking the navigation grid outside the desk cell.
  box(room, navy, 52.5, .012, 22.5, 15, .024, 15)
  box(room, black, 52.5, 2.986, 22.5, 15, .024, 15)
  box(room, blue, 59.94, 1.5, 22.5, .1, 3, 15)
  for (const z of [15.06, 29.94]) {
    box(room, navy, 52.5, 1.5, z, 15, 3, .1)
    for (const x of [46.3, 49.3, 52.3, 55.3, 58.3]) {
      box(room, blue, x, 1.5, z + (z < 20 ? .06 : -.06), 2.82, 2.44, .03)
      box(room, steel, x + 1.44, 1.5, z + (z < 20 ? .085 : -.085), .035, 2.75, .025)
    }
    for (const y of [.32, 2.64]) box(room, ice, 52.5, y, z + (z < 20 ? .09 : -.09), 14.9, .07, .045)
  }
  // Dress the inside of the concealed wall, leaving the entire door aperture.
  for (const z of [18, 27]) box(room, blue, 45.055, 1.5, z, .09, 3, 6)
  for (const z of [20.94, 24.06]) box(room, steel, 45.11, 1.5, z, .04, 3, .06)
  for (const z of [18.1, 26.9]) {
    box(room, steel, 52.5, .03, z, 14.7, .018, .025)
    box(room, cyan, 52.5, .035, z + (z < 20 ? .08 : -.08), 14.7, .018, .025)
  }
  for (const x of [48, 52, 56]) for (const z of [18, 27]) box(room, white, x, 2.961, z, 1.4, .025, .5)

  const screenMap = canvasMap(1536, 384, c => {
    c.fillStyle = '#041329'; c.fillRect(0, 0, 1536, 384)
    const wash = c.createRadialGradient(768, 205, 12, 768, 205, 550)
    wash.addColorStop(0, '#07569a'); wash.addColorStop(.45, '#043464'); wash.addColorStop(1, '#041329')
    c.fillStyle = wash; c.fillRect(0, 0, 1536, 384)
    c.lineWidth = 1; c.strokeStyle = '#126394'
    for (let x = 0; x < 1536; x += 96) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 384); c.stroke() }
    for (let y = 0; y < 384; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(1536, y); c.stroke() }
    // Deterministic telemetry pixels echo the supplied broadcast backdrop.
    for (let i = 0; i < 500; i++) {
      const x = (i * 137) % 1536, y = 225 + (i * 47) % 135
      c.fillStyle = i % 4 ? '#117bb0' : '#47cfff'
      c.fillRect(x, y, i % 7 === 0 ? 7 : 2, i % 5 === 0 ? 9 : 2)
    }
    const cx = 768, cy = 199, radius = 166
    c.save(); c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.clip()
    c.fillStyle = '#043261'; c.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
    c.strokeStyle = '#158ec4'; c.lineWidth = 1.5
    for (const factor of [.22, .48, .74, 1]) {
      c.beginPath(); c.ellipse(cx, cy, radius * factor, radius, -.15, 0, Math.PI * 2); c.stroke()
    }
    for (const latitude of [-.75, -.45, 0, .45, .75]) {
      c.beginPath(); c.ellipse(cx, cy + radius * latitude, radius * Math.sqrt(1 - latitude ** 2), radius * .13, -.08, 0, Math.PI * 2); c.stroke()
    }
    const continents = [
      [[-.79,-.44],[-.56,-.64],[-.29,-.58],[-.18,-.4],[-.4,-.23],[-.45,-.04],[-.66,-.14]],
      [[-.42,-.04],[-.22,.08],[-.15,.28],[-.34,.7],[-.49,.39],[-.53,.1]],
      [[.02,-.49],[.24,-.62],[.67,-.55],[.88,-.25],[.6,-.05],[.35,-.15],[.25,.1],[.1,-.07],[-.02,-.19]],
      [[.02,-.12],[.28,-.02],[.39,.24],[.17,.6],[-.04,.26],[-.1,.04]],
      [[.59,.42],[.83,.37],[.89,.57],[.64,.64]],
    ]
    c.fillStyle = '#0877a9'; c.strokeStyle = '#42cbef'; c.lineWidth = 2
    for (const points of continents) {
      c.beginPath(); points.forEach(([x, y], i) => { if (i === 0) c.moveTo(cx + x! * radius, cy + y! * radius); else c.lineTo(cx + x! * radius, cy + y! * radius) }); c.closePath(); c.fill(); c.stroke()
    }
    c.restore(); c.strokeStyle = '#68deff'; c.lineWidth = 3
    c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.stroke()
    c.fillStyle = '#a2deff'; c.font = 'bold 14px monospace'
    c.fillText('WORLD / LIVE', 58, 50); c.fillText('GLOBAL NETWORK', 1250, 50)
    c.fillStyle = '#329bcd'; c.font = '12px monospace'
    c.fillText('01  /  STUDIO', 58, 75); c.fillText('SG  01:00:00', 1250, 75)
  })
  panel(room, screenMap, 59.83, 1.51, 22.5, 13.6, 2.28, -Math.PI / 2)
  // Shallow angled wings and continuous white bands give the backdrop its
  // curved broadcast-set silhouette without occupying playable floor space.
  for (const y of [.3, 2.72]) {
    box(room, steel, 59.78, y, 22.5, .16, .2, 14.6)
    box(room, ice, 59.68, y, 22.5, .035, .07, 14.6)
  }
  for (const z of [15.6, 29.4]) box(room, steel, 59.75, 1.5, z, .12, 2.7, .065)

  const desk = new THREE.Group(); desk.position.set(52.5, 0, 22.5); desk.rotation.y = -Math.PI / 2; room.add(desk)
  const arc = new THREE.Shape()
  arc.moveTo(-1.35, -.83); arc.quadraticCurveTo(0, -1.26, 1.35, -.83)
  arc.lineTo(1.17, .68); arc.quadraticCurveTo(0, .25, -1.17, .68); arc.closePath()
  function curvedLayer(y: number, depth: number, material: THREE.Material, scale: number) {
    const mesh = new THREE.Mesh(ownGeometry(new THREE.ExtrudeGeometry(arc, { depth, bevelEnabled: false, curveSegments: 12 })), material)
    mesh.rotation.x = Math.PI / 2; mesh.position.y = y; mesh.scale.set(scale, scale, 1); desk.add(mesh)
    return mesh
  }
  curvedLayer(.98, .07, silver, 1)
  // Opaque tinted glass keeps the low-poly reflections legible and avoids
  // transparent sorting artifacts when looking across the desk.
  curvedLayer(1.07, .065, basic('#5596b3'), 1.02)
  curvedLayer(.9, .035, cyan, .94)
  curvedLayer(.2, .1, black, .85)
  box(desk, blue, 0, .56, -.05, 2.13, .71, .56)
  box(desk, steel, 0, .51, .25, 1.94, .46, .035)
  box(desk, ice, 0, .76, .277, 1.9, .025, .02)
  for (const x of [-.92, .92]) box(desk, silver, x, .54, -.18, .11, .85, .48)
  const nameMap = canvasMap(512, 128, c => {
    c.fillStyle = '#071a32'; c.fillRect(0, 0, 512, 128)
    c.fillStyle = '#6bd9ff'; c.fillRect(0, 0, 8, 128)
    c.fillStyle = '#f0faff'; c.textAlign = 'center'; c.font = 'bold 48px monospace'; c.fillText('BERNARD GOH', 260, 63)
    c.fillStyle = '#76bada'; c.font = '20px monospace'; c.fillText('LIVE FROM THE NEWSROOM', 260, 103)
  })
  panel(desk, nameMap, 0, .51, .276, 1.8, .45, 0)
  box(desk, white, .32, 1.082, -.26, .43, .012, .52)
  box(desk, basic('#afc3d2'), .32, 1.09, -.28, .29, .005, .012)
  box(desk, black, -.68, 1.13, -.17, .2, .15, .18)

  const chair = new THREE.Group(); chair.position.set(NEWSROOM.bernard.x + .13, 0, NEWSROOM.bernard.z); chair.rotation.y = -Math.PI / 2; room.add(chair)
  const cylinder = ownGeometry(new THREE.CylinderGeometry(.06, .075, .44, 8))
  const stem = new THREE.Mesh(cylinder, silver); stem.position.y = .37; chair.add(stem)
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Group(); spoke.rotation.y = i * Math.PI * .4; chair.add(spoke)
    box(spoke, steel, 0, .115, .21, .06, .06, .48)
    box(spoke, black, 0, .08, .44, .12, .1, .12)
  }
  box(chair, black, 0, .67, 0, .72, .16, .65)
  box(chair, black, 0, 1.14, -.31, .7, .9, .14)
  box(chair, blue, 0, 1.16, -.225, .58, .74, .03)
  for (const x of [-.43, .43]) {
    box(chair, steel, x, .88, -.03, .045, .4, .05)
    box(chair, black, x, 1.065, .02, .13, .065, .43)
  }
  // Scrawled over the globe screen directly behind the chair, small and at
  // seat-back height, so from the desk side the chair hides it: you have to
  // walk round behind Bernard to read the clue to the game room's snap (see
  // useSnapMic). It sits just proud of the screen's face, inside its frame.
  // Only the how — what happens is theirs to find out.
  const snapClue = canvasMap(512, 256, c => {
    c.fillStyle = '#c9ecff'; c.textAlign = 'center'; c.font = 'bold 44px monospace'
    c.fillText('HOLD SHIFT + SPACE', 256, 90)
    c.font = '32px monospace'
    c.fillText('in the game room,', 256, 150)
    c.fillText('then snap your fingers.', 256, 198)
  })
  const clueMesh = new THREE.Mesh(
    ownGeometry(new THREE.PlaneGeometry(1.3, .65)),
    ownMaterial(new THREE.MeshBasicMaterial({ map: snapClue, transparent: true, depthWrite: false, fog: false })),
  )
  clueMesh.position.set(59.81, 1.12, NEWSROOM.bernard.z); clueMesh.rotation.y = -Math.PI / 2; room.add(clueMesh)

  // Bernard's model faces local +Z. Each limb pivots at an anatomical joint,
  // so the seated pose, stand-up and chase share one recognizable silhouette.
  const bernard = new THREE.Group(); bernard.scale.setScalar(.85); room.add(bernard)
  const suit = ownMaterial(new THREE.MeshLambertMaterial({ color: '#173257', emissive: '#07152a', emissiveIntensity: .35 }))
  const lapel = ownMaterial(new THREE.MeshLambertMaterial({ color: '#233e61' }))
  const skin = ownMaterial(new THREE.MeshLambertMaterial({ color: '#d29b76' }))
  const skinLight = ownMaterial(new THREE.MeshLambertMaterial({ color: '#e7b08a' }))
  const hair = ownMaterial(new THREE.MeshLambertMaterial({ color: '#111a24' }))
  const tie = basic('#5689b8'), shoe = basic('#101923')
  const hips = new THREE.Group(); bernard.add(hips)
  box(hips, suit, 0, .04, 0, .54, .25, .35)
  const torso = new THREE.Group(); torso.position.y = .12; hips.add(torso)
  const jacket = box(torso, suit, 0, .35, 0, .7, .7, .39)
  jacket.scale.x = .74
  box(torso, suit, 0, .56, 0, .75, .2, .39)
  box(torso, white, 0, .45, .205, .25, .48, .026)
  const leftLapel = box(torso, lapel, -.185, .4, .231, .13, .51, .04); leftLapel.rotation.z = .22
  const rightLapel = box(torso, lapel, .185, .4, .231, .13, .51, .04); rightLapel.rotation.z = -.22
  for (const side of [-1, 1]) {
    const collar = box(torso, white, side * .078, .645, .24, .115, .13, .035); collar.rotation.z = side * -.3
  }
  box(torso, tie, 0, .61, .264, .075, .075, .04)
  const tieEnd = box(torso, tie, 0, .392, .258, .095, .37, .033); tieEnd.rotation.z = -.025
  box(torso, silver, 0, .06, .212, .035, .035, .023)
  box(torso, blue, -.25, .44, .222, .12, .027, .018)
  box(torso, skin, 0, .765, 0, .23, .21, .23)
  const head = new THREE.Group(); head.position.y = .97; torso.add(head)
  const fallbackHead = new THREE.Group(); head.add(fallbackHead)
  const headShape = ownGeometry(new THREE.SphereGeometry(1, 10, 7))
  const face = new THREE.Mesh(headShape, skinLight); face.scale.set(.285, .35, .25); fallbackHead.add(face)
  box(fallbackHead, skin, 0, -.17, .045, .4, .2, .33)
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(headShape, skin); ear.position.set(side * .284, -.025, -.01); ear.scale.set(.061, .115, .064); fallbackHead.add(ear)
  }
  box(fallbackHead, skin, 0, -.032, .252, .08, .12, .087)
  box(fallbackHead, basic('#a86950'), 0, -.153, .223, .145, .02, .018)
  const hairCap = new THREE.Mesh(headShape, hair); hairCap.position.set(0, .19, -.03); hairCap.scale.set(.303, .206, .26); fallbackHead.add(hairCap)
  box(fallbackHead, hair, 0, .06, -.21, .47, .32, .06)
  // Three swept facets suggest the distinctive side part, instead of a helmet.
  for (let i = 0; i < 3; i++) {
    const sweep = box(fallbackHead, hair, -.13 + i * .105, .245 + i * .013, .087 - i * .015, .21, .12, .24)
    sweep.rotation.z = -.2; sweep.rotation.y = -.16
  }
  const eyes = ownMaterial(new THREE.MeshBasicMaterial({ color: '#122034', fog: false }))
  const eyeGlow = ownMaterial(new THREE.MeshBasicMaterial({ color: '#ff1528', transparent: true, opacity: 0, depthWrite: false, fog: false }))
  for (const side of [-1, 1]) {
    box(fallbackHead, white, side * .123, .034, .23, .101, .044, .024)
    box(fallbackHead, eyes, side * .123, .034, .246, .049, .041, .014)
    const brow = box(fallbackHead, hair, side * .122, .103, .239, .121, .032, .029); brow.rotation.z = side * -.05
    box(fallbackHead, eyeGlow, side * .123, .034, .254, .155, .092, .006)
  }
  // A digitized photographic face on a faceted head, like a 1990s texture atlas.
  // The UV silhouette excludes the unused background pixels around the portrait.
  const outline: [number, number][] = [
    [.435,.028],[.55,.028],[.63,.061],[.67,.11],[.72,.14],[.765,.22],
    [.79,.29],[.79,.37],[.773,.444],[.803,.454],[.811,.485],[.804,.555],
    [.78,.615],[.758,.647],[.731,.727],[.687,.796],[.63,.86],[.579,.921],
    [.536,.947],[.477,.948],[.416,.925],[.354,.883],[.316,.83],[.278,.77],
    [.248,.699],[.228,.63],[.211,.582],[.19,.524],[.189,.482],[.202,.461],
    [.214,.445],[.198,.388],[.191,.325],[.205,.257],[.239,.197],[.286,.147],
    [.329,.114],[.373,.063],
  ]
  const faceOutline = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2((u - .5) * .95 * .94, (.5 - v) * .8 * .984)))
  const photoHead = new THREE.Group(); photoHead.visible = false; head.add(photoHead)
  const skull = new THREE.Mesh(ownGeometry(new THREE.ExtrudeGeometry(faceOutline, { depth: .32, bevelEnabled: false })), skin)
  skull.position.z = -.08; photoHead.add(skull)
  const portraitGeometry = ownGeometry(new THREE.ShapeGeometry(faceOutline))
  const vertices = portraitGeometry.getAttribute('position'), uv = portraitGeometry.getAttribute('uv')
  for (let i = 0; i < vertices.count; i++) uv.setXY(i, vertices.getX(i) / .95 + .5, vertices.getY(i) / .8 + .5)
  const portraitMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }))
  const portrait = new THREE.Mesh(portraitGeometry, portraitMaterial); portrait.position.z = .242; photoHead.add(portrait)
  const photoEyes = ownMaterial(new THREE.MeshBasicMaterial({ color: '#ff182d', transparent: true, opacity: 0, depthWrite: false, fog: false }))
  for (const x of [-.108, .105]) box(photoHead, photoEyes, x, .011, .247, .055, .016, .005)
  const eyeLight = new THREE.PointLight('#ff1837', 0, 2.1, 2); eyeLight.position.set(0, .02, .43); head.add(eyeLight)
  function arm(side: number) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * .41, .58, 0); torso.add(shoulder)
    box(shoulder, suit, 0, -.205, 0, .23, .44, .27)
    const elbow = new THREE.Group(); elbow.position.y = -.4; shoulder.add(elbow)
    box(elbow, suit, 0, -.17, 0, .19, .36, .23)
    box(elbow, white, 0, -.35, 0, .195, .065, .235)
    const hand = box(elbow, skinLight, 0, -.435, .013, .17, .15, .13)
    box(elbow, skin, -side * .095, -.397, .045, .055, .092, .07)
    return { shoulder, elbow, hand }
  }
  function leg(side: number) {
    const hip = new THREE.Group(); hip.position.set(side * .17, 0, 0); hips.add(hip)
    box(hip, suit, 0, -.24, 0, .255, .48, .3)
    const knee = new THREE.Group(); knee.position.y = -.47; hip.add(knee)
    box(knee, suit, 0, -.23, 0, .235, .47, .25)
    box(knee, shoe, 0, -.465, .075, .25, .14, .43)
    return { hip, knee }
  }
  const leftArm = arm(-1), rightArm = arm(1), leftLeg = leg(-1), rightLeg = leg(1)
  // The studio uses its own generated sprite pair. The detailed low-poly rig
  // stays as a harmless fallback structure but is never shown to the player.
  bernard.visible = false
  function bernardSprite(path: string) {
    const texture = new THREE.TextureLoader().load(path)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.repeat.set(1 / SPRITE_FRAME_COUNT, 1)
    textures.add(texture)
    const sprite = new THREE.Sprite(ownMaterial(new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: .1, fog: false })))
    return { sprite, texture }
  }
  const seatedVisual = bernardSprite('/assets/backrooms/sprites/bernard-newsroom-sheet.png')
  const seatedBernard = seatedVisual.sprite
  seatedBernard.center.set(.5, 0); seatedBernard.scale.set(2.15, 2.35, 1); room.add(seatedBernard)
  const chasingVisual = bernardSprite('/assets/backrooms/sprites/bernard-rage-sheet.png')
  const chasingBernard = chasingVisual.sprite
  chasingBernard.center.set(.5, 0); chasingBernard.scale.set(1.65, 2.35, 1); chasingBernard.visible = false; room.add(chasingBernard)
  let previousX: number = NEWSROOM.bernard.x, previousZ: number = NEWSROOM.bernard.z, stride = 0

  return {
    update(game: Game, dt: number) {
      const state = game.newsroom.bernard
      room.visible = game.newsroom.open
      const stand = state.enraged ? bernardStandProgress(state.rageTime) : 0
      const distance = Math.hypot(state.x - previousX, state.z - previousZ)
      const moving = state.enraged && stand >= .99 && dt > 0 && distance > .0001
      if (moving) stride += distance * 5.7
      seatedVisual.texture.offset.x = spriteFrameOffset(spriteFrame(game.time, 2))
      chasingVisual.texture.offset.x = spriteFrameOffset(moving ? spriteFrame(stride, 4 / (Math.PI * 2)) : 0)
      bernard.position.set(state.x, 0, state.z)
      seatedBernard.visible = stand < .5
      seatedBernard.position.set(state.x, .03, state.z)
      chasingBernard.visible = stand >= .5
      chasingBernard.position.set(state.x, .03 + (moving ? Math.abs(Math.sin(stride * 2)) * .045 : 0), state.z)
      if (!state.enraged) bernard.rotation.y = -Math.PI / 2
      else if (distance > .001) bernard.rotation.y = Math.atan2(state.x - previousX, state.z - previousZ)
      else if (stand < 1) bernard.rotation.y = Math.atan2(game.player.x - state.x, game.player.z - state.z)
      previousX = state.x; previousZ = state.z
      const gait = moving ? Math.sin(stride) : 0
      hips.position.y = THREE.MathUtils.lerp(.8, 1.055, stand) + (moving ? Math.abs(Math.sin(stride * 2)) * .045 : 0)
      torso.rotation.x = stand * (moving ? .09 : .01)
      leftLeg.hip.rotation.x = -(1 - stand) * Math.PI / 2 + gait * .64
      rightLeg.hip.rotation.x = -(1 - stand) * Math.PI / 2 - gait * .64
      leftLeg.knee.rotation.x = (1 - stand) * Math.PI / 2 + Math.max(0, -gait) * .65
      rightLeg.knee.rotation.x = (1 - stand) * Math.PI / 2 + Math.max(0, gait) * .65
      for (const [limb, side] of [[leftArm, -1], [rightArm, 1]] as const) {
        limb.shoulder.rotation.x = -(1 - stand) * .12 + side * gait * .68
        limb.shoulder.rotation.z = side * ((1 - stand) * -.12 + stand * .1)
        limb.elbow.rotation.x = -(1 - stand) * 1.4 - stand * .65
      }
      photoEyes.opacity = state.enraged ? .92 : 0
      eyes.color.set(state.enraged ? '#ff233b' : '#122034')
      eyeGlow.opacity = state.enraged ? .22 + Math.sin(game.time * 16) * .045 : 0
      eyeLight.intensity = state.enraged ? 1.25 : 0
      // The empty chair remains behind when the anchor gets up.
      chair.position.x = NEWSROOM.bernard.x + .13 + stand * .24
    },
    dispose() {
      if (disposed) return
      disposed = true
      room.removeFromParent()
      geometries.forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
      textures.forEach(texture => texture.dispose())
      room.clear()
    },
  }
}
