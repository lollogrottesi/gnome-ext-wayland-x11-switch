/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */
/**
 * Referencies:
 *  https://fedoraproject.org/wiki/How_to_debug_Wayland_problems
 *  https://docs.fedoraproject.org/en-US/fedora/latest/system-administrators-guide/Wayland/
 */
const GETTEXT_DOMAIN = 'my-indicator-extension';

const { GObject, St, Clutter, Gio, GLib } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const _ = ExtensionUtils.gettext;

const SESSION_TYPE = {
    X11         : "X11",
    WAYLAND     : "Wayland",
    UNDEFINED   : "Undefined"
};

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Session-selector'));
        this._loginSessionId = "";
        this._sessionType = SESSION_TYPE.UNDEFINED;
        this._sessionToSwitch = SESSION_TYPE.UNDEFINED;
        // Session Type Label is updated via _getCurrentSession().
        this._label = new St.Label({
            text: this._sessionType,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        this.add_child(this._label);

        // Switch item is updated via _getCurrentSession().
        this._switchItem = new PopupMenu.PopupMenuItem(_('Switch to ' + this._sessionToSwitch));
        this._switchItem.connect('activate', () => {
            Main.notify(_('Switching to '+ this._sessionToSwitch));
            const configFile = '/etc/gdm/custom.conf'
            const file = Gio.File.new_for_path(configFile);
            // Synchronous, blocking method
            let [, contents, etag] = file.load_contents(null);
            contents = contents.toString("utf8"); // Force to utf8.
            
            // Remove wayland enable print if present.
            const regex = /\s*(#?\s*WaylandEnable=(false|true))/ig;
            contents = contents.replaceAll(regex, ""); 

            // Append the print to switch session.
            if (this._sessionToSwitch === SESSION_TYPE.X11) {
                log("Entered X11");
                contents = contents.replace("[daemon]", "[daemon]\nWaylandEnable=false");
            } else if (this._sessionToSwitch === SESSION_TYPE.WAYLAND) {
                contents = contents.replace("[daemon]", "[daemon]\n# WaylandEnable=false");
                log("Entered Wayland");
            } else {
                contents = contents.replace("[daemon]", "[daemon]\n# WaylandEnable=false");
                log("Entered Undef");
            }
            // contents = contents.replaceAll("\n", ""); 

            // +" && systemctl restart gdm.service"
            // journalctl -f -o cat /usr/bin/gnome-shell
            const writeConfigCmd = "echo \'" + contents +"\' >" + configFile;
            const restartGgmCmd  = "systemctl restart gdm.service";
            const command = "pkexec sudo sh -c \"" + writeConfigCmd + " && " + restartGgmCmd +"\""
            // log("-----------------------------");
            // log(command);
            // log("-----------------------------");
            try {
                // Rewrite /etc/gdm/custom.conf and restart gdm.service
                GLib.spawn_command_line_async(command);
            } catch (e) {
                logError(e);
            }
        });

        if (this._sessionToSwitch === SESSION_TYPE.UNDEFINED){
            this._switchItem.sensitive = false;
        }
        this.menu.addMenuItem(this._switchItem);

        this._getCurrentSession();
    }
    _setSeddionId(newSessionId) {
        this._loginSessionId = newSessionId;
    }

    _getCurrentSession() {
        // TODO - Possibly change with: echo $XDG_SESSION_TYPE
        try {
            // Execute Loginctl and exctract login session id.
            let proc = Gio.Subprocess.new(
                ['loginctl'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            let [, stdout, stderr] = proc.communicate_utf8(null, null);
            this._loginSessionId = stdout.split("\n")[1].match("\s*([0-9]+)")[1];
            
            // Use the exctracted session ID to retrive the windowing session type.
            proc = Gio.Subprocess.new(
                ['loginctl', 'show-session', this._loginSessionId,'-p', 'Type'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            [, stdout, stderr] = proc.communicate_utf8(null, null);
            if (stdout.includes("Type=wayland")){
                this._setSessionWayland();
            } else if (stdout.includes("Type=x11")) {
                this._setSessionX11();
            } else {
                this._setSessionUndef();
            }
        } catch (e) {
            logError(e);
        }
    }

    _setSessionWayland() {
        this._sessionType = SESSION_TYPE.WAYLAND;
        this._sessionToSwitch = SESSION_TYPE.X11;
        this._label.set_text(this._sessionType);
        this._switchItem.label.text = _('Switch to ' + this._sessionToSwitch);
        this._switchItem.sensitive = true;
    }

    _setSessionX11() {
        this._sessionType = SESSION_TYPE.X11;
        this._sessionToSwitch = SESSION_TYPE.WAYLAND;
        this._label.set_text(this._sessionType);
        this._switchItem.label.text = _('Switch to ' + this._sessionToSwitch);
        this._switchItem.sensitive = true;
    }

    _setSessionUndef() {
        this._sessionType = SESSION_TYPE.UNDEFINED;
        this._sessionToSwitch = SESSION_TYPE.UNDEFINED;
        this._label.set_text(this._sessionType);
        this._switchItem.label.text = _('Switch to ' + this._sessionToSwitch);
        this._switchItem.sensitive = false;
    }
});

class Extension {
    constructor(uuid) {
        this._uuid = uuid;

        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}
