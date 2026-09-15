import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Scope} from '../core/provider.js';
import {LyraExtension, UUIDS, watch} from '../core/extension.js';
import {PanelMenus} from '../panelMenus.js';
import {StartMenu} from '../startMenu.js';
import {ShowAppsButton} from '../showAppsButton.js';
import {windowsProfile} from '../desktopProfile.js';
import type {DockEndpoint} from './dock.js';
import type {WindowsPanel} from '../windowsPanel.js';
import {destroyPanelIndicator, panelBox, popupArrow} from '../shellCompat.js';

export default class LyraMenus extends LyraExtension {
    private _controller: PanelMenus | null = null;
    private _start: StartMenu | null = null;
    protected activate(): void {
        const settings = this.getSettings('org.gnome.shell.extensions.sheliak');
        this._controller = this.scope.own(new PanelMenus(settings, this.path));
        let dock: DockEndpoint | null = null;
        let panel: WindowsPanel | null = null;
        let release: (() => void) | null = null;
        const sync = () => {
            release?.();
            release = null;
            if (!this.running) return;
            const profile = windowsProfile(settings);
            if (!profile) return;
            const resources = new Scope();
            release = () => resources.destroy();
            try {
                let wrapper: PanelMenu.Button | null = null;
                let fallback: ShowAppsButton | null = null;
                if (!dock) {
                    const side = panel?.active ? 'center' : 'left';
                    if (!panelBox(side)) return;
                    wrapper = new PanelMenu.Button(0, 'Lyra Menus', true);
                    const ownedWrapper = wrapper;
                    resources.add(() => destroyPanelIndicator(ownedWrapper));
                    fallback = new ShowAppsButton(`${this.path}/icons/sheliak-logo-symbolic.svg`,
                        `${this.path}/icons/sheliak-logo-symbolic-dark.svg`);
                    resources.own(fallback);
                    wrapper.add_child(fallback.actor);
                    Main.panel.addToStatusArea('lyra-start', wrapper, 0, panel?.active ? 'center' : 'left');
                }
                const launcher = dock?.dock.launcher ?? fallback!.actor;
                const anchor = dock?.panel?.anchor ?? wrapper?.container ?? launcher;
                const start = new StartMenu(launcher, anchor, profile, settings);
                resources.add(() => { start.destroy(); if (this._start === start) this._start = null; });
                this._start = start;
                if (!dock?.panel && !panel?.active) {
                    popupArrow(start.menu)?.updateArrowSide(dock ? St.Side.BOTTOM : St.Side.TOP);
                }
                const borrowed = dock?.dock;
                resources.add(() => borrowed?.setLauncherAction(null));
                if (borrowed) borrowed.setLauncherAction(() => start.toggle());
                else fallback!.setAction(() => start.toggle());
                const original = Number(GObject.signal_handler_find(global.display as never, {signalId: 'overlay-key'} as never));
                const handler = global.display.connect('overlay-key', () => {
                    if (!Main.sessionMode.isLocked) start.toggle();
                });
                resources.add(() => global.display.disconnect(handler));
                if (original) {
                    GObject.signal_handler_block(global.display as never, original);
                    resources.add(() => {
                        if (GObject.signal_handler_is_connected(global.display as never, original))
                            GObject.signal_handler_unblock(global.display as never, original);
                    });
                }
            } catch (error) {
                resources.destroy();
                release = null;
                throw error;
            }
        };
        this.scope.add(() => { release?.(); release = null; });
        const id = settings.connect('changed::desktop-profile', sync);
        this.scope.add(() => settings.disconnect(id));
        watch<DockEndpoint>(this.scope, UUIDS.dock, value => { dock = value; sync(); });
        watch<WindowsPanel>(this.scope, UUIDS.panel, value => { panel = value; sync(); });
        sync();
    }
}
