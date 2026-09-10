import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Dock} from './dock.js';
import {WindowAnimationManager} from './windowAnimations.js';
import {PanelMenus} from './panelMenus.js';
import {PanelMenuTheme} from './panelMenuTheme.js';
import {PanelSurfaceTheme} from './panelSurfaceTheme.js';
import {TopBarManager} from './topBar.js';
import {WindowsPanel} from './windowsPanel.js';
import {shellIsStartingUp, UnsupportedShellFeature} from './shellCompat.js';

type PanelActor = {
    visible: boolean;
    hide: () => void;
    show: () => void;
};

export default class SheliakExtension extends Extension {
    private _dock: Dock | null = null;
    private _windowAnimations: WindowAnimationManager | null = null;
    private _panelMenus: PanelMenus | null = null;
    private _panelMenuTheme: PanelMenuTheme | null = null;
    private _panelSurfaceTheme: PanelSurfaceTheme | null = null;
    private _topBar: TopBarManager | null = null;
    private _windowsPanel: WindowsPanel | null = null;
    private _settings: Gio.Settings | null = null;
    private _hideWorkspaceButtonSignal = 0;
    private _startupCompleteSignal = 0;
    private _sessionHadOverview: boolean | null = null;
    private _dashWasVisible: boolean | null = null;
    private _activitiesButton: PanelActor | null = null;
    private _activitiesButtonWasVisible = false;

    enable(): void {
        console.debug(`Sheliak: enable() em ${this.uuid}`);
        try {
            this._prepareDesktopStartup();
            this._settings = this.getSettings('org.gnome.shell.extensions.sheliak');
            this._panelSurfaceTheme = new PanelSurfaceTheme();
            this._dock = new Dock(this._settings, this.path);
            this._windowAnimations = new WindowAnimationManager(this._settings);
            this._panelMenus = new PanelMenus(this._settings, this.path);
            this._panelMenuTheme = new PanelMenuTheme();
            try {
                this._topBar = new TopBarManager(this._settings);
            } catch (error) {
                if (!(error instanceof UnsupportedShellFeature))
                    throw error;
                console.warn(`Sheliak: barra superior desativada: ${error.message}`);
            }
            // Sheliak substitui o dash padrão; mantê-lo visível duplicaria os
            // favoritos/apps em execução na Overview.
            this._dashWasVisible = Main.overview.dash.visible;
            Main.overview.dash.hide();

            // No GNOME Shell 48, o indicador de área de trabalho do painel é
            // registrado como "activities". Apenas ocultá-lo permite restaurar o
            // estado anterior sem recriar componentes internos do Shell.
            const statusArea = Main.panel.statusArea as unknown as Record<string, PanelActor>;
            this._activitiesButton = statusArea.activities ?? null;
            this._activitiesButtonWasVisible = this._activitiesButton?.visible ?? false;
            this._hideWorkspaceButtonSignal = this._settings.connect(
                'changed::hide-workspace-button', () => this._syncWorkspaceButton());
            this._syncWorkspaceButton();
            this._windowsPanel = new WindowsPanel(this._settings, this._dock);
            console.debug('Sheliak: dock criado e habilitado');
        } catch (error) {
            console.error(`Sheliak: falha na ativação; revertendo alterações: ${error}`);
            this._teardown();
        }
    }

    disable(): void {
        console.debug(`Sheliak: disable() em ${this.uuid}`);
        this._teardown();
        console.debug('Sheliak: dock destruído');
    }

    private _teardown(): void {
        this._destroyComponent('painel Windows', this._windowsPanel);
        this._windowsPanel = null;
        this._restoreDesktopStartup();
        if (this._dashWasVisible !== null) {
            if (this._dashWasVisible)
                Main.overview.dash.show();
            else
                Main.overview.dash.hide();
            this._dashWasVisible = null;
        }
        if (this._settings && this._hideWorkspaceButtonSignal)
            this._settings.disconnect(this._hideWorkspaceButtonSignal);
        this._hideWorkspaceButtonSignal = 0;
        if (this._activitiesButtonWasVisible)
            this._activitiesButton?.show();
        this._activitiesButton = null;
        this._activitiesButtonWasVisible = false;
        this._destroyComponent('cores dos menus', this._panelMenuTheme);
        this._panelMenuTheme = null;
        this._destroyComponent('barra superior', this._topBar);
        this._topBar = null;
        this._destroyComponent('menus do painel', this._panelMenus);
        this._panelMenus = null;
        this._destroyComponent('animações', this._windowAnimations);
        this._windowAnimations = null;
        this._destroyComponent('dock', this._dock);
        this._dock = null;
        this._destroyComponent('transparência do painel', this._panelSurfaceTheme);
        this._panelSurfaceTheme = null;
        this._settings = null;
    }

    private _destroyComponent(name: string, component: {destroy(): void} | null): void {
        try {
            component?.destroy();
        } catch (error) {
            console.error(`Sheliak: falha ao desmontar ${name}: ${error}`);
        }
    }

    private _syncWorkspaceButton(): void {
        if (this._settings?.get_boolean('hide-workspace-button'))
            this._activitiesButton?.hide();
        else if (this._activitiesButtonWasVisible)
            this._activitiesButton?.show();
    }

    private _prepareDesktopStartup(): void {
        if (!shellIsStartingUp())
            return;

        // O Shell usa hasOverview para decidir entre iniciar na Overview ou
        // executar a animação legada diretamente na área de trabalho.
        // A alteração é temporária e afeta somente o login em andamento.
        this._sessionHadOverview = Boolean(Main.sessionMode.hasOverview);
        Main.sessionMode.hasOverview = false;

        // Os índices internos começam em zero; esta é a área exibida como 1.
        global.workspace_manager.get_workspace_by_index(0)?.activate(
            global.get_current_time());

        this._startupCompleteSignal = Main.layoutManager.connect(
            'startup-complete', () => this._restoreDesktopStartup());
    }

    private _restoreDesktopStartup(): void {
        if (this._startupCompleteSignal) {
            Main.layoutManager.disconnect(this._startupCompleteSignal);
            this._startupCompleteSignal = 0;
        }

        if (this._sessionHadOverview !== null) {
            Main.sessionMode.hasOverview = this._sessionHadOverview;
            this._sessionHadOverview = null;
        }
    }
}
