import Foundation
import AppKit
import ImageIO

// Lossless pixel I/O and deterministic resampling only. Artwork is image_gen output.
let args = CommandLine.arguments
let cs = CGColorSpaceCreateDeviceRGB()
func read(_ p:String)->CGImage {
    let s = CGImageSourceCreateWithURL(URL(fileURLWithPath:p) as CFURL,nil)!
    return CGImageSourceCreateImageAtIndex(s,0,nil)!
}
func save(_ p:String,_ im:CGImage) {
    let dest=CGImageDestinationCreateWithURL(URL(fileURLWithPath:p) as CFURL,"public.png" as CFString,1,nil)!
    CGImageDestinationAddImage(dest,im,nil);CGImageDestinationFinalize(dest)
}
func bitmap(_ w:Int,_ h:Int)->CGContext {
    return CGContext(data:nil,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:cs,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
}
if args[1]=="decode" {
    let im=read(args[2]);let c=bitmap(im.width,im.height)
    c.draw(im,in:CGRect(x:0,y:0,width:im.width,height:im.height))
    let d=Data(bytes:c.data!,count:im.width*im.height*4)
    try! d.write(to:URL(fileURLWithPath:args[3]))
    print("\(im.width) \(im.height)")
} else if args[1]=="encode" {
    let w=Int(args[3])!,h=Int(args[4])!,c=bitmap(w,h)
    let d=try! Data(contentsOf:URL(fileURLWithPath:args[2]))
    d.copyBytes(to:c.data!.assumingMemoryBound(to:UInt8.self),count:w*h*4)
    save(args[5],c.makeImage()!)
} else if args[1]=="resize" {
    let w=Int(args[3])!,h=Int(args[4])!,c=bitmap(w,h)
    c.interpolationQuality = args.count>6 && args[6]=="nearest" ? .none : .high
    c.draw(read(args[2]),in:CGRect(x:0,y:0,width:w,height:h))
    save(args[5],c.makeImage()!)
}
