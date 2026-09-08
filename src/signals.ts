type SignalObject = {
    connect(signal: string, callback: (...args: any[]) => unknown): number;
    disconnect(id: number): void;
};

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
        try {
            object.disconnect(id);
        } catch {
            // The signal source may already have been finalized.
        }
    }

    /** A source being destroyed disconnects its own signals in GObject. */
    forget(object: SignalObject): void {
        this._signals = this._signals.filter(([source]) => source !== object);
    }

    destroy(): void {
        for (const [object, id] of this._signals.splice(0)) {
            try {
                object.disconnect(id);
            } catch {
                // The owner may already have destroyed the signal source.
            }
        }
    }
}
