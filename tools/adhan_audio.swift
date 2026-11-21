// Prepares adhan recordings for the app: decode any audio/video file, show a loudness profile,
// or trim + normalise + fade and write a mono WAV (compress it afterwards with afconvert).
//
//   swift tools/adhan_audio.swift profile <input> [stepSeconds]
//   swift tools/adhan_audio.swift export  <input> <output.wav> <startSec> <endSec>
import AVFoundation
import Foundation

let rate = 44100.0

func decode(_ path: String) -> [Float] {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let track = asset.tracks(withMediaType: .audio).first else { fatalError("no audio track in \(path)") }
    let reader = try! AVAssetReader(asset: asset)
    let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
        AVNumberOfChannelsKey: 1, AVSampleRateKey: rate,
    ])
    reader.add(out)
    reader.startReading()
    var samples: [Float] = []
    while let buf = out.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(buf) {
        let len = CMBlockBufferGetDataLength(block)
        var chunk = [Float](repeating: 0, count: len / 4)
        chunk.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: len, destination: $0.baseAddress!) }
        samples.append(contentsOf: chunk)
    }
    return samples
}

func db(_ x: Float) -> Float { x > 0 ? 20 * log10(x) : -120 }

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: profile <in> [step] | export <in> <out.wav> <start> <end>"); exit(1) }
let samples = decode(args[2])
let seconds = Double(samples.count) / rate

if args[1] == "profile" {
    let step = args.count > 3 ? Double(args[3])! : 5
    print(String(format: "length %.1fs", seconds))
    var t = 0.0
    while t < seconds {
        let a = Int(t * rate), b = min(samples.count, Int((t + step) * rate))
        let slice = samples[a..<b]
        let rms = sqrt(slice.reduce(0) { $0 + $1 * $1 } / Float(max(1, slice.count)))
        let peak = slice.map { abs($0) }.max() ?? 0
        let bar = String(repeating: "█", count: max(0, Int((db(rms) + 60) / 2)))
        print(String(format: "%6.1fs  rms %6.1f dB  peak %6.1f dB  ", t, db(rms), db(peak)) + bar)
        t += step
    }
} else if args[1] == "export" {
    let outPath = args[3]
    let start = max(0, Double(args[4])!), end = min(seconds, Double(args[5])!)
    var s = Array(samples[Int(start * rate)..<Int(end * rate)])
    // Level by loudness (RMS of the louder half-second windows) to -17 dBFS, at most +20 dB,
    // then a soft limiter keeps stray peaks (wind, handling noise) from clipping.
    let win = Int(0.5 * rate)
    var rmsList: [Float] = []
    var i0 = 0
    while i0 + win <= s.count {
        let w = s[i0..<(i0 + win)]
        rmsList.append(sqrt(w.reduce(0) { $0 + $1 * $1 } / Float(win)))
        i0 += win
    }
    let loud = rmsList.sorted().suffix(max(1, rmsList.count / 2))
    let level = sqrt(loud.reduce(0) { $0 + $1 * $1 } / Float(loud.count))
    let gain = min(pow(10, -17.0 / 20) / max(level, 1e-6), pow(10, 20.0 / 20))
    let fadeIn = Int(0.6 * rate), fadeOut = Int(2.5 * rate)
    let knee: Float = 0.8
    for i in 0..<s.count {
        var g = gain
        if i < fadeIn { g *= Float(i) / Float(fadeIn) }
        if i > s.count - fadeOut { g *= Float(s.count - i) / Float(fadeOut) }
        var x = s[i] * g
        let ax = abs(x)
        if ax > knee { x = (x < 0 ? -1 : 1) * (knee + (1 - knee) * tanh((ax - knee) / (1 - knee))) }
        s[i] = x
    }
    let fmt = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
    let file = try! AVAudioFile(forWriting: URL(fileURLWithPath: outPath), settings: fmt.settings)
    let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(s.count))!
    buf.frameLength = AVAudioFrameCount(s.count)
    s.withUnsafeBufferPointer { buf.floatChannelData![0].update(from: $0.baseAddress!, count: s.count) }
    try! file.write(from: buf)
    print(String(format: "wrote %@ (%.1fs, gain %+.1f dB)", outPath, end - start, db(gain)))
}
