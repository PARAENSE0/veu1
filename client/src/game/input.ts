/**
 * Entrada unificada: teclado, mouse (com pointer lock) e toque (joystick virtual,
 * arrastar para olhar, botões). Ações são mapeadas pelas teclas configuráveis.
 */
import { getSettings, type Action } from '../settings';

export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  private touchDown = new Set<Action>();
  private touchPressed = new Set<Action>();
  private touchReleased = new Set<Action>();
  lookDX = 0;
  lookDY = 0;
  joyX = 0;
  joyY = 0;
  wheel = 0;
  enabled = true;
  private cleanup: (() => void)[] = [];

  constructor(private el: HTMLElement) {
    const kd = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.repeat) return;
      if (['Tab', 'Space', 'ControlLeft', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    };
    const ku = (e: KeyboardEvent) => {
      if (this.down.has(e.code)) this.releasedSet.add(e.code);
      this.down.delete(e.code);
    };
    const md = (e: MouseEvent) => {
      if (!this.enabled || e.target !== this.el) return;
      if (document.pointerLockElement !== this.el && !this.isTouch()) {
        this.el.requestPointerLock?.();
        return;
      }
      const c = `Mouse${e.button}`;
      if (!this.down.has(c)) this.pressedSet.add(c);
      this.down.add(c);
    };
    const mu = (e: MouseEvent) => {
      const c = `Mouse${e.button}`;
      if (this.down.has(c)) this.releasedSet.add(c);
      this.down.delete(c);
    };
    const mm = (e: MouseEvent) => {
      if (document.pointerLockElement === this.el) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    };
    const wh = (e: WheelEvent) => {
      if (document.pointerLockElement === this.el) this.wheel += Math.sign(e.deltaY);
    };
    const blur = () => {
      for (const c of this.down) this.releasedSet.add(c);
      this.down.clear();
    };
    const ctx = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('mousemove', mm);
    window.addEventListener('wheel', wh, { passive: true });
    window.addEventListener('blur', blur);
    el.addEventListener('contextmenu', ctx);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('wheel', wh);
      window.removeEventListener('blur', blur);
      el.removeEventListener('contextmenu', ctx);
    });
  }

  isTouch(): boolean {
    const s = getSettings().touchControls;
    if (s === 'sempre') return true;
    if (s === 'nunca') return false;
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  }

  get locked() {
    return document.pointerLockElement === this.el;
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private code(a: Action) {
    return getSettings().bindings[a];
  }
  isDown(a: Action) {
    return this.down.has(this.code(a)) || this.touchDown.has(a);
  }
  pressed(a: Action) {
    return this.pressedSet.has(this.code(a)) || this.touchPressed.has(a);
  }
  released(a: Action) {
    return this.releasedSet.has(this.code(a)) || this.touchReleased.has(a);
  }
  mousePressed(button: number) {
    return this.pressedSet.has(`Mouse${button}`);
  }
  keyPressed(code: string) {
    return this.pressedSet.has(code);
  }

  // ---- toque (chamado pelos controles virtuais)
  touchPress(a: Action) {
    if (!this.touchDown.has(a)) this.touchPressed.add(a);
    this.touchDown.add(a);
  }
  touchRelease(a: Action) {
    if (this.touchDown.has(a)) this.touchReleased.add(a);
    this.touchDown.delete(a);
  }
  touchToggle(a: Action) {
    if (this.touchDown.has(a)) this.touchRelease(a);
    else this.touchPress(a);
  }
  touchActive(a: Action) {
    return this.touchDown.has(a);
  }
  setJoystick(x: number, y: number) {
    this.joyX = x;
    this.joyY = y;
  }
  addLook(dx: number, dy: number) {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.touchPressed.clear();
    this.touchReleased.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
  }

  dispose() {
    this.unlock();
    for (const c of this.cleanup) c();
  }
}
