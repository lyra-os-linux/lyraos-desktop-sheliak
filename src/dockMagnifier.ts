import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {SignalTracker} from './signals.js';

export type MagnifiableIcon = {
    actor: St.Button;
    zoomActor: Clutter.Actor;
};

/** Magnify the artwork inside stable button allocations, keeping clicks and
 * drag destinations stationary while the pointer moves between icons. */
export class DockMagnifier {
    private _signals = new SignalTracker();
    private _iconSignals = new Map<MagnifiableIcon, SignalTracker>();
    private _icons: MagnifiableIcon[] = [];
    private _targets = new Map<Clutter.Actor, number>();
    private _updateId = 0;
    private _destroyed = false;
    private _animationSettings = St.Settings.get();

    constructor(private _dock: St.Widget,
        private _horizontal: () => boolean,
        private _enabled: () => boolean) {
        for (const signal of ['motion-event', 'enter-event', 'leave-event']) {
            this._signals.connect(_dock, signal, () => {
                this.refresh();
                return Clutter.EVENT_PROPAGATE;
            });
        }
        this._signals.connect(_dock, 'notify::mapped', () => this.refresh());
        this._signals.connect(_dock, 'notify::allocation', () => this.refresh());
        this._signals.connect(_dock, 'destroy', () => {
            this._signals.forget(_dock);
            this._shutdown(false);
        });
        this._signals.connect(this._animationSettings, 'notify::enable-animations',
            () => this.refresh());
    }

    setIcons(icons: MagnifiableIcon[]): void {
        if (this._destroyed)
            return;
        this.reset(false);
        for (const signals of this._iconSignals.values())
            signals.destroy();
        this._iconSignals.clear();
        this._icons = icons;
        for (const icon of icons) {
            const {actor, zoomActor} = icon;
            const signals = new SignalTracker();
            this._iconSignals.set(icon, signals);
            zoomActor.set_pivot_point(0.5, 0.5);
            // DND marks the source as dragging before moving it to uiGroup.
            signals.connect(actor, 'style-changed', () => this.refresh());
            signals.connect(actor, 'notify::allocation', () => this.refresh());
            signals.connect(zoomActor, 'notify::allocation', () => this.refresh());
            const forget = (source: Clutter.Actor) => {
                signals.forget(source);
                signals.destroy();
                this._iconSignals.delete(icon);
                this._targets.delete(zoomActor);
                this._icons = this._icons.filter(item => item !== icon);
            };
            signals.connect(actor, 'destroy', () => forget(actor));
            signals.connect(zoomActor, 'destroy', () => forget(zoomActor));
        }
        this.refresh();
    }

    refresh(): void {
        if (this._destroyed || this._updateId)
            return;
        this._updateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._updateId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    reset(animate = true): void {
        if (this._destroyed)
            return;
        if (this._updateId)
            GLib.source_remove(this._updateId);
        this._updateId = 0;
        for (const {zoomActor} of this._icons)
            this._scale(zoomActor, 1, animate);
        this._targets.clear();
    }

    destroy(): void {
        this._shutdown(true);
    }

    private _shutdown(restore: boolean): void {
        if (this._destroyed)
            return;
        if (restore)
            this.reset(false);
        else if (this._updateId)
            GLib.source_remove(this._updateId);
        this._updateId = 0;
        this._destroyed = true;
        this._signals.destroy();
        for (const signals of this._iconSignals.values())
            signals.destroy();
        this._iconSignals.clear();
        this._targets.clear();
        this._icons = [];
    }

    private _update(): void {
        if (this._destroyed)
            return;
        const animations = this._animationSettings.enable_animations && this._enabled();
        if (!animations || !this._dock.mapped || !this._dock.has_allocation() ||
            this._icons.some(({actor}) => actor.has_style_class_name('dragging'))) {
            this.reset(false);
            return;
        }
        const [pointerX, pointerY] = global.get_pointer();
        const [dockX, dockY] = this._dock.get_transformed_position();
        const [dockWidth, dockHeight] = this._dock.get_transformed_size();
        // Mapped actors can still have invalid transforms during allocation.
        // Never feed NaN into a scale transition; allocation changes retry us.
        if (![pointerX, pointerY, dockX, dockY, dockWidth, dockHeight].every(Number.isFinite) ||
            dockWidth <= 0 || dockHeight <= 0) {
            this.reset(false);
            return;
        }
        if (pointerX < dockX || pointerX >= dockX + dockWidth ||
            pointerY < dockY || pointerY >= dockY + dockHeight) {
            this.reset();
            return;
        }

        const horizontal = this._horizontal();
        const samples: Array<{actor: Clutter.Actor; center: number;
            size: number; scale: number}> = [];
        for (const {actor, zoomActor} of this._icons) {
            if (!actor.mapped || !actor.has_allocation() || !zoomActor.has_allocation() ||
                zoomActor.width <= 0 || zoomActor.height <= 0)
                continue;
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            const [artX, artY] = zoomActor.get_transformed_position();
            const [artWidth, artHeight] = zoomActor.get_transformed_size();
            if (![x, y, width, height, artX, artY, artWidth, artHeight,
                zoomActor.width, zoomActor.height].every(Number.isFinite) || width <= 0 || height <= 0)
                continue;
            const center = horizontal ? x + width / 2 : y + height / 2;
            const distance = Math.abs((horizontal ? pointerX : pointerY) - center);
            const radius = (horizontal ? width : height) * 1.65;
            const influence = distance < radius
                ? (1 + Math.cos(Math.PI * distance / radius)) / 2 : 0;
            // The central pivot keeps this point fixed during scaling.
            const artCenterX = artX + artWidth / 2;
            const artCenterY = artY + artHeight / 2;
            const peak = Math.max(1, Math.min(1.4,
                2 * Math.min(artCenterX - dockX - 2,
                    dockX + dockWidth - artCenterX - 2) / zoomActor.width,
                2 * Math.min(artCenterY - dockY - 2,
                    dockY + dockHeight - artCenterY - 2) / zoomActor.height));
            samples.push({actor: zoomActor,
                center: horizontal ? artCenterX : artCenterY,
                size: horizontal ? zoomActor.width : zoomActor.height,
                scale: 1 + (peak - 1) * influence});
        }
        // Use the padded surface, but retain a gap between neighboring art.
        // Reduce only the added magnification when large icons fill the dock.
        samples.sort((a, b) => a.center - b.center);
        for (let i = 1; i < samples.length; i++) {
            const a = samples[i - 1], b = samples[i];
            const room = Math.max(0, b.center - a.center - 4 - (a.size + b.size) / 2);
            const extra = (a.size * (a.scale - 1) + b.size * (b.scale - 1)) / 2;
            if (extra > room) {
                const fraction = room / extra;
                a.scale = 1 + (a.scale - 1) * fraction;
                b.scale = 1 + (b.scale - 1) * fraction;
            }
        }
        for (const sample of samples)
            this._scale(sample.actor, sample.scale, true);
    }

    private _scale(actor: Clutter.Actor, scale: number, animate: boolean): void {
        if (!actor.get_stage() || !Number.isFinite(scale))
            return;
        const target = this._targets.get(actor) ?? 1;
        if (animate && (target === scale ||
            (scale !== 1 && Math.abs(target - scale) < 0.002)))
            return;
        this._targets.set(actor, scale);
        actor.remove_transition('scale-x');
        actor.remove_transition('scale-y');
        if (animate) {
            actor.save_easing_state();
            actor.set_easing_duration(140);
            actor.set_easing_mode(Clutter.AnimationMode.EASE_OUT_QUAD);
            actor.set_scale(scale, scale);
            actor.restore_easing_state();
        } else {
            actor.set_scale(scale, scale);
        }
    }
}
