import type { Component } from "solid-js";

import { createEffect, on, onMount, JSX, For } from "solid-js";
import { createStore } from "solid-js/store";

import cassetteUrl from "./assets/cassette-tape.svg";

interface AppState {
  rom?: Uint8Array;
  editorBuffer: string[];
  lineNumber: number;
}

const [state, setState] = createStore<AppState>({
  rom: undefined,
  editorBuffer: [""],
  lineNumber: 0,
});

import styles from "./App.module.css";
import {
  reset,
  tick,
  decDelayTimer,
  decSoundTimer,
  getDisplayBitmap,
  keyUp,
  keyDown,
  loadRom,
  setVBlank,
} from "./chip8-wasm/build/release";

interface AudioControl {
  start: () => void;
  stop: () => void;
}

const CPU_SPEED = 700;
const SIXTY_HZ_MS = 1000 / 60;
const KEYS = new Map([
  ["Digit1", 0x1],
  ["Digit2", 0x2],
  ["Digit3", 0x3],
  ["Digit4", 0xc],
  ["KeyQ", 0x4],
  ["KeyW", 0x5],
  ["KeyE", 0x6],
  ["KeyR", 0xd],
  ["KeyA", 0x7],
  ["KeyS", 0x8],
  ["KeyD", 0x9],
  ["KeyF", 0xe],
  ["KeyZ", 0xa],
  ["KeyX", 0x0],
  ["KeyC", 0xb],
  ["KeyV", 0xf],
]);
let IDLE = false;
let AUDIO_ACTIVE = false;

let audio: AudioControl | undefined;
const initAudio = () => {
  const audioCtx = new AudioContext();
  const oscillator = new OscillatorNode(audioCtx, { type: "triangle" });
  const gainNode = new GainNode(audioCtx);
  oscillator.connect(gainNode);
  oscillator.start();
  gainNode.gain.value = 0.01;
  let started = false;
  audio = {
    start: () => {
      if (!started) {
        gainNode.connect(audioCtx.destination);
        started = true;
      }
    },
    stop: () => {
      if (started) {
        gainNode.disconnect(audioCtx.destination);
        started = false;
      }
    },
  };
};

const createMainLoop = (
  ctx: CanvasRenderingContext2D
): ((timestamp: number) => void) => {
  let previousTimestamp: number;
  let elapsed = 0;

  const loop = (timestamp: number) => {
    if (state.rom === undefined) {
      return window.requestAnimationFrame(loop);
    }

    if (previousTimestamp !== undefined) {
      const delta = timestamp - previousTimestamp;
      elapsed += delta;
    }
    previousTimestamp = timestamp;

    if (elapsed >= SIXTY_HZ_MS) {
      for (let i = 0; i < Math.floor(elapsed / SIXTY_HZ_MS); i++) {
        if (!IDLE) {
          let nCycles = Math.round(CPU_SPEED / 60);
          for (let i = 0; i < nCycles; i++) {
            IDLE = tick();
            if (IDLE) break;
          }
        }

        decDelayTimer();
        const st = decSoundTimer();
        if (audio !== undefined) {
          st > 0 ? audio.start() : audio.stop();
        }
        setVBlank();
      }
      elapsed %= SIXTY_HZ_MS;
    }

    ctx.putImageData(new ImageData(getDisplayBitmap(), 64), 0, 0);

    window.requestAnimationFrame(loop);
  };

  return loop;
};

const init = async (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d");
  if (!(ctx instanceof CanvasRenderingContext2D)) {
    throw new Error("Failed to retrieve canvas context");
  }
  ctx.imageSmoothingEnabled = false;

  document.addEventListener("keydown", (e) => {
    if (!AUDIO_ACTIVE) {
      initAudio();
      AUDIO_ACTIVE = true;
    }
    const key = KEYS.get(e.code);
    if (key !== undefined && !e.repeat) {
      keyDown(key);
    }
  });

  document.addEventListener("keyup", (e) => {
    const key = KEYS.get(e.code);
    if (key !== undefined) {
      keyUp(key);
    }
  });

  window.requestAnimationFrame(createMainLoop(ctx));
};

const getOpcodeMnemonic = (opcode: number): string => {
  if (typeof opcode !== "number" || isNaN(opcode)) {
    return "";
  }

  const x = ((opcode & 0x0f00) >>> 8).toString(16).toUpperCase();
  const y = ((opcode & 0x00f0) >>> 4).toString(16).toUpperCase();
  const n = (opcode & 0x000f).toString(16).toUpperCase();
  const nn = (opcode & 0x00ff).toString(16).padStart(2, "0").toUpperCase();
  const nnn = (opcode & 0x0fff).toString(16).padStart(3, "0").toUpperCase();

  switch (opcode & 0xf000) {
    case 0x0000:
      switch (opcode) {
        case 0x0000: // Idle
          return "idle()";
        case 0x00e0: // Clear display
          return "clearDisplay()";
        case 0x00ee: // Return from subroutine
          return "PC := stack.pop()";
      }
      break;
    case 0x1000: // Jump to NNN
      return `PC := ${nnn}`;
    case 0x2000: // Call subroutine at NNN
      return `stack.push(PC); PC := ${nnn}`;
    case 0x3000: // 3XNN - if (VX == NN) { PC++ }
      return `if V${x} = ${nn} then PC += 2`;
    case 0x4000: // 4XNN - if (VX != NN) { PC++ }
      return `if V${x} ≠ ${nn} then PC += 2`;
    case 0x5000: // 5XY0 - if (VX == VY) { PC++ }
      return `if V${x} = V${y} then PC += 2`;
    case 0x6000: // 6XNN - VX := NN
      return `V${x} := ${nn}`;
    case 0x7000: // 7XNN - VX += NN
      return `V${x} += ${nn}`;
    case 0x8000:
      switch (parseInt(n, 16)) {
        case 0x0: // 8XY0 - VX := VY
          return `V${x} := V${y}`;
        case 0x1: // 8XY1 - VX |= VY
          return `V${x} |= V${y}; VF := 0`;
        case 0x2: // 8XY2 - VX &= VY
          return `V${x} &= V${y}; VF := 0`;
        case 0x3: // 8XY3 - VX ^= VY
          return `V${x} ^= V${y}; VF := 0`;
        case 0x4:
          return `V${x} += V${y}; VF = carry`;
        case 0x5:
          return `V${x} -= V${y}; VF = carry`;
        case 0x6:
          return `V${x} >>= 1; VF = lsb(V${x})`;
        case 0x7:
          return `V${y} -= V${x}; VF = carry`;
        case 0xe:
          return `V${x} <<= 1; VF = msb(V${x})`;
      }
      break;
    case 0x9000: // 9XY0 - if (VX != VY) { PC++ }
      return `if V${x} = V${y} then PC += 2`;
    case 0xa000: // ANNN - I := NNN
      return `I := ${nnn}`;
    case 0xb000: // BNNN - PC := V0 + NNN
      return `PC := V0 + ${nnn}`;
    case 0xc000: // CXNN - VX := rand() & NN
      return `V${x} := rand() & ${nn}`;
    case 0xd000:
      return `display(V${x}, V${y}, I..I+${n})`;
    case 0xe000:
      switch (parseInt(nn, 16)) {
        case 0x9e: // EX9E - if (KEYS[VX]) { PC++ }
          return `if V${x} = key then PC += 2`;
        case 0xa1: // EXA1 - if (!KEYS[VX]) { PC++ }
          return `if V${x} ≠ key then PC += 2`;
      }
      break;
    case 0xf000:
      switch (parseInt(nn, 16)) {
        case 0x07: // FX07 - VX := Delay Timer
          return `V${x} := DT`;
        case 0x0a: // FX0A - VX := getKey()
          return `V${x} := getKey()`;
        case 0x29: // I := FONT_ADDR + (VX & 8)
          return `I := fontAddr(V${x})`;
        case 0x15: // FX15 - Delay Timer := VX
          return `DT := V${x}`;
        case 0x18: // FX18 - Sound Timer := VX
          return `ST := V${x}`;
        case 0x1e:
          return `I += V${x}`;
        case 0x33: // FX33 - RAM[I .. I + 2] := bcd(VX)
          return `RAM[I..I+2] := bcd(V${x})`;
        case 0x55:
          return `RAM[I..I+${x}] := V0..V${x}`;
        case 0x65:
          return `V0..V${x} := RAM[I..I+${x}]`;
      }
      break;
  }

  return "";
};

const FileInput: Component = () => {
  const handleOpen: JSX.ChangeEventHandlerUnion<HTMLInputElement, Event> = (
    evt
  ) => {
    if (evt.currentTarget.files === null) return;
    const file = evt.currentTarget.files.item(0);
    if (file === null) return;
    file.arrayBuffer().then((buffer) => {
      const dv = new DataView(buffer);
      const editorBuffer = [];
      for (let i = 0; i < dv.byteLength; i += 2) {
        editorBuffer.push(
          dv.getUint16(i, false).toString(16).padStart(4, "0").toUpperCase()
        );
      }
      setState("editorBuffer", editorBuffer);
      setState("rom", new Uint8Array(buffer));
    });
  };

  return (
    <div class={styles.fileInput}>
      <label for="load_rom">
        <img src={cassetteUrl} />
        Load
      </label>
      <input
        type="file"
        id="load_rom"
        name="load_rom"
        accept=".ch8"
        onChange={handleOpen}
      />
    </div>
  );
};

const Header: Component = () => {
  return (
    <div class={styles.header}>
      <FileInput />
    </div>
  );
};

const Editor: Component = () => {
  return (
    <div
      class={styles.editor}
      tabindex="0"
      onKeyDown={(e) => {
        switch (e.code) {
          case "ArrowUp":
            e.preventDefault();
            setState("lineNumber", (n) => (n === 0 ? 0 : n - 1));
            break;
          case "ArrowDown":
            e.preventDefault();
            setState("lineNumber", (n) =>
              n === state.editorBuffer.length - 1 ? n : n + 1
            );
            break;
        }
      }}
    >
      <div class={styles.margin}>
        <For each={state.editorBuffer}>
          {(_, i) => (
            <div
              classList={{
                [styles.line]: true,
                [styles.active]: i() === state.lineNumber,
              }}
            >
              {(i() * 2 + 0x200).toString(16).padStart(4, "0").toUpperCase()}
            </div>
          )}
        </For>
      </div>
      <div class={styles.content}>
        <For each={state.editorBuffer}>
          {(line, i) => {
            return (
              <div
                classList={{
                  [styles.line]: true,
                  [styles.active]: state.lineNumber === i(),
                }}
                onClick={() => setState("lineNumber", i())}
              >
                {line}
                <span class={styles.mnemonic}>
                  {line.length > 0 ? getOpcodeMnemonic(parseInt(line, 16)) : ""}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

const App: Component = () => {
  let canvas: HTMLCanvasElement | undefined;

  onMount(async () => {
    if (canvas === undefined) {
      throw new Error("Missing canvas");
    }

    await init(canvas);
  });

  createEffect(
    on(
      () => state.rom,
      (rom) => {
        if (rom) {
          reset();
          loadRom(rom);
        }
      },
      { defer: true }
    )
  );

  return (
    <div class={styles.App}>
      <Header />
      <div class={styles.body}>
        <Editor />
        <div class={styles.rightPanel}>
          <div class={styles.display}>
            <canvas ref={canvas} width="64" height="32" />
          </div>
          <div class={styles.debugger}></div>
        </div>
      </div>
    </div>
  );
};

export default App;
