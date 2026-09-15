/* Gnome Shell Override
 *
 * Copyright (C) 2021 Sundeep Mediratta (smedius@gmail.com)
 * Copyright (C) 2020 Sergio Costas (rastersoft@gmail.com)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
/* exported GnomeShellOverride */
'use strict';
import Shell from 'gi://Shell'
import Meta from 'gi://Meta'

import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js'



/*
     * This class overrides methods in the Gnome Shell. The new methods
     * need to be defined below the class as seperate functions.
     * Original callbacks are captured per instance and passed to each replacement.
    */


export class GnomeShellOverride {
    constructor() {
        this._isX11 = !Meta.is_wayland_compositor();
        this._replacements = [];
    }

    enable() {
        if (this._isX11) {  // ** X11 Methods only
            if (WorkspaceAnimation &&
                WorkspaceAnimation.WorkspaceGroup !== undefined) {
                this.replaceMethod(WorkspaceAnimation.WorkspaceGroup, '_shouldShowWindow', newShouldShowWindow);
            }
        } else {    // ** Wayland replace methods below this
            this.replaceMethod(Shell.Global, 'get_window_actors', newGetWindowActors);
        }
    }

    // restore external methods only if have been intercepted

    disable() {
        for (const record of this._replacements.splice(0).reverse()) {
            record.active = false;
            if (record.prototype[record.methodName] === record.replacement)
                record.prototype[record.methodName] = record.original;
        }
    }

    // Lyra: optional APIs must exist before interception. Each wrapper keeps
    // its original callback even if another extension retains it after disable.
    replaceMethod(className, methodName, functionToCall) {
        const prototype = className?.prototype;
        const original = prototype?.[methodName];
        if (typeof original !== 'function') {
            console.warn(`Lyra Desktop Icons: ${methodName} unavailable; keeping native window behavior`);
            return;
        }
        if (this._replacements.some(record => record.prototype === prototype && record.methodName === methodName))
            return;
        const record = {prototype, methodName, original, active: true};
        record.replacement = function (...args) {
            return record.active ? functionToCall.call(this, original, ...args) : original.apply(this, args);
        };
        try {
            prototype[methodName] = record.replacement;
            this._replacements.push(record);
        } catch (error) {
            record.active = false;
            console.warn(`Lyra Desktop Icons: cannot intercept ${methodName}: ${error}`);
        }
    }

};


/**
 * New Functions used to replace the gnome shell functions are defined below.
 */

/**
 * Receives a list of metaWindow or metaWindowActor objects, and remove from it
 * our desktop window
 *
 * @param {GList} windowList A list of metaWindow or metaWindowActor objects
 * @returns {GList} The same list, but with the desktop window removed
 */

/**
 *
 * @param windowList
 */
function removeDesktopWindowFromList(windowList) {
    let returnVal = [];
    for (let element of windowList) {
        let window = element;
        if (window.get_meta_window) { // it is a MetaWindowActor
            window = window.get_meta_window();
        }
        if (!window.customJS_ding || !window.customJS_ding.hideFromWindowList) {
            returnVal.push(element);
        }
    }
    return returnVal;
}

/**
 * Method replacement for Shell.Global.get_window_actors
 * It removes the desktop window from the list of windows in the Activities mode
 */

/**
 *
 */
function newGetWindowActors(original) {
    /* eslint-disable no-invalid-this */
    let windowList = original.apply(this, []);
    return removeDesktopWindowFromList(windowList);
}

/**
 * Method replacement under X11 for should show window
 * It removes the desktop window from the window animation
 */

/**
 *
 * @param window
 */
function newShouldShowWindow(original, window) {
    if (window.get_window_type() === Meta.WindowType.DESKTOP) {
        return false;
    }
    /* eslint-disable no-invalid-this */
    return original.apply(this, [window]);
}
