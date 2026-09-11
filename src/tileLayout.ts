export type TileSize = 'small' | 'medium' | 'wide' | 'large';

export function tileSize(value: unknown): TileSize {
    return value === 'small' || value === 'wide' || value === 'large' ? value : 'medium';
}

export function tileSpan(size: TileSize): {width: number; height: number} {
    switch (size) {
    case 'small': return {width: 1, height: 1};
    case 'wide': return {width: 4, height: 2};
    case 'large': return {width: 4, height: 4};
    default: return {width: 2, height: 2};
    }
}

/** Pack variable-size cards into six small-cell columns without overlap. */
export function layoutTiles(sizes: readonly TileSize[]): Array<{x: number; y: number; width: number; height: number}> {
    const occupied = new Set<string>();
    return sizes.map(size => {
        const {width, height} = tileSpan(size);
        for (let y = 0; ; y++) {
            for (let x = 0; x <= 6 - width; x++) {
                const cells: string[] = [];
                for (let dy = 0; dy < height; dy++)
                    for (let dx = 0; dx < width; dx++) cells.push(`${x + dx},${y + dy}`);
                if (cells.some(cell => occupied.has(cell))) continue;
                for (const cell of cells) occupied.add(cell);
                return {x, y, width, height};
            }
        }
    });
}
