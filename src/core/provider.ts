/** A provider belongs to one enabled extension instance, never a module singleton. */
export class Provider<T> {
    readonly version = 1;
    private _listeners = new Set<(value: T | null) => void>();
    constructor(public current: T | null) {}

    subscribe(callback: (value: T | null) => void): () => void {
        this._listeners.add(callback);
        return () => { this._listeners.delete(callback); };
    }

    changed(): void {
        for (const callback of [...this._listeners]) {
            // Another callback may have released this subscription.
            if (!this._listeners.has(callback)) continue;
            try { callback(this.current); }
            catch (error) { console.error(`Lyra integration: ${error}`); }
        }
    }

    revoke(): void {
        this.current = null;
        this.changed();
        this._listeners.clear();
    }
}

export class Scope {
    private _releases: Array<() => void> = [];
    add(release: () => void): void { this._releases.push(release); }
    own<T extends {destroy(): void}>(component: T): T {
        this.add(() => component.destroy());
        return component;
    }
    destroy(): void {
        for (const release of this._releases.splice(0).reverse()) {
            try { release(); }
            catch (error) { console.error(`Lyra cleanup: ${error}`); }
        }
    }
}
