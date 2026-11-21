// Draws Istiqamah's icon (gold crescent + 8-point star on deep green) at every size we need.
// Usage: swift tools/make_icons.swift <webIconsDir> <iconsetDir>
import AppKit

func drawIcon(size: CGFloat, macStyle: Bool) -> NSBitmapImageRep {
    let px = Int(size)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))

    let body: CGRect
    if macStyle {
        let inset = size * 100 / 1024
        body = CGRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
    } else {
        body = CGRect(x: 0, y: 0, width: size, height: size)
    }
    let radius = macStyle ? body.width * 0.2237 : 0
    let bg = NSBezierPath(roundedRect: body, xRadius: radius, yRadius: radius)
    if macStyle {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -size * 0.008), blur: size * 0.025,
                      color: NSColor.black.withAlphaComponent(0.3).cgColor)
        NSColor(srgbRed: 0.04, green: 0.22, blue: 0.2, alpha: 1).setFill()
        bg.fill()
        ctx.restoreGState()
    }
    let green = NSGradient(colors: [NSColor(srgbRed: 0.11, green: 0.47, blue: 0.41, alpha: 1),
                                    NSColor(srgbRed: 0.03, green: 0.21, blue: 0.19, alpha: 1)])!
    green.draw(in: bg, angle: -90)

    // Crescent
    let r = body.width * (macStyle ? 0.27 : 0.24)
    let c = CGPoint(x: body.midX - r * 0.12, y: body.midY)
    let outer = NSBezierPath(ovalIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    let cutR = r * 0.82
    let cutC = CGPoint(x: c.x + r * 0.42, y: c.y + r * 0.16)
    let gold = NSGradient(colors: [NSColor(srgbRed: 0.98, green: 0.88, blue: 0.62, alpha: 1),
                                   NSColor(srgbRed: 0.84, green: 0.63, blue: 0.26, alpha: 1)])!
    ctx.saveGState()
    outer.addClip()
    let cut = NSBezierPath(rect: body.insetBy(dx: -10, dy: -10))
    cut.appendOval(in: CGRect(x: cutC.x - cutR, y: cutC.y - cutR, width: 2 * cutR, height: 2 * cutR))
    cut.windingRule = .evenOdd
    cut.addClip()
    gold.draw(in: outer.bounds, angle: -60)
    ctx.restoreGState()

    // 8-point star (two overlapping squares) in the crescent's hollow
    let sc = CGPoint(x: cutC.x + r * 0.02, y: cutC.y - r * 0.12)
    let sr = r * 0.25
    let star = NSBezierPath()
    for rot in [0.0, Double.pi / 4] {
        for k in 0..<4 {
            let a = rot + Double(k) * Double.pi / 2
            let p = CGPoint(x: sc.x + sr * CGFloat(cos(a)), y: sc.y + sr * CGFloat(sin(a)))
            if k == 0 { star.move(to: p) } else { star.line(to: p) }
        }
        star.close()
    }
    star.windingRule = .nonZero
    NSColor(srgbRed: 0.99, green: 0.92, blue: 0.72, alpha: 1).setFill()
    star.fill()

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

func save(_ rep: NSBitmapImageRep, _ path: String) {
    let data = rep.representation(using: .png, properties: [:])!
    try! data.write(to: URL(fileURLWithPath: path))
}

let args = CommandLine.arguments
let webDir = args.count > 1 ? args[1] : "web/icons"
let iconset = args.count > 2 ? args[2] : "build/AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: webDir, withIntermediateDirectories: true)
try? FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)

save(drawIcon(size: 192, macStyle: true), "\(webDir)/icon-192.png")
save(drawIcon(size: 512, macStyle: true), "\(webDir)/icon-512.png")
save(drawIcon(size: 512, macStyle: false), "\(webDir)/icon-maskable-512.png")
save(drawIcon(size: 180, macStyle: false), "\(webDir)/apple-touch-icon.png")
save(drawIcon(size: 64, macStyle: true), "\(webDir)/favicon.png")

for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128),
                   ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512),
                   ("512x512@2x", 1024)] {
    save(drawIcon(size: CGFloat(px), macStyle: true), "\(iconset)/icon_\(name).png")
}
print("icons written")
