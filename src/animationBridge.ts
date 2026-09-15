import GLib from 'gi://GLib';
import type Meta from 'gi://Meta';
import {animationCapabilities, unavailable} from './shellCompat.js';

export type NativeAnimationParams = {
    x?: number; y?: number; scale_x?: number; scale_y?: number; opacity?: number;
    onStopped: () => void;
};
type EaseActor = Meta.WindowActor & {ease(params: NativeAnimationParams): void};
type Request = (params: NativeAnimationParams) => void;

/** Intercept one native ease request, never the compositor's signal handlers.
 * The native decision, bookkeeping and onStopped completion remain in GNOME.
 * Every override is conditional on ownership and expires in the same main loop.
 */
export class NativeAnimationBridge {
    private _pending = new Map<Meta.WindowActor, () => void>();
    private _restoreDecision: (() => void) | null = null;
    private _active = true;

    constructor(
        capabilities: NonNullable<ReturnType<typeof animationCapabilities>>,
        settle: (actor: Meta.WindowActor) => void,
        prepare: (actor: Meta.WindowActor, minimizing: boolean) => Request,
    ) {
        const {wm, phase, nativeEase} = capabilities;
        const original = wm._shouldAnimateActor;
        const bridge = this;
        const override: typeof original = function (this: typeof wm, actor, types) {
            let minimizing: boolean | null = null;
            if (bridge._active && this === wm && wm._shouldAnimateActor === override) {
                try {
                    minimizing = phase();
                    if (minimizing !== null) bridge._pending.get(actor)?.();
                    if (minimizing !== null &&
                        (minimizing ? wm._minimizing : wm._unminimizing).has(actor)) minimizing = null;
                    if (minimizing !== null) settle(actor);
                } catch (error) { unavailable(`animation preparation: ${error}`); }
            }
            const allowed = original.call(this, actor, types);
            if (allowed && minimizing !== null && bridge._active && wm._shouldAnimateActor === override) {
                try {
                    const pending = minimizing ? wm._minimizing : wm._unminimizing;
                    // A foreign ease override or an already prepared native
                    // operation is not ours to replace.
                    if (!pending.has(actor) && !Object.hasOwn(actor, 'ease') && (actor as EaseActor).ease === nativeEase)
                        bridge._arm(actor as EaseActor, minimizing, prepare(actor, minimizing), capabilities);
                } catch (error) { unavailable(`animation interception: ${error}`); }
            }
            return allowed;
        };
        this._restoreDecision = () => {
            if (Object.getOwnPropertyDescriptor(wm, '_shouldAnimateActor')?.value === override)
                delete (wm as Partial<typeof wm>)._shouldAnimateActor;
        };
        try {
            Object.defineProperty(wm, '_shouldAnimateActor', {value: override, configurable: true, writable: true});
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    private _arm(actor: EaseActor, minimizing: boolean, request: Request,
        capabilities: NonNullable<ReturnType<typeof animationCapabilities>>): void {
        this._pending.get(actor)?.();
        const {wm, phase} = capabilities;
        const original = actor.ease;
        const bridge = this;
        let idle = 0, destroyId = 0, released = false;
        const release = () => {
            if (released) return;
            released = true;
            this._pending.delete(actor);
            try {
                if (Object.getOwnPropertyDescriptor(actor, 'ease')?.value === override)
                    delete (actor as Partial<EaseActor>).ease;
            } finally {
                try { if (idle) GLib.source_remove(idle); }
                finally {
                    idle = 0;
                    if (destroyId) { const id = destroyId; destroyId = 0; actor.disconnect(id); }
                }
            }
        };
        const override = function (this: Meta.WindowActor, params: NativeAnimationParams) {
            const owned = !released && actor.ease === override && this === actor;
            try {
                release();
                if (owned && bridge._active && phase() === minimizing &&
                    (minimizing ? wm._minimizing : wm._unminimizing).has(actor) &&
                    typeof params.onStopped === 'function') {
                    request(params);
                    return;
                }
            } catch (error) { unavailable(`animation request: ${error}`); }
            original.call(this, params);
        };
        this._pending.set(actor, release);
        try {
            destroyId = actor.connect('destroy', release);
            idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                idle = 0;
                release();
                return GLib.SOURCE_REMOVE;
            });
            Object.defineProperty(actor, 'ease', {value: override, configurable: true, writable: true});
        } catch (error) {
            release();
            throw error;
        }
    }

    destroy(): void {
        this._active = false;
        try { this._restoreDecision?.(); }
        catch (error) { console.warn(`Lyra: animation decision restoration: ${error}`); }
        this._restoreDecision = null;
        for (const release of this._pending.values()) {
            try { release(); }
            catch (error) { console.warn(`Lyra: animation request cleanup: ${error}`); }
        }
        this._pending.clear();
    }
}
