import Foundation

/// Same rules as `nameMatches` in src/features/hode/signals.ts: case-insensitive, trimmed,
/// and `*` matches any run of characters. Everything else is literal.
public enum NameMatcher {
    public static func matches(pattern: String, name: String) -> Bool {
        let p = normalize(pattern)
        let n = normalize(name)
        guard p.contains("*") else { return p == n }
        let body = p.split(separator: "*", omittingEmptySubsequences: false)
            .map { NSRegularExpression.escapedPattern(for: String($0)) }
            .joined(separator: ".*")
        return n.range(of: "^\(body)$", options: .regularExpression) != nil
    }

    private static func normalize(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "…", with: "...")
    }
}
