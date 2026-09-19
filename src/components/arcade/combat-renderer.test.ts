// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { createFightRenderer } from "./fight-renderer"
import { createFight, RAIN_WIDTH } from "./fight-sim"
import { drawSpecialEffects } from "./special-effects"

function context() {
  const calls = { drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), setTransform: vi.fn(),
    measureText: () => ({width:100}), createLinearGradient: () => ({addColorStop(){}}) }
  const ctx = new Proxy(calls, {get: (target, key) => Reflect.get(target,key) ?? (() => {})}) as unknown as CanvasRenderingContext2D
  return {ctx,calls}
}
function texture() {
  const image = new Image()
  Object.defineProperties(image,{naturalWidth:{value:1536},naturalHeight:{value:400}})
  return image
}

describe("fullscreen combat presentation", () => {
  it.each([[1920,1080],[1440,900],[3840,1080],[844,390],[390,844]])("fills %s×%s without stretching fighter proportions", (width,height) => {
    const {ctx,calls}=context(), canvas=document.createElement("canvas")
    vi.spyOn(canvas,"getContext").mockReturnValue(ctx)
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({width,height} as DOMRect)
    const renderer=createFightRenderer(canvas), state=createFight("bull","bear")
    renderer.render(state,100,["1P","CPU"])
    const [sx,, ,sy]=calls.setTransform.mock.calls.at(-1)!
    expect(sx).toBeCloseTo(sy)
    expect(canvas.width / canvas.height).toBeCloseTo(width / height)
    expect(calls.fillText.mock.calls.some(([text])=>text==="ENERGY 100/100 · READY")).toBe(true)
    state.fighters[0].energy=0
    renderer.render(state,200,["1P","CPU"])
    expect(calls.fillText.mock.calls.some(([text])=>text==="ENERGY 0/100")).toBe(true)
    renderer.dispose()
  })

  it.each([0, 1] as const)("shows five distinct Bernard energy bars, draining toward the outside in slot %s", slot => {
    const {ctx,calls}=context(), canvas=document.createElement("canvas")
    vi.spyOn(canvas,"getContext").mockReturnValue(ctx)
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({width:960,height:540} as DOMRect)
    const renderer=createFightRenderer(canvas)
    const state=slot===0 ? createFight("bernard","bull") : createFight("bull","bernard")
    renderer.render(state,100,["1P","CPU"])
    expect(calls.fillText.mock.calls.some(([text])=>text==="ENERGY 500/500 · READY")).toBe(true)
    const left=slot===0 ? 40 : 520, segmentW=76.8
    const meterRects=()=>calls.fillRect.mock.calls.filter(([x,y,w,h])=>y===83 && h===10 && x>=left && x<left+400 && w<=segmentW)
    expect(meterRects()).toHaveLength(10) // five backgrounds and five filled segments
    calls.fillRect.mockClear()
    state.fighters[slot].energy=250
    renderer.render(state,200,["1P","CPU"])
    const fills=meterRects().filter((_,index)=>index%2===1)
    expect(fills.map(([, ,w])=>w)).toEqual([segmentW,segmentW,segmentW/2,0,0])
    expect(fills[2]![0]).toBeCloseTo(slot===0 ? left+2*(segmentW+4) : left+400-2*(segmentW+4)-segmentW/2)
    expect(calls.fillText.mock.calls.some(([text])=>text==="ENERGY 250/500 · READY")).toBe(true)
    renderer.dispose()
  })

  it("keeps a jumping fighter below the HUD and above the floor on ultrawide screens", () => {
    const {ctx,calls}=context(), canvas=document.createElement("canvas")
    vi.spyOn(canvas,"getContext").mockReturnValue(ctx)
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({width:3840,height:1080} as DOMRect)
    const renderer=createFightRenderer(canvas), image=texture(), state=createFight("quant","bear")
    renderer.setSprites({quant:image})
    Object.assign(state.fighters[0],{state:"jump",y:128,vy:0})
    renderer.render(state,100,["1P","CPU"])
    const draw=calls.drawImage.mock.calls.find(([img])=>img===image)!
    const spriteTop = 540*0.86-128 + draw[6]
    expect(spriteTop).toBeGreaterThan(120)
    expect(spriteTop+draw[8]).toBeLessThan(540*0.86)
    renderer.dispose()
  })

  it("renders textured ice and full-body fire from their animation strips", () => {
    const {ctx,calls}=context(), state=createFight("bear","bull"), ice=texture(), fire=texture()
    state.phase="fight"
    for(const f of state.fighters){f.state="attack";f.move=f.def.moves.special;f.moveMs=f.move.startup+100}
    drawSpecialEffects(ctx,state,100,x=>x,y=>470-y,"back",{ice,fire})
    drawSpecialEffects(ctx,state,100,x=>x,y=>470-y,"front",{ice,fire})
    expect(calls.drawImage.mock.calls.filter(([image])=>image===fire)).toHaveLength(2)
    expect(calls.drawImage.mock.calls.some(([image])=>image===ice)).toBe(true)
  })

  it("centers a trapped fighter inside its sphere instead of using its grounded foot anchor", () => {
    const {ctx,calls}=context(), canvas=document.createElement("canvas")
    vi.spyOn(canvas,"getContext").mockReturnValue(ctx)
    vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue({width:960,height:540} as DOMRect)
    const renderer=createFightRenderer(canvas), image=texture(), state=createFight("whale","bear")
    renderer.setSprites({bear:image}); state.phase="fight"
    state.fighters[1].state="trapped";state.fighters[1].y=110-state.fighters[1].def.height/2
    renderer.render(state,100,["1P","CPU"])
    const draw=calls.drawImage.mock.calls.find(([img])=>img===image)!
    expect(draw[5]+draw[7]/2).toBeCloseTo(0)
    renderer.dispose()
  })

  it("shows a stationary orb after Whale recovers and marks the exact rain hit width", () => {
    const {ctx,calls}=context(), state=createFight("whale","bernard"), orb=texture()
    state.phase="fight";state.orbs=[{owner:0,x:450,y:110,radius:90,remainingMs:2500,captured:null}]
    state.rain=[{owner:1,x:300,ageMs:200,warningMs:600,activeMs:120,hit:false,move:state.fighters[1].def.moves.specialUp!}]
    drawSpecialEffects(ctx,state,100,x=>x,y=>470-y,"back",{orb})
    expect(calls.fillRect).toHaveBeenCalledWith(300-RAIN_WIDTH/2,0,RAIN_WIDTH,470)
    drawSpecialEffects(ctx,state,100,x=>x,y=>470-y,"front",{orb})
    const draw = calls.drawImage.mock.calls.find(([image])=>image===orb)!
    expect(draw).toEqual([orb,450-90*1.14,360-90*1.14,90*2.28,90*2.28])
    expect(calls.fillRect.mock.calls.some(([, , width, height])=>width===960 && height===540)).toBe(false)
    drawSpecialEffects(ctx,state,1000,x=>x,y=>470-y,"front",{orb})
    expect(calls.drawImage.mock.calls.at(-1)).toEqual(draw)
  })
})
