# Deskworlds

[![Watch Riverbed](docs/images/riverscape.gif)](docs/videos/riverscape.mp4)

Deskworlds puts a small living 3D world on your Mac desktop. The creatures in each world react to your cursor, and you can feed them from the menu bar. Everything runs locally with Three.js and WebGL2, with no account, analytics or internet connection.

## Worlds

| | |
| --- | --- |
| ![Riverbed](docs/images/riverscape-wide.png) **Riverbed** | ![Coral reef](docs/images/reefscape-wide.png) **Coral reef** |
| ![Betta](docs/images/bettascape-wide.png) **Betta** | ![Plasma globe](docs/images/plasmascape-wide.png) **Plasma globe** |
| ![Koi pond](docs/images/koiscape-wide.png) **Koi pond** | ![Bonfire](docs/images/bonfirescape-wide.png) **Bonfire** |

## Install on Mac

You need macOS 13 or newer and the Xcode command line tools (`xcode-select --install`). Clone the repository, then run this from the project folder:

```sh
sh wallpaper/install.sh
```

This builds the app, installs it at `~/Applications/Deskworlds.app`, and adds a login item. The first frame takes about 20 seconds to appear. Your desktop picture is not changed; the world draws on top of it.

To update, pull the latest source and run the installer again. To remove it, run `sh wallpaper/uninstall.sh`.

## Usage

Click the Deskworlds icon in the menu bar to switch worlds, feed the creatures, stir the fire, or pause. Desktop icons and clicks work as usual.

The wallpaper lowers its frame rate on battery or when windows cover the desktop, and stops when the desktop is hidden, the screen is locked, or Low Power Mode is on. It reads your cursor position and window sizes for this, but does not record keystrokes or request any special permissions.

## Run in a browser

All worlds also run in any browser with WebGL2. With Node.js 20 or newer:

```sh
npm start
```

Then open http://127.0.0.1:8080. Click a scene to drop food. Space pauses, F toggles fullscreen, and H hides the controls.

## Development

There are no dependencies to install. Each world lives in `scenes/<name>/`, the gallery in `ui/`, and the macOS app in `wallpaper/`.

```sh
npm run check
```

```sh
npm test
```

## License

[MIT](LICENSE). Three.js is bundled under its [MIT license](vendor/THREE-LICENSE.txt).
