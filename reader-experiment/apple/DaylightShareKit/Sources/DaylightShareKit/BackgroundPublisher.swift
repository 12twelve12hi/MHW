import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Upload tasks that outlive the process that started them: a background `URLSession` in the apps
/// (`BackgroundUploadSession`), a fake in tests.
public protocol BackgroundUploads: AnyObject {
    /// Starts one upload of `file` as the body of `request`, labelled `description` ("<id>:<part>:<attempt>").
    func upload(_ request: URLRequest, fromFile file: URL, description: String)
    /// The labels of the tasks that are still running or waiting (`getAllTasks`).
    func liveDescriptions() async -> [String]
    /// Cancels the tasks whose label `matches`.
    func cancel(where matches: @escaping (String) -> Bool) async
}

/// Share in place's first attempt (LAB-PLAN F04, iPhone and Mac with an App Group): the share extension builds the
/// frames as files (`FrameFileBuilder`, two passes, never the whole file in memory), saves the row `sending` with its
/// background attempt, starts one upload task per frame on the background session and closes. The OS finishes the
/// uploads; their answers come back here (`complete`), in the app: `handleEventsForBackgroundURLSession` on iPhone, at
/// launch and while it runs on the Mac.
///
/// - All parts 2xx: the row is `sent`. ntfy.sh dates an attachment from its upload, and the parts can finish hours
///   apart, so a row of more than one part counts as an attachment row and its `lastPublish` is the first part's
///   completion; when the last part completes more than 170 minutes after the first, part 0 may already be gone, and the
///   row is due for a re-send at once (`lastPublish` set back by the attachment wait).
/// - Any other answer: the row is `failed` or `expired` exactly as v1.1's attempt would leave it (PROTOCOL 3.1:
///   429 `network`, 413 `full`, another 4xx `refused`, 408, 5xx or no answer `network`), the attempt's other tasks are
///   cancelled (in place of "later frames are not published"), and the failure notice is posted (`FailureNotices`).
/// - An answer for an attempt the row no longer waits for (the app re-sent it, it was removed) is ignored.
///
/// Re-sends run in the app as today (`ShareSender`), from the stored body. Ad-hoc Mac builds (no App Group) publish in
/// the extension as v1.1 does and never use this.
public final class BackgroundPublisher {
    /// The background session's identifier, the same in the app and its share extension.
    public static let sessionIdentifier = "com.daylight.share.bg"
    /// The frame files' folder beside the outbox.
    public static let folder = "bg"
    /// A row whose last part came this long after its first is re-sent at once (part 0 may have expired: 180 min).
    public static let partsApartLimit: TimeInterval = 170 * 60

    public let outbox: OutboxStore
    let uploads: BackgroundUploads
    /// Posts the failure notice; nil posts none (tests of the rows alone).
    let notices: FailureNotices?
    /// The Daylight's name for the notice.
    let daylightName: () -> String?
    /// The clock (tests move it).
    public var now: () -> Date = Date.init

    public init(outbox: OutboxStore, uploads: BackgroundUploads, notices: FailureNotices? = nil,
                daylightName: @escaping () -> String? = { nil }) {
        self.outbox = outbox
        self.uploads = uploads
        self.notices = notices
        self.daylightName = daylightName
    }

    public var framesDirectory: URL { outbox.directory.appendingPathComponent(Self.folder, isDirectory: true) }

    // MARK: Starting (the share extension)

    /// Builds `input`'s frames and starts their uploads, then returns the row (`sending`), or throws ShareError for bad
    /// input (nothing is stored). A file goes from `file` (read in chunks); a page or a file given as `input.content` is
    /// written to a file first; a link is one small frame.
    @discardableResult
    public func start(_ input: ItemInput, file: URL? = nil, pairing: Pairing, from: String = "", app: String = "",
                      chunkSize: Int = DLS.chunk, nonces: [Data]? = nil) throws -> OutboxRow {
        var item = input
        if item.from == nil { item.from = from }
        if item.app == nil { item.app = app }
        if item.id == nil { item.id = ItemBuilder.newID() }
        let keys = pairing.keys
        let relay = try RelayClient(relay: pairing.relay)
        let fm = FileManager.default
        try fm.createDirectory(at: framesDirectory, withIntermediateDirectories: true)
        let attempt = UUID().uuidString.lowercased()
        let t = now()
        var row: OutboxRow
        var frames: [FrameFileBuilder.FrameFile]
        if item.kind == .url {
            let prepared = try ItemBuilder.prepare(item)
            let frame = try prepared.frame(part: 0, keys: keys, chunkSize: chunkSize, nonce: nonces?.first)
            let small = Frame.isSmall(frame.count)
            let url = framesDirectory.appendingPathComponent(FrameFileBuilder.fileName(id: prepared.id, part: 0))
            try (small ? Data(Base64.encode(frame).utf8) : frame).write(to: url, options: .atomic)
            frames = [FrameFileBuilder.FrameFile(part: 0, url: url, small: small, length: frame.count)]
            let h = prepared.header
            row = OutboxRow(id: h.id, kind: h.kind, title: h.title ?? "", url: h.url ?? "", header: h, created: t,
                            status: .sending, attachment: !small, hasBody: false, attemptStarted: t)
        } else {
            var source = file
            var temporary: URL?
            if source == nil {
                guard let content = item.content else { throw ShareError("content", "missing content") }
                let tmp = framesDirectory.appendingPathComponent("\(item.id!).src")
                try content.write(to: tmp, options: .atomic)
                temporary = tmp
                source = tmp
            }
            defer { if let temporary { try? fm.removeItem(at: temporary) } }
            let built: FrameFileBuilder.Built
            do {
                built = try FrameFileBuilder.build(source: source!, input: item, keys: keys,
                                                   encodedURL: outbox.bodyURL(item.id!), framesDirectory: framesDirectory,
                                                   chunkSize: chunkSize, nonces: nonces)
            } catch let e as ShareError {
                throw e
            } catch {
                throw ShareError.outOfSpace
            }
            frames = built.frames
            let h = built.header
            row = OutboxRow(id: h.id, kind: h.kind, title: h.title ?? "", url: h.url ?? "", name: h.name ?? "",
                            mime: h.mime ?? "", size: h.size ?? 0, header: h, created: t, status: .sending,
                            attachment: built.attachment || built.parts > 1, hasBody: true, attemptStarted: t)
        }
        row.bgAttempt = attempt
        row.bgParts = frames.count
        outbox.save(row)
        for f in frames {
            uploads.upload(try relay.publishRequest(topic: keys.inboxTopic, small: f.small), fromFile: f.url,
                           description: Self.describe(id: row.id, part: f.part, attempt: attempt))
        }
        return row
    }

    // MARK: Answers (the app)

    /// "<id>:<part>:<attempt>".
    public static func describe(id: String, part: Int, attempt: String) -> String { "\(id):\(part):\(attempt)" }

    static func parse(_ description: String) -> (id: String, part: Int, attempt: String)? {
        let p = description.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard p.count == 3, Lab.isID(p[0]), let part = Int(p[1]), part >= 0, !p[2].isEmpty else { return nil }
        return (p[0], part, p[2])
    }

    /// What an answer means (PROTOCOL 3.1, as `RelayClient.publish` reads it): nil for 2xx, else the error the row
    /// records. `status` nil: no answer at all.
    public static func failure(status: Int?, error: Error?) -> ShareError? {
        guard let status else {
            return ShareError("network", "network error: \(error?.localizedDescription ?? "no answer")", reason: "network", status: 0)
        }
        if (200..<300).contains(status) { return nil }
        if status == 429 { return ShareError("network", "HTTP 429", reason: "rate-limited", status: status) }
        if status == 413 { return ShareError("full", "HTTP 413", reason: "full", status: status) }
        if status >= 400 && status < 500 && status != 408 { return ShareError("refused", "HTTP \(status)", reason: "refused", status: status) }
        return ShareError("network", "HTTP \(status)", reason: "server", status: status)
    }

    /// What became of an answer.
    public enum Outcome: Equatable {
        /// Not for an attempt the row waits for (or not ours): nothing changed.
        case ignored
        /// One more part went; others are still on their way.
        case partSent
        /// Every part went: the row is `sent`.
        case sent(OutboxRow)
        /// The attempt failed: the row is `failed` or `expired`.
        case failed(OutboxRow)
    }

    /// One upload task's answer: `status` is its HTTP status (nil when there was none), `error` the task's error. A
    /// cancelled task (this publisher cancelled it) is ignored. Touches storage: off the main thread.
    @discardableResult
    public func complete(description: String, status: Int?, error: Error?) async -> Outcome {
        guard let d = Self.parse(description) else { return .ignored }
        if let e = error as NSError?, e.domain == NSURLErrorDomain, e.code == NSURLErrorCancelled { return .ignored }
        let failure = Self.failure(status: status, error: error)
        let t = now()
        let outcome: Outcome = outbox.update { state -> Outcome in
            guard let i = state.rows.firstIndex(where: { $0.id == d.id }), state.rows[i].status == .sending,
                  state.rows[i].bgAttempt == d.attempt else { return .ignored }
            var row = state.rows[i]
            if let failure {
                let code = ["network", "full", "refused"].contains(failure.code) ? failure.code : "network"
                row.status = .failed
                row.errorCode = code
                row.attempts += 1
                row.slowFails = (code == "full" || code == "refused") ? row.slowFails + 1 : 0
                if row.slowFails >= DLS.slowFailLimit { row.status = .expired }
                row.error = failure.message
                row.http = (100...599).contains(failure.status) ? failure.status : 0
                row.lastPublish = t
                row.bgAttempt = nil
                row.bgDone = []
                row.bgFirstDone = nil
                state.rows[i] = row
                return .failed(row)
            }
            if !row.bgDone.contains(d.part) { row.bgDone.append(d.part) }
            let first = row.bgFirstDone ?? t
            row.bgFirstDone = first
            row.attemptStarted = t // progress
            guard row.bgDone.count >= row.bgParts else {
                state.rows[i] = row
                return .partSent
            }
            row.status = .sent
            row.errorCode = ""
            row.attempts = 0
            row.slowFails = 0
            row.error = ""
            row.http = 0
            row.lastPublish = t.timeIntervalSince(first) > Self.partsApartLimit ? t.addingTimeInterval(-DLS.attachmentWait) : first
            row.bgAttempt = nil
            row.bgDone = []
            row.bgFirstDone = nil
            state.rows[i] = row
            return .sent(row)
        }
        switch outcome {
        case .ignored, .partSent:
            break
        case .sent:
            removeFrames(d.id)
        case let .failed(row):
            await uploads.cancel { desc in Self.parse(desc).map { $0.id == d.id && $0.attempt == d.attempt } ?? false }
            removeFrames(d.id)
            await notices?.sendFailed(row, daylightName: daylightName())
        }
        return outcome
    }

    /// The background attempts with live tasks (for `ShareSender.liveBackgroundAttempts`, once per tick).
    public func liveAttempts() async -> Set<String> {
        Set(await uploads.liveDescriptions().compactMap { Self.parse($0)?.attempt })
    }

    /// Deletes an item's frame files.
    public func removeFrames(_ id: String) {
        for f in FrameFileBuilder.frameFiles(id: id, in: framesDirectory) { try? FileManager.default.removeItem(at: f) }
    }
}

#if canImport(ObjectiveC)
/// The background `URLSession` (identifier `BackgroundPublisher.sessionIdentifier`, in the App Group's container):
/// not discretionary, waking the app when it ends (iPhone), and giving each upload 24 hours. The app and its share
/// extension each make one; the app's hears the answers (`onComplete`) and, when the OS woke it for them, calls the
/// completion handler it was given (`handleEvents`).
public final class BackgroundUploadSession: NSObject, BackgroundUploads, URLSessionTaskDelegate {
    private var session: URLSession!
    private let lock = NSLock()
    private var finishHandlers: [() -> Void] = []
    /// Each task's answer: its label, its HTTP status (nil when none) and its error.
    public var onComplete: ((_ description: String, _ status: Int?, _ error: Error?) -> Void)?

    public init(appGroup: String?, identifier: String = BackgroundPublisher.sessionIdentifier) {
        super.init()
        let c = URLSessionConfiguration.background(withIdentifier: identifier)
        c.sharedContainerIdentifier = appGroup
        c.isDiscretionary = false
        #if os(iOS)
        c.sessionSendsLaunchEvents = true
        #endif
        c.timeoutIntervalForResource = 24 * 60 * 60
        session = URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }

    public func upload(_ request: URLRequest, fromFile file: URL, description: String) {
        let task = session.uploadTask(with: request, fromFile: file)
        task.taskDescription = description
        task.resume()
    }

    public func liveDescriptions() async -> [String] {
        await session.allTasks.filter { $0.state == .running || $0.state == .suspended }.compactMap(\.taskDescription)
    }

    public func cancel(where matches: @escaping (String) -> Bool) async {
        for t in await session.allTasks where matches(t.taskDescription ?? "") { t.cancel() }
    }

    /// iPhone's `application(_:handleEventsForBackgroundURLSession:completionHandler:)`: the handler is called once the
    /// session has delivered every answer.
    public func handleEvents(_ completion: @escaping () -> Void) {
        lock.lock()
        finishHandlers.append(completion)
        lock.unlock()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let status = (task.response as? HTTPURLResponse)?.statusCode
        onComplete?(task.taskDescription ?? "", status, error)
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let handlers = finishHandlers
        finishHandlers = []
        lock.unlock()
        DispatchQueue.main.async { handlers.forEach { $0() } }
    }
}
#endif
