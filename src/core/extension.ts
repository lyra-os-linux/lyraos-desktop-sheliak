import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Provider, Scope} from './provider.js';

export const UUIDS = {
    dock: 'dock@lyraos.com.br', panel: 'panel@lyraos.com.br',
    menus: 'menus@lyraos.com.br', search: 'search@lyraos.com.br',
    animations: 'animations@lyraos.com.br', desktop: 'desktop-icons@lyraos.com.br',
} as const;

type Endpoint<T> = Pick<Provider<T>, 'version' | 'current' | 'subscribe'>;
type Manager = {
    lookup(uuid: string): {state: number; stateObj?: {lyraApi?: Endpoint<unknown>}} | undefined;
    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;
};

/** Rebind on enable/disable, and release old objects before provider teardown. */
export function watch<T>(scope: Scope, uuid: string, changed: (value: T | null) => void): void {
    const manager = Main.extensionManager as unknown as Manager;
    let endpoint: Endpoint<T> | null = null;
    let unsubscribe: (() => void) | null = null;
    const sync = () => {
        const candidate = manager.lookup(uuid)?.stateObj?.lyraApi as Endpoint<T> | undefined;
        const next = candidate?.version === 1 && candidate.current ? candidate : null;
        if (endpoint === next) return;
        unsubscribe?.();
        unsubscribe = null;
        endpoint = next;
        if (next) unsubscribe = next.subscribe(changed);
        changed(next?.current ?? null);
    };
    const id = manager.connect('extension-state-changed', sync);
    scope.add(() => {
        manager.disconnect(id);
        unsubscribe?.();
        unsubscribe = null;
        endpoint = null;
        changed(null);
    });
    sync();
}

export abstract class LyraExtension<T = object> extends Extension {
    lyraApi: Provider<T> | null = null;
    protected scope = new Scope();
    protected running = false;

    enable(): void {
        try {
            const legacy = (Main.extensionManager as unknown as Manager).lookup('sheliak@lyraos.com.br');
            if (legacy?.state === 1)
                throw new Error('Disable the legacy Sheliak extension before enabling the Lyra suite');
            this.running = true;
            this.activate();
        } catch (error) {
            this.disable();
            throw error; // Let GNOME report the actual failure, not a false active state.
        }
    }

    protected abstract activate(): void;

    disable(): void {
        this.running = false;
        this.lyraApi?.revoke();
        this.lyraApi = null;
        this.scope.destroy();
    }
}
