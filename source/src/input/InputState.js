// Shared, device-agnostic input state. Touch and keyboard/mouse both write into it,
// the game reads it once per frame and consumes the one-shot "pressed" flags.
export class InputState {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.lookDelta = { x: 0, y: 0 };
    this.sprintHeld = false; this.crouchHeld = false;
    this.fireHeld = false; this.adsHeld = false;
    this.pressed = new Set(); // jump, crouchToggle, crouchPress, slide, sprintTap, inspect, reload, adsToggle
  }
  press(action) { this.pressed.add(action); }
  consume(action) { const had = this.pressed.has(action); this.pressed.delete(action); return had; }
  takeLook() { const d = { x: this.lookDelta.x, y: this.lookDelta.y }; this.lookDelta.x = 0; this.lookDelta.y = 0; return d; }
  endFrame() { this.pressed.clear(); }
}
