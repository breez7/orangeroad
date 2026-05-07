import { Container, Graphics, Text } from 'pixi.js';
import { Location } from '@/entities/Location';
import { LOCATIONS, TOWN_BOUNDS } from '@/data/locations';

export class GameScene {
  readonly root: Container;
  private readonly locations: Location[] = [];

  constructor() {
    this.root = new Container();
    this.root.label = 'game-scene';

    const ground = new Graphics();
    ground.rect(0, 0, TOWN_BOUNDS.width, TOWN_BOUNDS.height);
    ground.fill({ color: 0x264653 });
    this.root.addChild(ground);

    const grid = new Graphics();
    const step = 80;
    for (let x = 0; x <= TOWN_BOUNDS.width; x += step) {
      grid.moveTo(x, 0).lineTo(x, TOWN_BOUNDS.height);
    }
    for (let y = 0; y <= TOWN_BOUNDS.height; y += step) {
      grid.moveTo(0, y).lineTo(TOWN_BOUNDS.width, y);
    }
    grid.stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
    this.root.addChild(grid);

    for (const def of LOCATIONS) {
      const loc = new Location(def);
      this.root.addChild(loc.view);
      this.locations.push(loc);
    }

    const banner = new Text({
      text: '오렌지로드 마을 — Phase 1.3',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 18,
        fill: 0xf4f1de,
        align: 'center',
      },
    });
    banner.anchor.set(0.5, 0);
    banner.x = TOWN_BOUNDS.width / 2;
    banner.y = 12;
    this.root.addChild(banner);
  }

  fitTo(viewWidth: number, viewHeight: number): void {
    const scale = Math.min(
      viewWidth / TOWN_BOUNDS.width,
      viewHeight / TOWN_BOUNDS.height,
    );
    this.root.scale.set(scale);
    this.root.x = (viewWidth - TOWN_BOUNDS.width * scale) / 2;
    this.root.y = (viewHeight - TOWN_BOUNDS.height * scale) / 2;
  }

  destroy(): void {
    for (const loc of this.locations) loc.destroy();
    this.locations.length = 0;
    this.root.destroy({ children: true });
  }
}
