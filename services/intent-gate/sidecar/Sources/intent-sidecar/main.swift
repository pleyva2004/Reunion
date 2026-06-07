import Foundation
import FoundationModels

// intent-sidecar
//
// A line-oriented classifier over the on-device Apple Foundation Models LLM.
// Protocol (newline-delimited JSON, one object per line):
//
//   stdin  : {"window": "<recent conversation text>"}
//   stdout : {"ready": true}                              (once, after model is available)
//            {"isTravelIntent": bool, "confidence": 0..1, "location": "..."}   (per request)
//            {"error": "<message>"}                       (on failure)
//
// Keeping this contract stable means Variant A (a CoreML/Create ML model) can be
// dropped in later without touching the TypeScript caller.

struct Request: Decodable { let window: String }

@Generable
struct TravelVerdict {
    @Guide(description: "true only if the recent conversation shows genuine intent to plan or take a trip together; false for idle mentions of places")
    let isTravelIntent: Bool

    @Guide(description: "confidence between 0.0 and 1.0")
    let confidence: Double

    @Guide(description: "a destination that EXPLICITLY appears in the conversation text (city, country, region, or landmark); empty string if no real place is named. Never guess, infer, or return a pronoun like 'it' or 'there'.")
    let location: String
}

struct Verdict: Encodable {
    let isTravelIntent: Bool
    let confidence: Double
    let location: String
}

struct ErrorLine: Encodable { let error: String }
struct ReadyLine: Encodable { let ready: Bool }

let encoder = JSONEncoder()

func writeLine<T: Encodable>(_ value: T) {
    guard let data = try? encoder.encode(value),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

let instructions = """
You read a window of recent casual group-chat messages between friends and decide \
whether the conversation shows intent to plan or take a trip TOGETHER.

Report intent (isTravelIntent = true) ONLY when the window contains a concrete \
travel signal:
- a named destination (a city, country, region, or landmark), or
- an explicit proposal to take a trip or go somewhere together, or
- travel logistics (trip dates, flights, lodging).

Do NOT report intent for, on their own: vague agreement ("let's go with it"), \
general availability ("I have a free weekend"), plain excitement, a place mentioned \
without any travel context ("I'm from Paris"), or jokes.

For the destination: only extract a place that EXPLICITLY appears in the window \
(a city, country, region, or landmark). If no real place is named, return an empty \
string. Never guess or invent a destination, and never return a pronoun or vague \
phrase like "it", "there", or "with it".
"""

@main
struct Main {
    static func main() async {
        // Gate on on-device model availability before accepting work.
        switch SystemLanguageModel.default.availability {
        case .available:
            break
        case .unavailable(let reason):
            let why: String
            switch reason {
            case .deviceNotEligible:
                why = "device not eligible for Apple Intelligence"
            case .appleIntelligenceNotEnabled:
                why = "Apple Intelligence is not enabled (System Settings > Apple Intelligence & Siri)"
            case .modelNotReady:
                why = "the on-device model is still downloading; try again shortly"
            @unknown default:
                why = "the on-device model is unavailable"
            }
            writeLine(ErrorLine(error: "Foundation Models unavailable: \(why)"))
            exit(1)
        }

        writeLine(ReadyLine(ready: true))

        while let line = readLine(strippingNewline: true) {
            if line.isEmpty { continue }
            guard let data = line.data(using: .utf8),
                  let req = try? JSONDecoder().decode(Request.self, from: data) else {
                writeLine(ErrorLine(error: "could not parse request line"))
                continue
            }

            let prompt = """
            Recent conversation:
            \(req.window)

            Classify the travel-planning intent of the latest message in context.
            """

            do {
                let session = LanguageModelSession(instructions: instructions)
                let response = try await session.respond(to: prompt, generating: TravelVerdict.self)
                let v = response.content

                // Guard the location: only surface a real place. Strip leading
                // filler ("with it" -> "it"), drop pronouns/vague words, and never
                // report a location when there is no travel intent.
                let raw = v.location.trimmingCharacters(in: .whitespacesAndNewlines)
                var probe = raw.lowercased()
                for filler in ["with ", "to ", "the ", "in ", "at ", "go ", "going "] {
                    while probe.hasPrefix(filler) { probe = String(probe.dropFirst(filler.count)) }
                }
                let nonPlaces: Set<String> = [
                    "", "it", "there", "this", "that", "here",
                    "somewhere", "anywhere", "home", "work", "out",
                ]
                let sanitized = nonPlaces.contains(probe) ? "" : raw
                let location = v.isTravelIntent ? sanitized : ""

                writeLine(Verdict(
                    isTravelIntent: v.isTravelIntent,
                    confidence: v.confidence,
                    location: location
                ))
            } catch {
                writeLine(ErrorLine(error: "inference failed: \(error.localizedDescription)"))
            }
        }
    }
}
