import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One message read from a topic.
public struct RelayMessage {
    public let id: String
    /// Unix seconds.
    public let time: Int
    /// The frame bytes; nil when the message is not usable (bad base64, expired attachment, …).
    public let frame: Data?
}

/// The ntfy transport (PROTOCOL 3).
public final class RelayClient {
    public let relay: String
    let session: URLSession
    /// Called instead of Task.sleep, so tests can skip waiting.
    var sleep: (TimeInterval) async -> Void = { s in try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }

    public init(relay: String = DLS.defaultRelay, session: URLSession? = nil) throws {
        self.relay = try ShareText.normalizeRelay(relay)
        self.session = session ?? RelayClient.defaultSession
    }

    public static let defaultSession: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 60
        c.timeoutIntervalForResource = 15 * 60
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        return URLSession(configuration: c)
    }()

    func topicURL(_ topic: String, suffix: String = "") throws -> URL {
        guard let u = URL(string: "\(relay)/\(topic)\(suffix)") else { throw ShareError("relay", "Bad relay address.") }
        return u
    }

    /// Publishes one frame: small frames as base64 message text (POST), large ones as an attachment (PUT).
    /// Retries network errors, 429 and 5xx up to `retries` times; 413 throws ShareError("too-large").
    /// Returns whether it went as an attachment.
    @discardableResult
    public func publish(topic: String, frame: Data, retries: Int = 3) async throws -> Bool {
        let small = Frame.isSmall(frame.count)
        var req = URLRequest(url: try topicURL(topic))
        req.setValue("no", forHTTPHeaderField: "Firebase")
        req.setValue("yes", forHTTPHeaderField: "Cache")
        let body: Data
        if small {
            req.httpMethod = "POST"
            req.setValue("text/plain", forHTTPHeaderField: "Content-Type")
            body = Data(Base64.encode(frame).utf8)
        } else {
            req.httpMethod = "PUT"
            req.setValue("dls1.bin", forHTTPHeaderField: "Filename")
            req.setValue("dls1", forHTTPHeaderField: "Message")
            req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            req.timeoutInterval = 300
            body = frame
        }
        var attempt = 0
        while true {
            let status: Int
            let response: HTTPURLResponse
            do {
                (_, response) = try await perform(req, body: body)
                status = response.statusCode
            } catch {
                if attempt >= retries { throw ShareError("network", "Couldn’t reach the relay (\(error.localizedDescription)).") }
                await sleep(pow(2, Double(attempt)))
                attempt += 1
                continue
            }
            if (200..<300).contains(status) { return !small }
            if status == 413 { throw ShareError("too-large", "The relay refused the file as too large.") }
            if (status == 429 || status >= 500) && attempt < retries {
                let ra = Double(response.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 0
                await sleep(ra > 0 ? min(ra, 60) : 10 * Double(attempt + 1))
                attempt += 1
                continue
            }
            throw ShareError("relay", "The relay answered \(status).")
        }
    }

    /// Reads cached messages: `since` is "all" or Unix seconds. Attachments larger than `maxAttachment` are skipped.
    public func poll(topic: String, since: String = "all", maxAttachment: Int = 16 * 1024 * 1024,
                     skip: (String) -> Bool = { _ in false }) async throws -> [RelayMessage] {
        let sinceParam = since.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "all"
        var req = URLRequest(url: try topicURL(topic, suffix: "/json?poll=1&since=\(sinceParam)"))
        req.httpMethod = "GET"
        let (data, response) = try await perform(req, body: nil)
        guard (200..<300).contains(response.statusCode) else {
            throw ShareError("relay", "The relay answered \(response.statusCode).")
        }
        var out: [RelayMessage] = []
        for line in data.split(separator: UInt8(ascii: "\n")) {
            guard let m = JSONRead.object(Data(line)), m["event"] as? String == "message", let id = m["id"] as? String
            else { continue }
            let time = JSONRead.integer(m["time"]) ?? 0
            if skip(id) {
                out.append(RelayMessage(id: id, time: time, frame: nil))
                continue
            }
            var frame: Data?
            if let att = m["attachment"] as? [String: Any], let s = att["url"] as? String {
                let declared = JSONRead.integer(att["size"]) ?? 0
                if declared <= maxAttachment, let u = URL(string: s), ["http", "https"].contains(u.scheme?.lowercased() ?? "") {
                    var r = URLRequest(url: u)
                    r.httpMethod = "GET"
                    if let (d, resp) = try? await perform(r, body: nil), (200..<300).contains(resp.statusCode),
                       d.count <= maxAttachment {
                        frame = d
                    }
                }
            } else if let text = m["message"] as? String {
                frame = Base64.decode(text)
            }
            out.append(RelayMessage(id: id, time: time, frame: frame))
        }
        return out
    }

    private func perform(_ request: URLRequest, body: Data?) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(Data, HTTPURLResponse), Error>) in
            let done: (Data?, URLResponse?, Error?) -> Void = { data, response, error in
                if let error {
                    cont.resume(throwing: error)
                } else if let http = response as? HTTPURLResponse {
                    cont.resume(returning: (data ?? Data(), http))
                } else {
                    cont.resume(throwing: ShareError("network", "No HTTP response."))
                }
            }
            // A data task with httpBody (rather than an upload task) so URLProtocol-based test relays see the body.
            var r = request
            r.httpBody = body
            session.dataTask(with: r, completionHandler: done).resume()
        }
    }
}
