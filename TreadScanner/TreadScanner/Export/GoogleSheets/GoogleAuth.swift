import Foundation
import AuthenticationServices
import CryptoKit
import UIKit

/// OAuth 2.0 authorization-code flow with PKCE against Google, using an iOS client ID.
/// iOS clients have no secret, so nothing sensitive ships in the app. Tokens live in the Keychain.
@MainActor
final class GoogleAuth: NSObject, ObservableObject {
    static let shared = GoogleAuth()

    @Published private(set) var isSignedIn: Bool = Keychain.get(GoogleAuth.refreshKey) != nil
    @Published private(set) var accountEmail: String? = Keychain.get(GoogleAuth.emailKey)

    private static let refreshKey = "google.refresh_token"
    private static let accessKey = "google.access_token"
    private static let expiryKey = "google.access_expiry"
    private static let emailKey = "google.email"

    private var webSession: ASWebAuthenticationSession?

    private static let scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/userinfo.email"
    ]

    enum AuthError: LocalizedError {
        case notConfigured, cancelled, badResponse(String), notSignedIn
        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Google client ID is not set in Config.plist."
            case .cancelled: return "Sign-in cancelled."
            case .badResponse(let s): return "Google sign-in failed: \(s)"
            case .notSignedIn: return "Not signed in to Google."
            }
        }
    }

    // MARK: Sign in

    func signIn() async throws {
        guard let clientID = AppConfig.googleClientID, let scheme = AppConfig.redirectScheme else {
            throw AuthError.notConfigured
        }
        let verifier = GoogleAuth.randomURLSafe(64)
        let challenge = GoogleAuth.base64URL(SHA256.hash(data: Data(verifier.utf8)))
        let redirect = "\(scheme):/oauth2redirect"
        let state = GoogleAuth.randomURLSafe(16)

        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: GoogleAuth.scopes.joined(separator: " ")),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            .init(name: "access_type", value: "offline"),
            .init(name: "prompt", value: "consent")
        ]

        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: scheme) { url, error in
                if let url { cont.resume(returning: url) }
                else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { cont.resume(throwing: AuthError.cancelled) }
                else { cont.resume(throwing: error ?? AuthError.badResponse("no callback")) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.webSession = session
            session.start()
        }
        webSession = nil

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else {
            throw AuthError.badResponse("missing code")
        }

        let token = try await GoogleAuth.tokenRequest([
            "client_id": clientID,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect
        ])
        guard let refresh = token.refresh_token else { throw AuthError.badResponse("no refresh token") }
        Keychain.set(refresh, for: GoogleAuth.refreshKey)
        store(access: token)
        isSignedIn = true
        await fetchEmail()
    }

    func signOut() {
        Keychain.delete(GoogleAuth.refreshKey)
        Keychain.delete(GoogleAuth.accessKey)
        Keychain.delete(GoogleAuth.expiryKey)
        Keychain.delete(GoogleAuth.emailKey)
        isSignedIn = false
        accountEmail = nil
    }

    // MARK: Access token

    func accessToken() async throws -> String {
        if let token = Keychain.get(GoogleAuth.accessKey),
           let expiryString = Keychain.get(GoogleAuth.expiryKey),
           let expiry = Double(expiryString), expiry - Date().timeIntervalSince1970 > 60 {
            return token
        }
        guard let refresh = Keychain.get(GoogleAuth.refreshKey), let clientID = AppConfig.googleClientID else {
            throw AuthError.notSignedIn
        }
        let token = try await GoogleAuth.tokenRequest([
            "client_id": clientID,
            "refresh_token": refresh,
            "grant_type": "refresh_token"
        ])
        store(access: token)
        return token.access_token
    }

    private func store(access token: TokenResponse) {
        Keychain.set(token.access_token, for: GoogleAuth.accessKey)
        let expiry = Date().timeIntervalSince1970 + Double(token.expires_in ?? 3600)
        Keychain.set(String(expiry), for: GoogleAuth.expiryKey)
    }

    private func fetchEmail() async {
        guard let token = try? await accessToken(),
              let url = URL(string: "https://www.googleapis.com/oauth2/v3/userinfo") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let (data, _) = try? await URLSession.shared.data(for: req),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let email = json["email"] as? String {
            Keychain.set(email, for: GoogleAuth.emailKey)
            accountEmail = email
        }
    }

    // MARK: Token endpoint

    private struct TokenResponse: Decodable {
        var access_token: String
        var expires_in: Int?
        var refresh_token: String?
    }

    private static func tokenRequest(_ params: [String: String]) async throws -> TokenResponse {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = params.map { "\($0.key)=\(formEncode($0.value))" }.joined(separator: "&").data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw AuthError.badResponse(String(data: data, encoding: .utf8) ?? "token error")
        }
        return try JSONDecoder().decode(TokenResponse.self, from: data)
    }

    // MARK: Helpers

    private static func formEncode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    private static func randomURLSafe(_ count: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return String((0..<count).map { _ in chars[Int.random(in: 0..<chars.count)] })
    }

    private static func base64URL(_ digest: SHA256Digest) -> String {
        Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension GoogleAuth: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
