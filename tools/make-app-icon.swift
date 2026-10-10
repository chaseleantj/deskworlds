// Renders ui/icon.svg into wallpaper/AppIcon.icns. Run from the project folder after
// changing the icon:  swift tools/make-app-icon.swift
//
// macOS draws app icons on a 1024 grid with the shape inset to 824, so the icon sits at
// the same size as its neighbours in Finder and the Dock.

import AppKit

let icon = URL(fileURLWithPath: "ui/icon.svg")
let output = URL(fileURLWithPath: "wallpaper/AppIcon.icns")
guard let image = NSImage(contentsOf: icon) else { fatalError("Cannot read \(icon.path)") }

let iconset = FileManager.default.temporaryDirectory.appendingPathComponent("AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

for points in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let pixels = points * scale
    let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
      bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let inset = Double(pixels) * 100 / 1024
    image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels).insetBy(dx: inset, dy: inset))
    NSGraphicsContext.restoreGraphicsState()
    let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
    try rep.representation(using: .png, properties: [:])!.write(to: iconset.appendingPathComponent(name))
  }
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", output.path]
try iconutil.run()
iconutil.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
guard iconutil.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Wrote \(output.path)")
