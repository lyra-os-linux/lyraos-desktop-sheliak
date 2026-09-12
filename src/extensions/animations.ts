import {LyraExtension} from '../core/extension.js';
import {WindowAnimationManager} from '../windowAnimations.js';

export default class LyraAnimations extends LyraExtension {
    protected activate(): void {
        this.scope.own(new WindowAnimationManager(this.getSettings('org.gnome.shell.extensions.sheliak')));
    }
}
