import Atk from 'gi://Atk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// GNOME 48's St.Button accessible has the role and focus states but does not
// implement Atk.Action. Delegate geometry, hierarchy and states to its native
// accessible, and expose activation through the same clicked signal. Calling
// Atk.Object.initialize(actor) from GJS is unsafe: its data is an untyped pointer.
const AppAccessible = GObject.registerClass({
    GTypeName: 'SheliakAppAccessible',
    Implements: [Atk.Action, Atk.Component],
}, class AppAccessible extends St.WidgetAccessible {
    private _actor: St.Button | null = null;
    private _native!: Atk.Object;
    private _component!: Atk.Component;
    private _pending = new Set<number>();

    bind(actor: St.Button, native: Atk.Object): void {
        this._actor = actor;
        this._native = native;
        this._component = this._native as unknown as Atk.Component;
        const stateId = this._native.connect('state-change', (_object, name, enabled) =>
            this.emit('state-change', name, enabled));
        const nameId = actor.connect('notify::accessible-name', () => this.notify('accessible-name'));
        actor.connect('destroy', () => {
            this._actor = null;
            this._native.disconnect(stateId);
            actor.disconnect(nameId);
            for (const source of this._pending) GLib.source_remove(source);
            this._pending.clear();
            this.notify_state_change(Atk.StateType.DEFUNCT, true);
        });
    }

    vfunc_get_name(): string { return this._actor?.accessible_name ?? ''; }
    vfunc_get_role(): Atk.Role { return Atk.Role.PUSH_BUTTON; }
    vfunc_get_parent(): Atk.Object { return this._native.get_parent(); }
    vfunc_get_index_in_parent(): number { return this._native.get_index_in_parent(); }
    // Artwork and numeric badges are presentation; the named launcher is a leaf.
    vfunc_get_n_children(): number { return 0; }
    vfunc_ref_state_set(): Atk.StateSet { return this._native.ref_state_set(); }
    vfunc_get_extents(coords: Atk.CoordType): [number, number, number, number] {
        return this._component.get_extents(coords);
    }
    vfunc_contains(x: number, y: number, coords: Atk.CoordType): boolean {
        return this._component.contains(x, y, coords);
    }
    vfunc_grab_focus(): boolean { return this._component.grab_focus(); }
    vfunc_get_layer(): Atk.Layer { return this._component.get_layer(); }
    vfunc_get_mdi_zorder(): number { return this._component.get_mdi_zorder(); }
    vfunc_get_alpha(): number { return this._component.get_alpha(); }
    vfunc_ref_accessible_at_point(x: number, y: number, coords: Atk.CoordType): Atk.Object | null {
        return this._component.ref_accessible_at_point(x, y, coords);
    }
    vfunc_get_n_actions(): number { return 1; }

    // get_name/get_description collide with Atk.Object vfuncs in GJS. The
    // distinct localized-name vfunc supplies the action label without replacing
    // the application's accessible name inherited from St.WidgetAccessible.
    vfunc_get_localized_name(index: number): string | null {
        return index === 0 ? _('Activate') : null;
    }

    vfunc_do_action(index: number): boolean {
        const actor = this._actor;
        if (index !== 0 || !actor?.reactive || !actor.mapped)
            return false;
        const source = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pending.delete(source);
            if (this._actor?.reactive && this._actor.mapped) {
                this._actor.grab_key_focus();
                this._actor.emit('clicked', 1);
            }
            return GLib.SOURCE_REMOVE;
        });
        this._pending.add(source);
        return true;
    }
});

// Override the lookup, keeping the native accessible owned by St.Button. Do not
// replace it with set_accessible(): ATK owns its association with the actor.
export const AppButton = GObject.registerClass({GTypeName: 'SheliakAppButton'},
    class AppButton extends St.Button {
        declare private _appAccessible: InstanceType<typeof AppAccessible> | undefined;

        _init(params: Partial<St.Button.ConstructorProps>): void {
            super._init(params);
            const accessible = new AppAccessible();
            accessible.bind(this, super.vfunc_get_accessible());
            this._appAccessible = accessible;
        }

        vfunc_get_accessible(): Atk.Object {
            // ATK can query during construction or after native disposal. Never
            // create/bind objects from that late query on an already dead actor.
            return this._appAccessible ?? defunctAccessible;
        }
    });

const defunctAccessible = new Atk.NoOpObject();
