import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({entryPoints: ['src/tileLayout.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Tiles'});
const {layoutTiles, tileSize} = runInNewContext(`${outputFiles[0].text}\nTiles`);
const plain = value => JSON.parse(JSON.stringify(value));

test('default medium tiles retain three cards per row', () => {
    assert.deepEqual(plain(layoutTiles(['medium', 'medium', 'medium', 'medium'])), [
        {x: 0, y: 0, width: 2, height: 2}, {x: 2, y: 0, width: 2, height: 2},
        {x: 4, y: 0, width: 2, height: 2}, {x: 0, y: 2, width: 2, height: 2},
    ]);
});

test('mixed sizes fill gaps without overlapping or exceeding the six-column group', () => {
    for (let seed = 0; seed < 24; seed++) {
        const sizes = Array.from({length: 40}, (_, index) =>
            ['small', 'medium', 'wide', 'large'][(index * (seed + 1) + Math.floor(index / 3) + seed) % 4]);
        const layout = layoutTiles(sizes);
        assert.deepEqual(plain(layoutTiles(sizes)), plain(layout), 'deterministic layout after reopening');
        const occupied = new Set();
        for (const cell of layout) {
            assert.ok(cell.x >= 0 && cell.x + cell.width <= 6 && cell.y >= 0);
            for (let y = cell.y; y < cell.y + cell.height; y++) {
                for (let x = cell.x; x < cell.x + cell.width; x++) {
                    const key = `${x},${y}`;
                    assert.ok(!occupied.has(key), `overlap in sequence ${seed} at ${key}`);
                    occupied.add(key);
                }
            }
        }
    }
});

test('empty lists and unsupported stored sizes have safe defaults', () => {
    assert.deepEqual(plain(layoutTiles([])), []);
    for (const value of [undefined, null, '', 'giant', 4, {}, 'medium']) assert.equal(tileSize(value), 'medium');
    for (const value of ['small', 'wide', 'large']) assert.equal(tileSize(value), value);
});
