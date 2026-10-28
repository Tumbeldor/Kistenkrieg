// Side-view weapon silhouettes for menus, HUD and pickups (drawn in a 100 × 40 box, muzzle to the right).
import type { WeaponId } from './config';

type Ctx = CanvasRenderingContext2D;

interface Painter {
  r(x: number, y: number, w: number, h: number, rad?: number, col?: string): void;
  p(pts: number[], col?: string): void;
  c(x: number, y: number, rad: number, col?: string): void;
  line(pts: number[], width: number, col?: string): void;
}

function painter(ctx: Ctx, main: string, edge: string): Painter {
  const finish = (col?: string) => {
    ctx.fillStyle = col ?? main;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.9;
    ctx.stroke();
  };
  return {
    r(x, y, w, h, rad = 0, col) {
      ctx.beginPath();
      if (rad > 0 && 'roundRect' in ctx) (ctx as Ctx & { roundRect(x: number, y: number, w: number, h: number, r: number): void }).roundRect(x, y, w, h, rad);
      else ctx.rect(x, y, w, h);
      finish(col);
    },
    p(pts, col) {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      finish(col);
    },
    c(x, y, rad, col) {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      finish(col);
    },
    line(pts, width, col) {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.strokeStyle = col ?? main;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    },
  };
}

const trigger = (d: Painter, x: number, y: number) => d.line([x, y, x, y + 5, x + 7, y + 5, x + 7, y], 1.2);

/**
 * Draws weapon `w` so that its 100-unit width spans `width` pixels, centred on (cx, cy).
 * `mono` paints everything in one colour (e.g. for locked items).
 */
export function drawWeaponSide(ctx: Ctx, w: WeaponId, cx: number, cy: number, width: number, mono?: string) {
  const main = mono ?? '#cdd2d8';
  const dark = mono ?? '#9aa1a9';
  const acc = (c: string) => mono ?? c;
  const s = width / 100;
  ctx.save();
  ctx.translate(cx - 50 * s, cy - 20 * s);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  const d = painter(ctx, main, 'rgba(10,12,15,0.55)');
  switch (w) {
    case 'pistol':
      d.p([33, 22, 45, 22, 43, 35, 32, 35, 31, 30]);
      d.r(30, 19, 38, 4, 0, dark);
      d.r(28, 11, 44, 8, 1.5);
      for (let x = 32; x < 41; x += 2.5) d.line([x, 12.5, x, 17.5], 0.6, 'rgba(10,12,15,0.5)');
      trigger(d, 45, 23);
      break;
    case 'revolver':
      d.p([30, 18, 42, 18, 40, 22, 36, 35, 27, 34, 29, 24]);
      d.r(37, 18, 18, 4, 0, dark);
      d.r(56, 12, 36, 5);
      d.r(52, 10, 8, 9, 0, dark);
      d.r(40, 9, 15, 12, 3);
      d.line([44, 10.5, 44, 19.5], 0.7, 'rgba(10,12,15,0.5)');
      d.line([48, 10.5, 48, 19.5], 0.7, 'rgba(10,12,15,0.5)');
      d.p([36, 9, 41, 9, 42, 12, 37, 12]);
      d.r(88, 10, 3, 2);
      trigger(d, 42, 22);
      break;
    case 'smg':
    case 'smgsil':
      d.r(6, 12, 4, 11, 1, dark);
      d.r(8, 14, 22, 3, 0, dark);
      d.p([50, 21, 56, 21, 60, 35, 54, 36]);
      d.p([34, 21, 42, 21, 40, 31, 33, 31]);
      d.r(28, 11, 40, 10, 1.5);
      d.r(34, 8, 6, 3);
      if (w === 'smgsil') {
        d.r(68, 12, 28, 8, 2.5, dark);
      } else {
        d.r(62, 8, 3, 3);
        d.r(68, 14, 14, 4);
        d.r(82, 13, 4, 6);
      }
      trigger(d, 42, 21);
      break;
    case 'rifle':
      d.p([2, 12, 24, 13, 24, 21, 4, 25], dark);
      d.p([42, 21, 50, 21, 54, 34, 46, 35]);
      d.p([29, 21, 36, 21, 33, 31, 27, 31]);
      d.r(24, 11, 34, 10);
      d.r(26, 8, 32, 3, 0, dark);
      d.r(58, 12, 22, 8, 1, dark);
      d.r(80, 14, 12, 3);
      d.r(92, 13, 5, 5);
      d.r(76, 7, 3, 5);
      trigger(d, 36, 21);
      break;
    case 'dmr':
      d.p([2, 13, 26, 13, 26, 21, 4, 25], dark);
      d.r(42, 21, 9, 9);
      d.p([30, 21, 37, 21, 34, 31, 28, 31]);
      d.r(26, 12, 30, 9);
      d.r(56, 13, 24, 7, 1, dark);
      d.r(80, 14.5, 18, 2.5);
      d.r(36, 9, 3, 3);
      d.r(50, 9, 3, 3);
      d.r(30, 4, 28, 5, 2);
      d.r(26, 3, 5, 7, 1, dark);
      d.r(57, 3, 5, 7, 1, dark);
      break;
    case 'shotgun':
      d.p([2, 13, 24, 14, 24, 21, 4, 26], acc('#a99a86'));
      d.r(24, 12, 24, 9);
      d.r(48, 12, 48, 4);
      d.r(48, 16, 38, 3.5, 0, dark);
      d.r(56, 15, 18, 6, 1.5, acc('#a99a86'));
      trigger(d, 30, 21);
      break;
    case 'autoshotgun':
      d.r(4, 12, 22, 8, 2, dark);
      d.p([32, 22, 39, 22, 37, 32, 31, 32]);
      d.c(50, 28, 8, dark);
      d.c(50, 28, 3);
      d.r(26, 10, 44, 12, 2);
      d.r(32, 6, 26, 3);
      d.r(70, 13, 24, 5);
      d.r(92, 12, 5, 7);
      break;
    case 'sniper':
      d.p([2, 12, 30, 13, 30, 21, 22, 22, 18, 28, 4, 28], dark);
      d.line([70, 17, 64, 32], 1.4, main);
      d.line([70, 17, 76, 32], 1.4, main);
      d.r(30, 12, 22, 8);
      d.r(52, 14, 44, 3);
      d.r(94, 13, 5, 5);
      d.r(36, 9, 3, 3);
      d.r(52, 9, 3, 3);
      d.r(30, 3, 30, 6, 2);
      d.r(26, 2, 6, 8, 1, dark);
      d.r(58, 2, 6, 8, 1, dark);
      d.r(46, 20, 6, 2);
      d.c(52, 22, 2);
      trigger(d, 34, 20);
      break;
    case 'lmg':
      d.r(4, 12, 22, 9, 2, dark);
      d.line([78, 17, 72, 32], 1.4, main);
      d.line([78, 17, 84, 32], 1.4, main);
      d.r(36, 22, 16, 12, 1, dark);
      d.p([28, 22, 34, 22, 32, 32, 27, 32]);
      d.r(26, 10, 36, 12);
      d.r(28, 7, 30, 3, 0, dark);
      d.r(62, 13, 30, 4);
      d.r(92, 12, 5, 6);
      d.line([62, 10, 66, 5, 74, 5, 76, 10], 1.6, main);
      break;
    case 'minigun':
      d.r(12, 24, 16, 11, 1, dark);
      d.line([20, 24, 30, 20], 2, dark);
      d.p([8, 12, 20, 12, 20, 22, 14, 22], dark);
      d.r(48, 9, 48, 3);
      d.r(48, 14, 48, 3);
      d.r(48, 19, 48, 3);
      d.r(84, 8, 4, 15, 0, dark);
      d.r(20, 9, 28, 16, 3);
      d.line([28, 9, 34, 4, 42, 4, 44, 9], 1.6, main);
      break;
    case 'flamer':
      d.r(4, 8, 20, 18, 6, acc('#a26a5a'));
      d.line([14, 26, 22, 31, 34, 26], 1.6, dark);
      d.p([38, 21, 45, 21, 43, 31, 37, 31]);
      d.p([56, 21, 62, 21, 61, 29, 56, 29]);
      d.r(26, 13, 40, 8, 2);
      d.r(66, 12, 26, 5, 0, dark);
      d.r(92, 11, 5, 7);
      break;
    case 'rocket':
      d.p([40, 21, 46, 21, 45, 31, 39, 31]);
      d.p([56, 21, 62, 21, 61, 29, 56, 29]);
      d.p([2, 10, 8, 12, 8, 21, 2, 23], dark);
      d.r(6, 12, 76, 9, 2);
      d.r(48, 7, 8, 5, 0, dark);
      d.p([78, 9, 86, 9, 99, 16.5, 86, 24, 78, 24], acc('#a3ab84'));
      break;
    case 'rail':
      d.r(4, 12, 20, 9, 2, dark);
      d.p([30, 22, 37, 22, 35, 32, 29, 32]);
      d.r(24, 9, 50, 13, 2);
      for (let x = 32; x < 70; x += 6) d.line([x, 11, x, 20], 1, 'rgba(10,12,15,0.45)');
      d.r(74, 10, 24, 3);
      d.r(74, 17, 24, 3);
      d.r(76, 13.5, 20, 2, 0, acc('#6fc6d6'));
      d.r(40, 5, 14, 4, 1, dark);
      break;
    case 'gl':
      d.r(4, 13, 22, 7, 2, dark);
      d.p([28, 21, 35, 21, 33, 32, 27, 32]);
      d.p([64, 20, 70, 20, 69, 29, 64, 29]);
      d.r(26, 12, 10, 9, 0, dark);
      d.r(56, 11, 30, 9, 1.5);
      d.r(86, 10, 4, 11, 0, dark);
      d.r(34, 7, 22, 18, 4);
      for (const y of [11.5, 16, 20.5]) d.line([36, y, 54, y], 0.7, 'rgba(10,12,15,0.5)');
      break;
    case 'crossbow':
      d.p([4, 14, 14, 15, 14, 22, 4, 24], dark);
      d.p([22, 21, 29, 21, 27, 31, 21, 31]);
      d.r(8, 16, 58, 5, 1.5);
      d.r(30, 10, 16, 4, 1.5, dark);
      d.line([66, 4, 48, 18, 66, 32], 0.6, acc('#e8e2d0'));
      ctx.beginPath();
      ctx.moveTo(66, 4);
      ctx.quadraticCurveTo(74, 18, 66, 32);
      ctx.strokeStyle = main;
      ctx.lineWidth = 3.2;
      ctx.stroke();
      d.r(40, 17, 52, 1.6);
      d.p([92, 16, 98, 17.8, 92, 19.6]);
      break;
    case 'grenade':
      d.r(44, 7, 12, 5, 1.5, dark);
      d.c(50, 22, 10);
      d.line([42, 22, 58, 22], 0.6, 'rgba(10,12,15,0.5)');
      d.line([50, 12, 50, 32], 0.6, 'rgba(10,12,15,0.5)');
      ctx.beginPath();
      ctx.arc(60, 9, 3, 0, Math.PI * 2);
      ctx.strokeStyle = main;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      break;
  }
  ctx.restore();
}
