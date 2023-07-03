import type { Component, ParentComponent } from "solid-js";

import {
  batch,
  untrack,
  createEffect,
  on,
  onMount,
  JSX,
  For,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";

import cassetteUrl from "./assets/cassette-tape.svg";
import resetUrl from "./assets/reset.svg";
import debugUrl from "./assets/debug.svg";

enum DebuggerTab {
  monitor,
  ram,
}

interface Chip8State {
  keys: Array<boolean>;
  ram: Uint8Array;
  registers: Array<number>;
  stack: Array<number>;
  programCounter: number;
  indexRegister: number;
  delayTimer: number;
  soundTimer: number;
  isIdle: boolean;
}

interface AppState {
  debugEnabled: boolean;
  cycle: number;
  rom?: Uint8Array;
  editorBuffer: string[];
  lineNumber: number;
  debuggerTab: DebuggerTab;
  chip8: Chip8State;
}

const initialChip8State = {
  keys: Array(16).fill(false),
  ram: new Uint8Array(4096),
  registers: Array(16).fill(0),
  stack: [],
  programCounter: 0x200,
  indexRegister: 0,
  delayTimer: 0,
  soundTimer: 0,
  isIdle: false,
};

const [state, setState] = createStore<AppState>({
  debugEnabled: false,
  cycle: 0,
  editorBuffer: [""],
  lineNumber: 0,
  debuggerTab: DebuggerTab.monitor,
  chip8: initialChip8State,
});

import styles from "./App.module.css";
import * as Chip8 from "./chip8-wasm/build/release";

interface AudioControl {
  start: () => void;
  stop: () => void;
}

const FPS = 1000 / 60; // Frames per second
const CPF = 10; // Cycles per frame
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

    if (state.debugEnabled === false) {
      if (elapsed >= FPS) {
        for (let i = 0; i < Math.floor(elapsed / FPS); i++) {
          if (!untrack(() => state.chip8.isIdle)) {
            for (let i = 0; i < CPF; i++) {
              const isIdle = Chip8.tick();
              setState("chip8", "isIdle", isIdle);
              if (isIdle) break;
            }
          }

          Chip8.decDelayTimer();
          const st = Chip8.decSoundTimer();
          if (audio !== undefined) {
            st > 0 ? audio.start() : audio.stop();
          }
          Chip8.setVBlank();
        }
        elapsed %= FPS;
      }
    }

    ctx.putImageData(new ImageData(Chip8.getDisplayBitmap(), 64), 0, 0);

    window.requestAnimationFrame(loop);
  };

  return loop;
};

const tick = (): boolean => {
  const isIdle = Chip8.tick();
  batch(() => {
    setState("chip8", "isIdle", isIdle);
    setState("chip8", "keys", Chip8.getKeys());
    setState("chip8", "ram", Chip8.getRam());
    setState("chip8", "registers", Chip8.getRegisters());
    setState("chip8", "stack", Chip8.getStack());
    setState("chip8", "programCounter", Chip8.getProgramCounter());
    setState("chip8", "indexRegister", Chip8.getIndexRegister());
  });
  return isIdle;
};

const singleStep = (): void => {
  if (!untrack(() => state.debugEnabled)) return;

  batch(() => {
    if (!untrack(() => state.chip8.isIdle)) {
      tick();
      // Automatically set VBlank in single step to avoid no-op
      Chip8.setVBlank();
    }

    let cycle = untrack(() => state.cycle);
    cycle += 1;

    if (cycle === CPF) {
      cycle = 0;
      const dt = Chip8.decDelayTimer();
      const st = Chip8.decSoundTimer();
      setState("chip8", "delayTimer", dt);
      setState("chip8", "soundTimer", st);
      if (audio !== undefined) {
        st > 0 ? audio.start() : audio.stop();
      }
    }

    setState("cycle", cycle);
  });
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
      Chip8.keyDown(key);
    } else if (e.code === "Space") {
      singleStep();
    }
  });

  document.addEventListener("keyup", (e) => {
    const key = KEYS.get(e.code);
    if (key !== undefined) {
      Chip8.keyUp(key);
    }
  });

  window.requestAnimationFrame(createMainLoop(ctx));
};

const reset = (): void => {
  Chip8.reset();
  if (state.rom) {
    Chip8.loadRom(state.rom);
  }
  batch(() => {
    setState("cycle", 0);
    setState("chip8", "isIdle", false);
    setState("chip8", "keys", Chip8.getKeys());
    setState("chip8", "ram", Chip8.getRam());
    setState("chip8", "registers", Chip8.getRegisters());
    setState("chip8", "stack", Chip8.getStack());
    setState("chip8", "programCounter", Chip8.getProgramCounter());
    setState("chip8", "indexRegister", Chip8.getIndexRegister());
    setState("chip8", "delayTimer", 0);
    setState("chip8", "soundTimer", 0);
  });
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

interface ButtonProps {
  iconUrl: string;
  label: string;
  active?: boolean;
  for?: string;
  onClick?: () => void;
}

const Button: Component<ButtonProps> = (props) => {
  return (
    <label
      classList={{
        [styles.button]: true,
        [styles.active]: props.active ?? false,
      }}
      for={props.for}
      onClick={props.onClick}
    >
      <img src={props.iconUrl} />
      {props.label}
    </label>
  );
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
      <Button label="Load" for="load_rom" iconUrl={cassetteUrl} />
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
  const toggleDebug = () => {
    setState("debugEnabled", (isEnabled) => !isEnabled);
  };

  return (
    <div class={styles.header}>
      <FileInput />
      <Button label="Reset" iconUrl={resetUrl} onClick={reset} />
      <Button
        label="Debug"
        iconUrl={debugUrl}
        active={state.debugEnabled}
        onClick={toggleDebug}
      />
    </div>
  );
};

const Editor: Component = () => {
  let margin: HTMLDivElement | undefined;

  createEffect(
    on(
      () => state.chip8.programCounter,
      (pc) => {
        if (state.debugEnabled) {
          const address = (pc - 0x200) / 2;
          const node = margin?.children[address];
          if (node) {
            node.scrollIntoView({
              behavior: "smooth",
            });
          }
        }
      }
    )
  );

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
      <div class={styles.margin} ref={margin}>
        <For each={state.editorBuffer}>
          {(_, i) => (
            <div
              classList={{
                [styles.line]: true,
                [styles.active]: i() === state.lineNumber,
                [styles.pcPosition]:
                  state.debugEnabled &&
                  i() * 2 + 0x200 === state.chip8.programCounter,
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

const Debugger: Component = () => {
  let ramListing: HTMLDivElement | undefined;

  return (
    <div class={styles.debugger}>
      <nav class={styles.tabs}>
        <span
          classList={{
            [styles.tab]: true,
            [styles.active]: state.debuggerTab === DebuggerTab.monitor,
          }}
          onClick={() => setState("debuggerTab", DebuggerTab.monitor)}
        >
          Monitor
        </span>
        <span
          classList={{
            [styles.tab]: true,
            [styles.active]: state.debuggerTab === DebuggerTab.ram,
          }}
          onClick={() => setState("debuggerTab", DebuggerTab.ram)}
        >
          RAM
        </span>
      </nav>
      <Show when={state.debuggerTab === DebuggerTab.monitor}>
        <div class={styles.monitor}>
          <section>
            <h1>State</h1>
            <dl class={styles.grid}>
              <div
                classList={{ [styles.cell]: true, [styles.clickable]: true }}
                onClick={() => {
                  setState("debuggerTab", DebuggerTab.ram);
                  const index = untrack(() => state.chip8.programCounter);
                  const node = ramListing?.children[index];
                  if (node) {
                    node.scrollIntoView(true);
                  }
                }}
              >
                <dt>PC</dt>
                <dd>
                  #
                  {state.chip8.programCounter
                    .toString(16)
                    .padStart(4, "0")
                    .toUpperCase()}
                </dd>
              </div>
              <div
                classList={{ [styles.cell]: true, [styles.clickable]: true }}
                onClick={() => {
                  setState("debuggerTab", DebuggerTab.ram);
                  const index = untrack(() => state.chip8.indexRegister);
                  const node = ramListing?.children[index];
                  if (node) {
                    node.scrollIntoView(true);
                  }
                }}
              >
                <dt>I</dt>
                <dd>
                  #
                  {state.chip8.indexRegister
                    .toString(16)
                    .padStart(4, "0")
                    .toUpperCase()}
                </dd>
              </div>
              <div class={styles.cell}>
                <dt>DT</dt>
                <dd>{state.chip8.delayTimer.toString().padStart(3, "0")}</dd>
              </div>
              <div class={styles.cell}>
                <dt>ST</dt>
                <dd>{state.chip8.soundTimer.toString().padStart(3, "0")}</dd>
              </div>
              <div class={styles.cell}>
                <dt>CPF</dt>
                <dd>{CPF.toString().padStart(2, "0")}</dd>
              </div>
              <div class={styles.cell}>
                <dt>CYC</dt>
                <dd>{state.cycle.toString().padStart(2, "0")}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h1>Registers</h1>
            <dl class={styles.grid}>
              <For each={state.chip8.registers}>
                {(value, index) => (
                  <div class={styles.cell}>
                    <dt>V{index().toString(16).toUpperCase()}</dt>
                    <dd>
                      <span>{value.toString().padStart(3, "0")}</span>{" "}
                      <span>
                        #{value.toString(16).toUpperCase().padStart(2, "0")}
                      </span>{" "}
                      <span>{value.toString(2).padStart(8, "0")}</span>
                    </dd>
                  </div>
                )}
              </For>
            </dl>
          </section>
          <section>
            <h1>Stack</h1>
            <dl class={styles.grid}>
              <For
                each={state.chip8.stack}
                fallback={
                  <div class={styles.emptyStack}>
                    &mdash;&nbsp;Empty&nbsp;&mdash;
                  </div>
                }
              >
                {(value, index) => (
                  <div class={styles.cell}>
                    <dt>
                      {index().toString(16).padStart(2, "0").toUpperCase()}
                    </dt>
                    <dd>
                      <span>
                        #{value.toString(16).toUpperCase().padStart(2, "0")}
                      </span>
                    </dd>
                  </div>
                )}
              </For>
            </dl>
          </section>
        </div>
      </Show>
      <Show when={state.debuggerTab === DebuggerTab.ram}>
        <div class={styles.ram}>
          <div class={styles.margin}></div>
          <div class={styles.ramListing} ref={ramListing}>
            <For each={[...state.chip8.ram]}>
              {(value, index) => {
                return (
                  <span
                    classList={{
                      [styles.address]: true,
                      [styles.pcPointer]:
                        index() === state.chip8.programCounter ||
                        index() - 1 === state.chip8.programCounter,
                      [styles.irPointer]: index() === state.chip8.indexRegister,
                    }}
                  >
                    {value.toString(16).toUpperCase().padStart(2, "0")}
                  </span>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
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
          <Show when={state.debugEnabled}>
            <Debugger />
          </Show>
        </div>
      </div>
    </div>
  );
};

export default App;
