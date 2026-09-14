import type Clutter from 'gi://Clutter';
import type St from 'gi://St';
import {OwnedValue} from './ownedState.js';
import {SignalTracker} from './signals.js';

/** Hide only while requested; return control to the latest external state. */
export class PanelVisibility {
    private _signals = new SignalTracker();
    private _suppressed = false;
    private _destroyed = false;
    private _value: OwnedValue<boolean>;

    constructor(actor: Clutter.Actor) {
        this._value = new OwnedValue(() => actor.visible, value => { actor.visible = value; });
        try {
            this._signals.connect(actor, 'destroy', () => {
                this._signals.forget(actor);
                this._value.abandon();
                this._destroyed = true;
            });
            this._signals.connect(actor, 'notify::visible', () => {
                if (this._value.writing) return;
                this._value.observe();
                // GNOME can reveal an indicator after it obtains its state.
                // Remember that request while the user has indicators hidden.
                if (this._suppressed) this._value.set(false);
            });
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    suppress(value: boolean): void {
        if (this._destroyed) return;
        this._suppressed = value;
        if (value) this._value.set(false);
        else this._value.restore();
    }

    destroy(): void {
        this._signals.destroy();
        if (this._destroyed) return;
        this._destroyed = true;
        this._value.restore();
    }
}

/** Track membership of one class, without replacing an actor's class list. */
export class PanelStyleClass {
    private _signals = new SignalTracker();
    private _value: OwnedValue<boolean>;

    constructor(actor: St.Widget, name: string) {
        this._value = new OwnedValue(() => actor.has_style_class_name(name), value => {
            if (value) actor.add_style_class_name(name);
            else actor.remove_style_class_name(name);
        });
        try {
            this._signals.connect(actor, 'notify::style-class', () => this._value.observe());
            this._signals.connect(actor, 'destroy', () => {
                this._signals.forget(actor);
                this._value.abandon();
            });
        } catch (error) {
            this._signals.destroy();
            throw error;
        }
    }

    set(present: boolean): void { this._value.set(present); }
    destroy(): void { this._signals.destroy(); this._value.restore(); }
}
