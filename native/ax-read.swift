// FreeFlow ax-read (macOS): prints the text of the focused field as JSON, so
// FreeFlow can notice the corrections made right after it pasted a dictation.
// Same output as PasteHelper.exe --read-focused on Windows. Needs the
// Accessibility permission; secure (password) fields are never read.
// Build: swiftc -O native/ax-read.swift -o native/ax-read
import AppKit
import ApplicationServices

func emit(_ kind: String, _ text: String?) -> Never {
    let app = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
    var obj: [String: Any] = ["outcome": "focused", "kind": kind, "process": app]
    obj["text"] = text ?? NSNull()
    if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
        print(s)
    }
    exit(0)
}

func attribute(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}

guard AXIsProcessTrusted() else { emit("denied", nil) }
let system = AXUIElementCreateSystemWide()
guard let focused = attribute(system, kAXFocusedUIElementAttribute as String) else { emit("none", nil) }
let element = focused as! AXUIElement
if (attribute(element, kAXSubroleAttribute as String) as? String) == (kAXSecureTextFieldSubrole as String) {
    emit("password", nil)
}
guard var text = attribute(element, kAXValueAttribute as String) as? String else { emit("none", nil) }
if text.count > 50000 { text = String(text.prefix(50000)) }
emit("value", text)
