// A living world as a desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// wallpaper picture, below the desktop icons, so files and folders stay on top of the
// scene and keep working normally. The scene comes from a web view fed by the copy of
// the scenes inside this app bundle, served over a private scheme so its module
// imports resolve the way they do from a web server.
//
// The window never takes mouse events. The pointer reaches the scene another way: the
// global cursor position is read on a timer and handed to the page as a pointer move,
// so clicking and dragging on the desktop still belongs to the Finder.

import Cocoa
import WebKit
import IOKit.ps

let sceneScheme = "deskworlds"
let sceneHost = "local"

/// The scenes the app can show, each a directory under scenes/ with a wallpaper.html.
enum World: String, CaseIterable {
  case riverscape, reefscape, bettascape, plasmascape, koiscape, bonfirescape

  var title: String {
    switch self {
    case .riverscape: "Riverbed"
    case .reefscape: "Coral reef"
    case .bettascape: "Betta"
    case .plasmascape: "Plasma globe"
    case .koiscape: "Koi pond"
    case .bonfirescape: "Bonfire"
    }
  }
  /// Only worlds with something to eat have anything to feed; the bonfire is stirred instead.
  var canFeed: Bool { self != .plasmascape }
  var feedTitle: String { self == .bonfirescape ? "Stir the Fire" : "Feed" }
  var page: String { "/scenes/\(rawValue)/wallpaper.html" }
  /// What shows before the page has drawn anything, matched to each scene's own dark.
  var background: NSColor {
    switch self {
    case .riverscape: NSColor(calibratedRed: 0.031, green: 0.055, blue: 0.047, alpha: 1)
    case .reefscape: NSColor(calibratedRed: 0.043, green: 0.094, blue: 0.145, alpha: 1)
    case .bettascape, .plasmascape, .bonfirescape: .black
    case .koiscape: NSColor(calibratedRed: 0.016, green: 0.024, blue: 0.02, alpha: 1)
    }
  }

  /// Riverbed until somebody picks otherwise. The choice outlives a restart.
  static var selected: World {
    get { UserDefaults.standard.string(forKey: "world").flatMap(World.init) ?? .riverscape }
    set { UserDefaults.standard.set(newValue.rawValue, forKey: "world") }
  }
}

/// Serves the bundled copy of the scenes to the web view.
final class SceneHandler: NSObject, WKURLSchemeHandler {
  private let root: URL
  private let page: String
  private static let types = [
    "html": "text/html",
    "js": "text/javascript",
    "css": "text/css",
    "json": "application/json",
    "jpg": "image/jpeg",
    "png": "image/png",
  ]

  init(root: URL, page: String) {
    self.root = root.standardizedFileURL
    self.page = page
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let path = url.path == "" || url.path == "/" ? page : url.path
    let file = root.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(
        NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
      return
    }
    let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    task.didReceive(
      URLResponse(
        url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil))
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Puts whatever the page complains about into the agent's log.
final class Reporter: NSObject, WKScriptMessageHandler {
  static let shared = Reporter()
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    NSLog("deskworlds page: \(message.body)")
  }
}

/// A window that keeps the exact frame it is given. AppKit insets ordinary windows from
/// the screen edges; a wallpaper has to reach them.
final class DesktopWindow: NSWindow {
  override func constrainFrameRect(_ rect: NSRect, to screen: NSScreen?) -> NSRect { rect }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

/// One screen's worth of world.
final class Wallpaper: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  let window: DesktopWindow
  let view: WKWebView
  private var loaded = false
  private var inside = false
  private var rate = 0
  private var battery = false

  init(screen: NSScreen, root: URL, world: World) {
    let settings = WKWebViewConfiguration()
    settings.setURLSchemeHandler(
      SceneHandler(root: root, page: world.page), forURLScheme: sceneScheme)
    settings.suppressesIncrementalRendering = true
    // The page holds no state worth keeping between runs and should never leave traces.
    settings.websiteDataStore = .nonPersistent()
    // The agent has no window to look at, so anything the page reports goes to the log.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          const report = (text) => webkit.messageHandlers.report.postMessage(String(text));
          for (const level of ['error', 'warn']) {
            const original = console[level];
            console[level] = (...parts) => {
              report(parts.map((part) => part && part.stack ? part.stack : part).join(' '));
              original.apply(console, parts);
            };
          }
          addEventListener('error', (event) =>
            report(`${event.message} at ${event.filename}:${event.lineno}`));
          addEventListener('unhandledrejection', (event) => report(event.reason));
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // A pointer move the page can read, sent from the global cursor position.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          window.scenePointerCount = 0;
          window.scenePointer = (x, y) => {
            const canvas = document.querySelector('#scene');
            window.scenePointerCount++;
            if (canvas)
              canvas.dispatchEvent(
                new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
          };
          window.scenePointerOut = () => {
            const canvas = document.querySelector('#scene');
            if (canvas) canvas.dispatchEvent(new PointerEvent('pointerleave'));
          };
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))

    view = WKWebView(frame: screen.frame, configuration: settings)
    settings.userContentController.add(Reporter.shared, name: "report")
    // WebKit stops a page whose window it thinks is covered, and AppKit never reports a
    // background agent's window as visible, so the scene would never start. This asks
    // WebKit not to make that call; the agent works out what is covered instead.
    if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
      || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
    {
      view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
    }
    view.underPageBackgroundColor = world.background
    view.autoresizingMask = [.width, .height]

    window = DesktopWindow(
      contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false,
      screen: screen)
    super.init()

    view.navigationDelegate = self
    settings.userContentController.add(self, name: "ready")
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.ignoresMouseEvents = true
    window.isOpaque = true
    window.hasShadow = false
    window.backgroundColor = world.background
    window.isReleasedWhenClosed = false
    window.contentView = view
    // Hiding the agent, or another app's "Hide Others", must not take the world away.
    window.canHide = false
    window.setFrame(screen.frame, display: true)
    window.orderFrontRegardless()

    // Native: full display resolution plugged in, the Balanced profile on battery.
    let page = "\(sceneScheme)://\(sceneHost)\(world.page)?quality=native"
    view.load(URLRequest(url: URL(string: page)!))
  }

  func close() {
    NotificationCenter.default.removeObserver(self)
    view.navigationDelegate = nil
    view.configuration.userContentController.removeAllUserScripts()
    view.configuration.userContentController.removeScriptMessageHandler(forName: "report")
    view.configuration.userContentController.removeScriptMessageHandler(forName: "ready")
    view.removeFromSuperview()
    window.contentView = nil
    window.orderOut(nil)
    window.close()
  }

  /// Send only state changes. The page's ready message resends once, so there is no
  /// need to cross the WebKit process boundary every second with an unchanged rate.
  @discardableResult
  func setRate(_ wanted: Int) -> Bool {
    guard wanted != rate else { return false }
    rate = wanted
    if rate == 0 && inside {
      if loaded { view.evaluateJavaScript("scenePointerOut()") }
      inside = false
    }
    NSLog("deskworlds: \(rate) fps")
    send()
    return true
  }

  func setPower(_ onBattery: Bool) {
    guard battery != onBattery else { return }
    battery = onBattery
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript(
      """
      typeof scenePower === 'function' && scenePower(\(battery ? "true" : "false"));
      typeof sceneRate === 'function' && sceneRate(\(rate));
      """)
  }

  /// A pinch of food, asked for from the menu rather than by clicking. The
  /// window never takes a mouse event, so there is no cursor position to drop it at: the
  /// page picks its own spot on the surface. Nothing is sent while the scene is stopped,
  /// where the food would only pile up unseen until it started again.
  func feed() {
    guard loaded, rate > 0 else { return }
    view.evaluateJavaScript("typeof sceneFeed === 'function' && sceneFeed()")
  }

  /// A cursor position in this screen's coordinates, or nil when the cursor left it.
  func setPointer(_ point: NSPoint?) {
    guard loaded, rate > 0 else { return }
    guard let point else {
      if inside { view.evaluateJavaScript("scenePointerOut()") }
      inside = false
      return
    }
    inside = true
    view.evaluateJavaScript(
      "scenePointer(\(String(format: "%.1f", point.x)),\(String(format: "%.1f", point.y)))")
  }

  /// The scene has installed its callbacks. WebKit's own didFinish can come before that,
  /// and a rate sent then would be lost until the next change.
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    loaded = true
    send()
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    NSLog("deskworlds: the scene did not load: \(error.localizedDescription)")
  }

  /// What the page thinks it is doing, for the log.
  func probe() {
    view.evaluateJavaScript(
      """
      (() => {
        const canvas = document.querySelector('#scene');
        const context = canvas && canvas.getContext('webgl2');
        return JSON.stringify({
          pixels: canvas && [canvas.width, canvas.height],
          covered: !document.querySelector('#loading').hidden,
          webgl2: Boolean(context),
          gpu: context && context.getParameter(context.RENDERER),
          hidden: document.hidden,
          pointers: window.scenePointerCount,
        });
      })()
      """
    ) { value, error in
      NSLog("deskworlds page state: \(value ?? error?.localizedDescription ?? "unreadable")")
    }
  }

  /// What this screen is showing right now. The agent has no window of its own to look
  /// at, so this is how it can be checked.
  func snapshot(to file: URL, then done: @escaping () -> Void) {
    view.takeSnapshot(with: nil) { image, _ in
      defer { done() }
      guard let image, let data = image.tiffRepresentation,
        let png = NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:])
      else { return }
      try? png.write(to: file)
      NSLog("deskworlds: wrote \(file.path)")
    }
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  static var shared: Controller?
  private var screens: [Wallpaper] = []
  private var root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var awake = true
  private var layout: [CGRect] = []
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var snapshots: DispatchSourceSignal?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let pause = NSMenuItem()
  private let feed = NSMenuItem()
  private var worldItems: [NSMenuItem] = []
  private var world = World.selected
  private var applied = 0
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var exposureTimer: Timer?
  /// The choice outlives a restart, so a paused world is still paused after logging in.
  /// Until one has been made there is nothing under the key at all, which is what lets a
  /// machine that asks for less motion start still without overruling anybody who has
  /// since decided otherwise.
  private var stopped =
    UserDefaults.standard.object(forKey: "paused") as? Bool ?? reduceMotion
  private var lowPower: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }
  /// Reduce Motion is a durable choice about the whole machine, not a passing shortage
  /// like Low Power Mode, so it decides how the wallpaper starts and never more than that:
  /// somebody who installed an animated wallpaper is allowed to want it anyway.
  private static var reduceMotion: Bool {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  }
  private var reduceMotion: Bool { Controller.reduceMotion }

  func applicationDidFinishLaunching(_ note: Notification) {
    Controller.shared = self
    build()
    addMenu()

    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)

    // Drawing while the display is off, asleep or locked would only cost power.
    let workspace = NSWorkspace.shared.notificationCenter
    for (name, value) in [
      (NSWorkspace.screensDidSleepNotification, false),
      (NSWorkspace.screensDidWakeNotification, true),
      (NSWorkspace.sessionDidResignActiveNotification, false),
      (NSWorkspace.sessionDidBecomeActiveNotification, true),
    ] {
      workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    let distributed = DistributedNotificationCenter.default()
    for (name, value) in [("com.apple.screenIsLocked", false), ("com.apple.screenIsUnlocked", true)]
    {
      distributed.addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }

    // Low Power Mode holds the scene still, like any other reason not to draw.
    NotificationCenter.default.addObserver(
      forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
    ) { [weak self] _ in self?.applyRate() }

    // Turning Reduce Motion on mid-session stops the scene for the same reason it starts
    // stopped under it, unless it has already been asked for deliberately.
    workspace.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self, UserDefaults.standard.object(forKey: "paused") == nil else { return }
      self.stopped = self.reduceMotion
      self.applyRate()
    }

    // Running on the battery halves the frame rate; the scene is slow enough to hold up.
    if let source = IOPSNotificationCreateRunLoopSource({ _ in
      DispatchQueue.main.async { Controller.shared?.applyRate() }
    }, nil)?.takeRetainedValue() {
      CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
    }

    // `kill -USR1` writes what the first screen is showing to /tmp/deskworlds.png.
    signal(SIGUSR1, SIG_IGN)
    snapshots = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    snapshots?.setEventHandler { [weak self] in self?.snapshot() }
    snapshots?.resume()
  }

  /// Draws for a moment even if the desktop is covered, then saves the frame.
  private func snapshot() {
    guard let first = screens.first else { return }
    for screen in screens { screen.setRate(60) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      first.probe()
      first.snapshot(to: URL(fileURLWithPath: "/tmp/deskworlds.png")) {
        self?.applyRate()
      }
    }
  }

  // Putting a full-screen window on a screen is itself a screen-parameter change, so the
  // arrangement is compared before anything is rebuilt.
  @objc private func screensChanged() {
    guard NSScreen.screens.map(\.frame) != layout else { return }
    build()
  }

  private func build() {
    layout = NSScreen.screens.map(\.frame)
    for screen in screens { screen.close() }
    screens = NSScreen.screens.map { Wallpaper(screen: $0, root: root, world: world) }
    applyRate()
  }

  private var onBattery: Bool {
    guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
      let kind = IOPSGetProvidingPowerSourceType(blob)?.takeRetainedValue() as String?
    else { return false }
    return kind == kIOPSBatteryPowerValue
  }

  /// Full speed while the wallpaper is in plain sight, a slow beat when windows leave only
  /// part of it showing, and nothing at all behind a full screen of work or a dark display.
  /// Power depends on the machine and display; it must be measured on the target Mac.
  func applyRate() {
    let battery = onBattery
    let full = battery ? 30 : 60
    let still = stopped || lowPower || !awake
    // Read the window list once for all displays, and never while deliberately still.
    let blockers = still ? [] : windowBlockers()
    applied = 0
    var changed = false
    for (index, screen) in screens.enumerated() {
      let showing = index < layout.count ? exposure(layout[index], blockers: blockers) : 1
      let rate = still || showing < 0.15 ? 0 : showing < 0.4 ? 20 : full
      screen.setPower(battery)
      if screen.setRate(rate) { changed = true }
      applied = max(applied, rate)
    }
    if changed { lastPoint = NSPoint(x: -1e4, y: -1e4) }
    updateTimers(pollExposure: !still)
  }

  private func updateTimers(pollExposure: Bool) {
    // Pointer sampling need not outrun the animation, nor wake a stopped wallpaper.
    let wanted = min(30, applied)
    if wanted != pointerRate {
      pointerTimer?.invalidate()
      pointerTimer = nil
      pointerRate = wanted
      if wanted > 0 {
        let timer = Timer.scheduledTimer(withTimeInterval: 1.0 / Double(wanted), repeats: true) { [weak self] _ in
          self?.trackPointer()
        }
        timer.tolerance = 0.003
        pointerTimer = timer
      }
    }
    if !pollExposure {
      exposureTimer?.invalidate()
      exposureTimer = nil
    } else if exposureTimer == nil {
      // Continue this low-frequency check while merely covered so uncovering resumes.
      let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
        self?.applyRate()
      }
      timer.tolerance = 0.25
      exposureTimer = timer
    }
  }

  /// How much of a screen ordinary windows leave uncovered, from none to all of it.
  /// AppKit's own occlusion never reports this agent's windows as visible, hence the
  /// direct look at what is on screen.
  private func windowBlockers() -> [CGRect] {
    guard
      let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
        as? [[String: Any]]
    else { return [] }
    let me = ProcessInfo.processInfo.processIdentifier
    // Only ordinary app windows count. The menu bar, the Dock and other system layers
    // hold full-screen windows that are almost entirely transparent.
    return list.compactMap { info -> CGRect? in
      guard info[kCGWindowLayer as String] as? Int == 0,
        info[kCGWindowOwnerPID as String] as? Int32 != me,
        info[kCGWindowAlpha as String] as? Double ?? 0 > 0.95,
        let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
      else { return nil }
      return CGRect(dictionaryRepresentation: bounds as CFDictionary)
    }
  }

  private func exposure(_ frame: CGRect, blockers: [CGRect]) -> Double {
    guard !blockers.isEmpty else { return 1 }
    let flipped = CGRect(
      x: frame.minX, y: (NSScreen.screens.first?.frame.height ?? frame.maxY) - frame.maxY,
      width: frame.width, height: frame.height)
    let columns = 16, rows = 10
    var free = 0
    for column in 0..<columns {
      for row in 0..<rows {
        let point = CGPoint(
          x: flipped.minX + flipped.width * (Double(column) + 0.5) / Double(columns),
          y: flipped.minY + flipped.height * (Double(row) + 0.5) / Double(rows))
        if !blockers.contains(where: { $0.contains(point) }) { free += 1 }
      }
    }
    return Double(free) / Double(columns * rows)
  }

  // MARK: - The menu bar

  /// The agent's only visible piece: an icon in the menu bar that can stop the scene.
  private func addMenu() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    // The logo's slab of layered ground, drawn black so AppKit can tint it for the menu bar.
    let symbol = Bundle.main.url(forResource: "menubar", withExtension: "svg").flatMap(NSImage.init)
    symbol?.size = NSSize(width: 18, height: 18)
    symbol?.isTemplate = true
    symbol?.accessibilityDescription = "Deskworlds"
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Deskworlds" }
    item.button?.toolTip = "Deskworlds · \(world.title)"

    let menu = NSMenu()
    menu.delegate = self
    // The items say for themselves when they are available; AppKit's own guess would
    // leave Pause enabled in Low Power Mode, where pressing it would do nothing.
    menu.autoenablesItems = false
    state.isEnabled = false
    menu.addItem(state)
    menu.addItem(.separator())
    let worlds = NSMenu(title: "World")
    worlds.autoenablesItems = false
    for choice in World.allCases {
      let item = NSMenuItem(title: choice.title, action: #selector(selectWorld), keyEquivalent: "")
      item.target = self
      item.representedObject = choice.rawValue
      worlds.addItem(item)
      worldItems.append(item)
    }
    let worldMenu = NSMenuItem(title: "World", action: nil, keyEquivalent: "")
    worldMenu.submenu = worlds
    menu.addItem(worldMenu)
    menu.addItem(.separator())
    feed.title = "Feed"
    feed.target = self
    feed.action = #selector(feedEveryScreen)
    menu.addItem(feed)
    pause.target = self
    pause.action = #selector(togglePause)
    menu.addItem(pause)
    menu.addItem(.separator())
    let leave = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
    leave.target = self
    menu.addItem(leave)
    item.menu = menu
    status = item
    if item.button?.window == nil || !item.isVisible {
      NSLog("deskworlds: the menu bar item did not appear")
    }
  }

  /// Says what the wallpaper is doing, and why, whenever the menu is opened. Most of the
  /// reasons it holds still are deliberate, and unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    for item in worldItems {
      item.state = item.representedObject as? String == world.rawValue ? .on : .off
    }
    state.title =
      lowPower
      ? "Still, for Low Power Mode"
      : stopped
        ? reduceMotion ? "Paused, for Reduce Motion" : "Paused"
        : !awake
          ? "Still, the screen is off"
          : applied == 0
            ? "Resting behind your windows"
            : "Running at \(applied) frames a second"
    pause.title = stopped ? "Resume" : "Pause"
    // In Low Power Mode nothing is going to draw, so the item would be a false promise.
    // Reduce Motion is not the same case: the machine can perfectly well draw, it has
    // merely been asked not to, and Resume is how somebody says they want this one anyway.
    pause.isEnabled = !lowPower
    // Food that nothing is going to draw would sit unseen until the scene started
    // again and then all arrive at once, so Feed says so rather than promising a feeding.
    feed.isEnabled = applied > 0 && world.canFeed
    feed.title = world.feedTitle
  }

  /// Every screen, because each one runs its own world rather than one
  /// scene stretched across them: feeding only the screen the menu bar happens to be on
  /// would leave the others unfed.
  @objc private func feedEveryScreen() {
    for screen in screens { screen.feed() }
  }

  /// Every screen changes together: the scenes are separate worlds, not one world with
  /// two windows, and mixing them would make the menu's checkmark a half-truth.
  @objc private func selectWorld(_ sender: NSMenuItem) {
    guard let name = sender.representedObject as? String, let chosen = World(rawValue: name),
      chosen != world
    else { return }
    world = chosen
    World.selected = chosen
    status?.button?.toolTip = "Deskworlds · \(chosen.title)"
    build()
  }

  @objc private func togglePause() {
    stopped.toggle()
    UserDefaults.standard.set(stopped, forKey: "paused")
    applyRate()
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }

  /// The cursor belongs to the Finder, so its position is read rather than captured.
  private func trackPointer() {
    let point = NSEvent.mouseLocation
    guard abs(point.x - lastPoint.x) > 0.2 || abs(point.y - lastPoint.y) > 0.2 else { return }
    lastPoint = point
    for (index, screen) in NSScreen.screens.enumerated() where index < screens.count {
      let frame = screen.frame
      screens[index].setPointer(
        frame.contains(point)
          ? NSPoint(x: point.x - frame.minX, y: frame.maxY - point.y) : nil)
    }
  }
}

let application = NSApplication.shared
let controller = Controller()
application.setActivationPolicy(.accessory)
application.delegate = controller
application.run()
