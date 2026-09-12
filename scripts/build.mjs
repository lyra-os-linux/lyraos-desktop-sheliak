import {build} from 'esbuild';
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const rootdir = new URL('../dist/', import.meta.url);
const outdir = new URL('common/', rootdir);

await rm(rootdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});

await build({
    entryPoints: [new URL('../src/prefs.ts', import.meta.url).pathname],
    outfile: new URL('prefs.js', outdir).pathname,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['gi://*', 'resource://*'],
    sourcemap: false,
    legalComments: 'none',
});

await Promise.all([
    cp(new URL('../prefs.css', import.meta.url), new URL('prefs.css', outdir)),
    mkdir(new URL('schemas/', outdir), {recursive: true}),
    cp(new URL('../schemas/org.gnome.shell.extensions.sheliak.gschema.xml', import.meta.url),
        new URL('schemas/org.gnome.shell.extensions.sheliak.gschema.xml', outdir)),
    cp(new URL('../icons/', import.meta.url), new URL('icons/', outdir), {recursive: true}),
]);

for (const catalogFile of await readdir(new URL('../po/', import.meta.url))) {
    if (!catalogFile.endsWith('.json'))
        continue;
    const languageTag = catalogFile.slice(0, -5);
    const language = languageTag.replace('-', '_');
    const translations = JSON.parse(await readFile(
        new URL(`../po/${catalogFile}`, import.meta.url), 'utf8'));
    const escapePo = value => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
    const entries = Object.entries(translations)
        .map(([msgid, msgstr]) => `msgid "${escapePo(msgid)}"\nmsgstr "${escapePo(msgstr)}"\n`)
        .join('\n');
    const po = `msgid ""\nmsgstr ""\n` +
        `"Project-Id-Version: Sheliak 2.0.0\\n"\n` +
        `"Language: ${language}\\n"\n` +
        `"Content-Type: text/plain; charset=UTF-8\\n"\n` +
        `"Content-Transfer-Encoding: 8bit\\n"\n\n${entries}`;
    const poPath = new URL(`${language}.po`, outdir);
    await writeFile(poPath, po);
    const localeDir = new URL(`locale/${language}/LC_MESSAGES/`, outdir);
    await mkdir(localeDir, {recursive: true});
    await execFileAsync('msgfmt', [
        '--check',
        '--output-file', new URL('sheliak.mo', localeDir).pathname,
        poPath.pathname,
    ]);
}

await execFileAsync('glib-compile-schemas', [new URL('schemas/', outdir).pathname]);

for (const role of ['dock', 'panel', 'menus', 'search', 'animations', 'desktop-icons']) {
    const source = new URL(`../extensions/${role}/`, import.meta.url);
    const metadata = JSON.parse(await readFile(new URL('metadata.json', source), 'utf8'));
    const target = new URL(`../dist/extensions/${metadata.uuid}/`, import.meta.url);
    await mkdir(target, {recursive: true});
    await build({entryPoints: [new URL(`../src/extensions/${role}.ts`, import.meta.url).pathname],
        outfile: new URL('extension.js', target).pathname, bundle: true, format: 'esm',
        platform: 'neutral', target: 'es2022', external: ['gi://*', 'resource://*'],
        sourcemap: false, legalComments: 'none'});
    for (const file of role === 'desktop-icons' ? ['metadata.json'] : ['metadata.json', 'stylesheet.css'])
        await cp(new URL(file, source), new URL(file, target));
    for (const file of ['schemas', 'locale', 'icons', 'prefs.js', 'prefs.css'])
        await cp(new URL(file, outdir), new URL(file, target), {recursive: true});
    if (role === 'desktop-icons') {
        await cp(new URL('../packaging/legacy-schemas', import.meta.url), new URL('legacy-schemas', target), {recursive: true});
        execFileSync('glib-compile-schemas', ['--strict', new URL('legacy-schemas', target).pathname]);
        for (const file of ['app', 'prefs.js', 'COPYING', 'UPSTREAM.md'])
            await cp(new URL(file, source), new URL(file, target), {recursive: true});
        await cp(new URL('schemas/org.gnome.shell.extensions.lyra-desktop-icons.gschema.xml', source),
            new URL('schemas/org.gnome.shell.extensions.lyra-desktop-icons.gschema.xml', target));
        execFileSync('glib-compile-schemas', ['--strict', new URL('schemas', target).pathname]);
        for (const file of await readdir(new URL('po', source))) {
            if (!file.endsWith('.po')) continue;
            const locale = new URL(`locale/${file.slice(0, -3)}/LC_MESSAGES/`, target);
            await mkdir(locale, {recursive: true});
            execFileSync('msgfmt', ['--check', '-o', new URL('lyra-desktop-icons.mo', locale).pathname,
                new URL(`po/${file}`, source).pathname]);
        }
    }
}
