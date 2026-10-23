import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Upload tasks that outlive the process that started them: one background `URLSession` per share in place
/// (`BackgroundUploadSession`), a fake in tests.
public protocol BackgroundUploads: AnyObject {
    /// Starts one upload of `file` as the body of `request`, labelled `description` ("<id>:<part>:<attempt>").
    func upload(_ request: URLRequest, fromFile file: URL, description: String)
    /// The labels of the tasks that are still running or waiting (`getAllTasks`).
    func liveDescriptions() async -> [String]
    /// Cancels the tasks whose label `matches`.
    func cancel(where matches: @escaping (String) -> Bool) async
}

/// One background upload's answer, as the session heard it: the task's label, its HTTP status (nil when there was
/// none) and its error.
public typealias BackgroundAnswer = @Sendable (_ description: String, _ status: Int?, _ error: Error?) async -> Void

/// Share in place's first attempt (LAB-PLAN F04, iPhone and Mac with an App Group): the share extension builds the
/// frames as files (`FrameFileBuilder`, two passes, never the whole file in memory), saves the row `sending` with its
/// background attempt, starts one upload task per frame on that attempt's own background session and closes. The OS
/// finishes the uploads, and every answer goes to `complete`, in whichever process holds the session:
///
/// - **One session per share, per process.** Apple's rule for app extensions is one process per background session, and
///   one session object per identifier in a process. Each share in place gets its own session,
///   "com.daylight.share.bg.<attempt>" (`sessionIdentifier(attempt:)`): an extension process the OS reuses for a second
///   share makes a second session with another identifier, and the app never holds an identifier the extension uses.
///   `BackgroundUploadSession.connect` keeps one session object per identifier in a process.
/// - **The extension hears its own answers** while it still runs (a link's POST is usually answered within a second of
///   the card closing): the row becomes `sent` or `failed`, the frame files go and the failure notice is posted there.
/// - **The app hears the rest.** iPhone: the OS wakes it for a session whose extension has gone
///   (`handleEventsForBackgroundURLSession`, `handleEvents(identifier:…)`), the only time it connects to one. Mac: the app
///   is never woken for them, so it takes over a session once its share is `adoptAfter` (15 minutes) old, by which time
///   the extension that started it has ended (`adoptable`, `AppModel.refresh`); until then the share extension's process
///   hears the answers.
///
/// What an answer does:
/// - All parts 2xx: the row is `sent`. ntfy.sh dates an attachment from its upload, and the parts can finish hours
///   apart, so a row of more than one part counts as an attachment row and its `lastPublish` is the first part's
///   completion; when the last part completes more than 170 minutes after the first, part 0 may already be gone, and the
///   row is due for a re-send at once (`lastPublish` set back by the attachment wait).
/// - Any other answer: the row is `failed` or `expired` exactly as v1.1's attempt would leave it (PROTOCOL 3.1:
///   429 `network`, 413 `full`, another 4xx `refused`, 408, 5xx or no answer `network`), the attempt's other tasks are
///   cancelled (in place of "later frames are not published"), and the failure notice is posted (`FailureNotices`).
/// - An answer for an attempt the row no longer waits for (the app re-sent it, it was removed) is ignored.
///
/// Re-sends run in the app as today (`ShareSender`), from the stored body. A `sending` row whose attempt has live tasks
/// in a session this process holds is not stale (`liveAttempts(waiting:)`, once per tick); otherwise v1.1's 15 minutes
/// apply. Ad-hoc Mac builds (no App Group) publish in the extension as v1.1 does and never use this.
public final class BackgroundPublisher {
    /// The start of every share in place's background session identifier: "com.daylight.share.bg.<attempt>".
    public static let sessionPrefix = "com.daylight.share.bg."
    /// The frame files' folder beside the outbox.
    public static let folder = "bg"
    /// A row whose last part came this long after its first is re-sent at once (part 0 may have expired: 180 min).
    public static let partsApartLimit: TimeInterval = 170 * 60
    /// The Mac app takes over a share's session once the share is this old (v1.1's stale time): the extension process
    /// that started it has ended by then, so no two processes use one session.
    public static let adoptAfter: TimeInterval = DLS.sendingStale

    /// A new attempt id (a lowercased UUID): one per share in place, shared by its rows, and its session's name.
    public static func newAttempt() -> String { UUID().uuidString.lowercased() }

    /// The background session of one share in place: "com.daylight.share.bg.<attempt>".
    public static func sessionIdentifier(attempt: String) -> String { sessionPrefix + attempt }

    /// The attempt a session identifier belongs to, or nil when it is not one of ours.
    public static func attempt(ofSession identifier: String) -> String? {
        guard identifier.hasPrefix(sessionPrefix) else { return nil }
        let a = String(identifier.dropFirst(sessionPrefix.count))
        guard !a.isEmpty, !a.contains(":"), !a.contains(".") else { return nil }
        return a
    }

    /// The attempts the outbox still waits for: `sending` rows handed to a background session.
    public static func waiting(_ rows: [OutboxRow]) -> Set<String> {
        Set(rows.compactMap { $0.status == .sending ? $0.bgAttempt : nil })
    }

    /// The Mac app's take-overs (`adoptAfter`): the attempts of `sending` rows whose share is at least 15 minutes old.
    public static func adoptable(_ rows: [OutboxRow], now: Date) -> Set<String> {
        Set(rows.compactMap { r in
            guard r.status == .sending, let a = r.bgAttempt, now.timeIntervalSince(r.created) >= adoptAfter else { return nil }
            return a
        })
    }

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
    /// written to a file first; a link is one small frame. `attempt`: the share's attempt id, whose session `uploads` is
    /// (`sessionIdentifier(attempt:)`); every row of one share has the same one.
    @discardableResult
    public func start(_ input: ItemInput, file: URL? = nil, pairing: Pairing, from: String = "", app: String = "",
                      attempt: String = BackgroundPublisher.newAttempt(), chunkSize: Int = DLS.chunk,
                      nonces: [Data]? = nil) throws -> OutboxRow {
        var item = input
        if item.from == nil { item.from = from }
        if item.app == nil { item.app = app }
        if item.id == nil { item.id = ItemBuilder.newID() }
        let keys = pairing.keys
        let relay = try RelayClient(relay: pairing.relay)
        let fm = FileManager.default
        try fm.createDirectory(at: framesDirectory, withIntermediateDirectories: true)
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

    // MARK: Answers (the process that holds the session)

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

    /// The attempts with live tasks in this publisher's session.
    public func liveAttempts() async -> Set<String> {
        Set(await uploads.liveDescriptions().compactMap { Self.parse($0)?.attempt })
    }

    /// Deletes an item's frame files.
    public func removeFrames(_ id: String) {
        for f in FrameFileBuilder.frameFiles(id: id, in: framesDirectory) { try? FileManager.default.removeItem(at: f) }
    }

    // MARK: Sessions

    /// Holds a session weakly for its own answers (a session keeps its answer handler, so the handler must not keep it).
    public final class SessionBox: @unchecked Sendable {
        public weak var session: BackgroundUploads?
        public init() {}
    }

    /// What a session does with each answer it hears: `complete` on `store`'s outbox once storage is settled, cancelling
    /// through the session in `box` (the one that heard it), with `notices` for the failure notice.
    public static func answers(store: SharedStore, notices: FailureNotices?, daylightName: @escaping @Sendable () -> String?,
                               box: SessionBox) -> BackgroundAnswer {
        { description, status, error in
            await store.ready()
            guard let uploads = box.session else { return }
            let publisher = BackgroundPublisher(outbox: OutboxStore(store: store), uploads: uploads, notices: notices,
                                                daylightName: daylightName)
            _ = await publisher.complete(description: description, status: status, error: error)
        }
    }

    /// The attempts with live tasks in the sessions of `registry` (this process's), for
    /// `ShareSender.liveBackgroundAttempts`, once per tick. A session with no live task whose attempt the outbox no
    /// longer waits for (`waiting`) is let go (`release`), so no process holds it any more.
    static func liveAttempts<S: BackgroundUploads>(in registry: BackgroundSessionRegistry<S>, waiting: Set<String>,
                                                   release: (S) -> Void) async -> Set<String> {
        var out = Set<String>()
        for (identifier, session) in registry.all {
            let live = Set(await session.liveDescriptions().compactMap { Self.parse($0)?.attempt })
            out.formUnion(live)
            if live.isEmpty, let a = Self.attempt(ofSession: identifier), !waiting.contains(a),
               registry.remove(identifier, session) {
                release(session)
            }
        }
        return out
    }
}

/// The background sessions this process holds, one object per identifier (Apple: a process makes one session per
/// identifier; a second one with the same identifier is a duplicate the system warns about and may not deliver to).
final class BackgroundSessionRegistry<Session: AnyObject> {
    private let lock = NSLock()
    private var sessions: [String: Session] = [:]
    private var order: [String] = []

    /// The session for `identifier`: the one this process already has, else `make()`'s (kept). `made` says which.
    func session(_ identifier: String, make: () -> Session) -> (session: Session, made: Bool) {
        lock.lock()
        defer { lock.unlock() }
        if let s = sessions[identifier] { return (s, false) }
        let s = make()
        sessions[identifier] = s
        order.append(identifier)
        return (s, true)
    }

    /// Every session held, oldest first.
    var all: [(identifier: String, session: Session)] {
        lock.lock()
        defer { lock.unlock() }
        return order.compactMap { id -> (identifier: String, session: Session)? in
            guard let s = sessions[id] else { return nil }
            return (identifier: id, session: s)
        }
    }

    /// Forgets `session` (when it is still the one held for `identifier`); returns whether it did.
    @discardableResult
    func remove(_ identifier: String, _ session: Session) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let s = sessions[identifier], s === session else { return false }
        sessions[identifier] = nil
        order.removeAll { $0 == identifier }
        return true
    }
}

#if canImport(ObjectiveC)
/// One share in place's background `URLSession` ("com.daylight.share.bg.<attempt>", in the App Group's container): not
/// discretionary, waking the app when it ends while the extension has gone (iPhone), and giving each upload 24 hours.
/// Made with `connect`, which keeps one object per identifier in a process; every task's answer goes to its
/// `onAnswer`, and, when the OS woke the app for the session, the completion handler it was given (`finish`) is called
/// once every answer has been handled.
public final class BackgroundUploadSession: NSObject, BackgroundUploads, URLSessionTaskDelegate {
    public let identifier: String
    private var session: URLSession!
    private let lock = NSLock()
    private var finishHandlers: [() -> Void]
    private var answer: BackgroundAnswer
    /// Answers being handled: the OS's completion handler waits for them.
    private let answering = DispatchGroup()

    static let registry = BackgroundSessionRegistry<BackgroundUploadSession>()

    /// This process's session for `identifier`: the one it already holds, else a new one, which reconnects to the
    /// tasks the OS keeps under that identifier (the app woken for a share's session, or the Mac app taking one over).
    /// `onAnswer` hears every task's answer from now on; `finish` (the OS's completion handler, iPhone) is called once
    /// the session has delivered its events and every answer has been handled.
    public static func connect(identifier: String, appGroup: String?, finish: (() -> Void)? = nil,
                               onAnswer: @escaping BackgroundAnswer) -> BackgroundUploadSession {
        let held = registry.session(identifier) {
            BackgroundUploadSession(identifier: identifier, appGroup: appGroup, finish: finish, onAnswer: onAnswer)
        }
        if !held.made {
            held.session.setAnswer(onAnswer)
            if let finish { held.session.handleEvents(finish) }
        }
        return held.session
    }

    /// The share's session for `attempt`, whose answers `complete` handles on `store`'s outbox (and posts `notices`).
    @discardableResult
    public static func connect(attempt: String, store: SharedStore, notices: FailureNotices?,
                               daylightName: @escaping @Sendable () -> String?,
                               finish: (() -> Void)? = nil) -> BackgroundUploadSession {
        let box = BackgroundPublisher.SessionBox()
        let s = connect(identifier: BackgroundPublisher.sessionIdentifier(attempt: attempt), appGroup: store.appGroup,
                        finish: finish,
                        onAnswer: BackgroundPublisher.answers(store: store, notices: notices, daylightName: daylightName, box: box))
        box.session = s
        return s
    }

    /// The attempts with live tasks in the sessions this process holds; lets go of the sessions whose attempt the outbox
    /// no longer waits for (`waiting`) and that have no task left.
    public static func liveAttempts(waiting: Set<String>) async -> Set<String> {
        await BackgroundPublisher.liveAttempts(in: registry, waiting: waiting) { $0.release() }
    }

    /// iPhone's `application(_:handleEventsForBackgroundURLSession:completionHandler:)`: when `identifier` is a share's
    /// session, reconnects to it once `store` is settled (answers go to `complete`, notices to `notices`) and calls
    /// `completion` when they have been handled; returns false for any other identifier (call `completion` yourself).
    @discardableResult
    public static func handleEvents(identifier: String, store: SharedStore, notices: FailureNotices?,
                                    daylightName: @escaping @Sendable () -> String?,
                                    completion: @escaping () -> Void) -> Bool {
        guard let attempt = BackgroundPublisher.attempt(ofSession: identifier) else { return false }
        Task {
            await store.ready()
            BackgroundUploadSession.connect(attempt: attempt, store: store, notices: notices, daylightName: daylightName,
                                            finish: completion)
        }
        return true
    }

    private init(identifier: String, appGroup: String?, finish: (() -> Void)?, onAnswer: @escaping BackgroundAnswer) {
        self.identifier = identifier
        answer = onAnswer
        finishHandlers = finish.map { [$0] } ?? []
        super.init()
        let c = URLSessionConfiguration.background(withIdentifier: identifier)
        c.sharedContainerIdentifier = appGroup
        c.isDiscretionary = false
        #if os(iOS)
        c.sessionSendsLaunchEvents = true
        #endif
        c.timeoutIntervalForResource = 24 * 60 * 60
        // The handlers are in place before the session exists: it may deliver at once.
        session = URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }

    private func setAnswer(_ onAnswer: @escaping BackgroundAnswer) {
        lock.lock()
        answer = onAnswer
        lock.unlock()
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

    /// Adds the OS's completion handler (iPhone): called once the session has delivered its events and every answer
    /// has been handled.
    public func handleEvents(_ completion: @escaping () -> Void) {
        lock.lock()
        finishHandlers.append(completion)
        lock.unlock()
    }

    /// Lets go of the session (it has no task left): this process no longer holds the identifier.
    func release() {
        setAnswer { _, _, _ in }
        session.finishTasksAndInvalidate()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let status = (task.response as? HTTPURLResponse)?.statusCode
        let description = task.taskDescription ?? ""
        lock.lock()
        let answer = self.answer
        lock.unlock()
        let group = answering
        group.enter()
        Task.detached {
            await answer(description, status, error)
            group.leave()
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        answering.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let handlers = self.finishHandlers
            self.finishHandlers = []
            self.lock.unlock()
            handlers.forEach { $0() }
        }
    }
}
#endif
