import {
  Component,
  DestroyRef,
  afterNextRender,
  inject,
  viewChild,
  ElementRef,
} from '@angular/core';

const CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

/**
 * Canvas CAPTCHA drawn in the ADDABAAZ palette.
 *
 * Redraws only when the canvas actually changes size, so mobile browsers
 * firing `resize` while the URL bar hides do not scramble the code.
 * Call `refresh()` for a brand new code.
 */
@Component({
  selector: 'app-captcha',
  template: `<canvas
    #canvas
    class="captcha-canvas"
    (click)="refresh()"
    title="Tap for a new code"
    aria-label="CAPTCHA image"
    role="img"
  ></canvas>`,
})
export class Captcha {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  private code = '';
  private renderedWidth = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onResize = () => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.draw(false), 250);
  };

  constructor() {
    afterNextRender(() => {
      this.draw(true);
      window.addEventListener('resize', this.onResize);
    });

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', this.onResize);
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
    });
  }

  refresh(): void {
    this.draw(true);
  }

  matches(answer: string): boolean {
    return answer.trim().toUpperCase() === this.code.toUpperCase();
  }

  private draw(force: boolean): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas?.getContext) return;

    const cssWidth = parseFloat(getComputedStyle(canvas).width) || 170;
    const cssHeight = parseFloat(getComputedStyle(canvas).height) || 54;

    if (!force && this.renderedWidth > 0 && Math.abs(cssWidth - this.renderedWidth) < 2) return;
    this.renderedWidth = cssWidth;

    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const width = cssWidth;
    const height = cssHeight;

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#1a1a22');
    background.addColorStop(1, '#07070a');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    for (let i = 0; i < 6; i++) {
      context.strokeStyle = `hsla(${Math.random() * 360}, 70%, 60%, 0.35)`;
      context.lineWidth = 1 + Math.random() * 1.4;
      context.beginPath();
      context.moveTo(Math.random() * width, Math.random() * height);
      context.bezierCurveTo(
        Math.random() * width,
        Math.random() * height,
        Math.random() * width,
        Math.random() * height,
        Math.random() * width,
        Math.random() * height,
      );
      context.stroke();
    }

    for (let i = 0; i < 70; i++) {
      context.fillStyle = `hsla(${Math.random() * 360}, 70%, 65%, 0.45)`;
      context.beginPath();
      context.arc(
        Math.random() * width,
        Math.random() * height,
        Math.random() * 1.5,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    const slotWidth = width / (CODE_LENGTH + 1);
    let text = '';

    for (let i = 0; i < CODE_LENGTH; i++) {
      const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      text += character;
      context.save();
      context.translate(slotWidth * (i + 0.95), height / 2 + 6);
      context.rotate((Math.random() - 0.5) * 0.65);
      const fontSize = Math.round(height * (0.52 + Math.random() * 0.14));
      context.font = `800 ${fontSize}px "Plus Jakarta Sans", Arial, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.shadowColor = 'rgba(0, 0, 0, 0.85)';
      context.shadowBlur = 5;
      context.shadowOffsetY = 1;
      context.fillStyle = `hsl(${Math.random() * 60}, 95%, ${62 + Math.random() * 20}%)`;
      context.fillText(character, 0, 0);
      context.restore();
    }

    this.code = text;
  }
}
