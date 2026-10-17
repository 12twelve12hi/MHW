import AppKit
import DaylightShareUI
import SwiftUI

/// The Share menu item (Safari, Finder, Preview, …): "Sending to <Daylight>… → Sent ✓", then it closes itself.
final class ShareViewController: NSViewController {
    private let model = ShareExtensionModel()

    override var nibName: NSNib.Name? { nil }

    override func loadView() {
        let host = NSHostingView(rootView: ShareExtensionView(model: model).frame(width: 360))
        host.frame = NSRect(x: 0, y: 0, width: 360, height: 260)
        view = host
        preferredContentSize = NSSize(width: 360, height: 260)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        model.onFinish = { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
        model.onCancel = { [weak self] in
            self?.extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
        }
        model.start(inputItems: extensionContext?.inputItems ?? [])
    }
}
