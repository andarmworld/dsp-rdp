# dsp-rdp: Remote desktops for multiple machines in DSH

[简体中文](https://github.com/andarmworld/dsp-rdp/blob/main/README.md) | **English**

For dsh Web `0.2.0-rc.2`, using Apache Guacamole `1.6.0` to access multiple remote desktops. Since `0.2.0`, machine configurations and complete connection histories are stored in the DSH instance and shared across browsers accessing that instance.

The form contains a machine name, Windows username, password, connection address, and buttons to connect or add a machine. Enter a hostname, IPv4 address, or bracketed IPv6 address, optionally followed by a port (3389 by default), such as `192.168.1.10:3389`. Adding a machine only saves its configuration; connecting saves the configuration and opens the gateway. Leave the password blank to enter it manually at the gateway's NLA login prompt. Passwords are persisted only when you select the option to remember the password encrypted on the server. Clear that option and save an existing machine to remove its stored password.

Search machines by name, address, or username, and edit or delete their configurations. Switching machines preserves open iframes; disconnecting closes the embedded view. Connection history records individual attempts, desktop readiness, disconnections, and failures, with filtering by the current machine, refresh, and pagination. The server generates error details; the client reports only predefined reason codes.

Connection status comes from the Guacamole client. A connection is recorded as successful only when its state is `CONNECTED`, no login parameters remain to be entered, and both desktop dimensions are valid. Connections waiting for NLA credentials or displaying a shared desktop with zero dimensions are not marked as successful. The separate-window button becomes available when the desktop is ready and joins the same session through the current tunnel UUID. If the session cannot be reused, an error is displayed. Keep the original page open. Closing the separate window does not close the embedded view. Refreshing the entire host page unloads the embedded view; when you select a machine again, the server checks for an active session previously confirmed as ready.

Resizing or maximizing the separate window automatically fits the remote desktop and requests the corresponding resolution within the same session. After updating the plugin, refresh DSH and reopen the separate window to use the updated behavior.

Legacy browser entries remain in their original storage. Same-site connection IDs that match machines imported by the server use the server configuration. Unmatched or external entries appear in the legacy browser entries section and can be opened separately.

## Interface preview

The image below shows the actual panel component in a local preview with mock RPC and generic sample data. It demonstrates the machine form, list, and connection-history controls. The preview does not connect to remote machines or establish that real remote desktop login has been validated.

![Local preview of the remote desktop panel](docs/images/panel-preview.png)

[View the 375px mobile preview](docs/images/panel-preview-mobile.png)

## Build and install

`dsp-rdp` is published on [npm](https://www.npmjs.com/package/dsp-rdp). Install it into the DSH Web profile:

```bash
dsh plugin --profile web add dsp-rdp
```

Availability in the in-app plugin center still depends on the community catalog scan. Publishing to npm does not mean the marketplace has already synchronized. Maintainer instructions are available in the [npm release guide (Chinese)](docs/npm-release.md).

You can also install the source version from the [GitHub repository](https://github.com/andarmworld/dsp-rdp):

```bash
dsh plugin --profile web add github:andarmworld/dsp-rdp
```

To build and install from local source:

```bash
npm ci
npm run typecheck
npm test
npm run build
DSH_HOME=/path/to/isolated/dsh-home dsh plugin --profile web add /absolute/path/to/dsp-rdp
```

The server loads with the DSH plugin. The client uses DSH's native `connection.rpc` over the existing `/api` channel to call `rdp/*` methods. The server registers the corresponding `/api/rdp/*` routes within the existing DSH Web service. Machine management and history requests reuse the existing DSH service, address, and authentication. No separate API process, listening port, or management API reverse proxy is required. The client injection list includes `@deepseek-ai/dsh-client-connection`.

## Gateway and storage

The plugin requires a running Guacamole 1.6.0 installation with a PostgreSQL data source, accessible through the same-site `/guacamole/` path. The reverse proxy must support WebSocket Upgrade. The gateway host must be able to reach the target machines on TCP port 3389. `gateway/compose.yaml` provides a template for Guacamole, guacd, and PostgreSQL.

The plugin stores machines and history in DSH's native storage domain and does not create a separate SQLite database. Server configuration fields:

| Field | Default | Purpose |
| --- | --- | --- |
| `guacamoleUrl` | `http://127.0.0.1:18081/guacamole` | Gateway URL accessed only by the server |
| `gatewayUser` | `dshadmin` | Gateway user for importing and connecting |
| `adminUser` | `guacadmin` | Trusted local header identity for managing connections and permissions |
| `keyFile` | `<DSH_HOME>/secrets/rdp.key` | Separate password-encryption key file |

Set these fields in the Web profile's plugin configuration, for example:

```yaml
- id: ligoo-rdp
  name: dsp-rdp
  config:
    guacamoleUrl: http://127.0.0.1:18081/guacamole
    gatewayUser: dshadmin
    adminUser: guacadmin
    keyFile: /private/dsh-home/secrets/rdp.key
```

The gateway uses trusted local header authentication. Restrict gateway access to trusted local callers; external requests must not be able to supply an administrative identity. Keep the key file outside this repository and release packages. The server imports connections authorized for the gateway user and manages permissions for newly created connections. Operators of the same DSH instance share this plugin's data; protect access with DSH authentication.

Optional password storage uses AES-256-GCM encryption, with the key stored separately and protected by file permissions. Lists and history never return passwords. Temporary login credentials are passed to the gateway only for an explicit connection. Passwords are not written to browser storage, connection URLs, or logs. The browser automatically submits a password only once to a visible NLA password form on the same-origin gateway; it does not automatically retry an incorrect password.

## Local interface preview

```bash
npm run preview
```

The preview binds only to `127.0.0.1:4173`, renders the actual `RdpPanel`, and explicitly labels its mock RPC data. Use it to check the layout and interactions of the form, machine list, and history. It does not start a management API, proxy the gateway, connect to remote machines, or include hardcoded passwords. Validate real RPC, persistence, NLA, and remote desktop behavior inside DSH.

## Validation and releases

Local checks cover address validation, encrypted storage, gateway API contracts, actual client identifiers, NLA and zero-size desktop readiness, form error recovery, iframe preservation, history pagination and terminal-state deduplication, and native RPC initialization. In a real browser, check layouts at widths of 375, 768, and 1280px. After entering login credentials, verify the real desktop, keyboard and mouse input, separate windows sharing the same session, and data recovery across browsers.

Unmounting the panel attempts to report a disconnection. If the browser process is terminated or the network is interrupted, the final request may not reach the server.

Before each release, commit changes locally in this repository with a message containing the version and implemented changes, and update `CHANGELOG.md`. Build the release package from that commit and record the target environment, version, commit hash, and validation results. Remote deployments and pushes require explicit authorization.

## License

This project is licensed under the [MIT License](LICENSE). Copyright belongs to andarmworld.
