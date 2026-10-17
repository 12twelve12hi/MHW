import DaylightShareKit
import Foundation
import SafariServices

/// The Safari Web Extension's native side (iOS and macOS). The extension's JavaScript asks it for the pairing the app
/// stored in the App Group, so pairing once in the app also pairs Safari:
///
///   browser.runtime.sendNativeMessage('application.id', {type: 'getPairing'})
///     -> {ok: true, paired: true, pairing: {code, link, relay, name}, from} | {ok: true, paired: false}
///
/// See `SafariNativeMessaging` for the other messages.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: SafariNativeMessaging.answer(message)]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
