import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import DaylightShareKit

/// An in-process stand-in for ntfy at https://relay.test (the parts PROTOCOL 3 uses), installed as a URLProtocol.
final class FakeRelay: URLProtocol {
    struct State {
        var topics: [String: [[String: Any]]] = [:]
        var files: [String: Data] = [:]
        var requests: [String] = []
        /// Status codes to answer the next publishes with (then 200 again).
        var failNext: [Int] = []
        var time = 1_800_000_000
        var nextID = 0
        var messageMaxBytes = 4096
    }

    private static let lock = NSLock()
    private static var _state = State()

    static func reset() { with { $0 = State() } }

    @discardableResult
    static func with<T>(_ body: (inout State) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body(&_state)
    }

    static var session: URLSession {
        let c = URLSessionConfiguration.ephemeral
        c.protocolClasses = [FakeRelay.self]
        return URLSession(configuration: c)
    }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "relay.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let url = request.url!
        let method = request.httpMethod ?? "GET"
        let body = Self.body(of: request)
        let parts = url.path.split(separator: "/").map(String.init)
        Self.with { $0.requests.append("\(method) \(url.path)\(url.query.map { "?" + $0 } ?? "")") }

        if method == "GET", parts.count == 2, parts[0] == "file" {
            let id = String(parts[1].dropLast(4))
            if let data = Self.with({ $0.files[id] }) { return respond(200, data) }
            return respond(404, Data("{\"error\":\"not found\"}".utf8))
        }
        if (method == "POST" || method == "PUT"), parts.count == 1 {
            if let status = Self.with({ s -> Int? in s.failNext.isEmpty ? nil : s.failNext.removeFirst() }) {
                return respond(status, Data("{}".utf8), headers: status == 429 ? ["Retry-After": "1"] : [:])
            }
            let filename = request.value(forHTTPHeaderField: "Filename")
            let msg: [String: Any] = Self.with { s in
                s.time += 1
                s.nextID += 1
                let id = "m\(s.nextID)"
                var m: [String: Any] = ["id": id, "time": s.time, "event": "message", "topic": parts[0]]
                let text = String(data: body, encoding: .utf8)
                if filename != nil || text == nil || body.count > s.messageMaxBytes {
                    s.files[id] = body
                    m["message"] = request.value(forHTTPHeaderField: "Message") ?? "file"
                    m["attachment"] = ["name": filename ?? "attachment.bin", "size": body.count,
                                       "url": "https://relay.test/file/\(id).bin"]
                } else {
                    m["message"] = text
                }
                s.topics[parts[0], default: []].append(m)
                return m
            }
            return respond(200, try! JSONSerialization.data(withJSONObject: msg))
        }
        if method == "GET", parts.count == 2, parts[1] == "json" {
            let since = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "since" }?.value ?? "all"
            let list = Self.with { $0.topics[parts[0]] ?? [] }
            let filtered = list.filter { m in
                guard let t = Int(since) else { return true }
                return (m["time"] as! Int) >= t
            }
            var out = Data()
            for m in filtered { out.append(try! JSONSerialization.data(withJSONObject: m)); out.append(0x0A) }
            return respond(200, out)
        }
        respond(404, Data())
    }

    private func respond(_ status: Int, _ data: Data, headers: [String: String] = [:]) {
        let r = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: r, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func body(of request: URLRequest) -> Data {
        if let b = request.httpBody { return b }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var out = Data()
        var buf = [UInt8](repeating: 0, count: 65536)
        while true {
            let n = stream.read(&buf, maxLength: buf.count)
            if n <= 0 { break }
            out.append(buf, count: n)
        }
        return out
    }
}

/// A minimal Daylight: polls the inbox, reassembles, acks (what the Android Inbox does).
struct TestReceiver {
    let keys: ShareKeys
    let relay: RelayClient

    func pollAndAck() async throws -> [Reassembler.Item] {
        let r = Reassembler()
        var items: [Reassembler.Item] = []
        var seen = Set<String>()
        for m in try await relay.poll(topic: keys.inboxTopic) {
            guard let f = m.frame, let o = try? Frame.open(keys: keys, purpose: .inbox, frame: f) else { continue }
            if let item = try r.add(header: o.header, body: o.body), seen.insert(item.header.id).inserted { items.append(item) }
        }
        if !items.isEmpty {
            let ack = AckHeader(ids: items.map(\.header.id))
            try await relay.publish(topic: keys.ackTopic, frame: Frame.seal(keys: keys, purpose: .ack, header: ack.json))
        }
        return items
    }
}
