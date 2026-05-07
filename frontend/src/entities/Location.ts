import { Container, Graphics, Text } from 'pixi.js';

export interface LocationDef {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Style palette shared with NPC.ts for visual cohesion. The soft-dark outline
 * (1.25px @ 0.85α on 0x1a1a2e) is the same one the SD character sprites use,
 * so buildings + people read like they belong to the same illustration set.
 */
const OUTLINE = { color: 0x1a1a2e, width: 1.25, alpha: 0.85 } as const;
const OUTLINE_THICK = { color: 0x1a1a2e, width: 1.6, alpha: 0.85 } as const;

/**
 * Tweak a 0xRRGGBB color by `delta` per channel (clamped 0..255). Negative
 * darkens, positive lightens. Lets us derive roof / window / awning shades
 * deterministically from each location's authored base color so the three
 * houses still feel distinct without having to hand-pick a full palette.
 */
function shade(color: number, delta: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 0xff) + delta));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 0xff) + delta));
  const b = Math.max(0, Math.min(255, (color & 0xff) + delta));
  return (r << 16) | (g << 8) | b;
}

/**
 * Phase B-2 (issue #21) — Location entity.
 *
 * Each location is drawn as a layered top-down scene that fits inside the
 * authored rect (rect coordinates in `LOCATIONS` are load-bearing for the
 * schedule + click-to-talk + path-router systems, so we never overflow).
 * Building footprints are slightly inset; details (roofs, windows, awnings,
 * trees, paths, fountains) are drawn on top using PixiJS Graphics primitives
 * — no external image assets.
 *
 * Layer order inside the location's container:
 *   1. Ground patch (a slightly different shade beneath the building, which
 *      reads as "schoolyard / front yard / cafe terrace / park").
 *   2. Building / structures.
 *   3. Decorations (windows, doors, awnings, trees, fountain, …).
 *   4. Korean name label as an in-world sign-style panel.
 */
export class Location {
  readonly def: LocationDef;
  readonly view: Container;

  constructor(def: LocationDef) {
    this.def = def;

    const container = new Container();
    container.x = def.x;
    container.y = def.y;
    container.label = `location:${def.id}`;

    // (1) Ground patch — fills the full rect with a soft, slightly off-base
    // shade. This is what shows through between building parts and reads as
    // the lot the structure sits on. Rounded corners keep the silhouette
    // friendly and match the previous Location look.
    const ground = new Graphics();
    ground.roundRect(0, 0, def.width, def.height, 14);
    ground.fill({ color: shade(def.color, -22), alpha: 0.55 });
    ground.stroke({ color: 0x1a1a2e, width: 2, alpha: 0.55 });
    container.addChild(ground);

    // (2-3) Per-id structure + decoration layer.
    switch (def.id) {
      case 'school':
        this.drawSchool(container);
        break;
      case 'kyousuke-home':
      case 'madoka-home':
      case 'hikaru-home':
        this.drawHouse(container);
        break;
      case 'cafe':
        this.drawCafe(container);
        break;
      case 'park':
        this.drawPark(container);
        break;
      default:
        // Fallback for any unknown id — keeps the building rendering forward
        // compatible if a future location is added without a dedicated draw.
        this.drawGenericBuilding(container);
        break;
    }

    // (4) Korean name label as a small "sign board" panel near the top of
    // the rect so it reads as in-world signage rather than floating text.
    container.addChild(this.makeSignBoard(def));

    this.view = container;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Per-id drawing helpers. Each takes the location container and adds layered
  // children to it. Coordinates are LOCAL to the rect (0,0)..(width,height).
  // ---------------------------------------------------------------------------

  /**
   * School — the largest rect in the town. Two-storey body with a darker roof
   * stripe along the top, two evenly-spaced rows of small windows, a front
   * door with steps centered along the bottom edge, and a small clock tower
   * with a circular face on the right.
   */
  private drawSchool(container: Container): void {
    const { width: w, height: h, color } = this.def;

    // Main body — inset so the ground patch shows around it.
    const padX = 16;
    const padY = 26;
    const bodyW = w - padX * 2;
    const bodyH = h - padY * 2;
    const body = new Graphics();
    body.roundRect(padX, padY, bodyW, bodyH, 6);
    body.fill({ color });
    body.stroke(OUTLINE_THICK);
    container.addChild(body);

    // Roof stripe — darker band along the top of the body.
    const roof = new Graphics();
    roof.rect(padX, padY, bodyW, 14);
    roof.fill({ color: shade(color, -55) });
    roof.stroke(OUTLINE);
    container.addChild(roof);

    // Window rows. Two rows × 5 columns of small dark rounded rects across
    // the body. Window pitch is computed so they're evenly spaced regardless
    // of how wide the rect is.
    const windows = new Graphics();
    const winColor = shade(color, -90);
    const cols = 5;
    const winW = 22;
    const winH = 16;
    const winRowYs = [padY + 22, padY + bodyH - winH - 16];
    for (const wy of winRowYs) {
      for (let c = 0; c < cols; c++) {
        const wx = padX + 18 + c * ((bodyW - 36 - winW) / (cols - 1));
        windows.roundRect(wx, wy, winW, winH, 2);
      }
    }
    windows.fill({ color: winColor, alpha: 0.85 });
    windows.stroke(OUTLINE);
    container.addChild(windows);

    // Front door with two steps — centered along the bottom edge of the body.
    const doorW = 24;
    const doorH = 18;
    const doorX = padX + bodyW / 2 - doorW / 2;
    const doorY = padY + bodyH - doorH;
    const door = new Graphics();
    door.roundRect(doorX, doorY, doorW, doorH, 2);
    door.fill({ color: shade(color, -100) });
    door.stroke(OUTLINE);
    // Steps — two thin rects extending downward from the door.
    door.rect(doorX - 4, doorY + doorH, doorW + 8, 3);
    door.rect(doorX - 8, doorY + doorH + 3, doorW + 16, 3);
    door.fill({ color: shade(color, -30), alpha: 0.85 });
    door.stroke(OUTLINE);
    container.addChild(door);

    // Clock tower — small square turret on the upper-right of the body with
    // a circular clock face. Small enough not to fight the windows for
    // attention but specific enough that the building reads as "school".
    const towerW = 22;
    const towerH = 22;
    const towerX = padX + bodyW - towerW - 10;
    const towerY = padY - 18;
    const tower = new Graphics();
    tower.rect(towerX, towerY, towerW, towerH);
    tower.fill({ color: shade(color, -30) });
    tower.stroke(OUTLINE);
    container.addChild(tower);

    const clockFace = new Graphics();
    const cx = towerX + towerW / 2;
    const cy = towerY + towerH / 2;
    clockFace.circle(cx, cy, 7);
    clockFace.fill({ color: 0xf4f1de });
    clockFace.stroke(OUTLINE);
    // Hour + minute hands.
    clockFace.moveTo(cx, cy).lineTo(cx, cy - 4);
    clockFace.stroke({ color: 0x1a1a2e, width: 1.25, alpha: 1 });
    clockFace.moveTo(cx, cy).lineTo(cx + 3, cy + 1);
    clockFace.stroke({ color: 0x1a1a2e, width: 1, alpha: 1 });
    container.addChild(clockFace);
  }

  /**
   * Generic house — pitched-roof triangle on top of a body rectangle, two
   * front windows with cross mullions, a front door with a doorknob, and a
   * tiny garden patch in one corner. Roof color is derived from the base so
   * the three homes stay visually distinct (kyousuke red-roofed, madoka with
   * a sandy roof, hikaru forest-roofed).
   */
  private drawHouse(container: Container): void {
    const { width: w, height: h, color } = this.def;

    // Body sits inset, leaving room above for the pitched roof and below for
    // a small garden / sign.
    const padX = 18;
    const bodyTop = 30;
    const bodyBottom = h - 18;
    const bodyW = w - padX * 2;
    const bodyH = bodyBottom - bodyTop;
    const body = new Graphics();
    body.roundRect(padX, bodyTop, bodyW, bodyH, 6);
    body.fill({ color });
    body.stroke(OUTLINE_THICK);
    container.addChild(body);

    // Pitched roof — triangle peaking above the body. Roof color is a darker
    // sibling of the base so each house roof differs naturally.
    const roof = new Graphics();
    const peakY = 8;
    roof.poly([
      padX - 4, bodyTop,
      padX + bodyW + 4, bodyTop,
      padX + bodyW / 2, peakY,
    ]);
    roof.fill({ color: shade(color, -55) });
    roof.stroke(OUTLINE_THICK);
    container.addChild(roof);

    // Two front windows with cross-mullions (rectangle with internal '+').
    const winColor = 0xcde3ff;
    const winW = 28;
    const winH = 24;
    const winY = bodyTop + 18;
    const winLX = padX + bodyW * 0.22 - winW / 2;
    const winRX = padX + bodyW * 0.62 - winW / 2;
    for (const wx of [winLX, winRX]) {
      const win = new Graphics();
      win.roundRect(wx, winY, winW, winH, 2);
      win.fill({ color: winColor, alpha: 0.95 });
      win.stroke(OUTLINE);
      // Cross mullions.
      win.moveTo(wx + winW / 2, winY).lineTo(wx + winW / 2, winY + winH);
      win.moveTo(wx, winY + winH / 2).lineTo(wx + winW, winY + winH / 2);
      win.stroke(OUTLINE);
      container.addChild(win);
    }

    // Front door — slim rect on the right of the body, with a doorknob.
    const doorW = 20;
    const doorH = 30;
    const doorX = padX + bodyW - doorW - 14;
    const doorY = bodyTop + bodyH - doorH;
    const door = new Graphics();
    door.roundRect(doorX, doorY, doorW, doorH, 2);
    door.fill({ color: shade(color, -90) });
    door.stroke(OUTLINE);
    door.circle(doorX + doorW - 4, doorY + doorH / 2, 1.2);
    door.fill({ color: 0xffd166 });
    container.addChild(door);

    // Tiny garden patch — a small soil rectangle with a few green dots — in
    // the lower-left corner of the body.
    const garden = new Graphics();
    const gx = padX + 4;
    const gy = bodyTop + bodyH - 14;
    garden.roundRect(gx, gy, 26, 10, 3);
    garden.fill({ color: 0x7a4a2a, alpha: 0.85 });
    garden.stroke(OUTLINE);
    container.addChild(garden);
    const flowers = new Graphics();
    for (let i = 0; i < 4; i++) {
      flowers.circle(gx + 4 + i * 6, gy + 5, 2);
    }
    flowers.fill({ color: 0x6a994e });
    container.addChild(flowers);
  }

  /**
   * Cafe — body with a striped awning along the top edge, a chalkboard menu
   * sign by the door, and one or two small outdoor tables (a circle with
   * dots around it for chairs). Reads as "place to eat" from the top down.
   */
  private drawCafe(container: Container): void {
    const { width: w, height: h, color } = this.def;

    const padX = 16;
    const padY = 24;
    const bodyW = w - padX * 2;
    const bodyH = h - padY * 2 - 14;
    const body = new Graphics();
    body.roundRect(padX, padY, bodyW, bodyH, 6);
    body.fill({ color });
    body.stroke(OUTLINE_THICK);
    container.addChild(body);

    // Striped awning across the top edge — alternating bands in two colors.
    const awning = new Graphics();
    const stripeW = 14;
    const awningH = 12;
    const stripeColors = [shade(color, 25), shade(color, -45)];
    for (let i = 0, x = padX; x < padX + bodyW; i++, x += stripeW) {
      const band = stripeColors[i % 2];
      const drawW = Math.min(stripeW, padX + bodyW - x);
      awning.rect(x, padY - 4, drawW, awningH);
      awning.fill({ color: band });
    }
    awning.stroke(OUTLINE);
    container.addChild(awning);

    // Door — centered along the bottom of the body.
    const doorW = 22;
    const doorH = 22;
    const doorX = padX + bodyW * 0.55 - doorW / 2;
    const doorY = padY + bodyH - doorH;
    const door = new Graphics();
    door.roundRect(doorX, doorY, doorW, doorH, 2);
    door.fill({ color: shade(color, -90) });
    door.stroke(OUTLINE);
    door.circle(doorX + doorW - 4, doorY + doorH / 2, 1.2);
    door.fill({ color: 0xffd166 });
    container.addChild(door);

    // Chalkboard menu sign next to the door.
    const sign = new Graphics();
    const sx = doorX - 28;
    const sy = doorY + 2;
    sign.roundRect(sx, sy, 22, 18, 2);
    sign.fill({ color: 0x2b2d2a });
    sign.stroke(OUTLINE);
    container.addChild(sign);
    const menuLines = new Graphics();
    for (let i = 0; i < 3; i++) {
      const ly = sy + 4 + i * 4.5;
      menuLines.moveTo(sx + 3, ly).lineTo(sx + 14, ly);
    }
    menuLines.stroke({ color: 0xf4f1de, width: 0.8, alpha: 0.9 });
    container.addChild(menuLines);

    // Outdoor tables along the bottom strip (outside the body, inside the
    // ground patch). Two tables, each a dark circle with four chair-dots.
    const tablesY = padY + bodyH + 10;
    for (const tx of [padX + 28, padX + bodyW - 28]) {
      const table = new Graphics();
      table.circle(tx, tablesY, 6);
      table.fill({ color: shade(color, -70) });
      table.stroke(OUTLINE);
      container.addChild(table);
      const chairs = new Graphics();
      const chairOffsets: Array<[number, number]> = [
        [-9, 0],
        [9, 0],
        [0, -9],
        [0, 9],
      ];
      for (const [dx, dy] of chairOffsets) {
        chairs.circle(tx + dx, tablesY + dy, 2.2);
      }
      chairs.fill({ color: 0xf4f1de, alpha: 0.9 });
      chairs.stroke(OUTLINE);
      container.addChild(chairs);
    }
  }

  /**
   * Park — a deterministic scatter of trees, a curving footpath, a bench,
   * and a small fountain. Tree positions are seeded by location id so the
   * scene looks the same on every reload. Trees read as "trunk + leaf circle"
   * from the top down.
   */
  private drawPark(container: Container): void {
    const { width: w, height: h, color } = this.def;

    // Slight grass overlay to make the park ground feel more verdant than
    // the generic location ground patch.
    const grass = new Graphics();
    grass.roundRect(8, 8, w - 16, h - 16, 12);
    grass.fill({ color, alpha: 0.5 });
    container.addChild(grass);

    // Sandy footpath — a few connected segments curving across the park.
    const path = new Graphics();
    path.moveTo(20, h - 30);
    path.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.55, h * 0.5);
    path.quadraticCurveTo(w * 0.8, h * 0.45, w - 20, 30);
    path.stroke({ color: 0xd6b88a, width: 12, alpha: 0.95 });
    path.stroke({ color: 0x9c7a4a, width: 12, alpha: 0.25 });
    container.addChild(path);

    // Fountain — concentric circles in pale blue, placed roughly mid-park.
    const fountain = new Graphics();
    const fx = w * 0.4;
    const fy = h * 0.42;
    fountain.circle(fx, fy, 16);
    fountain.fill({ color: 0xcfd8dc });
    fountain.stroke(OUTLINE);
    fountain.circle(fx, fy, 11);
    fountain.fill({ color: 0x9bd1f0, alpha: 0.95 });
    fountain.circle(fx, fy, 5);
    fountain.fill({ color: 0xe6f7ff });
    container.addChild(fountain);

    // Trees — deterministic scatter so reload doesn't reshuffle the layout.
    const rng = makeRng(`park:${this.def.id}`);
    const treeCount = 5;
    const trees = new Graphics();
    for (let i = 0; i < treeCount; i++) {
      // Avoid the path / fountain area by biasing positions toward the
      // park's outer band. We pick a random angle around the rect center
      // and place the tree near a margin of the rect.
      const tx = 26 + rng() * (w - 52);
      const ty = 26 + rng() * (h - 52);
      // Reject points too close to the fountain (visual collision).
      const dToFountain = Math.hypot(tx - fx, ty - fy);
      if (dToFountain < 32) continue;
      // Trunk.
      trees.rect(tx - 2.5, ty - 2, 5, 10);
      trees.fill({ color: 0x6f4e2a });
      trees.stroke(OUTLINE);
      // Leaves.
      const leafR = 10 + rng() * 4;
      trees.circle(tx, ty - 6, leafR);
      trees.fill({ color: 0x4f8f3a });
      trees.stroke(OUTLINE);
      // Highlight dot for a slight 3D feel.
      trees.circle(tx - leafR * 0.3, ty - 6 - leafR * 0.3, leafR * 0.35);
      trees.fill({ color: 0x7ab85c, alpha: 0.7 });
    }
    container.addChild(trees);

    // Bench — small dark rectangle near the path with two leg dots.
    const bench = new Graphics();
    const bx = w * 0.55;
    const by = h * 0.62;
    bench.rect(bx - 14, by - 3, 28, 6);
    bench.fill({ color: 0x6f4e2a });
    bench.stroke(OUTLINE);
    bench.circle(bx - 10, by + 5, 1.4);
    bench.circle(bx + 10, by + 5, 1.4);
    bench.fill({ color: 0x3a2a1a });
    container.addChild(bench);
  }

  /**
   * Fallback when an unknown id appears — minimal building. Should never run
   * for the current `LOCATIONS` set, kept for forward safety.
   */
  private drawGenericBuilding(container: Container): void {
    const { width: w, height: h, color } = this.def;
    const body = new Graphics();
    body.roundRect(16, 16, w - 32, h - 32, 6);
    body.fill({ color });
    body.stroke(OUTLINE_THICK);
    container.addChild(body);
  }

  /**
   * Build a small "sign board" Container holding the Korean name. Sits at
   * the bottom-center of the rect so it reads as a label without competing
   * with the building's central detail. The board has a soft cream fill and
   * the same dark outline used by NPC sprites.
   */
  private makeSignBoard(def: LocationDef): Container {
    const sign = new Container();
    sign.label = `location-sign:${def.id}`;

    const label = new Text({
      text: def.name,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 14,
        fontWeight: '700',
        fill: 0x1a1a2e,
        align: 'center',
        dropShadow: {
          color: 0xffffff,
          alpha: 0.5,
          blur: 1.5,
          distance: 0,
        },
      },
    });
    label.anchor.set(0.5);

    const padX = 10;
    const padY = 4;
    const boardW = label.width + padX * 2;
    const boardH = label.height + padY * 2;

    const board = new Graphics();
    board.roundRect(-boardW / 2, -boardH / 2, boardW, boardH, 4);
    board.fill({ color: 0xf4f1de, alpha: 0.95 });
    board.stroke(OUTLINE);
    sign.addChild(board);
    sign.addChild(label);

    sign.x = def.width / 2;
    sign.y = def.height - 12;
    return sign;
  }
}

/**
 * Tiny deterministic pseudo-random number generator. Hashes the seed string
 * into a 32-bit state and mulberry32-iterates from there, giving us a
 * reproducible scatter across page reloads without needing any dependency.
 */
function makeRng(seed: string): () => number {
  let s = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < seed.length; i++) {
    s ^= seed.charCodeAt(i);
    s = Math.imul(s, 16777619) >>> 0;
  }
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % 100000) / 100000;
  };
}
