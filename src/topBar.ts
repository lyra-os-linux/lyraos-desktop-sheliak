import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalTracker} from './signals.js';
import {panelBox} from './shellCompat.js';
import {windowsProfile} from './desktopProfile.js';
import {OwnedValue} from './ownedState.js';
import {PanelStyleClass, PanelVisibility} from './panelState.js';

const SHELIAK_PANEL_INDICATOR = 'sheliak-panel-indicator';
const FLOATING_PANEL_CLASS = 'sheliak-panel-floating';
const FLUSH_PANEL_CLASS = 'sheliak-panel-flush';
const MAX_PANEL_MARGIN = 32;
type HeightRequest = [number, boolean, number, boolean];

// Clutter's height getter can include margins before allocation, whereas
// set_height() expects a content request. Preserve the requests/flags.
function heightRequest(actor: Clutter.Actor): HeightRequest {
    return [actor.min_height, actor.min_height_set, actor.natural_height, actor.natural_height_set];
}
function setHeightRequest(actor: Clutter.Actor, [min, minSet, natural, naturalSet]: HeightRequest): void {
    actor.min_height = min;
    actor.natural_height = natural;
    actor.min_height_set = minSet;
    actor.natural_height_set = naturalSet;
}

type VisibleActor = Clutter.Actor & {
    visible: boolean;
    hide: () => void;
    show: () => void;
};

/**
 * Applies the top-panel preferences while preserving every actor's previous
 * visibility. Sheliak's own panel menus are deliberately excluded so placing
 * them on the right remains useful even when GNOME's native indicators are
 * hidden.
 */
export class TopBarManager {
    private _settings: Gio.Settings;
    private _signals = new SignalTracker();
    private _dateMenu: PanelVisibility | null = null;
    private _activities: PanelVisibility | null = null;
    private _rightBox: Clutter.Actor | null;
    private _nativeIndicators = new Map<VisibleActor, PanelVisibility>();
    private _trackedWindows = new Set<Meta.Window>();
    private _windowSignals = new Map<Meta.Window, number[]>();
    private _flush = false;
    private _height: OwnedValue<HeightRequest>;
    private _classes = new Map<string, PanelStyleClass>();
    private _destroyed = false;
    private _ownedMargins: [number, number, number, number] | null = null;
    private _panelState: {
        margins: [number, number, number, number];
    };

    constructor(settings: Gio.Settings) {
        this._settings = settings;
        const statusArea = Main.panel.statusArea as unknown as Record<string, VisibleActor>;
        this._rightBox = panelBox('right');
        const panel = Main.panel;
        this._height = new OwnedValue(() => heightRequest(panel), value => setHeightRequest(panel, value),
            (a, b) => a.every((value, index) => value === b[index]));
        this._panelState = {
            margins: [panel.margin_top, panel.margin_bottom,
                panel.margin_left, panel.margin_right],
        };

        try {
            for (const name of [FLOATING_PANEL_CLASS, FLUSH_PANEL_CLASS])
                this._classes.set(name, new PanelStyleClass(panel, name));
            if (statusArea.dateMenu)
                this._dateMenu = new PanelVisibility(statusArea.dateMenu);
            const activities = (statusArea.activities as (VisibleActor & {container?: Clutter.Actor}) | undefined)?.container;
            if (activities) this._activities = new PanelVisibility(activities);
            for (const actor of this._rightBox?.get_children() ?? [])
                this._trackNativeIndicator(actor);

            this._signals.connect(this._settings, 'changed::panel-height',
                () => this._syncHeight());
            this._signals.connect(this._settings, 'changed::desktop-profile', () => {
                this._syncHeight();
                this._syncFloating();
            });
            this._signals.connect(this._settings, 'changed::show-clock',
                () => this._syncClock());
            this._signals.connect(this._settings, 'changed::hide-workspace-button',
                () => this._syncActivities());
            this._signals.connect(this._settings, 'changed::show-panel-indicators',
                () => this._syncIndicators());
            this._signals.connect(this._settings, 'changed::floating-panel',
                () => this._syncFloating());
            this._signals.connect(this._settings, 'changed::panel-margin',
                () => this._syncFloating());
            this._signals.connect(this._settings, 'changed::extend-to-edges',
                () => this._syncFloating());
            // St reapplies CSS margins before emitting style-changed, including
            // when the panel is first mapped. Restore our geometry afterwards.
            this._signals.connect(panel, 'style-changed',
                () => this._syncMargins());
            if (this._rightBox) this._signals.connect(this._rightBox, 'child-added',
                (_box: Clutter.Actor, actor: Clutter.Actor) => {
                    this._trackNativeIndicator(actor);
                    this._syncIndicator(actor as VisibleActor);
                });
            this._signals.connect(global.display, 'window-created',
                (_display: unknown, window: Meta.Window) => {
                    this._trackWindow(window);
                    this._syncFloating();
                });
            this._signals.connect(global.workspace_manager, 'active-workspace-changed',
                () => this._syncFloating());
            for (const windowActor of global.get_window_actors()) {
                if (windowActor.meta_window)
                    this._trackWindow(windowActor.meta_window);
            }

            this._syncHeight();
            this._syncClock();
            this._syncActivities();
            this._syncIndicators();
            this._syncFloating();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    destroy(releaseAppearance: () => void = () => {}): void {
        if (this._destroyed) return;
        this._destroyed = true;
        this._signals.destroy();
        const panel = Main.panel;
        this._height.restore();
        const restoredHeight = heightRequest(panel);
        const currentMargins = [panel.margin_top, panel.margin_bottom,
            panel.margin_left, panel.margin_right];
        const restoreMargins = this._ownedMargins && this._marginsEqual(panel, this._ownedMargins);
        for (const style of this._classes.values()) style.destroy();
        this._classes.clear();
        // Panel layout and theme teardown can reapply CSS after our classes
        // are removed. Release them with our signals disconnected, then put
        // back the resolved geometry only once all restyling is complete.
        releaseAppearance();
        setHeightRequest(panel, restoredHeight);
        [panel.margin_top, panel.margin_bottom, panel.margin_left, panel.margin_right] =
            restoreMargins ? this._panelState.margins : currentMargins;
        this._dateMenu?.destroy();
        this._activities?.destroy();
        for (const visibility of this._nativeIndicators.values()) visibility.destroy();
        this._nativeIndicators.clear();
        this._trackedWindows.clear();
        this._windowSignals.clear();
        this._dateMenu = null;
        this._activities = null;
    }

    private _trackNativeIndicator(actor: Clutter.Actor): void {
        if (this._isOwnIndicator(actor) || actor === Main.panel.statusArea.dateMenu)
            return;
        const indicator = actor as VisibleActor;
        if (this._nativeIndicators.has(indicator))
            return;
        const visibility = new PanelVisibility(indicator);
        this._nativeIndicators.set(indicator, visibility);
        this._signals.connect(indicator, 'destroy', () => {
            visibility.destroy();
            this._nativeIndicators.delete(indicator);
            this._signals.forget(indicator);
        });
    }

    private _syncHeight(): void {
        const profile = windowsProfile(this._settings);
        const height = profile ? (profile === 'windows10' ? 48 : 52)
            : Math.max(24, Math.min(64, this._settings.get_uint('panel-height')));
        this._height.set([height, true, height, true]);
    }

    /**
     * Destaca a barra das bordas da tela. A margem usa as propriedades de
     * margem do Clutter em vez de CSS porque quem aloca a barra é o
     * `panelBox` (um St.BoxLayout vertical com a largura do monitor): ele
     * encolhe a barra pela margem e cresce em altura junto, então o strut —
     * e portanto a área de trabalho das janelas — já considera o vão.
     *
     * Enquanto houver uma janela maximizada no espaço de trabalho ativo, a
     * barra "cola" nas bordas (sem margens nem cantos arredondados) para não
     * destoar da janela colada nela — mesma lógica de sobreposição usada pelo
     * dock (`dock.ts` `_windowOverlapsDock`), mas restrita a maximização em
     * vez de qualquer sobreposição de retângulo.
     */
    private _syncFloating(): void {
        const floating = !windowsProfile(this._settings) && this._settings.get_boolean('floating-panel');
        if (!floating) {
            this._resetFloating();
            return;
        }

        const flush = this._settings.get_boolean('extend-to-edges') || this._hasMaximizedWindow();
        const margin = flush ? 0 : Math.min(MAX_PANEL_MARGIN, this._settings.get_uint('panel-margin'));
        this._ownedMargins = [margin, margin, margin, margin];
        this._classes.get(FLOATING_PANEL_CLASS)!.set(true);
        this._classes.get(FLUSH_PANEL_CLASS)!.set(flush);
        this._syncMargins();
        if (flush !== this._flush) {
            this._flush = flush;
            console.debug(`Sheliak: barra ${flush ? 'colada (dock estendido ou janela maximizada)' : 'flutuante'}`);
        }
    }

    private _resetFloating(): void {
        this._ownedMargins = [0, 0, 0, 0];
        this._classes.get(FLOATING_PANEL_CLASS)!.set(false);
        this._classes.get(FLUSH_PANEL_CLASS)!.set(false);
        this._syncMargins();
    }

    private _syncMargins(): void {
        if (!this._ownedMargins)
            return;
        const panel = Main.panel;
        [panel.margin_top, panel.margin_bottom, panel.margin_left, panel.margin_right] =
            this._ownedMargins;
    }

    private _trackWindow(window: Meta.Window): void {
        if (this._destroyed || this._trackedWindows.has(window))
            return;
        this._trackedWindows.add(window);
        const ids: number[] = [];
        for (const signal of ['notify::maximized-horizontally',
            'notify::maximized-vertically', 'workspace-changed', 'notify::minimized']) {
            ids.push(this._signals.connect(window, signal, () => this._syncFloating()));
        }
        ids.push(this._signals.connect(window, 'unmanaged', () => {
            for (const id of this._windowSignals.get(window) ?? [])
                this._signals.disconnect(window, id);
            this._windowSignals.delete(window);
            this._trackedWindows.delete(window);
            this._syncFloating();
        }));
        this._windowSignals.set(window, ids);
    }

    private _marginsEqual(actor: Clutter.Actor,
        margins: [number, number, number, number]): boolean {
        return actor.margin_top === margins[0] && actor.margin_bottom === margins[1]
            && actor.margin_left === margins[2] && actor.margin_right === margins[3];
    }

    private _hasMaximizedWindow(): boolean {
        const workspace = global.workspace_manager.get_active_workspace();
        return global.get_window_actors().some(windowActor => {
            const window = windowActor.meta_window;
            return !!window && !window.minimized && window.showing_on_its_workspace()
                && window.get_workspace() === workspace
                && window.get_monitor() === Main.layoutManager.primaryIndex
                && window.get_maximized() === Meta.MaximizeFlags.BOTH;
        });
    }

    private _syncClock(): void {
        this._dateMenu?.suppress(!this._settings.get_boolean('show-clock'));
    }

    private _syncActivities(): void {
        this._activities?.suppress(this._settings.get_boolean('hide-workspace-button'));
    }

    private _syncIndicators(): void {
        for (const actor of this._nativeIndicators.keys())
            this._syncIndicator(actor);
    }

    private _syncIndicator(actor: VisibleActor): void {
        if (this._isOwnIndicator(actor)) return;
        this._nativeIndicators.get(actor)?.suppress(!this._settings.get_boolean('show-panel-indicators'));
    }

    private _isOwnIndicator(actor: Clutter.Actor): boolean {
        // addToStatusArea inserts a St.Bin around the marked panel button.
        return [actor, actor.get_first_child()].some(child =>
            child instanceof St.Widget && child.has_style_class_name(SHELIAK_PANEL_INDICATOR));
    }
}
