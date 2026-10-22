@testable import SendToDaylight
import XCTest

/// The iPhone's Lab rules that need no screen (LAB-PLAN 1.2, 1.7, F00.1, F00.4), on storage of their own
/// (`LabChecks`, hosted in the app). The screens are `LabFirstRunTests` and `LabNoteTests` (UI tests).
final class LabAppTests: XCTestCase {
    /// 1.2: this is a Wave 0 build, so no one-time note: `LAB_NOTE_ENABLED` is false and the running app applied it.
    @MainActor
    func testAWave0BuildHasNoOneTimeNote() {
        XCTAssertFalse(LabBuild.LAB_NOTE_ENABLED, "the iPhone's W0 build has neither F01 nor F04 (LAB-PLAN 1.2)")
        let note = LabChecks.appNote()
        XCTAssertFalse(note.enabled)
        XCTAssertFalse(note.shows)
    }

    /// F00.1: the first start after an update from the last non-Lab build turns Lab on (the key was missing) and
    /// stores it, shows no note in W0, and keeps the pairing and the history as they were.
    @MainActor
    func testAnUpdateTurnsLabOnAndKeepsThePairingAndHistory() async {
        let r = await LabChecks.upgrade()
        XCTAssertFalse(r.storedBefore, "the non-Lab build stored no Lab key")
        XCTAssertTrue(r.labOn, "a missing key means on")
        XCTAssertTrue(r.storedAfter, "the first start writes lab = true")
        XCTAssertFalse(r.noteShows, "a W0 build shows no note")
        XCTAssertNotNil(r.pairedBefore)
        XCTAssertEqual(r.pairedAfter, r.pairedBefore, "the pairing is kept")
        XCTAssertEqual(r.rowsBefore.count, 6)
        XCTAssertEqual(r.rowsAfter, r.rowsBefore, "the history is kept")
    }

    /// 1.2 and 1.7: a stored Lab off stays off at the next start; `-DLSLab 1` and `-DLSLab 0` set it.
    @MainActor
    func testTheSwitchIsKeptAndTheLaunchArgumentSetsIt() async {
        let lab = await LabChecks.restarts()
        XCTAssertEqual(lab, [false, true, false])
    }

    /// 1.1 and 1.2: the share sheet item follows the app's switch through the App Group; with storage of its own (a
    /// sideloaded build without the group) it starts on, as a fresh install does, and keeps what is stored.
    @MainActor
    func testTheShareSheetFollowsTheAppsLabSwitch() async {
        let shared = [await LabChecks.shareSheetLab(stored: nil, shared: true),
                      await LabChecks.shareSheetLab(stored: true, shared: true),
                      await LabChecks.shareSheetLab(stored: false, shared: true)]
        XCTAssertEqual(shared, [true, true, false], "with the App Group: the app's switch (on when never set)")
        let own = [await LabChecks.shareSheetLab(stored: nil, shared: false),
                   await LabChecks.shareSheetLab(stored: false, shared: false)]
        XCTAssertEqual(own, [true, false], "with storage of its own: on by default, then as stored")
    }

    /// F00.4: an item queued offline, then Lab turned off, goes out once the relay is back: Lab off never stops or
    /// drops what waits (1.3). The history, the pairing and the Daylight server's pin are all still there, and the
    /// status dump (1.7) says Lab is off, with the Inbox's capabilities and the item states.
    @MainActor
    func testAnItemQueuedOfflineIsSentAfterLabIsTurnedOff() async throws {
        let r = try await LabChecks.offlineThenLabOff()
        XCTAssertTrue(r.labBefore, "a fresh install has Lab on")
        XCTAssertEqual(r.queuedStatus, "failed")
        XCTAssertEqual(r.queuedError, "network", "queued as waiting for the network")
        XCTAssertFalse(r.labAfter)
        XCTAssertEqual(r.publishedToInbox, 1, "back online, the next pass published it once")
        XCTAssertEqual(r.sentStatus, "sent")
        XCTAssertEqual(r.rows.count, 1, "the history kept it")
        XCTAssertTrue(r.pairedKept, "the pairing is kept")
        XCTAssertTrue(r.pinKept, "the Daylight server's pin is kept")
        XCTAssertEqual(r.statusLab as? Bool, false)
        for key in ["lab", "caps", "labStates"] {
            XCTAssertTrue(r.statusKeys.contains(key), "the status dump has no \(key) (LAB-PLAN 1.7)")
        }
    }
}
