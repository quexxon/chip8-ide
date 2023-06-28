// The entry file of your WebAssembly module.

const FONT_ADDR: u16 = 0x50
const ROM_ADDR: u16 = 0x200
const V0 = 0x0
const VF = 0xF
const DWIDTH = 64
const DHEIGHT = 32

const DISPLAY = new StaticArray<u64>(DHEIGHT)
const KEYS = new StaticArray<bool>(16)
const RAM = new Uint8Array(4096)
const REG = new StaticArray<u8>(16)
const STACK: Array<u16> = []

let PC: u16 = ROM_ADDR
let I: u16 = 0
let DT: u8 = 0
let ST: u8 = 0

let LAST_KEY_DOWN: u8 = 0
let KEY_BLOCK = false
let VBLANK = true

const FONT = [
  0xF0, 0x90, 0x90, 0x90, 0xF0, // 0
  0x20, 0x60, 0x20, 0x20, 0x70, // 1
  0xF0, 0x10, 0xF0, 0x80, 0xF0, // 2
  0xF0, 0x10, 0xF0, 0x10, 0xF0, // 3
  0x90, 0x90, 0xF0, 0x10, 0x10, // 4
  0xF0, 0x80, 0xF0, 0x10, 0xF0, // 5
  0xF0, 0x80, 0xF0, 0x90, 0xF0, // 6
  0xF0, 0x10, 0x20, 0x40, 0x40, // 7
  0xF0, 0x90, 0xF0, 0x90, 0xF0, // 8
  0xF0, 0x90, 0xF0, 0x10, 0xF0, // 9
  0xF0, 0x90, 0xF0, 0x90, 0x90, // A
  0xE0, 0x90, 0xE0, 0x90, 0xE0, // B
  0xF0, 0x80, 0x80, 0x80, 0xF0, // C
  0xE0, 0x90, 0x90, 0x90, 0xE0, // D
  0xF0, 0x80, 0xF0, 0x80, 0xF0, // E
  0xF0, 0x80, 0xF0, 0x80, 0x80  // F
]

export function reset(): void {
  DISPLAY.fill(0)
  KEYS.fill(false)
  RAM.set(FONT, FONT_ADDR)
  REG.fill(0)
  STACK.length = 0

  PC = ROM_ADDR
  I = 0
  DT = 0
  ST = 0

  LAST_KEY_DOWN = 0
  KEY_BLOCK = false
  VBLANK = true
}

export function getDisplayBitmap(): Uint8ClampedArray {
  const display = new Uint8ClampedArray(DWIDTH * DHEIGHT * 4)
  const dv = new DataView(display.buffer)
  for (let x = 0; x < DWIDTH; x++) {
    for (let y = 0; y < DHEIGHT; y++) {
      if ((DISPLAY[y] & (1 << (DWIDTH - x - 1)))) {
	dv.setUint32(x * 4 + y * DWIDTH * 4, u32.MAX_VALUE)
      } else {
	dv.setUint32(x * 4 + y * DWIDTH * 4, 0xFF)
      }
    }
  }
  return display
}

export function loadRom(rom: Uint8Array): void {
  RAM.set(rom, ROM_ADDR)
}

export function tick(): bool {
  const ramData = new DataView(RAM.buffer)
  const opcode = ramData.getUint16(PC)
  PC += 2

  const x: u8 = u8((opcode & 0x0F00) >>> 8)
  const y: u8 = u8((opcode & 0x00F0) >>> 4)
  const n: u8 = u8(opcode & 0x000F)
  const nn: u8 = u8(opcode & 0x00FF)
  const nnn: u16 = opcode & 0x0FFF

  switch (opcode & 0xF000) {
  case 0x0000:
    switch (opcode) {
    case 0x0000: // Idle
      return true
    case 0x00E0: // Clear display
      DISPLAY.fill(0)
      break
    case 0x00EE: // Return from subroutine
      PC = STACK.pop()
      break
    }
    break
  case 0x1000: // Jump to NNN
    PC = nnn
    break
  case 0x2000: // Call subroutine at NNN
    STACK.push(PC)
    PC = nnn
    break
  case 0x3000: // 3XNN - if (VX == NN) { PC++ }
    if (REG[x] === nn) {
      PC += 2
    }
    break
  case 0x4000: // 4XNN - if (VX != NN) { PC++ }
    if (REG[x] !== nn) {
      PC += 2
    }
    break
  case 0x5000: // 5XY0 - if (VX == VY) { PC++ }
    if (REG[x] === REG[y]) {
      PC += 2
    }
    break
  case 0x6000: // 6XNN - VX := NN
    REG[x] = nn
    break
  case 0x7000: // 7XNN - VX += NN
    REG[x] += nn
    break
  case 0x8000:
    switch (n) {
    case 0x0: // 8XY0 - VX := VY
      REG[x] = REG[y]
      break
    case 0x1: // 8XY1 - VX |= VY
      REG[x] |= REG[y]
      REG[VF] = 0
      break
    case 0x2: // 8XY2 - VX &= VY
      REG[x] &= REG[y]
      REG[VF] = 0
      break
    case 0x3: // 8XY3 - VX ^= VY
      REG[x] ^= REG[y]
      REG[VF] = 0
      break
    case 0x4: { // 8XY4 - VX += VY
      const vx = REG[x] + REG[y]
      const carry: u8 = vx < REG[x] ? 1 : 0
      REG[x] = vx
      REG[VF] = carry
      break
    }
    case 0x5: { // 8XY5 - VX -= VY
      const carry: u8 = REG[x] > REG[y] ? 1 : 0
      REG[x] -= REG[y]
      REG[VF] = carry
      break
    }
    case 0x6: { // 8XY6 - VF = lsb(VX); VX >>= 1
      REG[x] = REG[y]
      const carry: u8 = REG[x] & 1
      REG[x] >>>= 1
      REG[VF] = carry
      break
    }
    case 0x7: { // 8XY7 - VY -= VX
      const carry: u8 = REG[y] > REG[x] ? 1 : 0
      REG[x] = REG[y] - REG[x]
      REG[VF] = carry
      break
    }
    case 0xE: { // 8XY6 - VF = msb(VX) ; VX <<= 1
      REG[x] = REG[y]
      const carry: u8 = (REG[x] >>> 7) & 1
      REG[x] <<= 1
      REG[VF] = carry
      break
    }
    }
    break
  case 0x9000: // 9XY0 - if (VX != VY) { PC++ }
    if (REG[x] !== REG[y]) {
      PC += 2
    }
    break
  case 0xA000: // ANNN - I := NNN
    I = nnn
    break
  case 0xB000: // BNNN - PC := V0 + NNN
    PC = REG[V0] + nnn
    break
  case 0xC000: // CXNN - VX := rand() & NN
    const byte = new Uint8Array(1)
    crypto.getRandomValues(byte)
    const rand = byte[0]
    REG[x] = rand & nn
    break
  case 0xD000:
    const ix = REG[x] % DWIDTH
    const iy = REG[y] % DHEIGHT
    REG[VF] = 0

    if (!VBLANK) {
      PC -= 2
      return false
    }
    VBLANK = false

    for (let yOffset: u16 = 0; yOffset < n; yOffset++) {
      const spriteRow = RAM[I + yOffset]
      for (let xOffset: u8 = 0; xOffset < 8; xOffset++) {
	const spritePixel = spriteRow & (1 << 7 - xOffset)
	if (spritePixel > 0) {
	  const displayRow = DISPLAY[iy + yOffset]
	  const displayPixel = displayRow & (1 << (DWIDTH - 8 - ix) + (7 - xOffset))
	  if (displayPixel > 0){
	    REG[VF] = 1
	  }
	  DISPLAY[iy + yOffset] ^= 1 << (DWIDTH - 1 - ix - xOffset)
	}
	if ((ix + xOffset + 1) >= DWIDTH) break // At right edge of screen
      }
      if ((iy + yOffset + 1) >= DHEIGHT) break // At bottom of screen
    }
    break
  case 0xE000:
    switch (nn) {
    case 0x9E: // EX9E - if (KEYS[VX]) { PC++ }
      if (KEYS[REG[x]]) { PC += 2 }
      break
    case 0xA1: // EXA1 - if (!KEYS[VX]) { PC++ }
      if (!KEYS[REG[x]]) { PC += 2 }
      break
    }
    break
  case 0xF000:
    switch (nn) {
    case 0x07: // FX07 - VX := Delay Timer
      REG[x] = DT
      break
    case 0x0A: // FX0A - VX := getKey()
      const keyPressed = KEYS[LAST_KEY_DOWN]
      if (KEY_BLOCK && !keyPressed) {
	KEY_BLOCK = false
      } else {
	if (!KEY_BLOCK && keyPressed) {
	  REG[x] = LAST_KEY_DOWN
	  KEY_BLOCK = true
	}
	PC -= 2
      }
      break
    case 0x29: // I := FONT_ADDR + (VX & 8)
      I = FONT_ADDR + ((REG[x] & 0xF) * 5)
      break
    case 0x15: // FX15 - Delay Timer := VX
      DT = REG[x]
      break
    case 0x18: // FX18 - Sound Timer := VX
      ST = REG[x]
      break
    case 0x1e:
      I += REG[x]
      break
    case 0x33: // FX33 - RAM[I .. I + 2] := bcd(VX)
      const vx = REG[x]
      RAM[I] = u8(Math.floor(vx / 100))
      RAM[I + 1] = u8(Math.floor(vx / 10)) % 10
      RAM[I + 2] = vx % 10
      break
    case 0x55:
      for (let i: u8 = 0; i <= x; i++) {
	RAM[I++] = REG[i]
      }
      break
    case 0x65:
      for (let i: u8 = 0; i <= x; i++) {
	REG[i] = RAM[I++]
      }
      break
    }
    break
  }

  return false
}

export function decDelayTimer(): u8 {
  return (DT > 0) ? --DT : 0
}

export function decSoundTimer(): u8 {
  return ST > 0 ? --ST : 0
}

export function keyDown(key: u8): void {
  KEYS[key] = true
  LAST_KEY_DOWN = key
}

export function keyUp(key: u8): void {
  KEYS[key] = false
}

export function setVBlank(): void {
  VBLANK = true
}

export function getKeys(): StaticArray<bool> {
  return KEYS
}

export function getRam(): Uint8Array {
  return RAM
}

export function getRegisters(): StaticArray<u8> {
  return REG
}

export function getStack(): Array<u16> {
  return STACK
}

export function getProgramCounter(): u16 {
  return PC
}

export function getIndexRegister(): u16 {
  return I
}
