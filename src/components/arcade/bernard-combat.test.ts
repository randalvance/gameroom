import { createCpu } from './fight-ai'
import { describe, expect, it } from 'vitest'
import { CHARACTERS, characterById } from './characters'
import { createFight, EMPTY_INPUT, stepFight, type FightInput } from './fight-sim'
const step = 10
const input = (x: Partial<FightInput>) => ({ ...EMPTY_INPUT, ...x })
const ready = (id = 'whale' as typeof CHARACTERS[number]['id']) => { const s = createFight('bernard', id); s.phase = 'fight'; return s }
function run(s: ReturnType<typeof ready>, ms: number, enemy = EMPTY_INPUT) { for (let t=0;t<ms;t+=step) stepFight(s,[EMPTY_INPUT, enemy],step) }
function cast(s: ReturnType<typeof ready>, id: string) { stepFight(s,[input({sp:true,specialId:id}),EMPTY_INPUT],step) }
describe('Bernard expanded combat', () => {
  it('rushes 1.5 times Bull speed and reaches across the stage', () => {
    const s=ready(); s.fighters[0].x=40;s.fighters[1].x=900
    cast(s,'bernard-dash'); const f=s.fighters[0]; run(s,230)
    const x=f.x;run(s,100);expect(f.x-x).toBeCloseTo(180)
    run(s,900);expect(s.fighters[1].health).toBeLessThan(120)
  })
  it('places a powered ice area larger than Bear and a fired midrange circle',()=>{
    const ice=ready();cast(ice,'bernard-ice');expect(ice.fighters[0].move!.hitbox.w).toBeGreaterThan(characterById('bear').moves.special.hitbox.w)
    const circle=ready();circle.fighters[0].x=100;circle.fighters[1].x=500;cast(circle,'bernard-circle');run(circle,1400);expect(circle.fighters[1].health).toBeLessThan(120)
  })
  it('spawns larger longer-lived orbs but preserves the three-orb limit',()=>{
    const s=ready();s.fighters[1].x=940
    for(let n=0;n<3;n++){cast(s,'bernard-orb');run(s,950)}
    expect(s.orbs).toHaveLength(3);expect(s.orbs[0]!.radius).toBeGreaterThan(90)
    const before=s.fighters[0].energy;cast(s,'bernard-orb');expect(s.fighters[0].energy).toBe(before)
    run(s,5500);expect(s.orbs).toHaveLength(0)
  })
  it.each(CHARACTERS.map(c=>c.id))('scans standing %s once throughout 1000ms and allows ducking',id=>{
    for(const duck of [false,true]){
      const s=ready(id);s.fighters[0].x=100;s.fighters[1].x=600
      stepFight(s,[EMPTY_INPUT,input({down:duck})],10);cast(s,'bernard-special');run(s,500,input({down:duck}))
      const hp=s.fighters[1].health;expect(hp < characterById(id).maxHealth).toBe(!duck)
      expect(s.fighters[0].move?.kind).toBe('beam');expect(s.projectiles).toHaveLength(0)
      run(s,500,input({down:duck}));expect(s.fighters[1].health).toBe(hp)
    }
  })
  it.each(CHARACTERS.map(c=>c.id))('lets %s walk underneath Breaking News from either edge',id=>{
    for(const flipped of [false,true]){
      const s=ready(id);const [f,v]=s.fighters;f.x=flipped?929:31;v.x=flipped?v.def.width/2:960-v.def.width/2
      cast(s,'bernard-breaking-news');expect(f.energy).toBe(200)
      run(s,600);expect(f.y).toBeGreaterThan(160)
      const hp=v.health
      for(let t=0;t<2400;t+=step){
        const dx=f.x-v.x;stepFight(s,[EMPTY_INPUT,input({left:dx < -3,right:dx > 3})],step)
      }
      expect(v.health).toBe(hp);expect(Math.abs(v.x-f.x)).toBeLessThan(5)
    }
  })
  it('locks forward aim, costs three bars once, and hits the marked area only once',()=>{
    const s=ready();s.fighters[0].x=150;s.fighters[1].x=800;cast(s,'bernard-breaking-news')
    const target=s.fighters[0].special!.targetX;run(s,2100);expect(s.fighters[1].health).toBe(120);expect(s.fighters[0].energy).toBe(200)
    expect(s.fighters[0].special!.targetX).toBe(target);run(s,900);expect(s.fighters[1].health).toBeLessThan(120)
  })
  it('never clamps the explosion under Bernard at a wall, and clears it on timeout',()=>{
    const s=ready();s.fighters[0].x=929;s.fighters[1].x=910;cast(s,'bernard-breaking-news');run(s,650)
    const f=s.fighters[0];expect(Math.abs(f.special!.targetX-f.x)).toBeGreaterThanOrEqual(240)
    s.timerMs=1;run(s,10);expect(s.phase).toBe('ko');expect(f.move).toBeNull()
  })
})

describe('Bernard CPU and telegraphs',()=>{
  it('selects the six regular funded specials and respects the energy budget',()=>{
    const selected=new Set<string>()
    for(let n=0;n<100;n++){
      const s=ready();s.fighters[0].x=200;s.fighters[1].x=520
      const action=createCpu(0,()=>n/100).next(s,10)
      if(action.sp) selected.add(action.specialId ?? (action.up ? 'bernard-special-up':'bernard-special'))
    }
    expect([...selected].sort()).toEqual(['bernard-circle','bernard-dash','bernard-ice','bernard-orb','bernard-special','bernard-special-up'].sort())
    const s=ready();s.fighters[0].energy=0
    for(let n=0;n<100;n++) expect(createCpu(0,()=>n/100).next(s,10).sp).toBe(false)
  })
  it('ducks the scan and walks toward the safe space beneath Breaking News',()=>{
    const s=ready();cast(s,'bernard-special');expect(createCpu(1,()=>0.5).next(s,10).down).toBe(true)
    const ult=ready();cast(ult,'bernard-breaking-news');run(ult,650)
    const action=createCpu(1,()=>0.5).next(ult,10);expect(action.left).toBe(true);expect(action.sp).toBe(false)
  })
})

describe('Breaking News cast lifecycle',()=>{
  it('throws within 2.2 seconds, then allows the full flight warning before impact',()=>{
    const s=ready();s.fighters[0].x=150;s.fighters[1].x=800
    cast(s,'bernard-breaking-news')
    const events: { type: string; at: number }[]=[]
    for(let t=10;t<=3100;t+=10){
      stepFight(s,[EMPTY_INPUT,EMPTY_INPUT],10)
      events.push(...s.events.map(event=>({type:event.type,at:t})))
    }
    const release=events.find(event=>event.type==='specialRelease')!
    const impact=events.find(event=>event.type==='specialImpact')!
    expect(release).toBeDefined();expect(impact).toBeDefined()
    expect(release.at).toBeLessThanOrEqual(2200)
    expect(impact.at-release.at).toBe(600)
    expect(events.find(event=>event.type==='hit')!.at).toBeGreaterThanOrEqual(impact.at)
  })
  it('rejects a short energy reserve and emits release and impact once even on a miss',()=>{
    const s=ready();s.fighters[0].energy=299;cast(s,'bernard-breaking-news')
    expect(s.fighters[0].move).toBeNull();expect(s.fighters[0].energy).toBe(299)
    expect(s.events.map(e=>e.type)).toContain('outOfEnergy')
    s.fighters[0].energy=500;cast(s,'bernard-breaking-news');run(s,600)
    s.fighters[1].x=s.fighters[0].x
    const events=[]
    for(let t=0;t<4800;t+=10){stepFight(s,[EMPTY_INPUT,EMPTY_INPUT],10);events.push(...s.events)}
    expect(events.filter(e=>e.type==='specialRelease')).toHaveLength(1)
    expect(events.filter(e=>e.type==='specialImpact')).toHaveLength(1)
    expect(events.filter(e=>e.type==='hit')).toHaveLength(0)
    expect(s.fighters[0].energy).toBe(200);expect(s.fighters[0].move).toBeNull()
  })
  it('still hits someone who rises late in the scan',()=>{
    const s=ready();cast(s,'bernard-special');run(s,1000,input({down:true}))
    expect(s.fighters[1].health).toBe(120)
    run(s,100);expect(s.fighters[1].health).toBe(104)
  })
})

describe('Bernard directional controls',()=>{
  it.each([false,true])('selects the four borrowed specials relative to facing (reversed=%s)',reversed=>{
    const forward=reversed?'left':'right',back=reversed?'right':'left'
    for(const [keys,id] of [[{[forward]:true},'bernard-dash'],[{[back]:true},'bernard-ice'],[{down:true,[forward]:true},'bernard-circle'],[{down:true},'bernard-orb']] as const){
      const s=ready();s.fighters[0].x=reversed?800:100;s.fighters[1].x=reversed?100:800
      stepFight(s,[input({...keys,sp:true}),EMPTY_INPUT],10);expect(s.fighters[0].move?.id).toBe(id)
    }
  })
  it('resolves down then up+special before jumping and supports the early jump cancel',()=>{
    for(const split of [false,true]){
      const s=ready();stepFight(s,[input({down:true}),EMPTY_INPUT],10)
      if(split)stepFight(s,[input({up:true}),EMPTY_INPUT],10)
      stepFight(s,[input({up:true,sp:true}),EMPTY_INPUT],10)
      expect(s.fighters[0].move?.id).toBe('bernard-breaking-news');expect(s.fighters[0].energy).toBe(200)
    }
  })
  it('expires down-up gestures, preserves Up+SP rain, and refuses unaffordable ultimate',()=>{
    const stale=ready();stepFight(stale,[input({down:true}),EMPTY_INPUT],10);run(stale,500)
    stepFight(stale,[input({up:true,sp:true}),EMPTY_INPUT],10);expect(stale.fighters[0].move?.kind).toBe('rain')
    const poor=ready();poor.fighters[0].energy=299;stepFight(poor,[input({down:true}),EMPTY_INPUT],10)
    stepFight(poor,[input({up:true,sp:true}),EMPTY_INPUT],10);expect(poor.fighters[0].move).toBeNull();expect(poor.fighters[0].energy).toBe(299)
    const normal=ready();stepFight(normal,[input({down:true,lk:true}),EMPTY_INPUT],10);expect(normal.fighters[0].move?.id).toBe('bernard-crlk')
  })
})

it('recognizes a fresh Up after holding Down across the motion-buffer boundary',()=>{
  const s=ready()
  for(let t=0;t<420;t+=10)stepFight(s,[input({down:true}),EMPTY_INPUT],10)
  stepFight(s,[input({up:true,sp:true}),EMPTY_INPUT],10)
  expect(s.fighters[0].move?.id).toBe('bernard-breaking-news')
})
