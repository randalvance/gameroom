import { describe, it, expect, vi } from 'vitest'
import { createGame, fireLaser, stepGame, canStand, NEWSROOM } from './simulation'
const idle = { forward: 0, strafe: 0, fire: false, interact: false }
function door() {
 const g=createGame(); Object.assign(g.player,{x:41.5,z:22.5,yaw:Math.PI/2}); return g
}
describe('secret newsroom key',()=>{
 it('assigns one random enemy as the guaranteed carrier each run',()=>{
  const random=vi.spyOn(Math,'random').mockReturnValue(0)
  try { expect(createGame().newsroom.key.carrierId).toBe(0)
   random.mockReturnValue(.999); expect(createGame().newsroom.key.carrierId).toBe(11)
  } finally { random.mockRestore() }
 })
 it('keeps the door solid and pauses combat when approached without the key',()=>{
  const g=door(); stepGame(g,{...idle,interact:true,fire:true},.05)
  expect(g.newsroom.open).toBe(false); expect(g.newsroom.notice).toBe('key-needed')
  expect(canStand(NEWSROOM.door.x,NEWSROOM.door.z)).toBe(false)
  const before=JSON.stringify(g);stepGame(g,{...idle,forward:1,fire:true},.05);fireLaser(g)
  expect(JSON.stringify(g)).toBe(before)
 })
 it('drops a physical key only when the carrier is defeated, then collects it on contact',()=>{
  const g=createGame();g.newsroom.key.carrierId=0
  Object.assign(g.player,{x:19.5,z:16.5,yaw:Math.PI/2})
  g.enemies=[{...g.enemies[0]!,x:22.5,z:16.5,hp:2}]
  fireLaser(g);expect(g.newsroom.key.position).toBeNull()
  g.shotCooldown=0;fireLaser(g)
  expect(g.newsroom.key.position).toEqual({x:22.5,z:16.5})
  expect(g.newsroom.key.collected).toBe(false)
  stepGame(g,idle,.01);expect(g.newsroom.notice).toBeNull()
  g.player.x=21.8;stepGame(g,idle,.01)
  expect(g.newsroom.key.collected).toBe(true);expect(g.newsroom.key.position).toBeNull()
  expect(g.newsroom.notice).toBe('key-found')
  const before=JSON.stringify(g);stepGame(g,{...idle,fire:true},.05);expect(JSON.stringify(g)).toBe(before)
  g.newsroom.notice=null;stepGame(g,idle,.01);expect(g.newsroom.notice).toBeNull()
 })
 it('does not drop a key from other enemies',()=>{
  const g=createGame();g.newsroom.key.carrierId=1
  Object.assign(g.player,{x:19.5,z:16.5,yaw:Math.PI/2})
  g.enemies=[{...g.enemies[0]!,x:22.5,z:16.5,hp:1}];fireLaser(g)
  expect(g.newsroom.key.position).toBeNull()
 })
 it('unlocks only with the collected key and still presents Bernard’s warning',()=>{
  const g=door();g.newsroom.key.collected=true
  stepGame(g,{...idle,interact:true},.05)
  expect(g.newsroom.open).toBe(true);expect(g.newsroom.warningPending).toBe(true)
  expect(g.newsroom.notice).toBeNull()
  expect(createGame().newsroom.key.collected).toBe(false)
 })
 it('does not collect a key through the closed secret wall',()=>{
  const g=door();g.newsroom.key.position={x:42.3,z:22.5}
  stepGame(g,idle,.01);expect(g.newsroom.key.collected).toBe(false)
 })
})
