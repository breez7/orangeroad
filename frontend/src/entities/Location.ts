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

export class Location {
  readonly def: LocationDef;
  readonly view: Container;

  constructor(def: LocationDef) {
    this.def = def;

    const container = new Container();
    container.x = def.x;
    container.y = def.y;
    container.label = `location:${def.id}`;

    const tile = new Graphics();
    tile.roundRect(0, 0, def.width, def.height, 12);
    tile.fill({ color: def.color, alpha: 0.85 });
    tile.stroke({ color: 0x1a1a2e, width: 3, alpha: 0.9 });
    container.addChild(tile);

    const label = new Text({
      text: def.name,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 22,
        fontWeight: '600',
        fill: 0x1a1a2e,
        align: 'center',
        dropShadow: {
          color: 0xffffff,
          alpha: 0.4,
          blur: 2,
          distance: 0,
        },
      },
    });
    label.anchor.set(0.5);
    label.x = def.width / 2;
    label.y = def.height / 2;
    container.addChild(label);

    this.view = container;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
