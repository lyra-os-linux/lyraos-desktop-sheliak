import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {animationCapabilities, unavailable} from './shellCompat.js';

const ZOOM_DURATION = 260;
const FADE_DURATION = 200;

type AnimationMode = 'zoom' | 'fade' | 'none';
type Completion = (actor: Meta.WindowActor) => void;

interface ActiveWindowAnimation {
    finish(): void;
}

type ActorState = {
    opacity: number;
    scaleX: number;
    scaleY: number;
    translationX: number;
    translationY: number;
    pivotX: number;
    pivotY: number;
};

class TransformAnimation implements ActiveWindowAnimation {
    private _timeline: Clutter.Timeline | null;
    private _timelineSignals: number[] = [];
    private _finished = false;
    private _state: ActorState;
    private _targetScale = 1;
    private _targetTranslationX = 0;
    private _targetTranslationY = 0;

    constructor(
        private _actor: Meta.WindowActor,
        target: Mtk.Rectangle,
        private _minimizing: boolean,
        private _mode: 'zoom' | 'fade',
        private _complete: Completion,
    ) {
        const [pivotX, pivotY] = _actor.get_pivot_point();
        this._state = {
            opacity: _actor.opacity,
            scaleX: _actor.scale_x,
            scaleY: _actor.scale_y,
            translationX: _actor.translation_x,
            translationY: _actor.translation_y,
            pivotX,
            pivotY,
        };

        if (_mode === 'zoom') {
            const [width, height] = _actor.get_size();
            const targetWidth = Math.max(1, target.width);
            const targetHeight = Math.max(1, target.height);
            this._targetScale = Math.max(0.04,
                Math.min(targetWidth / Math.max(1, width),
                    targetHeight / Math.max(1, height)));
            this._targetTranslationX = this._state.translationX +
                target.x + target.width / 2 - (_actor.x + width / 2);
            this._targetTranslationY = this._state.translationY +
                target.y + target.height / 2 - (_actor.y + height / 2);
        } else {
            this._targetScale = 0.92;
            this._targetTranslationX = this._state.translationX;
            this._targetTranslationY = this._state.translationY;
        }

        _actor.set_pivot_point(0.5, 0.5);
        this._apply(0);
        this._timeline = new Clutter.Timeline({
            actor: _actor,
            duration: _mode === 'zoom' ? ZOOM_DURATION : FADE_DURATION,
        });
        this._timelineSignals.push(this._timeline.connect('new-frame', () => {
            if (this._timeline)
                this._apply(this._timeline.get_progress());
        }));
        this._timelineSignals.push(this._timeline.connect('completed', () => this.finish()));
        this._timeline.start();
    }

    private _apply(progress: number): void {
        // Minimize accelerates into the icon; restore decelerates out of it.
        const collapsed = this._minimizing
            ? progress * progress * progress
            : Math.pow(1 - progress, 3);
        const scale = 1 + (this._targetScale - 1) * collapsed;
        const opacity = Math.round(this._state.opacity * (1 - collapsed));

        this._actor.scale_x = this._state.scaleX * scale;
        this._actor.scale_y = this._state.scaleY * scale;
        this._actor.translation_x = this._state.translationX +
            (this._targetTranslationX - this._state.translationX) * collapsed;
        this._actor.translation_y = this._state.translationY +
            (this._targetTranslationY - this._state.translationY) * collapsed;
        this._actor.opacity = opacity;
    }

    finish(): void {
        if (this._finished)
            return;
        this._finished = true;

        if (this._timeline) {
            for (const id of this._timelineSignals)
                this._timeline.disconnect(id);
            this._timelineSignals = [];
            this._timeline.stop();
            this._timeline = null;
        }

        this._actor.opacity = this._state.opacity;
        this._actor.scale_x = this._state.scaleX;
        this._actor.scale_y = this._state.scaleY;
        this._actor.translation_x = this._state.translationX;
        this._actor.translation_y = this._state.translationY;
        this._actor.set_pivot_point(this._state.pivotX, this._state.pivotY);
        this._complete(this._actor);
    }
}

export class WindowAnimationManager {
    private _capabilities = animationCapabilities();
    private _shellwm = this._capabilities?.shellwm;
    private _originalCompletedMinimize = this._shellwm?.completed_minimize;
    private _originalCompletedUnminimize = this._shellwm?.completed_unminimize;
    private _nativeSignalIds: number[] = [];
    private _signalIds: number[] = [];
    private _activeAnimations = new Map<Meta.WindowActor, ActiveWindowAnimation>();

    constructor(private _settings: Gio.Settings) {
        if (!this._capabilities || !this._shellwm) return;
        // Migrate the removed mode for existing installations.
        if (this._settings.get_string('minimize-animation') === 'magic-lamp')
            this._settings.set_string('minimize-animation', 'zoom');

        // Resolve both handlers before blocking either one. If connecting a
        // replacement fails, release everything acquired so far.
        try {
            for (const id of this._capabilities.ids) {
                this._shellwm.block_signal_handler(id);
                this._nativeSignalIds.push(id);
            }
            this._signalIds.push(this._shellwm.connect('minimize', (_wm, actor) => {
                this._animate(actor, true);
            }));
            this._signalIds.push(this._shellwm.connect('unminimize', (_wm, actor) => {
                this._animate(actor, false);
            }));
            this._signalIds.push(this._shellwm.connect('kill-window-effects', (_wm, actor) => {
                this._destroyActorEffects(actor);
            }));
        } catch (error) {
            this.destroy();
            unavailable(`compositor animation activation: ${error}`);
        }
    }

    private _animate(actor: Meta.WindowActor, minimizing: boolean): void {
        if (!this._shellwm || !this._originalCompletedMinimize || !this._originalCompletedUnminimize) return;
        const shellComplete = minimizing
            ? this._originalCompletedMinimize.bind(this._shellwm)
            : this._originalCompletedUnminimize.bind(this._shellwm);
        const complete = (completedActor: Meta.WindowActor) => {
            this._activeAnimations.delete(completedActor);
            shellComplete(completedActor);
        };

        // Settle the compositor event already in flight before preparing the
        // opposite state. In particular, completed_minimize() may hide the
        // actor, so show it only after settling when restoring rapidly.
        this._destroyActorEffects(actor);
        if (!minimizing)
            actor.show();

        if (Main.overview.visible || !St.Settings.get().enable_animations) {
            complete(actor);
            return;
        }

        const mode = this._animationMode();
        if (mode === 'none') {
            complete(actor);
            return;
        }

        const metaWindow = actor.meta_window;
        if (!metaWindow) {
            complete(actor);
            return;
        }
        const [hasGeometry, geometry] = metaWindow.get_icon_geometry();
        const target = hasGeometry ? geometry : this._fallbackTarget(actor);
        const animation = new TransformAnimation(
            actor, target, minimizing, mode, complete);
        this._activeAnimations.set(actor, animation);
    }

    private _animationMode(): AnimationMode {
        const mode = this._settings.get_string('minimize-animation');
        if (mode === 'fade' || mode === 'none')
            return mode;
        return 'zoom';
    }

    private _fallbackTarget(actor: Meta.WindowActor): Mtk.Rectangle {
        const metaWindow = actor.meta_window;
        const monitor = metaWindow
            ? Main.layoutManager.monitors[metaWindow.get_monitor()]
            : null;
        return new Mtk.Rectangle({
            x: monitor ? monitor.x + Math.floor(monitor.width / 2) : 0,
            y: monitor ? monitor.y + monitor.height : 0,
            width: 1,
            height: 1,
        });
    }

    private _destroyActorEffects(actor: Meta.WindowActor): void {
        this._activeAnimations.get(actor)?.finish();
    }

    destroy(): void {
        if (!this._shellwm) return;
        for (const id of this._signalIds)
            this._shellwm.disconnect(id);
        this._signalIds = [];

        for (const actor of global.get_window_actors())
            this._destroyActorEffects(actor);
        this._activeAnimations.clear();

        for (const id of this._nativeSignalIds)
            this._shellwm.unblock_signal_handler(id);
        this._nativeSignalIds = [];
    }
}
