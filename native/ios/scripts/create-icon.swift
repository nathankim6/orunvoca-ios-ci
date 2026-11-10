import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let args = CommandLine.arguments
let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil)!
let original = CGImageSourceCreateImageAtIndex(source, 0, nil)!
let canvas = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
canvas.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); canvas.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
let width: CGFloat = 624
let height = width * CGFloat(original.height) / CGFloat(original.width)
canvas.interpolationQuality = .high
canvas.draw(original, in: CGRect(x: 200, y: (1024-height)/2, width: width, height: height))
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, canvas.makeImage()!, nil)
assert(CGImageDestinationFinalize(destination))
print("Created opaque 1024px brand icon")
