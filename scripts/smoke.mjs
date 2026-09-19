// A walk through the demo: wardrobe → room → konami → arcade → console.
import { chromium } from "playwright"

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()) })

await page.goto("http://localhost:3000", { waitUntil: "networkidle" })
await page.fill('input[placeholder="What everyone calls you"]', "Randal")
await page.getByRole("radio", { name: "Character 7", exact: true }).click()
await page.getByRole("button", { name: /PLAY AS THIS ONE/ }).click()
await page.getByRole("button", { name: /ENTER THE ROOM/ }).click()
await page.waitForTimeout(5000)

// walk a few steps
for (const key of ["KeyW", "KeyW", "KeyA"]) {
  await page.keyboard.down(key); await page.waitForTimeout(400); await page.keyboard.up(key)
}
await page.screenshot({ path: "/tmp/shot-room.png" })

// chat
await page.keyboard.press("Enter")
await page.waitForTimeout(300)
await page.keyboard.type("hello room")
await page.keyboard.press("Enter")
await page.waitForTimeout(600)
await page.screenshot({ path: "/tmp/shot-chat.png" })

// konami
const code = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","KeyB","KeyA"]
for (const k of code) { await page.keyboard.press(k); await page.waitForTimeout(90) }
await page.waitForTimeout(2500)
const toast = await page.getByText(/ARCADE CABINET APPEARED/).count()
await page.screenshot({ path: "/tmp/shot-konami.png" })

console.log("arcade toast:", toast)
console.log("errors:", errors.slice(0, 10))
await browser.close()
