import GObject from 'gi://GObject';

type SignalObject = {
    connect(signal: string, callback: (...args: any[]) => unknown): number;
    disconnect(id: number): void;
};

// Disconnecting a GObject handler whose id is already gone aborts the whole
// process: GLib's `invalid_closure_notify` is a `g_assert`, so it calls
// `abort()` and cannot be caught by a JS `try/catch`. This bites on a shared,
// long-lived emitter (for example a Shell.App or Gio.Settings) that outlives
// the tracker: the owner may have dropped the handler, or a redisplay may tear
// the same icon down twice. Confirm the handler is still installed first;
// `signal_handler_is_connected` only reads the handler table and never aborts.
// Plain JS emitters (imports.signals, such as PopupMenu or DND draggables) are
// not GObjects and disconnect safely, so the catch still covers them.
function safeDisconnect(object: SignalObject, id: number): void {
    if (typeof GObject?.Object === 'function' && object instanceof GObject.Object) {
        if (GObject.signal_handler_is_connected(object, id))
            object.disconnect(id);
        return;
    }
    try {
        object.disconnect(id);
    } catch {
        // A plain JS signal source may already have been finalized.
    }
}

export class SignalTracker {
    private _signals: Array<[SignalObject, number]> = [];

    connect(
        object: SignalObject,
        signal: string,
        callback: (...args: any[]) => unknown,
    ): number {
        const id = object.connect(signal, callback);
        this._signals.push([object, id]);
        return id;
    }

    disconnect(object: SignalObject, id: number): void {
        const index = this._signals.findIndex(([source, signalId]) =>
            source === object && signalId === id);
        if (index === -1)
            return;
        this._signals.splice(index, 1);
        safeDisconnect(object, id);
    }

    /** A source being destroyed disconnects its own signals in GObject. */
    forget(object: SignalObject): void {
        this._signals = this._signals.filter(([source]) => source !== object);
    }

    destroy(): void {
        for (const [object, id] of this._signals.splice(0))
            safeDisconnect(object, id);
    }
}
