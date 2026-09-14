/** A reversible write to shared Shell state. No-op writes never acquire it.
 * Observe property notifications to also notice changes away and back again.
 * Other writers setting the same value without a notification are unknowable.
 */
export class OwnedValue<T> {
    private _pending = false;
    private _writing = false;
    private _before!: T;
    private _last!: T;

    constructor(private _read: () => T, private _write: (value: T) => void,
        private _equal: (a: T, b: T) => boolean = Object.is) {}

    observe(): void {
        if (!this._writing && this._pending && !this._equal(this._read(), this._last))
            this._pending = false;
    }

    set(value: T): void {
        this.observe();
        const current = this._read();
        if (this._equal(current, value)) return;
        if (!this._pending) this._before = current;
        this._last = value;
        this._pending = true;
        this._writing = true;
        try { this._write(value); } finally { this._writing = false; }
    }

    restore(): void {
        this.observe();
        if (!this._pending) return;
        this._pending = false;
        this._writing = true;
        try { this._write(this._before); } finally { this._writing = false; }
    }

    abandon(): void { this._pending = false; }
    get writing(): boolean { return this._writing; }
}
