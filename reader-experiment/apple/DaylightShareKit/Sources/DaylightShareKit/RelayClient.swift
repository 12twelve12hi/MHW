import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One message read from a topic, with what came of it (PROTOCOL 3.2).
public struct RelayMessage {
    public enum Outcome: String {
        /// `frame` holds the frame bytes (from the message text, or a downloaded attachment).
        case frame
        /// The caller's `skip` said it is handled already; nothing was downloaded.
        case skipped
        /// The attachment answered 404 or 410: the relay dropped it (the sender re-sends with a new message).
        case expired
        /// Not usable: bad base64, an attachment URL that is neither https nor the relay's own origin, or one larger
        /// than `DLS.maxAttachment`.
        case junk
        /// The download failed for now (429, 5xx, another status, a network error, a timeout, a reset): it holds the
        /// cursor and is tried again at the next poll.
        case retry
    }

    public let id: String
    /// Unix seconds.
    public let time: Int
    /// Whether the message carries an attachment.
    public let attachment: Bool
    public let outcome: Outcome
    /// The frame bytes when `outcome` is `.frame`.
    public let frame: Data?
}

/// The ntfy transport (PROTOCOL 3).
public final class RelayClient {
    public let relay: String
    let session: URLSession
    /// The relay's origin (scheme, host, port) for the attachment download rule.
    let origin: String?
    /// Called instead of Task.sleep, so tests can skip waiting.
    var sleep: (TimeInterval) async -> Void = { s in try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }
    /// The waits before the in-call retries of a publish after a network error, 408 or 5xx (PROTOCOL 3.1).
    public var retryDelays: [TimeInterval] = [1, 2, 4]

    public init(relay: String = DLS.defaultRelay, session: URLSession? = nil) throws {
        let normalized = try ShareText.normalizeRelay(relay)
        self.relay = normalized
        self.session = session ?? RelayClient.defaultSession
        origin = URL(string: normalized).flatMap { RelayClient.origin($0) }
    }

    public static let defaultSession: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 60
        c.timeoutIntervalForResource = 15 * 60
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        return URLSession(configuration: c)
    }()

    /// "scheme://host:port" with the default port filled in, or nil.
    static func origin(_ url: URL) -> String? {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false), let scheme = c.scheme?.lowercased(),
              let host = c.host?.lowercased(), !host.isEmpty else { return nil }
        let port = c.port ?? (scheme == "https" ? 443 : scheme == "http" ? 80 : -1)
        return "\(scheme)://\(host):\(port)"
    }

    func topicURL(_ topic: String, suffix: String = "") throws -> URL {
        guard let u = URL(string: "\(relay)/\(topic)\(suffix)") else { throw ShareError("relay", "Bad relay address.") }
        return u
    }

    // MARK: Publish (PROTOCOL 3.1)

    /// Publishes one frame: small frames as base64 message text (POST), large ones as an attachment (PUT).
    /// Returns whether it went as an attachment. Throws ShareError with `code` and `status` (CHANGES-v1.1 2.4):
    ///
    /// - no answer, a timeout, 408 or 5xx: retried in the call after 1 s, 2 s and 4 s (or `Retry-After`, at most
    ///   60 s), then `network` (`status` 0 when there was no answer);
    /// - 429: `network` with status 429 at once (the caller's re-send pass then publishes nothing more);
    /// - 413: `full` (the pass publishes no more attachments);
    /// - any other 4xx: `refused`.
    @discardableResult
    public func publish(topic: String, frame: Data) async throws -> Bool {
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
            let response: HTTPURLResponse
            do {
                (_, response) = try await perform(req, body: body)
            } catch {
                if attempt < retryDelays.count {
                    await sleep(retryDelays[attempt])
                    attempt += 1
                    continue
                }
                throw ShareError("network", "network error: \(error.localizedDescription)", reason: "network", status: 0)
            }
            let status = response.statusCode
            if (200..<300).contains(status) { return !small }
            if status == 429 { throw ShareError("network", "HTTP 429", reason: "rate-limited", status: status) }
            if status == 413 { throw ShareError("full", "HTTP 413", reason: "full", status: status) }
            if status >= 400 && status < 500 && status != 408 {
                throw ShareError("refused", "HTTP \(status)", reason: "refused", status: status)
            }
            if attempt < retryDelays.count {
                let retryAfter = Double(response.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 0
                await sleep(retryAfter > 0 ? min(retryAfter, 60) : retryDelays[attempt])
                attempt += 1
                continue
            }
            throw ShareError("network", "HTTP \(status)", reason: "server", status: status)
        }
    }

    // MARK: Receive (PROTOCOL 3.2)

    /// Reads cached messages: `since` is "all" or Unix seconds; `skip(id)` is true for messages the caller has handled.
    /// Returns one entry per message line with its outcome (see `RelayMessage.Outcome`). Attachments are downloaded
    /// only from https or the relay's own origin, at most `DLS.maxAttachment` bytes; after a 429 no further attachment
    /// is downloaded in this poll (they are `retry`). Throws ShareError `network` (no answer, `status` 0) or `relay`
    /// (an error status, or an answer over `DLS.maxPollResponse`).
    public func poll(topic: String, since: String = "all", skip: (String) -> Bool = { _ in false }) async throws
        -> [RelayMessage] {
        let sinceParam = since.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "all"
        var req = URLRequest(url: try topicURL(topic, suffix: "/json?poll=1&since=\(sinceParam)"))
        req.httpMethod = "GET"
        let response: HTTPURLResponse
        let answer: Data?
        do {
            (response, answer) = try await fetchCapped(req, cap: DLS.maxPollResponse)
        } catch {
            throw ShareError("network", "Couldn’t reach the relay (\(error.localizedDescription)).", reason: "network")
        }
        guard (200..<300).contains(response.statusCode) else {
            throw ShareError("relay", "The relay answered \(response.statusCode).", reason: "status",
                             status: response.statusCode)
        }
        guard let data = answer else {
            throw ShareError("relay", "The relay’s answer is too long.", reason: "too-long", status: response.statusCode)
        }
        var out: [RelayMessage] = []
        var stopDownloads = false
        for line in data.split(separator: UInt8(ascii: "\n")) {
            guard let m = JSONRead.object(Data(line)), m["event"] as? String == "message", let id = m["id"] as? String
            else { continue }
            let time = JSONRead.integer(m["time"]) ?? 0
            let att = m["attachment"]
            let hasAttachment = !JSONRead.isNull(att) && (att as? Bool) != false
            func entry(_ outcome: RelayMessage.Outcome, _ frame: Data? = nil) -> RelayMessage {
                RelayMessage(id: id, time: time, attachment: hasAttachment, outcome: outcome, frame: frame)
            }
            if skip(id) {
                out.append(entry(.skipped))
            } else if hasAttachment {
                guard let url = (att as? [String: Any])?["url"] as? String else {
                    out.append(entry(.junk))
                    continue
                }
                if stopDownloads {
                    out.append(entry(.retry))
                    continue
                }
                let (outcome, frame, status) = await download(url)
                out.append(entry(outcome, frame))
                if status == 429 { stopDownloads = true }
            } else if let text = m["message"] as? String, let frame = Base64.decode(text) {
                out.append(entry(.frame, frame))
            } else {
                out.append(entry(.junk))
            }
        }
        return out
    }

    /// Downloads one attachment under the download rule (PROTOCOL 3.2). -> outcome, frame, HTTP status (0: none).
    func download(_ urlString: String) async -> (RelayMessage.Outcome, Data?, Int) {
        guard let url = URL(string: urlString), let scheme = url.scheme?.lowercased() else { return (.junk, nil, 0) }
        if scheme != "https" && (Self.origin(url) == nil || Self.origin(url) != origin) { return (.junk, nil, 0) }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.timeoutInterval = 300
        do {
            let (response, body) = try await fetchCapped(req, cap: DLS.maxAttachment)
            let status = response.statusCode
            if (200..<300).contains(status) {
                guard let body else { return (.junk, nil, status) }
                return (.frame, body, status)
            }
            if status == 404 || status == 410 { return (.expired, nil, status) }
            return (.retry, nil, status)
        } catch {
            return (.retry, nil, 0)
        }
    }

    // MARK: HTTP

    /// A request whose answer is read as a stream, at most `cap` bytes: the body is nil when the answer is longer (a
    /// larger `Content-Length` is not read at all), and empty for an error status (not read).
    func fetchCapped(_ request: URLRequest, cap: Int) async throws -> (HTTPURLResponse, Data?) {
        #if canImport(Darwin)
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            bytes.task.cancel()
            throw ShareError("network", "No HTTP response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            bytes.task.cancel()
            return (http, Data())
        }
        if http.expectedContentLength > Int64(cap) {
            bytes.task.cancel()
            return (http, nil)
        }
        var buffer: [UInt8] = []
        if http.expectedContentLength > 0 { buffer.reserveCapacity(Int(http.expectedContentLength)) }
        for try await byte in bytes {
            buffer.append(byte)
            if buffer.count > cap {
                bytes.task.cancel()
                return (http, nil)
            }
        }
        return (http, Data(buffer))
        #else
        let (data, http) = try await perform(request, body: nil)
        return (http, (200..<300).contains(http.statusCode) && data.count > cap ? nil : data)
        #endif
    }

    private func perform(_ request: URLRequest, body: Data?) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(Data, HTTPURLResponse), Error>) in
            let done: @Sendable (Data?, URLResponse?, Error?) -> Void = { data, response, error in
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
