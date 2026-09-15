import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {animationCapabilities, unavailable} from './shellCompat.js';
import {NativeAnimationBridge, type NativeAnimationParams} from './animationBridge.js';

const ZOOM_DURATION = 260;
const FADE_DURATION = 200;

type AnimationMode = 'zoom' | 'fade' | 'none';
type Completion = (actor: Meta.WindowActor) => void;

interface ActiveWindowAnimation {
    finish(): void;
}

type ActorState = {
    x: number;
    y: number;
    opacity: number;
    scaleX: number;
    scaleY: number;
    translationX: number;
    translationY: number;
    pivotX: number;
    pivotY: number;
};

function captureState(actor: Meta.WindowActor): ActorState {
    const [pivotX, pivotY] = actor.get_pivot_point();
    return {x: actor.x, y: actor.y, opacity: actor.opacity,
        scaleX: actor.scale_x, scaleY: actor.scale_y,
        translationX: actor.translation_x, translationY: actor.translation_y, pivotX, pivotY};
}

function restoreState(actor: Meta.WindowActor, state: ActorState): void {
    actor.set_position(state.x, state.y);
    actor.opacity = state.opacity;
    actor.scale_x = state.scaleX;
    actor.scale_y = state.scaleY;
    actor.translation_x = state.translationX;
    actor.translation_y = state.translationY;
    actor.set_pivot_point(state.pivotX, state.pivotY);
}

class TransformAnimation implements ActiveWindowAnimation {
    private _timeline: Clutter.Timeline | null = null;
    private _destroyId = 0;
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
        this._state = captureState(_actor);

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
    }

    start(): void {
        try {
            this._destroyId = this._actor.connect('destroy', () => this.finish());
            this._timeline = new Clutter.Timeline({
                actor: this._actor,
                duration: this._mode === 'zoom' ? ZOOM_DURATION : FADE_DURATION,
            });
            this._timelineSignals.push(this._timeline.connect('new-frame', () => {
                try {
                    if (this._timeline) this._apply(this._timeline.get_progress());
                } catch (error) {
                    unavailable(`animation frame: ${error}`);
                    this.finish();
                }
            }));
            this._timelineSignals.push(this._timeline.connect('completed', () => this.finish()));
            this._actor.set_pivot_point(0.5, 0.5);
            this._apply(0);
            this._timeline.start();
        } catch (error) {
            // No compositor completion on partial acquisition: the caller
            // restores native preparation and delegates the original ease.
            this._finished = true;
            this._release();
            restoreState(this._actor, this._state);
            throw error;
        }
    }

    private _release(): void {
        const timeline = this._timeline;
        this._timeline = null;
        for (const id of this._timelineSignals) {
            try { timeline?.disconnect(id); }
            catch (error) { console.warn(`Lyra: timeline disconnect: ${error}`); }
        }
        this._timelineSignals = [];
        try { timeline?.stop(); }
        catch (error) { console.warn(`Lyra: timeline stop: ${error}`); }
        finally {
            if (this._destroyId) {
                const id = this._destroyId;
                this._destroyId = 0;
                try { this._actor.disconnect(id); }
                catch (error) { console.warn(`Lyra: animation actor disconnect: ${error}`); }
            }
        }
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

        try {
            this._release();
            restoreState(this._actor, this._state);
        } finally { this._complete(this._actor); }
    }
}

export class WindowAnimationManager {
    private _capabilities = animationCapabilities();
    private _shellwm = this._capabilities?.shellwm;
    private _bridge: NativeAnimationBridge | null = null;
    private _signalIds: number[] = [];
    private _activeAnimations = new Map<Meta.WindowActor, ActiveWindowAnimation>();

    constructor(private _settings: Gio.Settings) {
        if (!this._capabilities || !this._shellwm) return;
        if (this._settings.get_string('minimize-animation') === 'magic-lamp')
            this._settings.set_string('minimize-animation', 'zoom');
        try {
            this._signalIds.push(this._shellwm.connect('kill-window-effects', (_wm, actor) => {
                this._destroyActorEffects(actor);
            }));
            this._bridge = new NativeAnimationBridge(this._capabilities,
                actor => this._destroyActorEffects(actor), (actor, minimizing) => {
                    const state = captureState(actor);
                    return params => this._animate(actor, minimizing, state, params);
                });
        } catch (error) {
            this.destroy();
            unavailable(`compositor animation activation: ${error}`);
        }
    }

    private _animate(actor: Meta.WindowActor, minimizing: boolean,
        state: ActorState, params: NativeAnimationParams): void {
        // GNOME has prepared its bookkeeping and transform by this point.
        // Keep that state for fallback if any custom allocation fails.
        const nativeState = captureState(actor);
        let animation: TransformAnimation | undefined;
        let completed = false;
        const complete = () => {
            if (completed) return;
            completed = true;
            if (this._activeAnimations.get(actor) === animation) this._activeAnimations.delete(actor);
            try { params.onStopped(); }
            catch (error) { console.error(`Lyra: native animation completion: ${error}`); }
        };
        try {
            const metaWindow = actor.meta_window;
            if (!metaWindow) { complete(); return; }
            if (!minimizing) {
                const rect = metaWindow.get_buffer_rect();
                state = {...state, x: params.x ?? rect.x, y: params.y ?? rect.y,
                    scaleX: params.scale_x ?? 1, scaleY: params.scale_y ?? 1, opacity: 255};
            }
            restoreState(actor, state);
            if (!minimizing) actor.show();
            const mode = this._animationMode();
            if (Main.overview.visible || !St.Settings.get().enable_animations || mode === 'none') {
                complete();
                return;
            }
            const [hasGeometry, geometry] = metaWindow.get_icon_geometry();
            const target = hasGeometry ? geometry : this._fallbackTarget(actor);
            animation = new TransformAnimation(actor, target, minimizing, mode, complete);
            // Register before starting: completion can be synchronous.
            this._activeAnimations.set(actor, animation);
            animation.start();
        } catch (error) {
            if (this._activeAnimations.get(actor) === animation) this._activeAnimations.delete(actor);
            restoreState(actor, nativeState);
            throw error;
        }
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
        this._bridge?.destroy();
        this._bridge = null;
        for (const id of this._signalIds) {
            try { this._shellwm?.disconnect(id); }
            catch (error) { console.warn(`Lyra: animation signal disconnect: ${error}`); }
        }
        this._signalIds = [];
        for (const animation of this._activeAnimations.values()) {
            try { animation.finish(); }
            catch (error) { console.error(`Lyra: animation cleanup: ${error}`); }
        }
        this._activeAnimations.clear();
    }
}
