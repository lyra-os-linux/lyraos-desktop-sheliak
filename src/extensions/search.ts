import {LyraExtension} from '../core/extension.js';
import {PanelMenus} from '../panelMenus.js';
import {SearchIndicator} from '../search/indicator.js';

export default class LyraSearch extends LyraExtension {
    private _controller: PanelMenus | null = null;
    protected activate(): void {
        this._controller = this.scope.own(new PanelMenus(this.getSettings('org.gnome.shell.extensions.sheliak'),
            this.path, 'search', () => new SearchIndicator()));
    }
}
