import DaylightShareKit
import Foundation
import SafariServices

/// The Safari Web Extension's native side (iOS and macOS). The extension's JavaScript asks it for the pairing the app
/// stored in the App Group, so pairing once in the app also pairs Safari:
///
///   browser.runtime.sendNativeMessage('application.id', {type: 'getPairing'})
///     -> {ok: true, paired: true, pairing: {code, link, relay, name}, from} | {ok: true, paired: false, shared}
///
/// Builds without an App Group (ad-hoc and unsigned Mac builds) answer `paired: false`, and the extension pairs in its
/// own popup. See `SafariNativeMessaging` for the other messages.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]
        // Storage is resolved off this thread (the App Group can be slow, or missing); answer once it is settled.
        SafariNativeMessaging.answerWhenReady(message) { answer in
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: answer]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }
}
